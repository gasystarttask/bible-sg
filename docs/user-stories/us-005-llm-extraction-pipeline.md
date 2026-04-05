# User Story: US-005 - LLM Extraction Pipeline

**As a** Data Engineer,  
**I want to** build a pipeline that sends Bible chapters to an LLM to extract entities and their relationships,  
**So that** we can automatically build a relational map of the scriptures.

---

## 🎯 Acceptance Criteria

- [x] **Prompt Engineering:** Create a specialized prompt that instructs the LLM to identify genealogy, geography, and key events.
- [x] **Batch Processing:** Implement a script to iterate through specific books (Genesis, Gospels, Acts).
- [x] **Rate Limit Management:** Handle OpenAI/Anthropic API limits using delays or queuing (especially for large books).
- [x] **Traceability:** Ensure every extracted relation is linked to its source `verse_id` from the XML.

---

## 🛠️ Technical Notes

* **Orchestrator:** LangChain `RunnableSequence`.
* **Model:** GPT-4o or Claude 3.5 Sonnet (higher reasoning required for extraction).
* **Scope:** Limit initial extraction to Genesis, Matthew, and Acts to control costs.

---

## 🧪 Definition of Done (DoD)

1. A script `scripts/extract-graph.ts` is functional.
2. **Testing with a French query** for "Genèse Chapitre 12" extracts the relation "Abram -> ALLER_EN -> Égypte".
3. Extracted data is saved in a temporary `data/raw_graph.json` file.

---

**Priority:** High (Core Graph Logic)  
**Estimation:** 8 Story Points  
**Status:**  ✅ `done`