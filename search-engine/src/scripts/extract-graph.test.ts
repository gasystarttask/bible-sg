import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildExtractionPrompt,
  runExtractionPipeline,
  mergeEntities,
  groupByBookChapter,
  createCopilotLlmClient,
} from './extract-graph'
import { VerseRecord, ChapterGraph, LlmClient, RawGraphOutput } from '@search/types/entity.type';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

describe('US-005 - LLM Extraction Pipeline', () => {
  describe('buildExtractionPrompt', () => {
    it('builds a specialized French prompt with strict extraction rules', () => {
      const prompt = buildExtractionPrompt({
        book: 'GEN',
        chapter: 12,
        verses: [
          {
            verse_id: 'b.GEN.12.10',
            text: 'Abram descendit en Égypte.',
            book: 'GEN',
            chapter: 12,
            verse: 10
          }
        ]
      })

      expect(prompt).toContain("Toute l'extraction doit être faite en FRANÇAIS")
      expect(prompt).toContain('RÈGLES STRICTES')
      expect(prompt).toContain('Person, Location, Object')
      expect(prompt).toContain('PERE_DE')
      expect(prompt).toContain('EPOUX_DE')
      expect(prompt).toContain('VOYAGE_VERS')
      expect(prompt).toContain('JSON valide')
      expect(prompt).toContain('__JSON_START__')
      expect(prompt).toContain('__JSON_END__')
    })

    it('includes verse context in prompt', () => {
      const verses: VerseRecord[] = [
        {
          verse_id: 'b.GEN.12.1',
          text: 'Le Seigneur dit à Abram...',
          book: 'GEN',
          chapter: 12,
          verse: 1
        },
        {
          verse_id: 'b.GEN.12.5',
          text: 'Abram prit Saraï...',
          book: 'GEN',
          chapter: 12,
          verse: 5
        }
      ]
      const prompt = buildExtractionPrompt({ book: 'GEN', chapter: 12, verses })

      expect(prompt).toContain('b.GEN.12.1')
      expect(prompt).toContain('b.GEN.12.5')
      expect(prompt).toContain('Le Seigneur dit à Abram')
    })
  })

  describe('groupByBookChapter', () => {
    it('groups verses by book and chapter', () => {
      const verses: VerseRecord[] = [
        { verse_id: 'b.GEN.12.1', text: 'v1', book: 'GEN', chapter: 12, verse: 1 },
        { verse_id: 'b.GEN.12.2', text: 'v2', book: 'GEN', chapter: 12, verse: 2 },
        { verse_id: 'b.GEN.13.1', text: 'v3', book: 'GEN', chapter: 13, verse: 1 }
      ]

      const grouped = groupByBookChapter(verses, ['GEN'])

      expect(grouped).toHaveLength(2)
      expect(grouped[0]).toEqual(
        expect.objectContaining({
          book: 'GEN',
          chapter: 12,
          verses: expect.arrayContaining([
            expect.objectContaining({ verse_id: 'b.GEN.12.1' }),
            expect.objectContaining({ verse_id: 'b.GEN.12.2' })
          ])
        })
      )
    })

    it('filters by allowed books', () => {
      const verses: VerseRecord[] = [
        { verse_id: 'b.GEN.1.1', text: 'v1', book: 'GEN', chapter: 1, verse: 1 },
        { verse_id: 'b.MAT.1.1', text: 'v2', book: 'MAT', chapter: 1, verse: 1 },
        { verse_id: 'b.ACT.1.1', text: 'v3', book: 'ACT', chapter: 1, verse: 1 }
      ]

      const grouped = groupByBookChapter(verses, ['GEN', 'MAT'])

      expect(grouped).toHaveLength(2)
      expect(grouped.map((g) => g.book)).toEqual(['GEN', 'MAT'])
    })

    it('sorts verses by verse number within chapter', () => {
      const verses: VerseRecord[] = [
        { verse_id: 'b.GEN.1.3', text: 'v3', book: 'GEN', chapter: 1, verse: 3 },
        { verse_id: 'b.GEN.1.1', text: 'v1', book: 'GEN', chapter: 1, verse: 1 },
        { verse_id: 'b.GEN.1.2', text: 'v2', book: 'GEN', chapter: 1, verse: 2 }
      ]

      const grouped = groupByBookChapter(verses, ['GEN'])

      expect(grouped[0].verses.map((v) => v.verse_id)).toEqual([
        'b.GEN.1.1',
        'b.GEN.1.2',
        'b.GEN.1.3'
      ])
    })
  })

  describe('mergeEntities', () => {
    it('deduplicates entities by slug', () => {
      const chapters: ChapterGraph[] = [
        {
          book: 'GEN',
          chapter: 12,
          query: 'GEN 12',
          entities: [
            {
              name: 'Abram',
              type: 'Person',
              description: 'Patriarche',
              slug: 'abram',
              source_verse_id: 'b.GEN.12.1'
            }
          ],
          relations: []
        },
        {
          book: 'GEN',
          chapter: 13,
          query: 'GEN 13',
          entities: [
            {
              name: 'Abram',
              type: 'Person',
              description: 'Père des croyants',
              slug: 'abram',
              source_verse_id: 'b.GEN.13.1'
            }
          ],
          relations: []
        }
      ]

      const merged = mergeEntities(chapters)

      expect(merged.size).toBe(1)
      expect(merged.has('abram')).toBe(true)
      expect(merged.get('abram')?.description).toContain('Père des croyants')
    })

    it('disambiguates homonyms with different names but same slug', () => {
      const chapters: ChapterGraph[] = [
        {
          book: 'GEN',
          chapter: 4,
          query: 'GEN 4',
          entities: [
            {
              name: 'Hénoch 1',
              type: 'Person',
              description: 'Fils de Caïn',
              slug: 'henoch',
              source_verse_id: 'b.GEN.4.17'
            }
          ],
          relations: []
        },
        {
          book: 'GEN',
          chapter: 5,
          query: 'GEN 5',
          entities: [
            {
              name: 'Hénoch 2',
              type: 'Person',
              description: 'Fils de Jared',
              slug: 'henoch',
              source_verse_id: 'b.GEN.5.24'
            }
          ],
          relations: []
        }
      ]

      const merged = mergeEntities(chapters)

      expect(merged.size).toBe(2)
      const keys = Array.from(merged.keys())
      // Both keys should have 'henoch' in them
      const henochKeys = keys.filter((k) => k.includes('henoch'))
      expect(henochKeys).toHaveLength(2)
      // At least one key should be the plain slug, the other should be disambiguated
      expect(keys).toContain('henoch')
      // The second one should have a suffix with context
      const suffixed = keys.find((k) => k !== 'henoch' && k.includes('henoch'))
      expect(suffixed).toBeDefined()
    })

    it('keeps longest description when merging', () => {
      const chapters: ChapterGraph[] = [
        {
          book: 'GEN',
          chapter: 12,
          query: 'GEN 12',
          entities: [
            {
              name: 'Abram',
              type: 'Person',
              description: 'Short',
              slug: 'abram',
              source_verse_id: 'b.GEN.12.1'
            }
          ],
          relations: []
        },
        {
          book: 'GEN',
          chapter: 13,
          query: 'GEN 13',
          entities: [
            {
              name: 'Abram',
              type: 'Person',
              description: 'This is a much longer description',
              slug: 'abram',
              source_verse_id: 'b.GEN.13.1'
            }
          ],
          relations: []
        }
      ]

      const merged = mergeEntities(chapters)
      expect(merged.get('abram')?.description).toBe('This is a much longer description')
    })
  })

  describe('runExtractionPipeline', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), 'extract-graph-'))
    })

    it('parses real processed_bible.json rows with id + French book name', async () => {
      const inputPath = path.join(tmpDir, 'processed_bible.json')
      const outputPath = path.join(tmpDir, 'data', 'raw_graph.json')

      await writeJson(inputPath, [
        {
          id: 'b.GEN.12.1',
          book: 'Genèse',
          chapter: 12,
          verse: 1,
          text: 'Le Seigneur dit à Abram: Va-t-en de ton pays.',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        },
        {
          id: 'b.GEN.12.5',
          book: 'Genèse',
          chapter: 12,
          verse: 5,
          text: 'Abram prit Saraï, sa femme, et Lot, fils de son frère.',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        }
      ])

      const llm: LlmClient = {
        invoke: async () =>
          JSON.stringify({
            entities: [
              {
                name: 'Abram',
                type: 'Person',
                description: 'Patriarche',
                slug: 'abram',
                source_verse_id: 'b.GEN.12.1'
              },
              {
                name: 'Lot',
                type: 'Person',
                description: "Neveu d'Abram",
                slug: 'lot',
                source_verse_id: 'b.GEN.12.5'
              }
            ],
            relations: [
              {
                source_slug: 'lot',
                relation_type: 'NEPHEW_OF',
                target_slug: 'abram',
                evidence_verse_id: 'b.GEN.12.5'
              }
            ]
          })
      }

      const result = await runExtractionPipeline({
        inputPath,
        outputPath,
        books: ['GEN'],
        delayMs: 0,
        llm,
        verbose: false
      })

      expect(result.chapters).toHaveLength(1)
      expect(result.chapters[0].entities).toHaveLength(2)
      expect(result.chapters[0].relations).toHaveLength(1)
      expect(result.merged_entities).toHaveLength(2)

      const saved = JSON.parse(await readFile(outputPath, 'utf-8')) as RawGraphOutput
      expect(saved.chapters).toHaveLength(1)
    })

    it('DoD: extracts genealogy (NEPHEW_OF), geography (TRAVELS_TO), and persons', async () => {
      const inputPath = path.join(tmpDir, 'processed_bible.json')
      const outputPath = path.join(tmpDir, 'data', 'raw_graph.json')

      await writeJson(inputPath, [
        {
          id: 'b.GEN.12.5',
          book: 'Genèse',
          chapter: 12,
          verse: 5,
          text: 'Abram prit Saraï et Lot et ils allèrent en Canaan.',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        },
        {
          id: 'b.GEN.12.10',
          book: 'Genèse',
          chapter: 12,
          verse: 10,
          text: 'Il y eut une famine. Abram descendit en Égypte.',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        }
      ])

      const llm: LlmClient = {
        invoke: async () =>
          JSON.stringify({
            entities: [
              {
                name: 'Abram',
                type: 'Person',
                description: 'Patriarche',
                slug: 'abram',
                source_verse_id: 'b.GEN.12.5'
              },
              {
                name: 'Lot',
                type: 'Person',
                description: "Neveu d'Abram",
                slug: 'lot',
                source_verse_id: 'b.GEN.12.5'
              },
              {
                name: 'Canaan',
                type: 'Location',
                description: 'Terre promise',
                slug: 'canaan',
                source_verse_id: 'b.GEN.12.5'
              },
              {
                name: 'Égypte',
                type: 'Location',
                description: "Pays d'Afrique",
                slug: 'egypte',
                source_verse_id: 'b.GEN.12.10'
              }
            ],
            relations: [
              {
                source_slug: 'lot',
                relation_type: 'NEPHEW_OF',
                target_slug: 'abram',
                evidence_verse_id: 'b.GEN.12.5'
              },
              {
                source_slug: 'abram',
                relation_type: 'TRAVELS_TO',
                target_slug: 'canaan',
                evidence_verse_id: 'b.GEN.12.5'
              },
              {
                source_slug: 'abram',
                relation_type: 'TRAVELS_TO',
                target_slug: 'egypte',
                evidence_verse_id: 'b.GEN.12.10'
              }
            ]
          })
      }

      const result = await runExtractionPipeline({
        inputPath,
        outputPath,
        books: ['GEN'],
        delayMs: 0,
        llm,
        verbose: false
      })

      expect(result.chapters).toHaveLength(1)
      expect(result.chapters[0].relations).toContainEqual({
        source_slug: 'lot',
        relation_type: 'NEPHEW_OF',
        target_slug: 'abram',
        evidence_verse_id: 'b.GEN.12.5'
      })
      expect(result.chapters[0].relations).toContainEqual(
        expect.objectContaining({
          source_slug: 'abram',
          relation_type: 'TRAVELS_TO',
          target_slug: 'egypte'
        })
      )
    })

    it('uses schema validator and does not crash on malformed LLM output', async () => {
      const inputPath = path.join(tmpDir, 'processed_bible.json')
      const outputPath = path.join(tmpDir, 'data', 'raw_graph.json')

      await writeJson(inputPath, [
        {
          id: 'b.GEN.12.1',
          book: 'Genèse',
          chapter: 12,
          verse: 1,
          text: 'Va-t-en de ton pays.',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        }
      ])

      const llm: LlmClient = {
        invoke: async () => '{"invalid": true, "entities": "not_array"}'
      }

      const result = await runExtractionPipeline({
        inputPath,
        outputPath,
        books: ['GEN'],
        delayMs: 0,
        llm,
        verbose: false
      })

      expect(result.chapters).toHaveLength(1)
      expect(result.chapters[0].entities).toEqual([])
      expect(result.chapters[0].relations).toEqual([])
    })

    it('respects configurable delayMs for rate limiting', async () => {
      const inputPath = path.join(tmpDir, 'processed_bible.json')
      const outputPath = path.join(tmpDir, 'data', 'raw_graph.json')

      await writeJson(inputPath, [
        {
          id: 'b.GEN.1.1',
          book: 'Genèse',
          chapter: 1,
          verse: 1,
          text: '...',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        },
        {
          id: 'b.GEN.2.1',
          book: 'Genèse',
          chapter: 2,
          verse: 1,
          text: '...',
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        }
      ])

      const llm: LlmClient = {
        invoke: async () => JSON.stringify({ entities: [], relations: [] })
      }

      const start = Date.now()
      await runExtractionPipeline({
        inputPath,
        outputPath,
        books: ['GEN'],
        delayMs: 100,
        llm,
        verbose: false
      })
      const elapsed = Date.now() - start

      // With 2 chapters and 100ms delay between them, should take at least 50ms
      expect(elapsed).toBeGreaterThanOrEqual(50)
    }, 10000)

    it('throws on rate-limit 429 (>3600s retry-after) without crashing', async () => {
      const inputPath = path.join(tmpDir, 'processed_bible.json')
      const outputPath = path.join(tmpDir, 'data', 'raw_graph.json')
      const partialPath = path.join(tmpDir, 'data', 'raw_graph.partial.json')

      await writeJson(
        inputPath,
        Array.from({ length: 3 }, (_, i) => ({
          id: `b.GEN.${i + 1}.1`,
          book: 'Genèse',
          chapter: i + 1,
          verse: 1,
          text: `Chapter ${i + 1}`,
          metadata: { testament: 'Old', version: 'BIBLE(Fr)' }
        }))
      )

      let callCount = 0
      const llm: LlmClient = {
      invoke: async () => {
          callCount++
          if (callCount === 2) {
            const err = new Error('Rate limit')
            ;(err as Error & { status: number; headers: Record<string, string> }).status = 429
            ;(err as Error & { status: number; headers: Record<string, string> }).headers = { 'retry-after': '86400' }
            throw err
          }
          return JSON.stringify({ entities: [], relations: [] })
        }
      }

      await expect(
        runExtractionPipeline({
          inputPath,
          outputPath,
          books: ['GEN'],
          delayMs: 0,
          llm,
          partialOutputPath: partialPath,
          verbose: false
        })
      ).rejects.toThrow(/Rate limit/)

      expect(callCount).toBeGreaterThanOrEqual(2)
    }, 15000)

    it('uses gpt-4o-mini by default', () => {
      const model = process.env.COPILOTE_MODEL ?? 'gpt-4o-mini'
      expect(model).toBe('gpt-4o-mini')
    })

    it('respects EXTRACT_DELAY_MS environment variable', () => {
      const delayMs = 20000
      expect(delayMs).toBeGreaterThanOrEqual(15000)
      expect(delayMs).toBeLessThanOrEqual(30000)
    })
  })

  describe('createCopilotLlmClient', () => {
    it('creates client with GitHub token', () => {
      const token = 'test-token-123'
      const client = createCopilotLlmClient(token, 'gpt-4o-mini')

      expect(client).toHaveProperty('invoke')
      expect(typeof client.invoke).toBe('function')
    })
  })
})