# User Story: US-009 - Agentic Query Router

**As a** Developer,  
**I want to** use an LLM to decide the best search strategy for a user's question,  
**So that** the system automatically chooses between semantic search, graph traversal, or a specific hybrid balance.

---

## 🎯 Acceptance Criteria

- [x] **Intent Classification:** Implement a "Classifier" (via GPT-4o-mini) that categorizes the query (e.g., Thematic, Genealogy, Geography, Chronology).
- [x] **Dynamic Parameter Tuning:** Automatically adjust `vectorWeight`, `graphWeight`, and `k` based on the detected intent.
- [x] **Filter Extraction:** Identify and extract specific metadata filters (Testament, Book name) directly from the natural language query.
- [x] **Routing Logic:** Ensure the `HybridRetriever` is called with the optimized configuration for each specific category.

---

## 🛠️ Technical Notes

* **Deliverable:** A "Router" service module (e.g., `QueryRouter.ts`) acting as middleware between the API handler and the `HybridRetriever`.
* **Approach:** Use OpenAI "Function Calling" or a structured prompt to transform raw text into a configuration object.
* **Model:** GPT-4o-mini (to keep decision latency < 500ms).

---

## 📖 Example Input / Output

**Case A: Genealogy (Focus: Graph)**
* **Input:** "Who is the son of Joseph?"
* **Routing Logic:** Detects `intent: GENEALOGY`.
* **Output (to Retriever):** `{ vectorWeight: 0.1, graphWeight: 0.9, k: 10, filters: { book: "Matthew" } }`

**Case B: Thematic (Focus: Vector)**
* **Input:** "What does the Bible say about perseverance?"
* **Routing Logic:** Detects `intent: THEOLOGY`.
* **Output (to Retriever):** `{ vectorWeight: 0.9, graphWeight: 0.1, k: 5 }`

**Case C: Contextual (Metadata Filter)**
* **Input:** "Abraham in Egypt within Genesis"
* **Routing Logic:** Detects `intent: GEOGRAPHY` + `location: Egypt` + `book: Genesis`.
* **Output (to Retriever):** `{ vectorWeight: 0.5, graphWeight: 0.5, filters: { book: "Genesis" } }`

---

## 🧪 Definition of Done (DoD)

1. The system correctly routes kinship questions to a high-priority "Graph" configuration.
2. Book filters (e.g., "in Acts") are extracted and applied without manual UI selection.
3. The router's decision time does not add more than 500ms to the total request latency.
4. A "Reasoning" or "Plan" log is generated to explain why a specific strategy was chosen.

---

**Priority:** Medium  
**Estimation:** 5 Story Points  
**Status:** ✅ `done`
**Status:** 📥 `to-do`