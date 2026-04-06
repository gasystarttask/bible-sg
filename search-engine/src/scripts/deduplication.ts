import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { MongoClient, ObjectId, type Db } from 'mongodb'
import { mergeEntities } from './extract-graph';
import { RawEntity, RawRelation, AliasConfig, RawGraphOutput, ChapterGraph } from '@search/types/entity.type';
import { ResolvedEntity, EntityDoc, RelationDoc } from '@search/types/relation-doc.type';

interface CliOptions {
  inputPath: string
  aliasConfigPath: string
  strictRelations: boolean
  autoCreateMissing: boolean
}

const DEFAULT_ALIAS_TO_CANONICAL: Record<string, string> = {
  jesus: 'jesus-christ',
  christ: 'jesus-christ',
  jesuschrist: 'jesus-christ',
  jesusdenazareth: 'jesus-christ',
  jesuschristdenazareth: 'jesus-christ',
  jesusnazareth: 'jesus-christ',
  'jesusde-nazareth': 'jesus-christ',
  'jesus-nazareth': 'jesus-christ',
  'jesus-christ-de-nazareth': 'jesus-christ',
  'jesus-de-nazareth': 'jesus-christ',
  leseigneur: 'jesus-christ',
  seigneur: 'jesus-christ',
  filsdelhomme: 'jesus-christ',
  simonpierre: 'pierre',
  'simon-pierre': 'pierre',
  cephas: 'pierre',
  kephas: 'pierre',
  cefas: 'pierre'
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k?.startsWith('--') && v && !v.startsWith('--')) {
      args.set(k, v)
      i += 1
    }
  }

  const inputPath = path.resolve(process.cwd(), args.get('--input') ?? '../data/raw_graph.json')
  const aliasConfigPath = path.resolve(
    process.cwd(),
    args.get('--alias-config') ?? '../data/entity-alias-overrides.json'
  )
  const strictRelations = (args.get('--strict-relations') ?? 'true') !== 'false'
  const autoCreateMissing = (args.get('--auto-create-missing') ?? 'true') !== 'false'

  return { inputPath, aliasConfigPath, strictRelations, autoCreateMissing }
}

function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function normalizeKey(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function toValidEntity(v: Partial<RawEntity>): RawEntity | null {
  if (!isNonEmptyString(v.slug)) return null
  if (!isNonEmptyString(v.name)) return null
  if (!isNonEmptyString(v.type)) return null
  if (!isNonEmptyString(v.source_verse_id)) return null
  return {
    ...v,
    slug: v.slug,
    name: v.name,
    type: v.type,
    source_verse_id: v.source_verse_id,
    description: typeof v.description === 'string' ? v.description : ''
  } as RawEntity
}

function toValidRelation(v: Partial<RawRelation>): RawRelation | null {
  if (!isNonEmptyString(v.source_slug)) return null
  if (!isNonEmptyString(v.target_slug)) return null
  if (!isNonEmptyString(v.relation_type)) return null
  if (!isNonEmptyString(v.evidence_verse_id)) return null
  return {
    source_slug: v.source_slug,
    target_slug: v.target_slug,
    relation_type: v.relation_type,
    evidence_verse_id: v.evidence_verse_id
  } as RawRelation
}

async function loadAliasConfig(aliasConfigPath: string): Promise<AliasConfig> {
  try {
    const raw = await readFile(aliasConfigPath, 'utf-8')
    return JSON.parse(raw) as AliasConfig
  } catch {
    return {}
  }
}

function collectEntities(graph: RawGraphOutput): RawEntity[] {
  const chapters = safeArray<ChapterGraph>(graph.chapters)
  if (chapters.length > 0) {
    return [...mergeEntities(chapters).values()].map((e) => toValidEntity(e)).filter(Boolean) as RawEntity[]
  }

  const out: RawEntity[] = []
  for (const e of safeArray<RawEntity>(graph.merged_entities)) {
    const ok = toValidEntity(e)
    if (ok) out.push(ok)
  }
  return out
}

function collectRelations(graph: RawGraphOutput): RawRelation[] {
  const uniq = new Map<string, RawRelation>()
  for (const ch of safeArray<ChapterGraph>(graph.chapters)) {
    for (const r of safeArray<RawRelation>(ch?.relations)) {
      const ok = toValidRelation(r)
      if (!ok) continue
      const k = `${ok.source_slug}|${ok.relation_type}|${ok.target_slug}|${ok.evidence_verse_id}`
      if (!uniq.has(k)) uniq.set(k, ok)
    }
  }
  return [...uniq.values()]
}

function buildCanonicalSlugMap(entitiesIn: RawEntity[], cfg: AliasConfig): Map<string, string> {
  const aliasToCanonical = new Map<string, string>()

  const register = (alias: string, canonical: string): void => {
    if (!isNonEmptyString(alias) || !isNonEmptyString(canonical)) return
    aliasToCanonical.set(normalizeKey(alias), canonical)
  }

  for (const [alias, canonical] of Object.entries(DEFAULT_ALIAS_TO_CANONICAL)) {
    register(alias, canonical)
  }

  for (const [alias, canonical] of Object.entries(cfg.alias_to_canonical ?? {})) {
    register(alias, canonical)
  }

  const map = new Map<string, string>()
  for (const e of entitiesIn) {
    const bySlug = aliasToCanonical.get(normalizeKey(e.slug))
    const byName = aliasToCanonical.get(normalizeKey(e.name))
    const canonical = bySlug ?? byName ?? e.slug
    map.set(e.slug, canonical)
  }

  return map
}

function resolveEntities(
  entitiesIn: RawEntity[],
  canonicalSlugBySlug: Map<string, string>,
  cfg: AliasConfig
): ResolvedEntity[] {
  const buckets = new Map<
    string,
    {
      entity: RawEntity
      aliases: Set<string>
    }
  >()

  for (const e of entitiesIn) {
    const canonicalSlug = canonicalSlugBySlug.get(e.slug) ?? e.slug
    const meta = cfg.canonical_meta?.[canonicalSlug]

    const bucket = buckets.get(canonicalSlug)
    if (!bucket) {
      buckets.set(canonicalSlug, {
        entity: {
          ...e,
          slug: canonicalSlug,
          name: meta?.name ?? e.name,
          type: (meta?.type as RawEntity['type']) ?? e.type
        },
        aliases: new Set([e.slug, e.name])
      })
      continue
    }

    bucket.aliases.add(e.slug)
    bucket.aliases.add(e.name)

    // On ne remplace plus arbitrairement la description.
    // La fusion est faite en base via description_fragments.
    if (!bucket.entity.source_verse_id && e.source_verse_id) {
      bucket.entity.source_verse_id = e.source_verse_id
    }
  }

  for (const [canonicalSlug, aliases] of Object.entries(cfg.canonical_aliases ?? {})) {
    const bucket = buckets.get(canonicalSlug)
    if (!bucket) continue
    for (const a of aliases) {
      if (isNonEmptyString(a)) bucket.aliases.add(a)
    }
  }

  const resolved: ResolvedEntity[] = []
  for (const [slug, { entity, aliases }] of buckets) {
    const aliasList = [...aliases]
      .filter((a) => isNonEmptyString(a))
      .filter((a) => normalizeKey(a) !== normalizeKey(slug))
      .filter((a) => normalizeKey(a) !== normalizeKey(entity.name))
      .sort((a, b) => a.localeCompare(b))

    resolved.push({
      ...entity,
      slug,
      aliases: aliasList
    })
  }

  return resolved
}

function normalizeRelations(
  relationsIn: RawRelation[],
  canonicalSlugBySlug: Map<string, string>
): RawRelation[] {
  const uniq = new Map<string, RawRelation>()
  for (const r of relationsIn) {
    const source_slug = canonicalSlugBySlug.get(r.source_slug) ?? r.source_slug
    const target_slug = canonicalSlugBySlug.get(r.target_slug) ?? r.target_slug
    const normalized: RawRelation = { ...r, source_slug, target_slug }
    const k = `${normalized.source_slug}|${normalized.relation_type}|${normalized.target_slug}|${normalized.evidence_verse_id}`
    if (!uniq.has(k)) uniq.set(k, normalized)
  }
  return [...uniq.values()]
}

async function upsertEntities(db: Db, entitiesIn: ResolvedEntity[]): Promise<void> {
  if (entitiesIn.length === 0) return
  const entities = db.collection<EntityDoc>('entities')
  const now = new Date()

  await entities.bulkWrite(
    entitiesIn.map((e) => {
      const incomingDescription = (e.description ?? '').trim()

      return {
        updateOne: {
          filter: { slug: e.slug },
          update: [
            {
              $set: {
                created_at: { $ifNull: ['$created_at', now] },
                updated_at: now,
                slug: e.slug,
                name: e.name,
                type: e.type,
                source_verse_id: e.source_verse_id,
                aliases: { $setUnion: [{ $ifNull: ['$aliases', []] }, e.aliases] },
                _incoming_desc: incomingDescription
              }
            },
            {
              $set: {
                description_fragments: {
                  $cond: [
                    { $eq: ['$_incoming_desc', ''] },
                    { $ifNull: ['$description_fragments', []] },
                    { $setUnion: [{ $ifNull: ['$description_fragments', []] }, ['$_incoming_desc']] }
                  ]
                }
              }
            },
            {
              $set: {
                description: {
                  $reduce: {
                    input: '$description_fragments',
                    initialValue: '',
                    in: {
                      $cond: [
                        { $eq: ['$$value', ''] },
                        '$$this',
                        { $concat: ['$$value', ' | ', '$$this'] }
                      ]
                    }
                  }
                }
              }
            },
            { $unset: '_incoming_desc' }
          ],
          upsert: true
        }
      }
    }),
    { ordered: false }
  )
}

async function buildSlugToIdMap(db: Db): Promise<Map<string, ObjectId>> {
  const entities = db.collection<EntityDoc>('entities')
  const rows = await entities.find({}, { projection: { _id: 1, slug: 1 } }).toArray()
  const map = new Map<string, ObjectId>()
  for (const row of rows) {
    if (row._id && row.slug) map.set(row.slug, row._id)
  }
  return map
}

async function upsertRelations(
  db: Db,
  rels: RawRelation[],
  slugToId: Map<string, ObjectId>,
  strictRelations: boolean
): Promise<{ processed: number; skipped: number }> {
  if (rels.length === 0) return { processed: 0, skipped: 0 }

  const relations = db.collection<RelationDoc>('relations')
  const now = new Date()

  const ops: Array<Parameters<typeof relations.bulkWrite>[0][number]> = []
  let skipped = 0

  for (const r of rels) {
    const sourceId = slugToId.get(r.source_slug)
    const targetId = slugToId.get(r.target_slug)

    if (!sourceId || !targetId) {
      if (strictRelations) {
        throw new Error(
          `Invalid relation reference: ${r.source_slug} -${r.relation_type}-> ${r.target_slug}`
        )
      }
      skipped += 1
      continue
    }

    ops.push({
      updateOne: {
        filter: {
          source_entity_id: sourceId,
          target_entity_id: targetId,
          relation_type: r.relation_type
        },
        update: {
          $setOnInsert: {
            created_at: now,
            evidence_verse_id: r.evidence_verse_id
          },
          $set: {
            source_entity_id: sourceId,
            target_entity_id: targetId,
            source_slug: r.source_slug,
            target_slug: r.target_slug,
            relation_type: r.relation_type,
            updated_at: now
          },
          $addToSet: {
            evidence_verse_ids: r.evidence_verse_id
          }
        },
        upsert: true
      }
    })
  }

  if (ops.length > 0) {
    await relations.bulkWrite(ops, { ordered: false })
  }

  return { processed: ops.length, skipped }
}

async function findEntityIdsBySlugOrName(
  db: Db,
  slugCandidates: string[],
  nameCandidates: string[]
): Promise<ObjectId[]> {
  const entities = db.collection<EntityDoc>('entities')

  const docs = await entities
    .find(
      {
        $or: [
          { slug: { $in: slugCandidates } },
          { name: { $in: nameCandidates } },
          { aliases: { $in: [...slugCandidates, ...nameCandidates] } }
        ]
      },
      { projection: { _id: 1 } }
    )
    .toArray()

  return docs.map((d) => d._id!).filter(Boolean)
}

async function checkSingleCanonicalNode(
  db: Db,
  candidates: string[]
): Promise<{ ok: boolean; distinctCount: number }> {
  const ids = await findEntityIdsBySlugOrName(db, candidates, candidates)
  const uniq = new Set(ids.map((id) => id.toString()))
  return { ok: uniq.size === 1, distinctCount: uniq.size }
}

async function checkBethleemJudee(db: Db): Promise<boolean> {
  const entities = db.collection<EntityDoc>('entities')
  const relations = db.collection<RelationDoc>('relations')

  const bethleemIds = await findEntityIdsBySlugOrName(
    db,
    ['bethleem', 'bethlehem', 'bethleem-de-judee', 'bethlehem-de-judee'],
    ['Bethléem', 'Bethlehem', 'Bethléem de Judée', 'Bethlehem de Judée']
  )

  const judeeIds = await findEntityIdsBySlugOrName(
    db,
    ['judee', 'judea', 'province-de-judee', 'region-de-judee'],
    ['Judée', 'Judea', 'Province de Judée', 'Région de Judée']
  )

  // 1) If a "Bethléem de Judée" style entity exists, accept implicit linkage
  const implicit = await entities.findOne({
    _id: { $in: bethleemIds },
    $or: [
      { slug: { $regex: /beth(le)?em.*jud(e|é)e/i } },
      { name: { $regex: /beth(le)?em.*jud(e|é)e/i } }
    ]
  })
  if (implicit) return true

  if (bethleemIds.length === 0 || judeeIds.length === 0) return false

  // 2) Direct edge in either direction (any relation type)
  const direct = await relations.findOne({
    $or: [
      { source_entity_id: { $in: bethleemIds }, target_entity_id: { $in: judeeIds } },
      { source_entity_id: { $in: judeeIds }, target_entity_id: { $in: bethleemIds } }
    ]
  })

  return Boolean(direct)
}

async function ensureRelationEndpointEntities(
  db: Db,
  relationsIn: RawRelation[]
): Promise<number> {
  const entities = db.collection<EntityDoc>('entities')
  const now = new Date()

  const required = new Set<string>()
  for (const r of relationsIn) {
    required.add(r.source_slug)
    required.add(r.target_slug)
  }

  const existing = await entities
    .find({ slug: { $in: [...required] } }, { projection: { slug: 1 } })
    .toArray()

  const existingSlugs = new Set(existing.map((e) => e.slug))
  const missing = [...required].filter((s) => !existingSlugs.has(s))
  if (missing.length === 0) return 0

  const firstEvidenceBySlug = new Map<string, string>()
  for (const r of relationsIn) {
    if (!firstEvidenceBySlug.has(r.source_slug)) {
      firstEvidenceBySlug.set(r.source_slug, r.evidence_verse_id)
    }
    if (!firstEvidenceBySlug.has(r.target_slug)) {
      firstEvidenceBySlug.set(r.target_slug, r.evidence_verse_id)
    }
  }

  await entities.bulkWrite(
    missing.map((slug) => ({
      updateOne: {
        filter: { slug },
        update: {
          $setOnInsert: {
            slug,
            name: slugToLabel(slug),
            type: 'Object',
            aliases: [],
            description: 'Entité créée automatiquement depuis une relation orpheline.',
            description_fragments: ['Entité créée automatiquement depuis une relation orpheline.'],
            source_verse_id: firstEvidenceBySlug.get(slug) ?? 'unknown',
            created_at: now,
            updated_at: now
          }
        },
        upsert: true
      }
    })),
    { ordered: false }
  )

  return missing.length
}

export async function populateGraphDatabase(options: CliOptions): Promise<void> {
  const raw = await readFile(options.inputPath, 'utf-8')
  const graph = JSON.parse(raw) as RawGraphOutput
  const aliasConfig = await loadAliasConfig(options.aliasConfigPath)

  const MONGODB_URI = process.env.DATABASE_URL
  const DB_NAME = process.env.MONGODB_DB_NAME ?? 'bible_sg'

  if (!MONGODB_URI) {
    throw new Error('Missing DATABASE_URL environment variable.')
  }

  const entitiesRaw = collectEntities(graph)
  const relationsRaw = collectRelations(graph)

  const canonicalSlugBySlug = buildCanonicalSlugMap(entitiesRaw, aliasConfig)
  const entitiesIn = resolveEntities(entitiesRaw, canonicalSlugBySlug, aliasConfig)
  const relationsIn = normalizeRelations(relationsRaw, canonicalSlugBySlug)

  const client = new MongoClient(MONGODB_URI)
  const db = client.db(DB_NAME)

  try {
    await upsertEntities(db, entitiesIn)

    let autoCreated = 0
    if (options.autoCreateMissing) {
      autoCreated = await ensureRelationEndpointEntities(db, relationsIn)
    }

    const slugToId = await buildSlugToIdMap(db)
    const relStats = await upsertRelations(db, relationsIn, slugToId, options.strictRelations)

    const totalEntities = await db.collection('entities').countDocuments()
    const totalRelations = await db.collection('relations').countDocuments()
    const bethleemLinked = await checkBethleemJudee(db)

    const jesusChrist = await checkSingleCanonicalNode(db, [
      'Jésus',
      'Jesus',
      'Christ',
      'Jésus Christ',
      'jesus',
      'jesus-christ',
      'jesus-nazareth',
      'jesus-de-nazareth'
    ])

    const simonPierreCephas = await checkSingleCanonicalNode(db, [
      'Simon-Pierre',
      'Simon Pierre',
      'Céphas',
      'Cephas',
      'Kephas',
      'pierre'
    ])

    console.log('[graph-dedup] Summary')
    console.log(`- entities raw collected: ${entitiesRaw.length}`)
    console.log(`- entities canonicalized: ${entitiesIn.length}`)
    console.log(`- relation edges raw collected: ${relationsRaw.length}`)
    console.log(`- relation edges canonicalized: ${relationsIn.length}`)
    console.log(`- auto-created missing entities: ${autoCreated}`)
    console.log(`- relations processed input: ${relStats.processed}`)
    console.log(`- relations skipped invalid: ${relStats.skipped}`)
    console.log(`- total nodes (entities): ${totalEntities}`)
    console.log(`- total edges (relations): ${totalRelations}`)
    console.log(`- DoD check Bethléem -> Judée: ${bethleemLinked ? 'OK' : 'NOT FOUND'}`)
    console.log(
      `- DoD check 'Jésus'/'Christ' => same node: ${jesusChrist.ok ? 'OK' : `FAILED (${jesusChrist.distinctCount})`}`
    )
    console.log(
      `- DoD check 'Simon-Pierre'/'Céphas' => same node: ${simonPierreCephas.ok ? 'OK' : `FAILED (${simonPierreCephas.distinctCount})`}`
    )
  } finally {
    await client.close()
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  await populateGraphDatabase(options)
}

main().catch((err) => {
  console.error('[graph-dedup] ❌', err)
  process.exit(1)
})