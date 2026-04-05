# User Story: US-004 - Entity Extraction Schema

**As a** Developer,  
**I want to** define a strict validation schema using Zod for biblical entities and relations,  
**So that** the LLM output is consistent and can be reliably parsed into DocumentDB collections.

---

## 🎯 Acceptance Criteria

- [x] **Schema Definition:** Create Zod schemas for `Entity` (Person, Location, Object, Event) and `Relation` (Subject, Predicate, Object).
- [x] **Type Safety:** Export TypeScript types derived from these Zod schemas to be used across the application.
- [x] **Contextual Metadata:** The schema must include a field for the source verse ID (e.g., `b.GEN.1.1`) to maintain traceability.
- [x] **Validation Logic:** Implement a validation function that catches and logs malformed LLM responses without crashing the extraction pipeline.

---

## 🛠️ Technical Notes

* **Tooling:** Zod, TypeScript.
* **Fields:** * `Entity`: name, type, description, slug (unique ID).
    * `Relation`: source_slug, relation_type (e.g., SON_OF, BORN_IN), target_slug, evidence_verse_id.

---

## 🧪 Definition of Done (DoD)

1. A file `shared/schemas/graph.ts` contains the validated schemas.
2. **Testing with a French query** like a mock JSON response for "Abraham" and "Isaac" passes the validation.
3. The schema is integrated into the LangChain `StructuredOutputParser`.

---

**Priority:** Medium (Phase 2 Starter)  
**Estimation:** 2 Story Points  
**Status:** ✅ `done`