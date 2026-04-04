# User Story: US-001 - Bible XML to JSON Transformation

**As a** Data Engineer,  
**I want to** parse the CES XML Bible source and transform it into a structured JSON format,  
**So that** I can generate vector embeddings for each verse and store them in DocumentDB for the RAG engine.

---

## 🎯 Acceptance Criteria

- [ ] **XML Parsing:** The script must successfully load the `cesDoc` XML and navigate the hierarchy (`text > body > div[type=book] > div[type=chapter] > seg`).
- [ ] **ID Preservation:** Each segment must retain its unique ID (e.g., `b.GEN.1.1`) to serve as a primary key.
- [ ] **Data Structure:** The output must be an array of objects following this schema:
  ```typescript
  {
    "id": string;        // e.g., "b.GEN.1.1"
    "book": string;      // e.g., "Genesis"
    "chapter": number;   // e.g., 1
    "verse": number;     // e.g., 1
    "text": string;      // e.g., "Au commencement..."
    "metadata": {
       "testament": "Old" | "New",
       "version": "LSG"
    }
  }
  ```
- [ ] Sanitization: Remove any leading/trailing whitespaces and handle XML entities (like `&amp;`d) within the verse text.

- [ ] Error Handling: The parser should log errors for malformed segments but continue processing the rest of the document.

## 🛠️ Technical Notes
- Tooling: Use fast-xml-parser for high-performance parsing in Node.js/TypeScript.

- Memory Management: Since the Bible contains ~31,102 verses, the script should use a stream-based approach or efficient loops to avoid OutOfMemory errors.

- LangChain Ready: The resulting JSON must be easily mappable to LangChain's Document class:

```TypeScript
new Document({
  pageContent: verse.text,
  metadata: { id: verse.id, ...verse.metadata }
})
```
## 🧪 Definition of Done (DoD)
1. A script scripts/ingest-bible.ts exists and is executable via npm run ingest.

2. A sample file data/processed_bible.json is generated with valid data.

3. The total verse count in the JSON matches the segment count from the XML source (approx. 31,102 verses).

3. UTF-8 encoding is preserved (special characters like "é", "à", "œ" are correctly rendered).

**Priority**: High (Blocker for Phase 1)

**Estimation**: 3-5 Story Points

**Status**: ⏳ in-progress