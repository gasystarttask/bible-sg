# User Story: US-008 - Hybrid Retriever (Vector + Graph)

**As a** User,  
**I want to** get answers that combine both textual context and relational data,  
**So that** I can understand a verse's meaning alongside its genealogical or geographical connections.

---

## 🎯 Acceptance Criteria

- [ ] **Multi-Source Fetching:** Implement a retriever that queries both the Vector Store (verse similarity) and the DocumentDB Graph (entity relationships).
- [ ] **Context Reranking:** Merge and rank results so that the most relevant verses and their associated "Entity Facts" are sent to the LLM.
- [ ] **Fact Augmentation:** If a person is mentioned in a verse, automatically pull their `description` and `aliases` from the graph into the prompt context.

---

## 🛠️ Technical Notes

* **Approach:** Reciprocal Rank Fusion (RRF) or custom weighting (e.g., 0.7 Vector / 0.3 Graph).
* **Tools:** LangChain `BaseRetriever` class and MongoDB `$lookup` for graph joins.

---

## 🧪 Definition of Done (DoD)

1. A query about "Abraham's journey" returns both the relevant Genesis verses and the list of locations (Sichem, Bethel, Egypt) from the graph.
2. The system response includes details about entities that weren't explicitly in the retrieved text but exist in the graph.

---

**Priority:** High  
**Estimation:** 8 Story Points  
**Status:** 📥 `to-do`