# Bible Chat Scholar

[![Release](https://img.shields.io/github/v/release/gasystarttask/bible-sg?display_name=tag)](https://github.com/gasystarttask/bible-sg/releases)
[![Security](https://img.shields.io/github/issues-search/gasystarttask/bible-sg?query=is%3Aopen+label%3Asecurity&label=security%20issues)](https://github.com/gasystarttask/bible-sg/issues?q=is%3Aopen+label%3Asecurity)
[![Code Quality](https://img.shields.io/github/actions/workflow/status/gasystarttask/bible-sg/search-engine-openapi.yml?label=code%20quality)](https://github.com/gasystarttask/bible-sg/actions/workflows/search-engine-openapi.yml)

Bible Chat Scholar is a ~~proof-of-concept~~ Bible AI engine using semantic search (vector embeddings) and a roadmap toward RAG + knowledge graph capabilities.

## What it includes

- XML → JSON parsing pipeline
- Verse embedding/vectorization pipeline
- Semantic Search API in Next.js
- Foundation for hybrid retrieval (vector + graph)

## Architecture diagram

![Bible Chat Scholar Architecture](./docs/images/architecture-en.png)

## Tech stack

- Next.js (App Router, TypeScript)
- DocumentDB / Mongo-compatible vector search
- OpenAI embeddings (`text-embedding-3-small`)
- LangChain

## Quick start

1. Install dependencies
2. Configure environment variables (`DATABASE_URL`, `OPENAI_API_KEY`, etc.)
3. Run app and pipelines as needed

## Documentation references

- [Docs folder](./docs)
- [Roadmap](./docs/roadmap.md)
- [User Story: US-003 Semantic Search API](./docs/user-stories/us-003-semantic-search-api.md)

## Licensing

- **Code**: [MIT License](`./LICENSE`)
- **Data**: [CC0-1.0](`./DATA_LICENSE.md`), source: https://github.com/christos-c/bible-corpus