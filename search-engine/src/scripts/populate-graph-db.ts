import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { MongoClient, ObjectId, type Db } from 'mongodb'
import { getDb } from '../lib/mongodb'
import type { ChapterGraph, RawEntity, RawGraphOutput, RawRelation } from './extract-graph'

interface CliOptions {
  inputPath: string
  strictRelations: boolean
  autoCreateMissing: boolean
}

type EntityDoc = RawEntity & {
  _id?: ObjectId
  created_at: Date
  updated_at: Date
}

type RelationDoc = RawRelation & {
  _id?: ObjectId
  source_entity_id: ObjectId
  target_entity_id: ObjectId
  created_at: Date
  updated_at: Date
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
  const strictRelations = (args.get('--strict-relations') ?? 'true') !== 'false'
  const autoCreateMissing = (args.get('--auto-create-missing') ?? 'true') !== 'false'

  return { inputPath, strictRelations, autoCreateMissing }
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

function mergeEntitiesFromGraph(graph: RawGraphOutput): RawEntity[] {
  const bySlug = new Map<string, RawEntity>()

  for (const e of safeArray<RawEntity>(graph.merged_entities)) {
    bySlug.set(e.slug, e)
  }

  for (const ch of safeArray<ChapterGraph>(graph.chapters)) {
    for (const e of safeArray<RawEntity>(ch?.entities)) {
      const existing = bySlug.get(e.slug)
      if (!existing || (e.description?.length ?? 0) > (existing.description?.length ?? 0)) {
        bySlug.set(e.slug, e)
      }
    }
  }

  return [...bySlug.values()]
}

function collectRelations(graph: RawGraphOutput): RawRelation[] {
  const uniq = new Map<string, RawRelation>()
  for (const ch of safeArray<ChapterGraph>(graph.chapters)) {
    for (const r of safeArray<RawRelation>(ch?.relations)) {
      const k = `${r.source_slug}|${r.relation_type}|${r.target_slug}|${r.evidence_verse_id}`
      if (!uniq.has(k)) uniq.set(k, r)
    }
  }
  return [...uniq.values()]
}

async function ensureIndexes(db: Db): Promise<void> {
  const entities = db.collection<EntityDoc>('entities')
  const relations = db.collection<RelationDoc>('relations')

  await entities.createIndex({ slug: 1 }, { unique: true, name: 'ux_entities_slug' })
  await relations.createIndex({ source_slug: 1 }, { name: 'ix_rel_source_slug' })
  await relations.createIndex({ target_slug: 1 }, { name: 'ix_rel_target_slug' })
  await relations.createIndex(
    { source_entity_id: 1, target_entity_id: 1, relation_type: 1, evidence_verse_id: 1 },
    { unique: true, name: 'ux_rel_edge' }
  )
}

async function upsertEntities(db: Db, entitiesIn: RawEntity[]): Promise<void> {
  if (entitiesIn.length === 0) return
  const entities = db.collection<EntityDoc>('entities')
  const now = new Date()

  await entities.bulkWrite(
    entitiesIn.map((e) => ({
      updateOne: {
        filter: { slug: e.slug },
        update: {
          $setOnInsert: { created_at: now },
          $set: {
            slug: e.slug,
            name: e.name,
            type: e.type,
            source_verse_id: e.source_verse_id,
            updated_at: now
          }
        },
        upsert: true
      }
    })),
    { ordered: false }
  )

  // Keep longest description deterministically
  for (const e of entitiesIn) {
    const current = await entities.findOne(
      { slug: e.slug },
      { projection: { _id: 1, description: 1 } }
    )
    if (!current || !current._id) continue
    if (!current.description || e.description.length > current.description.length) {
      await entities.updateOne(
        { _id: current._id },
        { $set: { description: e.description, updated_at: now } }
      )
    }
  }
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
          relation_type: r.relation_type,
          evidence_verse_id: r.evidence_verse_id
        },
        update: {
          $setOnInsert: { created_at: now },
          $set: {
            source_entity_id: sourceId,
            target_entity_id: targetId,
            source_slug: r.source_slug,
            target_slug: r.target_slug,
            relation_type: r.relation_type,
            evidence_verse_id: r.evidence_verse_id,
            updated_at: now
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
          { name: { $in: nameCandidates } }
        ]
      },
      { projection: { _id: 1 } }
    )
    .toArray()

  return docs.map((d) => d._id!).filter(Boolean)
}

async function checkBethleemJudee(db: Db): Promise<boolean> {
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

  if (bethleemIds.length === 0 || judeeIds.length === 0) return false

  // Accept either direction + common geographic relation types
  const edge = await relations.findOne({
    $or: [
      {
        source_entity_id: { $in: bethleemIds },
        target_entity_id: { $in: judeeIds },
        relation_type: { $in: ['LOCATED_IN', 'SITUE_DANS', 'EVENT_AT', 'VOYAGE_VERS'] }
      },
      {
        source_entity_id: { $in: judeeIds },
        target_entity_id: { $in: bethleemIds },
        relation_type: { $in: ['LOCATED_IN', 'SITUE_DANS', 'EVENT_AT', 'VOYAGE_VERS'] }
      }
    ]
  })

  return Boolean(edge)
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
            description: 'Entité créée automatiquement depuis une relation orpheline.',
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

  const MONGODB_URI = process.env.DATABASE_URL;
  const DB_NAME = process.env.MONGODB_DB_NAME ?? "bible_sg";

  if (!MONGODB_URI) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }

  const entitiesIn = mergeEntitiesFromGraph(graph)
  const relationsIn = collectRelations(graph)
  const client = new MongoClient(MONGODB_URI);
  const db = client.db(DB_NAME);
  try {
    await ensureIndexes(db)
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

    console.log('[graph-populate] Summary')
    console.log(`- entities upserted input: ${entitiesIn.length}`)
    console.log(`- auto-created missing entities: ${autoCreated}`)
    console.log(`- relations upserted input: ${relStats.processed}`)
    console.log(`- relations skipped invalid: ${relStats.skipped}`)
    console.log(`- total nodes (entities): ${totalEntities}`)
    console.log(`- total edges (relations): ${totalRelations}`)
    console.log(`- DoD check Bethléem -> Judée: ${bethleemLinked ? 'OK' : 'NOT FOUND'}`)
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2))
    await populateGraphDatabase(options)
}

main().catch((err) => {
  console.error('[graph-populate] ❌', err)
  process.exit(1)
})