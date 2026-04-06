import { ChapterGraph, RawRelation, RawEntity, RawGraphOutput } from '@search/types/entity.type'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
interface CliOptions {
  inputDir: string
  outputPath: string
  pattern: RegExp
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

  const inputDir = args.get('--input-dir') ?? path.resolve(process.cwd(), '../data')
  const outputPath = args.get('--output') ?? path.resolve(inputDir, 'row_graph.json')
  const pattern = new RegExp(args.get('--pattern') ?? '^raw_graph\\..+\\.json$')

  return { inputDir, outputPath, pattern }
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function chapterKey(ch: ChapterGraph): string {
  return `${ch.book}:${ch.chapter}`
}

function relationKey(r: RawRelation): string {
  return `${r.source_slug}|${r.relation_type}|${r.target_slug}|${r.evidence_verse_id}`
}

function mergeChapter(a: ChapterGraph, b: ChapterGraph): ChapterGraph {
  const scoreA = a.entities.length + a.relations.length
  const scoreB = b.entities.length + b.relations.length
  const base = scoreB >= scoreA ? b : a
  const other = scoreB >= scoreA ? a : b

  const entitiesBySlug = new Map<string, RawEntity>()
  for (const e of [...base.entities, ...other.entities]) {
    const existing = entitiesBySlug.get(e.slug)
    if (!existing || (e.description?.length ?? 0) > (existing.description?.length ?? 0)) {
      entitiesBySlug.set(e.slug, e)
    }
  }

  const relSeen = new Set<string>()
  const relations: RawRelation[] = []
  for (const r of [...base.relations, ...other.relations]) {
    const key = relationKey(r)
    if (relSeen.has(key)) continue
    relSeen.add(key)
    relations.push(r)
  }

  return {
    ...base,
    entities: [...entitiesBySlug.values()],
    relations
  }
}

function rebuildMergedEntities(chapters: ChapterGraph[]): RawEntity[] {
  const bySlug = new Map<string, RawEntity>()
  for (const ch of chapters) {
    for (const e of ch.entities) {
      const existing = bySlug.get(e.slug)
      if (!existing || (e.description?.length ?? 0) > (existing.description?.length ?? 0)) {
        bySlug.set(e.slug, e)
      }
    }
  }
  return [...bySlug.values()]
}

async function readRawGraph(filePath: string): Promise<RawGraphOutput | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RawGraphOutput>

    return {
      generated_at: String(parsed.generated_at ?? new Date().toISOString()),
      books: safeArray<string>(parsed.books),
      chapters: safeArray<ChapterGraph>(parsed.chapters),
      merged_entities: safeArray<RawEntity>(parsed.merged_entities)
    }
  } catch (err) {
    console.warn(`[merge-raw-graph] skip invalid file: ${filePath}`, err)
    return null
  }
}

export async function mergeRawGraphs(options: CliOptions): Promise<RawGraphOutput> {
  const { inputDir, outputPath, pattern } = options
  const entries = await readdir(inputDir)

  const files = entries
    .filter((f) => pattern.test(f))
    .filter((f) => path.resolve(inputDir, f) !== path.resolve(outputPath))
    .map((f) => path.resolve(inputDir, f))
    .sort()

  if (files.length === 0) {
    throw new Error(`[merge-raw-graph] no input files matching ${pattern} in ${inputDir}`)
  }

  const chapterMap = new Map<string, ChapterGraph>()

  for (const file of files) {
    const graph = await readRawGraph(file)
    if (!graph) continue

    for (const ch of graph.chapters) {
      const key = chapterKey(ch)
      const existing = chapterMap.get(key)
      chapterMap.set(key, existing ? mergeChapter(existing, ch) : ch)
    }
  }

  const chapters = [...chapterMap.values()].sort((a, b) =>
    a.book === b.book ? a.chapter - b.chapter : a.book.localeCompare(b.book)
  )

  const books = [...new Set(chapters.map((c) => c.book))]
  const merged_entities = rebuildMergedEntities(chapters)

  const output: RawGraphOutput = {
    generated_at: new Date().toISOString(),
    books,
    chapters,
    merged_entities
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8')

  console.log(
    `[merge-raw-graph] merged files=${files.length}, books=${books.length}, chapters=${chapters.length}, entities=${merged_entities.length}, output=${outputPath}`
  )

  return output
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  await mergeRawGraphs(options)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}