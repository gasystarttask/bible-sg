# User Story: US-009 - Agentic Query Router

**As a** Developer,  
**I want to** use an LLM to decide the best search strategy for a user's question,  
**So that** complex genealogical questions use graph traversal while thematic questions use semantic search.

---

## 🎯 Acceptance Criteria

- [ ] **Intent Classification:** Use a lightweight model (GPT-4o-mini) to categorize queries (e.g., `Genealogy`, `Theology`, `Geography`).
- [ ] **Dynamic Tool Selection:** Route `Genealogy` queries to a Graph Traversal tool and `Theology` queries to the Hybrid Vector retriever.
- [ ] **Fallback Mechanism:** Ensure a default semantic search is used if the intent is ambiguous.

---

## 🛠️ Technical Notes

* **Approach:** LangChain Expression Language (LCEL) with `RouterChain` or `OpenAIFunctionsAgent`.
* **Logic:** Use the Graph for "Who is the father of...?" and Vector for "What does Jesus say about...?".

---

## 🧪 Definition of Done (DoD)

1. The system correctly identifies a "family tree" question and bypasses standard vector search to query relations.
2. Response time remains under 2 seconds for the routing decision.

---

**Priority:** Medium  
**Estimation:** 5 Story Points  
**Status:** 📥 `to-do`