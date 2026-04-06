import { z } from 'zod'

export const VerseIdSchema = z
  .string()
  .regex(/^b\.[A-Z0-9]+\.\d+\.\d+$/, 'Invalid verse id format (expected b.BOOK.CHAPTER.VERSE)')

export const SlugSchema = z
  .string()
  .min(1, 'Slug is required')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format')

export const EntityTypeEnum = z.enum(['Person', 'Location', 'Object', 'Event'])
export type EntityType = z.infer<typeof EntityTypeEnum>

export const EntitySchema = z
  .object({
    name: z.string().min(1, 'Entity name is required'),
    type: EntityTypeEnum,
    description: z.string().min(1, 'Description is required'),
    slug: SlugSchema,
    source_verse_id: VerseIdSchema
  })
  .strict()

export type Entity = z.infer<typeof EntitySchema>

export const RelationTypeEnum = z.enum([
  'FATHER_OF',
  'MOTHER_OF',
  'SON_OF',
  'DAUGHTER_OF',
  'SPOUSE_OF',
  'BROTHER_OF',
  'SISTER_OF',
  'NEPHEW_OF',
  'NIECE_OF',
  'ANCESTOR_OF',
  'DESCENDANT_OF',
  'BORN_IN',
  'DIED_IN',
  'LOCATED_IN',
  'TRAVELS_TO',
  'ORIGINATED_FROM',
  'OWNED_BY',
  'RULED_OVER',
  'INTERACTS_WITH',
  'TAKES_INTO_HOUSE',
  'APPEARS_IN',
  'PARTICIPATED_IN',
  'EVENT_AT',
  'BLESSED_BY',
  'CURSED_BY',
  'SERVANT_OF',
  'PROPHET_OF',
  'FOLLOWER_OF',
  'ENEMY_OF',
  'ALLY_OF',
  'CREATED_BY'
])
export type RelationType = z.infer<typeof RelationTypeEnum>

export const RelationSchema = z
  .object({
    source_slug: SlugSchema,
    relation_type: RelationTypeEnum,
    target_slug: SlugSchema,
    evidence_verse_id: VerseIdSchema
  })
  .strict()

export type Relation = z.infer<typeof RelationSchema>

/**
 * Stratégie 1: Schéma strict pour l'étape d'extraction LLM
 * - liste fermée de relations utiles
 * - endpoints typés Person|Location
 * - justification requise
 */
export const StrictExtractionRelationTypeEnum = z.enum([
  'FATHER_OF',
  'MOTHER_OF',
  'SON_OF',
  'DAUGHTER_OF',
  'SPOUSE_OF',
  'BROTHER_OF',
  'SISTER_OF',
  'TRAVELS_TO',
  'LOCATED_IN',
  'FOLLOWER_OF',
  'INTERACTS_WITH',
  'EVENT_AT'
])
export type StrictExtractionRelationType = z.infer<typeof StrictExtractionRelationTypeEnum>

const EndpointTypeEnum = z.enum(['Person', 'Location'])

const KINSHIP_TYPES = new Set<StrictExtractionRelationType>([
  'FATHER_OF',
  'MOTHER_OF',
  'SON_OF',
  'DAUGHTER_OF',
  'SPOUSE_OF',
  'BROTHER_OF',
  'SISTER_OF'
])

const NOISY_EVENT_TARGETS = new Set(['roc', 'rocher', 'sable', 'foule', 'multitude'])
const METAPHORIC_SPOUSE_SLUGS = new Set(['diable', 'satan', 'satanas', 'esprit', 'esprit-saint', 'saint-esprit'])

function normalizeSlugLike(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export const ExtractionRelationSchema = z
  .object({
    source_slug: SlugSchema,
    relation_type: StrictExtractionRelationTypeEnum,
    target_slug: SlugSchema,
    source_type: EndpointTypeEnum, // Person|Location uniquement
    target_type: EndpointTypeEnum, // Person|Location uniquement
    justification: z.string().min(8, 'Justification is required'),
    evidence_verse_id: VerseIdSchema
  })
  .strict()
  .superRefine((rel, ctx) => {
    // parenté uniquement Person -> Person
    if (KINSHIP_TYPES.has(rel.relation_type)) {
      if (rel.source_type !== 'Person' || rel.target_type !== 'Person') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Kinship relations must be Person -> Person'
        })
      }
    }

    // EVENT_AT doit pointer vers Location
    if (rel.relation_type === 'EVENT_AT' && rel.target_type !== 'Location') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EVENT_AT target must be Location'
      })
    }

    // anti-bruit circonstanciel
    const s = normalizeSlugLike(rel.source_slug)
    const t = normalizeSlugLike(rel.target_slug)

    if (rel.relation_type === 'SPOUSE_OF' && (METAPHORIC_SPOUSE_SLUGS.has(s) || METAPHORIC_SPOUSE_SLUGS.has(t))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SPOUSE_OF with metaphorical entities is not allowed'
      })
    }

    if (rel.relation_type === 'EVENT_AT' && NOISY_EVENT_TARGETS.has(t)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EVENT_AT with generic/noisy target is not allowed'
      })
    }
  })

export type ExtractionRelation = z.infer<typeof ExtractionRelationSchema>

export const GraphSchema = z
  .object({
    entities: z.array(EntitySchema),
    relations: z.array(RelationSchema)
  })
  .strict()

export type Graph = z.infer<typeof GraphSchema>

export const ExtractionGraphSchema = z
  .object({
    entities: z.array(EntitySchema),
    relations: z.array(ExtractionRelationSchema)
  })
  .strict()

export type ExtractionGraph = z.infer<typeof ExtractionGraphSchema>

export function validateGraph(input: unknown): {
  success: boolean
  data?: Graph
  errors?: string[]
} {
  const result = GraphSchema.safeParse(input)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
  }
  return { success: true, data: result.data }
}

export function validateExtractionGraph(input: unknown): {
  success: boolean
  data?: ExtractionGraph
  errors?: string[]
} {
  const result = ExtractionGraphSchema.safeParse(input)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
  }
  return { success: true, data: result.data }
}