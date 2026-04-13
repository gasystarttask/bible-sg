# User Story: US-014 - Knowledge Graph Preview (UI)

**As a** User,  
**I want to** see a visual summary of related people and places next to the chat,  
**So that** I can discover unexpected connections in the narrative.

---

## 🎯 Acceptance Criteria

- [x] **Entity Cards:** Display "Entity Chips" (e.g., [Abraham], [Canaan]) found in the current answer.
- [x] **Relation Snippets:** Show a small text summary of the graph links (e.g., "Abraham is the spouse of Sarah").
- [x] **Graph Navigation:** Clicking an entity chip triggers a new focused search for that entity.

---

## 🛠️ Technical Notes

* **Approach:** Sidebar or "Suggested Topics" section.
* **Data:** Powered by the `entities` and `relations` collections in DocumentDB.

---

## 🧪 Definition of Done (DoD)

1. After a query about "Jacob", the UI displays chips for "Isaac" (Father) and "Esau" (Brother).
2. The UI remains clean and does not overwhelm the user with too much data.

---

**Priority:** Low (Refinement)  
**Estimation:** 3 Story Points  
**Status:** ✅ `done`