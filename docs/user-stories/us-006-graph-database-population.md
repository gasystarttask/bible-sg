# User Story: US-006 - Graph Database Population

**As a** Developer,  
**I want to** ingest the extracted entities and relations into DocumentDB,  
**So that** they can be queried alongside the vector data.

---

## 🎯 Acceptance Criteria

- [ ] **Collection Setup:** Create `entities` and `relations` collections in DocumentDB.
- [ ] **Unique Constraints:** Ensure no duplicate entities are created (use `slug` as a unique index).
- [ ] **Referential Integrity:** Verify that every relation points to valid entity IDs.
- [ ] **Upsert Logic:** Implement "upsert" (update or insert) logic to allow re-running the script without data corruption.

---

## 🛠️ Technical Notes

* **DB:** DocumentDB
* **Indexing:** Create indexes on `source_slug` and `target_slug` for fast graph traversal.

---

## 🧪 Definition of Done (DoD)

1. The `entities` collection contains unique records for persons and places.
2. **Testing with a French query** on the database shows that "Bethléem" is correctly linked to "Judée".
3. A summary log shows the total number of nodes and edges created.

---

**Priority:** Medium  
**Estimation:** 5 Story Points  
**Status:** 📥 `to-do`