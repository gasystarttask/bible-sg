import { TargetBook } from "./target-book.type"

export interface AliasConfig {
  alias_to_canonical?: Record<string, string>
  canonical_aliases?: Record<string, string[]>
  canonical_meta?: Record<string, { name?: string; type?: string }>
}

export interface VerseRecord {
  verse_id: string
  text: string
  book?: string
  chapter?: number
  verse?: number
}

export interface RawEntity {
  name: string
  type: 'Person' | 'Location' | 'Object' | 'Event'
  description: string
  slug: string
  source_verse_id: string
}

export interface RawRelation {
  source_slug: string
  relation_type: string
  target_slug: string
  evidence_verse_id: string
}

export interface ChapterGraph {
  book: string
  chapter: number
  query: string
  entities: RawEntity[]
  relations: RawRelation[]
}

export interface RawGraphOutput {
  generated_at: string
  books: string[]
  chapters: ChapterGraph[]
  merged_entities?: RawEntity[]
}

export interface LlmClient {
  invoke(prompt: string): Promise<string>
}

export interface RunOptions {
  inputPath: string
  outputPath: string
  books?: TargetBook[]
  delayMs?: number
  llm: LlmClient
  sleepFn?: (ms: number) => Promise<void>
  verbose?: boolean
  partialOutputPath?: string
}