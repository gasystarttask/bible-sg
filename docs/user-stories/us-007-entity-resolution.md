# User Story: US-007 - Entity Resolution (Deduplication)

**As a** Product Owner,  
**I want to** merge different mentions of the same entity (e.g., "Christ", "Jésus", "Le Seigneur", "Jésus-Nazareth") into a single canonical ID,  
**So that** the graph remains accurate and easy to navigate.

---

## 🎯 Acceptance Criteria

- [x] **Alias Mapping:** Create a dictionary or use an LLM to map synonyms to a canonical slug (e.g., `jesus_christ`).
- [x] **ID Normalization:** Update all relations to use the canonical slug instead of raw text names.
- [x] **Manual Overrides:** Provide a way to manually fix incorrect merges via a configuration file.

---

## 🛠️ Technical Notes

* **Approach:** Hybrid (String similarity + LLM verification).
* **Storage:** Store an `aliases` array in the entity document (e.g., `aliases: ["Le Messie", "Fils de l'Homme"]`).

---

## 🧪 Definition of Done (DoD)

1. A search for "Jésus" and "Christ" in the graph returns the same unique node ID.
2. **Testing with a French query** ensures that "Simon-Pierre" and "Céphas" are resolved correctly.
3. The graph density is reduced by removing redundant duplicate nodes.

---

**Priority:** Low (Refinement)  
**Estimation:** 5 Story Points  
**Status:** ✅ `done`