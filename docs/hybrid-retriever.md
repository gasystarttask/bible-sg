# hybrid-retriever.ts

## Purpose
`src/lib/hybrid-retriever.ts` provides a **hybrid Bible search** that combines:

- vector search (semantic similarity with OpenAI embeddings + MongoDB vector index),
- graph search (entity-driven retrieval with `entity_slugs`),
- rank fusion (RRF) to merge both result sets.

It returns:
- ranked verses,
- related entity facts,
- metadata about search weights and result counts.

---

## Main flow (`retrieve`)

1. Build a cache key from query + parameters.
2. Return cached payload if available (`retrieveCache`).
3. Run in parallel:
   - `vectorSearch(query, k * 2, filters)`
   - `graphSearch(query, k * 2, filters)`
4. Merge both lists using `reciprocalRankFusion(...)`.
5. Keep top `k` verses above `minScore`.
6. Resolve entity slugs:
   - first from `verse.entitySlugs`,
   - fallback to `extractMentionedEntities(...)` if missing.
7. Load facts with relations via `augmentWithEntityFacts(...)`.
8. Re-rank/filter entity facts with `scoreAndFilterEntityFacts(...)`.
9. Cache and return final response.

---

## Search strategies

### 1) `vectorSearch`
- Creates/reads embedding from `getQueryEmbedding` (with embedding cache).
- Runs MongoDB `$vectorSearch` on `embedding`.
- Applies optional `book` / `testament` filters.
- Returns `RankedVerseResult[]` with source `"vector"`.

### 2) `graphSearch`
- Tokenizes query and matches entities (`name` / `aliases`).
- Uses `entity_slugs: { $in: [...] }` against `verses` (primary path).
- Applies same `book` / `testament` filters.
- Uses limited regex fallback only if no primary hits.
- Returns `RankedVerseResult[]` with source `"graph"`.

### 3) Fusion: `reciprocalRankFusion`
- Combines vector + graph rankings with configurable weights:
  - `vectorWeight`
  - `graphWeight`
- Produces final hybrid score and source `"hybrid"`.

---

## Entity enrichment

### `augmentWithEntityFacts`
Uses a MongoDB aggregation pipeline:
- `$match` selected entities by slug,
- `$lookup` relations by `source_slug` or `source_entity_id`,
- nested `$lookup` to resolve relation targets in `entities`,
- projects normalized `EntityFact` output.

### `scoreAndFilterEntityFacts`
Applies relevance scoring using:
- query overlap (`inQuery`, token overlap),
- presence in returned verses,
- relation count bonus,
- penalties for generic/auto-generated/noisy entities.

Then:
- keeps only positive facts,
- deduplicates by normalized name,
- trims relations and max returned facts.

---

## Caching

- **Embedding cache** (`embeddingCache`)
  - key: normalized query
  - reduces repeated OpenAI embedding calls
- **Retrieve cache** (`retrieveCache`)
  - key: query + search params + filters
  - accelerates repeated API requests

Both caches are in-memory TTL maps with max-size eviction.

---

## Important helpers

- `normalizeLoose`, `stripDiacritics`, `tokenizeQuery`: robust text normalization.
- `buildBookRegexes`, `buildTestamentRegex`: filter normalization.
- `containsNormalizedPhrase`: normalized phrase boundary matching.
- `dedupeRelations`: removes duplicate relation edges in output.

---

## Recommended indexes

```javascript
db.verses.createIndex({ entity_slugs: 1 });
db.entities.createIndex({ slug: 1 }, { unique: true });
db.relations.createIndex({ source_slug: 1 });
db.relations.createIndex({ source_entity_id: 1 });
db.relations.createIndex({ target_slug: 1 });
db.relations.createIndex({ target_entity_id: 1 });
```

These indexes are required for stable latency and scalable graph enrichment.