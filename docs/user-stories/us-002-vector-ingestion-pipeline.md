# User Story: US-002 - Vector Ingestion Pipeline

**As a** Data Engineer,  
**I want to** generate vector embeddings for each Bible verse and store them in DocumentDB,  
**So that** the chat engine can perform semantic similarity searches to find relevant context.

---

## 🎯 Acceptance Criteria

- [ ] **Embedding Generation:** Use OpenAI's `text-embedding-3-small` (1536 dimensions) to vectorize the `text` field of each JSON segment.
- [ ] **Batch Processing:** Implement batching (e.g., 100 verses per request) to optimize API calls and avoid rate limits.
- [ ] **DocumentDB Integration:** Store the resulting vectors in the `verses` collection using the `vector` type (provided by the underlying `pgvector` extension).
- [ ] **Metadata Persistence:** Ensure all metadata (book, chapter, verse ID) is stored alongside the vector for filtering purposes.
- [ ] **Idempotency:** The script should be re-runnable without creating duplicate entries (use the verse ID as a unique constraint).

---

## 🛠️ Technical Notes

* **Orchestrator:** Use `LangChain.js` and its `MongoDBAtlasVectorSearch` or `PGVector` integrations (depending on the specific DocumentDB.io driver configuration).
* **Environment Variables:** Securely handle `OPENAI_API_KEY` and `DATABASE_URL`.
* **Rate Limiting:** Implement a "sleep" or retry logic if the OpenAI API returns a `429` (Too Many Requests).
* **Vector Indexing:** Ensure an **HNSW** (Hierarchical Navigable Small World) index is created on the vector column to maintain sub-second search speeds across 31k+ verses.

---

## 🧪 Definition of Done (DoD)

1.  A script `scripts/vectorize-bible.ts` is functional.
2.  The `verses` collection in DocumentDB is populated with ~31,102 documents.
3.  Each document contains an `embedding` array of 1536 floats.
4.  A manual test query (e.g., searching for "parables about seeds") returns topographically similar verses (e.g., Matthew 13).
5.  Search latency is under 200ms.

---

**Priority:** High (Blocker for Phase 3)  
**Estimation:** 5-8 Story Points  
**Status:** 📥 `to-do`