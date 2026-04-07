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
3. Apply **adaptive fanout**:
   - If `vectorWeight <= 0.1`: skip vector search entirely (resolve to empty).
   - If `graphWeight <= 0.25`: skip graph search entirely (resolve to empty).
   - Otherwise: use fanout multiplier based on intent:
     - `vectorSearchK = (vectorWeight <= 0.15) ? max(4, k) : k * 2`
     - `graphSearchK = (graphWeight >= 0.8) ? max(k + 2, 8) : k * 2`
4. Run in parallel (both or single-sided):
   - `vectorSearch(query, vectorSearchK, filters)`
   - `graphSearch(query, graphSearchK, filters)`
5. Merge both lists using `reciprocalRankFusion(...)`.
6. Keep top `k` verses above `minScore`.
7. Resolve entity slugs:
   - first from `verse.entitySlugs`,
   - fallback to `extractMentionedEntities(...)` if missing.
8. Load facts with relations via `augmentWithEntityFacts(...)`.
9. Re-rank/filter entity facts with `scoreAndFilterEntityFacts(...)` (includes genealogy lexical boosting via `rerankByQueryOverlap` for kinship hints).
10. Cache and return final response.

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
- `isGenealogyQuery`: detects kinship patterns in query string.
- `rerankByQueryOverlap`: lexical boosting for genealogy context.

---

## Weight presets (from Query Router)

| Intent | Vector | Graph | k | Use Case |
|--------|--------|-------|---|----------|
| **THEOLOGY** | 0.9 | 0.1 | 5 | Thematic: "What does Bible say about faith?" |
| **GENEALOGY** | 0.1 | 0.9 | 6 | Kinship: "Father of Jacob?" → *fast profile: 0.8/0.2 after routing* |
| **GEOGRAPHY** | 0.5 | 0.5 | 8 | Places: "Abraham in Egypt?" |
| **CHRONOLOGY** | 0.4 | 0.6 | 8 | Timeline: "What happened after X?" |
| **GENERAL** | 0.8 | 0.2 | 5 | Fallback (vector-only with graph skip) |

*Note: Kinship fast profile applied dynamically by router when direct kinship detected.*

---

## Optimization: Adaptive fanout & kinship fast profile

### Context
- **Genealogy queries** (`"fils de"`, `"son of"`, etc.) benefit from high graph weight but graph search is slow (~3–7s cold).
- **Theology/General queries** are fast with vector-only but GENERAL used to run full hybrid (added latency + noise).

### Solutions
1. **Kinship fast profile** (from Query Router):
   - Direct kinship patterns detected in `query-router.ts` → `isDirectKinshipQuestion`
   - Routes genealogy to `vectorWeight: 0.8, graphWeight: 0.2, k: 6` (fast)
   - Skips graph search via adaptive fanout when `gw <= 0.25`
   - Result: genealogy queries drop from 6.6s → ~2s cold, correct Genesis verses for Joseph query

2. **THEOLOGY weight bump + Christology keywords** (from Query Router US-009 refinement):
   - Added `"jesus"`, `"jésus"`, `"christ"`, `"messie"` to heuristic intent detection
   - Adjusted `GENERAL: { vw: 0.8, gw: 0.2 }` (was 0.7/0.3)
   - Ensures pure-vector queries stay <2s, irrelevant graph results skipped

3. **Genealogy lexical boost** (`rerankByQueryOverlap`):
   - If query looks genealogical, re-rank results by token overlap with query
   - Prioritizes verses mentioning query keywords (e.g., query "Joseph" → Genesis 46:19 ranked high)
   - Applied post-RRF fusion in retriever's `retrieve` method

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