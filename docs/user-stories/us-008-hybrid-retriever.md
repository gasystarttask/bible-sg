# User Story: US-008 - Hybrid Retriever (Vector + Graph)

**As a** User,  
**I want to** get answers that combine both textual context and relational data,  
**So that** I can understand a verse's meaning alongside its genealogical or geographical connections.

---

## 🎯 Acceptance Criteria

- [x] **Multi-Source Fetching:** Implement a retriever that queries both the Vector Store (verse similarity) and the DocumentDB Graph (entity relationships).
- [x] **Context Reranking:** Merge and rank results so that the most relevant verses and their associated "Entity Facts" are sent to the LLM.
- [x] **Fact Augmentation:** If a person is mentioned in a verse, automatically pull their `description` and `aliases` from the graph into the prompt context.

---

## 🛠️ Technical Notes

* **Approach:** Reciprocal Rank Fusion (RRF) with custom weighting (default: 0.7 Vector / 0.3 Graph).
* **Tools:** Custom `HybridRetriever` class (inspired by LangChain `BaseRetriever`) and MongoDB `$lookup` for graph joins.
* **Endpoint:** `POST /api/hybrid-search`

### Request Body
```json
{
  "query": "Abraham's journey",
  "k": 5,
  "vectorWeight": 0.7,
  "graphWeight": 0.3,
  "minScore": 0.0,
  "filters": {
    "testament": "Old Testament",
    "book": "Genesis"
  }
}
```

### Response
```json
{
  "query": "Abraham's journey",
  "verses": [
    {
      "id": "...",
      "text": "...",
      "reference": "Genesis 12:1",
      "score": 0.92,
      "source": "hybrid"
    }
  ],
  "entityFacts": [
    {
      "slug": "abraham",
      "name": "Abraham",
      "type": "person",
      "description": "Father of nations...",
      "aliases": ["Abram"],
      "relations": [
        { "type": "traveled_to", "targetName": "Sichem", "targetSlug": "sichem" }
      ]
    }
  ],
  "metadata": {
    "vectorWeight": 0.7,
    "graphWeight": 0.3,
    "totalVectorResults": 10,
    "totalGraphResults": 4,
    "processingTimeMs": 320
  }
}
```

---

## 🧪 Definition of Done (DoD)

1. A query about "Abraham's journey" returns both the relevant Genesis verses and the list of locations (Sichem, Bethel, Egypt) from the graph.
2. The system response includes details about entities that weren't explicitly in the retrieved text but exist in the graph.
3. Unit tests cover: missing query, invalid weights, rate limiting, valid response structure.

---

**Priority:** High  
**Estimation:** 8 Story Points  
**Status:** ✅ `done`