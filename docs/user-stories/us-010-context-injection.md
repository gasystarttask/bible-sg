# User Story: US-010 - Context Injection & Prompt Engineering

**As a** Developer / Prompt Engineer,  
**I want to** design a specialized system prompt that ingests both verse results and entity facts,  
**So that** the AI assistant provides accurate, grounded, and well-sourced biblical answers.

---

## 🎯 Acceptance Criteria

- [x] **Context Assembly:** Create a function to format the `HybridRetriever` output into a readable string for the LLM (Verses with refs + Entity relations).
- [x] **Strict Grounding:** The prompt must explicitly forbid the AI from using outside knowledge for factual claims (Anti-hallucination).
- [x] **Citation Enforcement:** The AI must use a specific format for citations (e.g., `[Book Chapter:Verse]`) and link them to the provided context.
- [x] **Entity Awareness:** The AI should use the `entityFacts` to resolve ambiguities (e.g., knowing that "Christ" and "Jesus" are the same person).
- [x] **Handling Uncertainty:** If the retrieved context doesn't contain the answer, the AI must say "I don't know based on the provided scriptures."

---

## 🛠️ Technical Notes

* **Model:** GPT-4o-mini (as the primary reasoner).
* **Prompt Structure:**
    1. **Role:** Scholarly Biblical Assistant.
    2. **Knowledge Base:** Provided "Context" (Verses) and "Knowledge Graph" (Entities).
    3. **Rules:** No preaching, only factual analysis of the text.
* **Data Input:** JSON string containing the `verses` and `entityFacts` arrays.

---

## 🧪 Definition of Done (DoD)

1. The AI correctly answers "Qui est Jésus?" by citing the specific verses from the hybrid search (e.g., Mat 16:13).
2. The AI uses facts from the graph (like "Jésus est aussi appelé Fils de l'homme") to enrich the answer even if the verse only uses one of the titles.
3. No information outside of the provided context is included in the response.
4. The response format is clean and compatible with the future Markdown renderer.

---

**Priority:** High  
**Estimation:** 5 Story Points  
**Status:** ✅ `done`