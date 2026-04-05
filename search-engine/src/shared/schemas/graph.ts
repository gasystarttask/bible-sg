import { z } from 'zod'

/**
 * Entity Types for biblical entities
 */
export const EntityTypeEnum = z.enum(['Person', 'Location', 'Object', 'Event'])
export type EntityType = z.infer<typeof EntityTypeEnum>

const SlugSchema = z
  .string()
  .min(1, 'Slug is required')
  .regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase alphanumeric with hyphens and underscores')

const VerseIdSchema = z
  .string()
  .min(1, 'Verse ID is required')
  .regex(/^b\.[A-Z]+\.\d+\.\d+$/, 'Verse ID format must be b.BOOK.CHAPTER.VERSE')

/**
 * Entity Schema - represents a biblical entity
 */
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

/**
 * Relation Types for connections between entities
 */
export const RelationTypeEnum = z.enum([
  // --- Genealogy ---
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
  'DESCENDANT_OF',
  // --- Geography ---
  'BORN_IN',
  'DIED_IN',
  'LOCATED_IN',
  'TRAVELS_TO',
  'ORIGINATED_FROM',
  // --- Creation & Possession ---
  'CREATED_BY',
  'OWNED_BY',
  'RULED_OVER',
  // --- Narrative interactions ---
  'INTERACTS_WITH',
  'TAKES_INTO_HOUSE',
  'APPEARS_IN',
  'PARTICIPATED_IN',
  'EVENT_AT',
  // --- Spiritual ---
  'BLESSED_BY',
  'CURSED_BY',
  'SERVANT_OF',
  'PROPHET_OF',
  'FOLLOWER_OF',
  'ENEMY_OF',
  'ALLY_OF'
])

export type RelationType = z.infer<typeof RelationTypeEnum>

/**
 * Relation Schema - represents a connection between two entities (RDF-like triple)
 */
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
 * Graph Schema - collection of entities and relations
 */
export const GraphSchema = z
  .object({
    entities: z.array(EntitySchema),
    relations: z.array(RelationSchema)
  })
  .strict()
  .superRefine((graph, ctx) => {
    const seen = new Set<string>()
    graph.entities.forEach((e, i) => {
      if (seen.has(e.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entities', i, 'slug'],
          message: `Duplicate entity slug: ${e.slug}`
        })
      }
      seen.add(e.slug)
    })
  })

export type Graph = z.infer<typeof GraphSchema>

/**
 * Validation result type
 */
export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: string[]
}

function mapZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

/**
 * Validates entity data and returns structured result
 */
export function validateEntity(data: unknown): ValidationResult<Entity> {
  const result = EntitySchema.safeParse(data)
  if (result.success) return { success: true, data: result.data }
  const errors = mapZodErrors(result.error)
  console.error('Entity validation failed:', errors)
  return { success: false, errors }
}

/**
 * Validates relation data and returns structured result
 */
export function validateRelation(data: unknown): ValidationResult<Relation> {
  const result = RelationSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data }
  const errors = mapZodErrors(result.error)
  console.error('Relation validation failed:', errors)
  return { success: false, errors }
}

/**
 * Validates graph data (entities and relations) and returns structured result
 */
export function validateGraph(data: unknown): ValidationResult<Graph> {
  const result = GraphSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data }
  const errors = mapZodErrors(result.error)
  console.error('Graph validation failed:', errors)
  return { success: false, errors }
}
