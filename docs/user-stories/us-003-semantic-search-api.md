# User Story: US-003 - Semantic Search API

**As a** Developer,  
**I want to** create a backend API endpoint that performs vector similarity searches,  
**So that** I can retrieve the most relevant Bible verses based on the meaning of a user's query rather than just keywords.

---

## 🎯 Acceptance Criteria

- ✅ **Query Vectorization:** The API must take a plain text string, convert it into a vector using the `text-embedding-3-small` model.
- ✅ **Vector Search Execution:** Perform a similarity search in the DocumentDB `verses` collection (using the `$vectorSearch` or `pgvector` operator).
- ✅ **Metadata Filtering:** The API must support optional filters (e.g., searching only in the "New Testament" or a specific "Book").
- ✅ **Result Formatting:** Return a JSON array of the top `K` most relevant verses (default K=5) including their text, reference (ID), and similarity score.
- ✅ **Performance:** The end-to-end search (embedding + DB query) should respond in under 500ms.

---

## 🛠️ Technical Notes

* **Endpoint:** `POST /api/search`
* **Library:** Use `LangChain.js` VectorStore abstractions for DocumentDB.
* **Security:** Implement rate limiting (OpenAI cost protection).
* **Similarity Threshold:** Implement a minimum score threshold (e.g., 0.7).

---

## 🧪 Definition of Done (DoD)

1.  A Next.js Route Handler `app/api/search/route.ts` is implemented.
2.  The API successfully connects to DocumentDB and OpenAI.
3.  **Testing with a French query** like *"Jésus marchant sur l'eau"* returns the correct historical accounts (Matthieu 14, Marc 6, Jean 6).
4.  The API handles empty results or database connection timeouts gracefully (HTTP 400, 500).

---

**Priority:** High (Core RAG Component)  
**Estimation:** 3-5 Story Points  
**Status:** ✅ `done`