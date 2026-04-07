import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  EntityTypeEnum,
  RelationTypeEnum,
  validateGraph
} from '@search/shared/schemas/graph'
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import PQueue from 'p-queue'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  VerseRecord,
  ChapterGraph,
  RawGraphOutput,
  LlmClient,
  RawEntity,
  RawRelation,
  RunOptions
} from '@search/types/entity.type'
import { TargetBook } from '@search/types/target-book.type'

const VERSE_ID_RE = /^b\.([A-Z0-9]+)\.(\d+)\.(\d+)$/
const DEFAULT_BOOKS: TargetBook[] = ['GEN', 'MAT', 'ACT']

type JsonRecord = Record<string, unknown>
type EntityType = z.infer<typeof EntityTypeEnum>
type RelationType = z.infer<typeof RelationTypeEnum>

interface RelationCandidate extends RawRelation {
  source_type?: EntityType
  target_type?: EntityType
  justification?: string
}

const ENDPOINT_TYPES = new Set<EntityType>(['Person', 'Location'])

const STRICT_RELATION_TYPES = new Set<RelationType>([
  'FATHER_OF',
  'MOTHER_OF',
  'SUCCESSOR_OF',
  'ANOINTED_BY',
  'SON_OF',
  'DAUGHTER_OF',
  'SPOUSE_OF',
  'BROTHER_OF',
  'SISTER_OF',
  'TRAVELS_TO',
  'LOCATED_IN',
  'FOLLOWER_OF',
  'INTERACTS_WITH',
  'DESCRIBES_AS',
  'FULFILLS',
  'SYMBOLISES',
  'EVENT_AT',
  'SLAVE_OF',
  'OPPOSES'
])

const NOISY_OBJECT_SLUGS = new Set<string>([
  'roc',
  'rocher',
  'sable',
  'bois',
  'vetement',
  'vetements',
  'arbre',
  'arbre-fruitier',
  'foule',
  'multitude'
])

const IMPORTANT_OBJECT_WHITELIST = new Set<string>([
  'arche-de-l-alliance',
  'tabernacle',
  'temple',
  'autel'
])

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function progressLabel(index: number, total: number): string {
  const pct = total === 0 ? 100 : Math.round(((index + 1) / total) * 100)
  return `[${index + 1}/${total} - ${pct}%]`
}

function toVerseRecord(value: unknown): VerseRecord | null {
  if (!isRecord(value)) return null

  const verseId = readString(value.verse_id ?? value.id, '')
  const text = readString(value.text, '')
  const parsed = parseVerseId(verseId)

  if (!verseId || !text || !parsed) {
    return null
  }

  return {
    verse_id: verseId,
    text,
    book: parsed.book,
    chapter: readNumber(value.chapter) ?? parsed.chapter,
    verse: readNumber(value.verse) ?? parsed.verse
  }
}

function normalizeVerse(v: VerseRecord): VerseRecord {
  const parsed = parseVerseId(v.verse_id)

  if (!parsed) return v

  return {
    ...v,
    book: v.book ?? parsed.book,
    chapter: v.chapter ?? parsed.chapter,
    verse: v.verse ?? parsed.verse
  }
}

function getRetryAfterSeconds(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const maybe = error as { status?: number; headers?: Headers | Record<string, string> }
  if (maybe.status !== 429) return null

  const headers = maybe.headers
  if (!headers) return null

  if (headers instanceof Headers) {
    const v = headers.get('retry-after')
    return v ? Number(v) : null
  }

  const raw = headers['retry-after'] ?? headers['Retry-After']
  return raw ? Number(raw) : null
}

async function savePartialOutput(
  chapters: ChapterGraph[],
  books: string[],
  outputPath: string,
  verbose = true
): Promise<void> {
  const output: RawGraphOutput = {
    generated_at: new Date().toISOString(),
    books,
    chapters,
    merged_entities: [...mergeEntities(chapters).values()]
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8')

  if (verbose) {
    console.log(
      `[extract-graph] ⚠️  PARTIAL SAVE: ${chapters.length} chapters saved to ${outputPath}`
    )
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function parseVerseId(verseId: string): { book: string; chapter: number; verse: number } | null {
  const m = VERSE_ID_RE.exec(verseId)
  if (!m) return null
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) }
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
}

function extractJsonCandidate(input: string): string {
  const startToken = '__JSON_START__'
  const endToken = '__JSON_END__'

  const tokenStart = input.indexOf(startToken)
  const tokenEnd = input.lastIndexOf(endToken)

  if (tokenStart >= 0 && tokenEnd > tokenStart) {
    return input.slice(tokenStart + startToken.length, tokenEnd).trim()
  }

  const firstBrace = input.indexOf('{')
  const lastBrace = input.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return input.slice(firstBrace, lastBrace + 1).trim()
  }

  return input.trim()
}

function tryParseModelJson(raw: string): unknown | null {
  const candidates = [
    stripCodeFence(raw),
    extractJsonCandidate(stripCodeFence(raw)),
    extractJsonCandidate(raw)
  ]

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // try next candidate
    }
  }

  return null
}

function buildJsonRepairPrompt(raw: string): string {
  return [
    'Répare ce JSON invalide.',
    'Contraintes:',
    '- Ne change pas le sens.',
    '- Retourne uniquement un JSON valide.',
    '- Aucun texte hors JSON.',
    '',
    'JSON à réparer:',
    raw
  ].join('\n')
}

async function parseOrRepairModelJson(raw: string, llm: LlmClient): Promise<unknown | null> {
  const parsed = tryParseModelJson(raw)
  if (parsed !== null) return parsed

  const repairedRaw = await llm.invoke(buildJsonRepairPrompt(raw))
  return tryParseModelJson(repairedRaw)
}

export function buildExtractionPrompt(args: {
  book: string
  chapter: number
  verses: VerseRecord[]
}): string {
  const { book, chapter, verses } = args
  const verseLines = verses.map((v) => `- ${v.verse_id}: ${v.text}`).join('\n')

  return [
    'Tu es un expert biblique spécialisé dans la construction de graphes de connaissances.',
    '',
    'Toute l\'extraction doit être faite en FRANÇAIS.',
    '',
    'RÈGLES STRICTES :',
    '1) Noms : Utilise les noms bibliques français (ex: "Éternel" ou "Dieu", "Abram", "Moïse").',
    '2) Description : Rédige une description courte en français.',
    '3) Types d\'entités : Person, Location, Object, Event.',
    '4) Relations autorisées (liste fermée) :',
    '   FATHER_OF, MOTHER_OF, SON_OF, DAUGHTER_OF, SPOUSE_OF, BROTHER_OF, SISTER_OF,',
    '   TRAVELS_TO, LOCATED_IN, FOLLOWER_OF, INTERACTS_WITH, EVENT_AT.',
    '5) Pour chaque relation, fournis: source_type, target_type (Person|Location) + justification.',
    '6) source_type et target_type doivent être Person ou Location uniquement.',
    '7) Pas d\'anglais dans les champs de contenu (sauf constantes relation_type).',
    '',
    'WHAT NOT TO EXTRACT (IMPORTANT):',
    '- Ne PAS extraire les objets inanimés non pivots (sable, bois, vêtements, roc, arbre fruitier).',
    '- Exception: objets historiques majeurs (ex: Arche de l’Alliance, Temple, Tabernacle).',
    '- Ne PAS créer de relation familiale (SPOUSE_OF, FATHER_OF, etc.) entre ennemis',
    '  ou relations circonstancielles (ex: Jésus et diable).',
    '- Ne PAS utiliser EVENT_AT avec des cibles génériques (sable, foule, multitude).',
    '',
    'Validation de direction:',
    '- La justification doit être explicite et cohérente avec la direction.',
    '- Exemple correct: { "relation_type":"FATHER_OF", "justification":"David est l\'ancêtre de X" }.',
    '- Si la phrase implique "X est le fils de Y", alors la relation doit être SON_OF (X -> Y).',
    '',
    'Réponds uniquement en JSON valide.',
    'Encadre le JSON entre __JSON_START__ et __JSON_END__.',
    '',
    `Contexte: ${book} chapitre ${chapter}`,
    '__JSON_START__',
    '{',
    '  "entities": [',
    '    { "name": "...", "type": "Person|Location|Object|Event", "description": "...", "slug": "...", "source_verse_id": "b.BOOK.CHAPTER.VERSE" }',
    '  ],',
    '  "relations": [',
    '    {',
    '      "source_slug": "...",',
    '      "relation_type": "FATHER_OF|MOTHER_OF|SON_OF|DAUGHTER_OF|SPOUSE_OF|BROTHER_OF|SISTER_OF|TRAVELS_TO|LOCATED_IN|FOLLOWER_OF|INTERACTS_WITH|EVENT_AT",',
    '      "target_slug": "...",',
    '      "source_type": "Person|Location",',
    '      "target_type": "Person|Location",',
    '      "justification": "...",',
    '      "evidence_verse_id": "b.BOOK.CHAPTER.VERSE"',
    '    }',
    '  ]',
    '}',
    '__JSON_END__',
    '',
    '--- TEXTE SOURCE (français) ---',
    verseLines
  ].join('\n')
}

export function groupByBookChapter(
  verses: VerseRecord[],
  allowedBooks: string[]
): Array<{ book: string; chapter: number; verses: VerseRecord[] }> {
  const map = new Map<string, VerseRecord[]>()

  for (const rawVerse of verses) {
    const v = normalizeVerse(rawVerse)
    if (!v.book || !v.chapter) continue
    if (!allowedBooks.includes(v.book)) continue

    const key = `${v.book}:${v.chapter}`
    const list = map.get(key) ?? []
    list.push(v)
    map.set(key, list)
  }

  return [...map.entries()]
    .map(([key, list]) => {
      const [book, chapterStr] = key.split(':')
      return {
        book,
        chapter: Number(chapterStr),
        verses: list.sort((a, b) => {
          const av = parseVerseId(a.verse_id)?.verse ?? 0
          const bv = parseVerseId(b.verse_id)?.verse ?? 0
          return av - bv
        })
      }
    })
    .sort((a, b) => (a.book === b.book ? a.chapter - b.chapter : a.book.localeCompare(b.book)))
}

function normalizeSlug(input: unknown, fallback = 'unknown'): string {
  const raw = readString(input, '').trim()
  const base = raw.length > 0 ? raw : fallback
  return slugify(base)
}

function normalizeEntityType(input: unknown): EntityType | undefined {
  const normalized = readString(input, '')
  if (!normalized) return undefined

  const aliases: Record<string, EntityType> = {
    PERSON: 'Person',
    PERSONNE: 'Person',
    LOCATION: 'Location',
    LIEU: 'Location',
    OBJECT: 'Object',
    OBJET: 'Object',
    EVENT: 'Event',
    EVENEMENT: 'Event'
  }

  const key = normalized
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()

  const candidate = aliases[key] ?? normalized
  const parsed = EntityTypeEnum.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

function normalizeRelationType(input: unknown): RelationType {
  const raw = readString(input, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const aliases: Record<string, RelationType> = {
    // Movement / French
    ALLER_EN: 'TRAVELS_TO',
    SE_REND_A: 'TRAVELS_TO',
    DESCEND_EN: 'TRAVELS_TO',
    DESCENDIT_EN: 'TRAVELS_TO',
    VA_EN: 'TRAVELS_TO',
    GO_TO: 'TRAVELS_TO',
    WENT_TO: 'TRAVELS_TO',
    MOVED_TO: 'TRAVELS_TO',
    TRAVELED_TO: 'TRAVELS_TO',
    // Creation
    CREATES: 'CREATED_BY',
    MADE_BY: 'CREATED_BY',
    CREE_PAR: 'CREATED_BY',
    CREA: 'CREATED_BY',
    BUILT_BY: 'CREATED_BY',
    // Location
    IS_IN: 'LOCATED_IN',
    SITUATED_IN: 'LOCATED_IN',
    LIVES_IN: 'LOCATED_IN',
    DWELLS_IN: 'LOCATED_IN',
    // Narrative interactions
    TAKES: 'TAKES_INTO_HOUSE',
    TOOK: 'TAKES_INTO_HOUSE',
    PREND: 'TAKES_INTO_HOUSE',
    PRIT: 'TAKES_INTO_HOUSE',
    CAPTIVE: 'TAKES_INTO_HOUSE',
    MEETS: 'INTERACTS_WITH',
    MET: 'INTERACTS_WITH',
    SPEAKS_TO: 'INTERACTS_WITH',
    SPOKE_TO: 'INTERACTS_WITH',
    RENCONTRE: 'INTERACTS_WITH',
    // Mention
    MENTIONED_IN: 'APPEARS_IN',
    FOUND_IN: 'APPEARS_IN',
    PRESENT_IN: 'APPEARS_IN',
    SEEN_IN: 'APPEARS_IN',
    // Genealogy
    NEPHEW: 'NEPHEW_OF',
    NIECE: 'NIECE_OF',
    SON: 'SON_OF',
    DAUGHTER: 'DAUGHTER_OF',
    BROTHER: 'BROTHER_OF',
    SISTER: 'SISTER_OF',
    PERE_DE: 'FATHER_OF',
    MERE_DE: 'MOTHER_OF',
    FILS_DE: 'SON_OF',
    FILLE_DE: 'DAUGHTER_OF',
    EPOUX_DE: 'SPOUSE_OF',
    EPOUSE_DE: 'SPOUSE_OF',
    FRERE_DE: 'BROTHER_OF',
    SOEUR_DE: 'SISTER_OF',
    NEVEU_DE: 'NEPHEW_OF',
    NIECE_DE: 'NIECE_OF',
    ANCETRE_DE: 'ANCESTOR_OF',
    DESCENDANT_DE: 'DESCENDANT_OF',
    NE_A: 'BORN_IN',
    MORT_A: 'DIED_IN',
    SITUE_DANS: 'LOCATED_IN',
    VOYAGE_VERS: 'TRAVELS_TO',
    ORIGINAIRE_DE: 'ORIGINATED_FROM',
    POSSEDE_PAR: 'OWNED_BY',
    GOUVERNE: 'RULED_OVER',
    INTERAGIT_AVEC: 'INTERACTS_WITH',
    PREND_DANS_SA_MAISON: 'TAKES_INTO_HOUSE',
    APPARAIT_DANS: 'APPEARS_IN',
    PARTICIPE_A: 'PARTICIPATED_IN',
    EVENEMENT_A: 'EVENT_AT',
    BENI_PAR: 'BLESSED_BY',
    MAUDIT_PAR: 'CURSED_BY',
    SERVITEUR_DE: 'SERVANT_OF',
    PROPHETE_DE: 'PROPHET_OF',
    DISCIPLE_DE: 'FOLLOWER_OF',
    DISCIPLE_OF: 'FOLLOWER_OF',
    ENNEMI_DE: 'ENEMY_OF',
    ALLIE_DE: 'ALLY_OF'
  }

  const candidate = aliases[raw] ?? raw
  const parsed = RelationTypeEnum.safeParse(candidate)
  return parsed.success ? parsed.data : 'EVENT_AT'
}

const KINSHIP_RELATIONS = new Set<string>([
  'SON_OF',
  'DAUGHTER_OF',
  'FATHER_OF',
  'MOTHER_OF',
  'SPOUSE_OF',
  'BROTHER_OF',
  'SISTER_OF',
  'NEPHEW_OF',
  'NIECE_OF',
  'ANCESTOR_OF',
  'DESCENDANT_OF'
])

const METAPHORIC_SPOUSE_SLUGS = new Set<string>([
  'diable',
  'satan',
  'satanas',
  'esprit',
  'esprit-saint',
  'saint-esprit'
])

const GENERIC_EVENT_TARGET_SLUGS = new Set<string>([
  'roc',
  'rocher',
  'sable',
  'foule',
  'multitude'
])

function isJesusLike(value: string): boolean {
  const s = slugify(value)
  return s === 'jesus' || s === 'jesus-christ' || s.startsWith('jesus-')
}

function isMetaphoricSpouse(value: string): boolean {
  return METAPHORIC_SPOUSE_SLUGS.has(slugify(value))
}

function isGenericEventTarget(value: string): boolean {
  return GENERIC_EVENT_TARGET_SLUGS.has(slugify(value))
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function relationDirectionFromJustification(
  relationType: RelationType,
  sourceName: string,
  targetName: string,
  justification?: string
): RelationType {
  if (!justification) return relationType

  const j = normalizeText(justification)
  const source = escapeRegex(normalizeText(sourceName).replace(/-/g, ' '))
  const target = escapeRegex(normalizeText(targetName).replace(/-/g, ' '))

  if (relationType === 'FATHER_OF') {
    const sourceAsChild = new RegExp(`${source}.*(fils|fille|descendant).*(de|du|d').*${target}`)
    if (sourceAsChild.test(j)) return 'SON_OF'
  }

  if (relationType === 'SON_OF') {
    const sourceAsParent = new RegExp(`${source}.*(pere|mere|ancetre).*(de|du|d').*${target}`)
    if (sourceAsParent.test(j)) return 'FATHER_OF'
  }

  return relationType
}

function isRelevantObjectEntity(entity: RawEntity): boolean {
  if (entity.type !== 'Object') return true
  const s = slugify(entity.slug || entity.name)
  if (IMPORTANT_OBJECT_WHITELIST.has(s)) return true
  return !NOISY_OBJECT_SLUGS.has(s)
}

function sanitizeRelations(entities: RawEntity[], relations: RelationCandidate[]): RawRelation[] {
  const entityBySlug = new Map<string, RawEntity>()
  for (const entity of entities) entityBySlug.set(entity.slug, entity)

  const out: RawRelation[] = []
  const seen = new Set<string>()

  for (const relation of relations) {
    const sourceEntity = entityBySlug.get(relation.source_slug)
    const targetEntity = entityBySlug.get(relation.target_slug)
    if (!sourceEntity || !targetEntity) continue

    // Strategy 1: strict typed endpoints (Person|Location only)
    const sourceType = relation.source_type ?? sourceEntity.type
    const targetType = relation.target_type ?? targetEntity.type
    if (!ENDPOINT_TYPES.has(sourceType) || !ENDPOINT_TYPES.has(targetType)) continue

    // Strategy 1: closed relation list
    if (!STRICT_RELATION_TYPES.has(relation.relation_type as RelationType)) continue

    const sourceName = sourceEntity.name || relation.source_slug
    const targetName = targetEntity.name || relation.target_slug

    let relType = relation.relation_type

    // Existing correction + strategy 3 (directionality by justification)
    if (relType === 'FATHER_OF' && isJesusLike(sourceName) && !isJesusLike(targetName)) {
      relType = 'SON_OF'
    }

    relType = relationDirectionFromJustification(
      relType as RelationType,
      sourceName,
      targetName,
      relation.justification
    )

    // Strategy 2: metaphoric/circumstantial noise
    if (relType === 'SPOUSE_OF' && (isMetaphoricSpouse(sourceName) || isMetaphoricSpouse(targetName))) {
      continue
    }

    if (relType === 'EVENT_AT' && isGenericEventTarget(targetName)) {
      continue
    }

    const current: RawRelation = {
      source_slug: relation.source_slug,
      relation_type: relType,
      target_slug: relation.target_slug,
      evidence_verse_id: relation.evidence_verse_id
    }

    const key = `${current.source_slug}|${current.relation_type}|${current.target_slug}|${current.evidence_verse_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(current)
  }

  return out
}

function buildKinshipSignature(chapter: ChapterGraph, slug: string): Set<string> {
  const sig = new Set<string>()

  for (const rel of chapter.relations) {
    if (!KINSHIP_RELATIONS.has(rel.relation_type)) continue

    if (rel.source_slug === slug) {
      sig.add(`${rel.relation_type}:OUT:${rel.target_slug}`)
    }
    if (rel.target_slug === slug) {
      sig.add(`${rel.relation_type}:IN:${rel.source_slug}`)
    }
  }

  return sig
}

function hasKinshipConflict(existingSig: Set<string>, incomingSig: Set<string>): boolean {
  if (existingSig.size === 0 || incomingSig.size === 0) return false

  for (const item of incomingSig) {
    if (existingSig.has(item)) return false
  }

  return true
}

function makeDisambiguatedSlug(baseSlug: string, sourceVerseId: string, used: Set<string>): string {
  const parsed = parseVerseId(sourceVerseId)
  const suffix = parsed
    ? `${parsed.book.toLowerCase()}-${parsed.chapter}`
    : sourceVerseId.replace(/[^a-z0-9]/gi, '-').toLowerCase()

  let candidate = `${baseSlug}-${suffix}`
  let i = 2
  while (used.has(candidate)) {
    candidate = `${baseSlug}-${suffix}-${i}`
    i++
  }
  return candidate
}

export function mergeEntities(chapters: ChapterGraph[]): Map<string, RawEntity> {
  const slugIndex = new Map<string, RawEntity>()
  const aliasIndex = new Map<string, string>()
  const ambiguousAliases = new Set<string>()
  const kinshipBySlug = new Map<string, Set<string>>()

  const usedSlugs = new Set<string>()

  const registerAlias = (alias: string, slug: string): void => {
    const key = slugify(alias)
    if (!key) return
    if (ambiguousAliases.has(key)) return

    const existing = aliasIndex.get(key)
    if (!existing) {
      aliasIndex.set(key, slug)
      return
    }

    if (existing !== slug) {
      aliasIndex.delete(key)
      ambiguousAliases.add(key)
    }
  }

  const upsertEntity = (slug: string, entity: RawEntity, kinshipSig: Set<string>): void => {
    slugIndex.set(slug, { ...entity, slug })
    usedSlugs.add(slug)

    registerAlias(slug, slug)
    registerAlias(entity.name, slug)

    const existingSig = kinshipBySlug.get(slug) ?? new Set<string>()
    for (const s of kinshipSig) existingSig.add(s)
    kinshipBySlug.set(slug, existingSig)
  }

  for (const chapter of chapters) {
    for (const entity of chapter.entities) {
      const rawSlug = normalizeSlug(entity.slug, entity.name || 'unknown')
      const nameKey = slugify(entity.name)
      const kinshipSig = buildKinshipSignature(chapter, rawSlug)

      let resolvedSlug: string | undefined = slugIndex.has(rawSlug) ? rawSlug : undefined

      if (!resolvedSlug && nameKey && !ambiguousAliases.has(nameKey)) {
        const viaAlias = aliasIndex.get(nameKey)
        if (viaAlias && slugIndex.has(viaAlias)) {
          resolvedSlug = viaAlias
        }
      }

      if (!resolvedSlug) {
        upsertEntity(rawSlug, entity, kinshipSig)
        continue
      }

      const existing = slugIndex.get(resolvedSlug)
      if (!existing) {
        upsertEntity(rawSlug, entity, kinshipSig)
        continue
      }

      const sameName = existing.name.toLowerCase() === entity.name.toLowerCase()
      const existingSig = kinshipBySlug.get(resolvedSlug) ?? new Set<string>()
      const kinshipConflict = hasKinshipConflict(existingSig, kinshipSig)

      if (!sameName || kinshipConflict) {
        const disambiguated = makeDisambiguatedSlug(rawSlug, entity.source_verse_id, usedSlugs)
        upsertEntity(disambiguated, { ...entity, slug: disambiguated }, kinshipSig)

        if (nameKey) {
          aliasIndex.delete(nameKey)
          ambiguousAliases.add(nameKey)
        }
        continue
      }

      if (entity.description.length > existing.description.length) {
        slugIndex.set(resolvedSlug, { ...existing, description: entity.description })
      }

      for (const s of kinshipSig) existingSig.add(s)
      kinshipBySlug.set(resolvedSlug, existingSig)

      registerAlias(entity.name, resolvedSlug)
      registerAlias(rawSlug, resolvedSlug)
    }
  }

  return slugIndex
}

function normalizeGraphPayload(
  payload: unknown,
  fallbackVerseId: string
): { entities: RawEntity[]; relations: RawRelation[] } {
  if (!isRecord(payload)) return { entities: [], relations: [] }

  const entitiesRaw = Array.isArray(payload.entities) ? payload.entities : []
  const relationsRaw = Array.isArray(payload.relations) ? payload.relations : []

  const entities = entitiesRaw
    .map((item) => {
      const e = isRecord(item) ? item : {}
      const name = readString(e.name, '')
      const entityType = normalizeEntityType(e.type)

      return {
        name,
        type: entityType ?? 'Event',
        description: readString(e.description, ''),
        slug: normalizeSlug(e.slug, name || 'unknown'),
        source_verse_id: readString(e.source_verse_id, fallbackVerseId)
      } satisfies RawEntity
    })
    .filter((e) => e.name.length > 0)
    .filter(isRelevantObjectEntity)

  const entityTypeBySlug = new Map<string, EntityType>()
  for (const entity of entities) entityTypeBySlug.set(entity.slug, entity.type)

  const relationCandidates: RelationCandidate[] = relationsRaw
    .map((item) => {
      const r = isRecord(item) ? item : {}

      const source_slug = normalizeSlug(r.source_slug, 'source')
      const target_slug = normalizeSlug(r.target_slug, 'target')
      const relation_type = normalizeRelationType(r.relation_type)

      const inferredSourceType = entityTypeBySlug.get(source_slug)
      const inferredTargetType = entityTypeBySlug.get(target_slug)

      const source_type = normalizeEntityType(r.source_type) ?? inferredSourceType
      const target_type = normalizeEntityType(r.target_type) ?? inferredTargetType

      return {
        source_slug,
        relation_type,
        target_slug,
        source_type,
        target_type,
        justification: readString(r.justification, ''),
        evidence_verse_id: readString(r.evidence_verse_id, fallbackVerseId)
      }
    })
    .filter((r) => !!r.source_slug && !!r.target_slug && !!r.evidence_verse_id)

  const relations = sanitizeRelations(entities, relationCandidates)

  return {
    entities,
    relations
  }
}

function dedupeEntitiesBySlug(graph: {
  entities: RawEntity[]
  relations: RawRelation[]
}): { entities: RawEntity[]; relations: RawRelation[] } {
  const seen = new Set<string>()
  const uniqueEntities: RawEntity[] = []

  for (const entity of graph.entities) {
    if (seen.has(entity.slug)) continue
    seen.add(entity.slug)
    uniqueEntities.push(entity)
  }

  return {
    entities: uniqueEntities,
    relations: graph.relations
  }
}

export async function extractChapterGraph(
  chapter: { book: string; chapter: number; verses: VerseRecord[] },
  llm: LlmClient
): Promise<ChapterGraph> {
  const prompt = buildExtractionPrompt(chapter)
  const raw = await llm.invoke(prompt)
  const fallbackVerse = chapter.verses[0]?.verse_id ?? `b.${chapter.book}.${chapter.chapter}.1`

  const parsed = await parseOrRepairModelJson(raw, llm)
  if (parsed === null) {
    console.error('LLM JSON parse failed after repair attempt')
    return {
      book: chapter.book,
      chapter: chapter.chapter,
      query: `${chapter.book} chapitre ${chapter.chapter}`,
      entities: [],
      relations: []
    }
  }

  const normalized = normalizeGraphPayload(parsed, fallbackVerse)
  const deduped = dedupeEntitiesBySlug(normalized)
  const validated = validateGraph(deduped)

  if (!validated.success || !validated.data) {
    console.error('LLM graph validation failed:', validated.errors)
    return {
      book: chapter.book,
      chapter: chapter.chapter,
      query: `${chapter.book} chapitre ${chapter.chapter}`,
      entities: [],
      relations: []
    }
  }

  return {
    book: chapter.book,
    chapter: chapter.chapter,
    query: `${chapter.book} chapitre ${chapter.chapter}`,
    entities: validated.data.entities,
    relations: validated.data.relations
  }
}

export async function runExtractionPipeline(options: RunOptions): Promise<RawGraphOutput> {
  const {
    inputPath,
    outputPath,
    books = DEFAULT_BOOKS,
    delayMs = 20000,
    llm,
    sleepFn = sleep,
    verbose = true,
    partialOutputPath
  } = options

  const file = await readFile(inputPath, 'utf-8')
  const rawData = JSON.parse(file) as unknown
  const inputRows = Array.isArray(rawData) ? rawData : []
  const verses = inputRows
    .map(toVerseRecord)
    .filter((verse): verse is VerseRecord => verse !== null)

  const grouped = groupByBookChapter(verses, books)

  if (verbose) {
    console.log(
      `[extract-graph] start: rows=${inputRows.length}, verses=${verses.length}, chapters=${grouped.length}, books=${books.join(',')}, delayMs=${delayMs}`
    )
  }

  const queue = new PQueue({
    concurrency: 1,
    interval: delayMs,
    intervalCap: 1
  })

  const chapters: ChapterGraph[] = []
  let rateLimitHit = false

  const tasks = grouped.map((chapter, i) =>
    queue.add(async () => {
      if (rateLimitHit) return null

      const start = Date.now()

      if (verbose) {
        console.log(
          `${progressLabel(i, grouped.length)} extracting ${chapter.book} ${chapter.chapter} (${chapter.verses.length} verses)`
        )
      }

      try {
        const chapterGraph = await extractChapterGraph(chapter, llm)

        if (verbose) {
          const ms = Date.now() - start
          console.log(
            `${progressLabel(i, grouped.length)} done in ${ms}ms (entities=${chapterGraph.entities.length}, relations=${chapterGraph.relations.length})`
          )
        }

        return chapterGraph
      } catch (error) {
        const retryAfter = getRetryAfterSeconds(error)

        if (retryAfter && retryAfter > 3600) {
          rateLimitHit = true
          console.error(
            `[extract-graph] ❌ 429 FAMINE: Daily rate limit reached. Retry after ~${Math.ceil(retryAfter / 3600)}h`
          )

          const saveTarget = partialOutputPath ?? outputPath.replace('.json', '.partial.json')
          await savePartialOutput(chapters, books, saveTarget, verbose)

          throw new Error(
            `Rate limit (429) at chapter ${i + 1}/${grouped.length}. Partial output saved to ${saveTarget}.`
          )
        }

        if (retryAfter && retryAfter > 0) {
          console.warn(
            `[extract-graph] ⚠️  429 received at chapter ${i + 1}. Waiting ${retryAfter}s...`
          )
          await sleepFn(retryAfter * 1000)
          return null
        }

        console.error(`[extract-graph] ❌ Error at chapter ${i + 1}:`, error)
        throw error
      }
    })
  )

  const results = await Promise.all(tasks)
  chapters.push(...results.filter((ch): ch is ChapterGraph => ch !== null))

  const output: RawGraphOutput = {
    generated_at: new Date().toISOString(),
    books,
    chapters,
    merged_entities: [...mergeEntities(chapters).values()]
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8')

  if (verbose) {
    const mergedCount = output.merged_entities?.length ?? 0
    console.log(
      `[extract-graph] ✅ completed: chapters=${chapters.length}, merged_entities=${mergedCount}, output=${outputPath}`
    )
  }

  return output
}

export function createCopilotLlmClient(githubToken: string, model = 'gpt-4o'): LlmClient {
  const copilotModel = new ChatOpenAI(model, {
    temperature: 0,
    openAIApiKey: 'none',
    configuration: {
      baseURL: 'https://models.github.ai/inference',
      defaultHeaders: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      }
    }
  } as Omit<ChatOpenAIFields, 'model'>)

  return {
    async invoke(prompt: string): Promise<string> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (copilotModel as any).invoke([
        new SystemMessage(
          [
            'Tu extrais uniquement en français.',
            'Noms bibliques français.',
            'Descriptions courtes en français.',
            'Types autorisés: Person, Location, Object, Event.',
            'Relations AUTORISÉES uniquement: FATHER_OF, MOTHER_OF, SON_OF, DAUGHTER_OF, SPOUSE_OF, BROTHER_OF, SISTER_OF, TRAVELS_TO, LOCATED_IN, FOLLOWER_OF, INTERACTS_WITH, EVENT_AT.',
            'Chaque relation doit inclure source_type/target_type (Person|Location) et justification.',
            'Ne pas extraire les objets inanimés non pivots (sable, roc, foule, vêtements...).',
            'Ne pas créer de SPOUSE_OF/relations familiales entre ennemis (ex: Jésus/diable).',
            'Retourne uniquement un JSON valide.'
          ].join(' ')
        ),
        new HumanMessage(prompt)
      ])

      const content = response.content
      return typeof content === 'string' ? content : JSON.stringify(content)
    }
  }
}

export async function main(): Promise<void> {
  const apiKey = process.env.GITHUB_TOKEN
  if (!apiKey) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const inputPath =
    process.env.EXTRACT_INPUT_PATH ??
    path.resolve(process.cwd(), '../data/processed_bible.json')

  const outputPath =
    process.env.EXTRACT_OUTPUT_PATH ?? path.resolve(process.cwd(), '../data/raw_graph.json')

  const partialOutputPath = process.env.EXTRACT_PARTIAL_OUTPUT_PATH ?? undefined

  const books = (process.env.EXTRACT_BOOKS ?? 'GEN,MAT,ACT')
    .split(',')
    .map((b) => b.trim().toUpperCase())
    .filter(Boolean) as TargetBook[]

  const delayMs = Number(process.env.EXTRACT_DELAY_MS ?? '20000')
  const model = process.env.COPILOTE_MODEL ?? 'gpt-4o-mini'

  if (process.env.VERBOSE !== 'false') {
    console.log(`[extract-graph] config: model=${model}, delayMs=${delayMs}ms`)
  }

  const llm = createCopilotLlmClient(apiKey, model)

  const result = await runExtractionPipeline({
    inputPath,
    outputPath,
    books,
    delayMs,
    llm,
    partialOutputPath
  })

  console.log(`[extract-graph] Final: ${result.chapters.length} chapters extracted.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}