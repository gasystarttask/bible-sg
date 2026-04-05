import { describe, it, expect } from 'vitest'
import {
  EntityTypeEnum,
  RelationTypeEnum,
  validateEntity,
  validateRelation,
  validateGraph,
  type Entity,
  type Relation
} from './graph'

describe('Graph Schema - Entity Validation', () => {
  it('should validate a valid Person entity', () => {
    const validEntity: Entity = {
      name: 'Abraham',
      type: 'Person',
      description: 'Patriarch of Israel, father of Isaac',
      slug: 'abraham',
      source_verse_id: 'b.GEN.12.1'
    }
    const result = validateEntity(validEntity)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(validEntity)
  })

  it('should validate a valid Location entity', () => {
    const validEntity: Entity = {
      name: 'Canaan',
      type: 'Location',
      description: 'The promised land',
      slug: 'canaan-land',
      source_verse_id: 'b.GEN.12.5'
    }
    const result = validateEntity(validEntity)
    expect(result.success).toBe(true)
    expect(result.data?.type).toBe('Location')
  })

  it('should reject entity with missing name', () => {
    const invalidEntity = {
      type: 'Person',
      description: 'Patriarch of Israel',
      slug: 'abraham',
      source_verse_id: 'b.GEN.12.1'
    }
    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
    expect(result.errors).toBeDefined()
  })

  it('should reject entity with invalid slug format', () => {
    const invalidEntity: Entity = {
      name: 'Abraham',
      type: 'Person',
      description: 'Patriarch of Israel',
      slug: 'Abraham_Invalid', // uppercase not allowed
      source_verse_id: 'b.GEN.12.1'
    }
    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Slug must be lowercase')
  })

  it('should reject entity with invalid verse ID format', () => {
    const invalidEntity: Entity = {
      name: 'Abraham',
      type: 'Person',
      description: 'Patriarch of Israel',
      slug: 'abraham',
      source_verse_id: 'GEN.12.1' // missing b. prefix
    }
    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Verse ID format must be')
  })

  it('should reject entity with invalid type', () => {
    const invalidEntity = {
      name: 'Abraham',
      type: 'InvalidType',
      description: 'Patriarch of Israel',
      slug: 'abraham',
      source_verse_id: 'b.GEN.12.1'
    }
    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
  })

  it('should reject entity with empty description', () => {
    const invalidEntity: Entity = {
      name: 'Abraham',
      type: 'Person',
      description: '',
      slug: 'abraham',
      source_verse_id: 'b.GEN.12.1'
    }
    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
  })
})

describe('Graph Schema - Relation Validation', () => {
  it('should validate a valid SON_OF relation', () => {
    const validRelation: Relation = {
      source_slug: 'isaac',
      relation_type: 'SON_OF',
      target_slug: 'abraham',
      evidence_verse_id: 'b.GEN.21.2'
    }
    const result = validateRelation(validRelation)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(validRelation)
  })

  it('should validate a valid BORN_IN relation', () => {
    const validRelation: Relation = {
      source_slug: 'abraham',
      relation_type: 'BORN_IN',
      target_slug: 'ur-of-chaldees',
      evidence_verse_id: 'b.GEN.11.28'
    }
    const result = validateRelation(validRelation)
    expect(result.success).toBe(true)
  })

  it('should reject relation with missing source_slug', () => {
    const invalidRelation = {
      relation_type: 'SON_OF',
      target_slug: 'abraham',
      evidence_verse_id: 'b.GEN.21.2'
    }
    const result = validateRelation(invalidRelation)
    expect(result.success).toBe(false)
  })

  it('should reject relation with invalid relation_type', () => {
    const invalidRelation: Relation = {
      source_slug: 'isaac',
      relation_type: 'INVALID_RELATION' as any,
      target_slug: 'abraham',
      evidence_verse_id: 'b.GEN.21.2'
    }
    const result = validateRelation(invalidRelation)
    expect(result.success).toBe(false)
  })

  it('should reject relation with invalid evidence_verse_id', () => {
    const invalidRelation: Relation = {
      source_slug: 'isaac',
      relation_type: 'SON_OF',
      target_slug: 'abraham',
      evidence_verse_id: 'INVALID_VERSE'
    }
    const result = validateRelation(invalidRelation)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Verse ID format must be')
  })

  it('should support all relation types', () => {
    const relationTypes = [
      'SON_OF',
      'DAUGHTER_OF',
      'FATHER_OF',
      'BORN_IN',
      'RULED_OVER',
      'SERVANT_OF',
      'PROPHET_OF',
      'EVENT_AT'
    ]

    relationTypes.forEach(relType => {
      const relation: Relation = {
        source_slug: 'entity1',
        relation_type: relType as any,
        target_slug: 'entity2',
        evidence_verse_id: 'b.GEN.1.1'
      }
      const result = validateRelation(relation)
      expect(result.success).toBe(true)
    })
  })
})

describe('Graph Schema - Full Graph Validation', () => {
  it('should validate a complete graph with Abraham and Isaac', () => {
    const validGraph = {
      entities: [
        {
          name: 'Abraham',
          type: 'Person',
          description: 'Patriarch of Israel',
          slug: 'abraham',
          source_verse_id: 'b.GEN.12.1'
        },
        {
          name: 'Isaac',
          type: 'Person',
          description: 'Son of Abraham',
          slug: 'isaac',
          source_verse_id: 'b.GEN.21.2'
        },
        {
          name: 'Canaan',
          type: 'Location',
          description: 'The promised land',
          slug: 'canaan',
          source_verse_id: 'b.GEN.12.5'
        }
      ],
      relations: [
        {
          source_slug: 'isaac',
          relation_type: 'SON_OF',
          target_slug: 'abraham',
          evidence_verse_id: 'b.GEN.21.2'
        },
        {
          source_slug: 'abraham',
          relation_type: 'BORN_IN',
          target_slug: 'canaan',
          evidence_verse_id: 'b.GEN.12.5'
        }
      ]
    }

    const result = validateGraph(validGraph)
    expect(result.success).toBe(true)
    expect(result.data?.entities).toHaveLength(3)
    expect(result.data?.relations).toHaveLength(2)
  })

  it('should reject graph with invalid entity in array', () => {
    const invalidGraph = {
      entities: [
        {
          name: 'Abraham',
          type: 'Person',
          description: 'Patriarch of Israel',
          slug: 'abraham',
          source_verse_id: 'b.GEN.12.1'
        },
        {
          name: 'Isaac',
          type: 'InvalidType',
          description: 'Son of Abraham',
          slug: 'isaac',
          source_verse_id: 'b.GEN.21.2'
        }
      ],
      relations: []
    }

    const result = validateGraph(invalidGraph)
    expect(result.success).toBe(false)
  })

  it('should handle empty graph', () => {
    const emptyGraph = {
      entities: [],
      relations: []
    }

    const result = validateGraph(emptyGraph)
    expect(result.success).toBe(true)
    expect(result.data?.entities).toHaveLength(0)
  })

  it('should validate French biblical query - Abraham and Isaac', () => {
    const frenchBiblicalGraph = {
      entities: [
        {
          name: 'Abraham',
          type: 'Person',
          description: 'Patriarche d\'Israël, père d\'Isaac et d\'Ismaël',
          slug: 'abraham',
          source_verse_id: 'b.GEN.12.1'
        },
        {
          name: 'Isaac',
          type: 'Person',
          description: 'Fils d\'Abraham et de Sarah',
          slug: 'isaac',
          source_verse_id: 'b.GEN.21.2'
        },
        {
          name: 'Sarah',
          type: 'Person',
          description: 'Épouse d\'Abraham, mère d\'Isaac',
          slug: 'sarah',
          source_verse_id: 'b.GEN.12.11'
        }
      ],
      relations: [
        {
          source_slug: 'isaac',
          relation_type: 'SON_OF',
          target_slug: 'abraham',
          evidence_verse_id: 'b.GEN.21.2'
        },
        {
          source_slug: 'isaac',
          relation_type: 'SON_OF',
          target_slug: 'sarah',
          evidence_verse_id: 'b.GEN.21.2'
        },
        {
          source_slug: 'sarah',
          relation_type: 'SPOUSE_OF',
          target_slug: 'abraham',
          evidence_verse_id: 'b.GEN.12.11'
        }
      ]
    }

    const result = validateGraph(frenchBiblicalGraph)
    expect(result.success).toBe(true)
    expect(result.data?.entities).toHaveLength(3)
    expect(result.data?.relations).toHaveLength(3)
    expect(result.data?.entities[0].description).toContain('Patriarche')
  })
})

describe('Graph Schema - Type Exports', () => {
  it('should export EntityType enum', () => {
    const types = ['Person', 'Location', 'Object', 'Event']
    types.forEach(type => {
      const result = EntityTypeEnum.safeParse(type)
      expect(result.success).toBe(true)
    })
  })

  it('should export RelationType enum', () => {
    const types = ['SON_OF', 'BORN_IN', 'RULED_OVER', 'SERVANT_OF']
    types.forEach(type => {
      const result = RelationTypeEnum.safeParse(type)
      expect(result.success).toBe(true)
    })
  })
})