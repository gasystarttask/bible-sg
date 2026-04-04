
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
