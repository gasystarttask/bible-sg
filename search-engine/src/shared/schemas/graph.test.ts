import { describe, it, expect } from 'vitest'
import {
  EntitySchema,
  RelationSchema,
  EntityTypeEnum,
  RelationTypeEnum,
  validateGraph,
  validateExtractionGraph,
  type Entity,
  type Relation
} from './graph'

function validateEntity(input: unknown): {
  success: boolean
  data?: Entity
  errors?: string[]
} {
  const result = EntitySchema.safeParse(input)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
  }

  return {
    success: true,
    data: result.data
  }
}

function validateRelation(input: unknown): {
  success: boolean
  data?: Relation
  errors?: string[]
} {
  const result = RelationSchema.safeParse(input)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
  }

  return {
    success: true,
    data: result.data
  }
}

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
    const invalidEntity = {
      name: 'Abraham',
      type: 'Person',
      description: 'Patriarch of Israel',
      slug: 'Abraham_Invalid',
      source_verse_id: 'b.GEN.12.1'
    }

    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Invalid slug format')
  })

  it('should reject entity with invalid verse ID format', () => {
    const invalidEntity = {
      name: 'Abraham',
      type: 'Person',
      description: 'Patriarch of Israel',
      slug: 'abraham',
      source_verse_id: 'GEN.12.1'
    }

    const result = validateEntity(invalidEntity)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Invalid verse id format')
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
    const invalidEntity = {
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
    const invalidRelation = {
      source_slug: 'isaac',
      relation_type: 'INVALID_RELATION',
      target_slug: 'abraham',
      evidence_verse_id: 'b.GEN.21.2'
    }

    const result = validateRelation(invalidRelation)
    expect(result.success).toBe(false)
  })

  it('should reject relation with invalid evidence_verse_id', () => {
    const invalidRelation = {
      source_slug: 'isaac',
      relation_type: 'SON_OF',
      target_slug: 'abraham',
      evidence_verse_id: 'INVALID_VERSE'
    }

    const result = validateRelation(invalidRelation)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]).toContain('Invalid verse id format')
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
    ] as const

    relationTypes.forEach((relType) => {
      const relation = {
        source_slug: 'entity1',
        relation_type: relType,
        target_slug: 'entity2',
        evidence_verse_id: 'b.GEN.1.1'
      }

      const result = validateRelation(relation)
      expect(result.success, `Relation type ${relType} should be valid`).toBe(true)
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

  it('should validate French biblical graph', () => {
    const frenchBiblicalGraph = {
      entities: [
        {
          name: 'Abraham',
          type: 'Person',
          description: "Patriarche d'Israël, père d'Isaac et d'Ismaël",
          slug: 'abraham',
          source_verse_id: 'b.GEN.12.1'
        },
        {
          name: 'Isaac',
          type: 'Person',
          description: "Fils d'Abraham et de Sarah",
          slug: 'isaac',
          source_verse_id: 'b.GEN.21.2'
        },
        {
          name: 'Sarah',
          type: 'Person',
          description: "Épouse d'Abraham, mère d'Isaac",
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

describe('Graph Schema - Strict Extraction Validation', () => {
  it('should validate a strict extraction graph', () => {
    const extractionGraph = {
      entities: [
        {
          name: 'Jésus',
          type: 'Person',
          description: 'Messie annoncé dans les Écritures',
          slug: 'jesus',
          source_verse_id: 'b.MAT.1.1'
        },
        {
          name: 'David',
          type: 'Person',
          description: "Roi d'Israël",
          slug: 'david',
          source_verse_id: 'b.MAT.1.1'
        }
      ],
      relations: [
        {
          source_slug: 'jesus',
          relation_type: 'SON_OF',
          target_slug: 'david',
          source_type: 'Person',
          target_type: 'Person',
          justification: "Jésus est présenté comme fils de David dans la généalogie.",
          evidence_verse_id: 'b.MAT.1.1'
        }
      ]
    }

    const result = validateExtractionGraph(extractionGraph)
    expect(result.success).toBe(true)
  })

  it('should reject kinship relation with non Person endpoint', () => {
    const extractionGraph = {
      entities: [
        {
          name: 'Jésus',
          type: 'Person',
          description: 'Messie',
          slug: 'jesus',
          source_verse_id: 'b.MAT.1.1'
        },
        {
          name: 'Nazareth',
          type: 'Location',
          description: 'Ville de Galilée',
          slug: 'nazareth',
          source_verse_id: 'b.MAT.2.23'
        }
      ],
      relations: [
        {
          source_slug: 'jesus',
          relation_type: 'SON_OF',
          target_slug: 'nazareth',
          source_type: 'Person',
          target_type: 'Location',
          justification: 'Relation invalide.',
          evidence_verse_id: 'b.MAT.2.23'
        }
      ]
    }

    const result = validateExtractionGraph(extractionGraph)
    expect(result.success).toBe(false)
  })

  it('should reject metaphorical spouse relation', () => {
    const extractionGraph = {
      entities: [
        {
          name: 'Jésus',
          type: 'Person',
          description: 'Messie',
          slug: 'jesus',
          source_verse_id: 'b.MAT.4.1'
        },
        {
          name: 'Diable',
          type: 'Person',
          description: 'Tentateur',
          slug: 'diable',
          source_verse_id: 'b.MAT.4.1'
        }
      ],
      relations: [
        {
          source_slug: 'jesus',
          relation_type: 'SPOUSE_OF',
          target_slug: 'diable',
          source_type: 'Person',
          target_type: 'Person',
          justification: 'Relation erronée produite par le modèle.',
          evidence_verse_id: 'b.MAT.4.1'
        }
      ]
    }

    const result = validateExtractionGraph(extractionGraph)
    expect(result.success).toBe(false)
  })

  it('should reject noisy EVENT_AT target', () => {
    const extractionGraph = {
      entities: [
        {
          name: 'Jésus',
          type: 'Person',
          description: 'Messie',
          slug: 'jesus',
          source_verse_id: 'b.MAT.7.24'
        },
        {
          name: 'Sable',
          type: 'Location',
          description: 'Lieu générique de parabole',
          slug: 'sable',
          source_verse_id: 'b.MAT.7.26'
        }
      ],
      relations: [
        {
          source_slug: 'jesus',
          relation_type: 'EVENT_AT',
          target_slug: 'sable',
          source_type: 'Person',
          target_type: 'Location',
          justification: 'Cible trop générique.',
          evidence_verse_id: 'b.MAT.7.26'
        }
      ]
    }

    const result = validateExtractionGraph(extractionGraph)
    expect(result.success).toBe(false)
  })
})

describe('Graph Schema - Type Exports', () => {
  it('should export EntityType enum', () => {
    const types = ['Person', 'Location', 'Object', 'Event']
    types.forEach((type) => {
      const result = EntityTypeEnum.safeParse(type)
      expect(result.success).toBe(true)
    })
  })

  it('should export RelationType enum', () => {
    const types = ['SON_OF', 'BORN_IN', 'RULED_OVER', 'SERVANT_OF']
    types.forEach((type) => {
      const result = RelationTypeEnum.safeParse(type)
      expect(result.success).toBe(true)
    })
  })
})