# 📖 Bible AI Engine: RAG + Knowledge Graph Roadmap

This roadmap outlines the development of a semantic search and chat engine for the Bible, leveraging **DocumentDB (Postgres-backed)**, **LangChain**, and **Next.js**.

---

## 🏗️ Phase 1: Data Infrastructure & Vectorization
*Focus: Turning raw XML into a searchable vector database.*

- 📥 **Project Scaffolding** (Next.js 14+, Tailwind, TypeScript) `done`
- ⏳ **XML Parser Service** (Transforming CES XML to JSON segments) `in-progress`
- ✅ **DocumentDB Connection** (Setting up pg_documentdb / pgvector) `done`
- 📥 **Vector Ingestion Pipeline** (OpenAI `text-embedding-3-small` + LangChain) `to-do`
- 📥 **Semantic Search API** (Basic similarity search endpoint) `to-do`

---

## 🕸️ Phase 2: Knowledge Graph Extraction
*Focus: Building the relational layer (People, Places, Events).*

- ⏳ **Entity Extraction Schema** (Zod definitions for Persons/Locations) `in-progress`
- 📥 **LLM Extraction Pipeline** (Processing key books: Genesis, Gospels, Acts) `to-do`
- 📥 **Graph Database Population** (Populating `entities` and `relations` collections) `to-do`
- 📥 **Entity Resolution** (Merging "Jesus", "Christ", and "Lord" into a single ID) `to-do`

---

## 🧠 Phase 3: RAG Orchestration & AI Logic
*Focus: Creating the "Brain" using LangChain and Vercel AI SDK.*

- 📥 **Hybrid Retriever** (Combining Vector Search + Graph Traversal) `to-do`
- 📥 **Agentic Router** (Logic to decide between semantic search or genealogy graph) `to-do`
- 📥 **Context Injection** (System prompts for theological accuracy and sourcing) `to-do`
- 📥 **Streaming API Handlers** (Using `LangChainAdapter` for real-time UI) `to-do`

---

## 🎨 Phase 4: Frontend & User Experience
*Focus: A clean, scholarly, and responsive chat interface.*

- 📥 **Chat Interface** (Vercel AI SDK `useChat` integration) `to-do`
- 📥 **Citation System** (Clickable verse references linked to source text) `to-do`
- 📥 **Knowledge Graph Preview** (UI components to show "Related Entities") `to-do`
- 📥 **Performance Optimization** (Edge runtime & Postgres indexing) `to-do`

---

## 🚀 Deployment & Scaling
- 📥 **Database Migration** (Production instance on AWS/Azure/Supabase) `to-do`
- 📥 **Vercel Deployment** (CI/CD setup) `to-do`

---
**Legend:**
- ✅ : `done`
- ⏳ : `in-progress`
- 📥 : `to-do`