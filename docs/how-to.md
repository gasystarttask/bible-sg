# How To

## Run Database Locally with Docker Compose

To start the database locally, run:

```bash
docker compose -f ../db/compose.yml up -d
```

The database will be available and ready for development.

To stop the database:

```bash
docker compose -f ../db/compose.yml down
```

View logs:

```bash
docker compose -f ../db/compose.yml logs -f
```

## Ingest Bible Data

To parse the French Bible XML and generate the JSON dataset:

```bash
cd pipelines/xml-to-json
npm install
npm run ingest
```

This will:
- Load the raw XML from `raw-data/french.xml`
- Parse and transform it into structured JSON
- Generate `data/processed_bible.json` (~31,102 verses)
- Preserve UTF-8 encoding for French characters (é, à, œ, etc.)

The output file is ready to be loaded into the database or used with LangChain for RAG embeddings.

## Vectorize Bible & Store in Database

To generate OpenAI embeddings for each verse and populate DocumentDB:

```bash
cd pipelines/xml-to-json
export DATABASE_URL="mongodb://localhost:27017"
export OPENAI_API_KEY="sk-your-key-here"
npm run vectorize
```

This will:
- Load verses from `data/processed_bible.json`
- Generate embeddings using `text-embedding-3-small` (1536 dimensions)
- Process verses in batches of 100 to optimize API calls
- Store vectors in the `bible_sg.verses` collection with metadata
- Create HNSW vector index for sub-200ms semantic search
- Skip duplicates automatically (idempotent operation)

**Environment Variables:**
- `DATABASE_URL` - MongoDB connection string (default: `mongodb://localhost:27017`)
- `OPENAI_API_KEY` - OpenAI API key (required)

**Output:**
- ~31,102 documents in MongoDB with embeddings
- Dimensions: 1536 floats per verse
- Indexed for fast semantic similarity search

## Check if data is persisted
To verify data is persisted in the database, connect to MongoDB using mongosh:

```bash
docker exec -it <container-name> mongosh 'mongodb://admin:password@documentdb:10260/?directConnection=true&tls=true&tlsAllowInvalidCertificates=true'
```

Once connected, run:

```javascript
use bible_sg
db.verses.countDocuments()
db.verses.findOne()
```

This will show the total number of verses ingested and display a sample document with its embedding vector.

## Setup Vitest for Testing

To set up Vitest in the search-engine app:

### 1. Install Vitest and dependencies

```bash
npm install -D vitest @vitest/ui happy-dom
```

### 2. Update `package.json`

Add test scripts:

```json
"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:run": "vitest run"
}
```

### 3. Create `vitest.config.js`

```javascript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    }
  }
})
```

### 4. Run tests

```bash
npm test        # Watch mode
npm run test:ui # With UI
npm run test:run # Single run
```