import { NextRequest, NextResponse } from "next/server";
import { OpenAIEmbeddings } from "@langchain/openai";
import { getDb } from "@search/lib/mongodb";

type Testament = "Old" | "New";

type SearchRequest = {
  query: string;
  k?: number;
  minScore?: number;
  filters?: {
    testament?: Testament;
    book?: string;
  };
};

type VerseDoc = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  metadata?: {
    testament?: Testament;
    version?: string;
  };
  score?: number;
};

const COLLECTION_NAME = process.env.MONGODB_COLLECTION_NAME ?? "verses";
const DEFAULT_K = 5;
const MAX_K = 20;
const DEFAULT_MIN_SCORE = 0.6;
const MAX_QUERY_LENGTH = 500;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function searchHandler(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    let body: SearchRequest;
    try {
      body = (await req.json()) as SearchRequest;
    } catch {
      return badRequest("Invalid JSON body.");
    }

    if (!body?.query || typeof body.query !== "string" || !body.query.trim()) {
      return badRequest("`query` is required.");
    }

    if (body.query.length > MAX_QUERY_LENGTH) {
      return badRequest(`\`query\` is too long (max ${MAX_QUERY_LENGTH} chars).`);
    }

    const rawK = body.k ?? DEFAULT_K;
    if (!Number.isInteger(rawK) || rawK < 1) {
      return badRequest("`k` must be a positive integer.");
    }
    const k = Math.min(rawK, MAX_K);

    const rawMinScore = body.minScore ?? DEFAULT_MIN_SCORE;
    if (typeof rawMinScore !== "number" || Number.isNaN(rawMinScore)) {
      return badRequest("`minScore` must be a number.");
    }
    const minScore = Math.min(Math.max(rawMinScore, 0), 1);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Server misconfiguration: missing OPENAI_API_KEY." },
        { status: 500 }
      );
    }

    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small",
    });

    const queryVector = await embeddings.embedQuery(body.query.trim());

    const db = await getDb();
    const collection = db.collection<VerseDoc>(COLLECTION_NAME);

    const filterMatch: Record<string, unknown> = {};
    if (body.filters?.testament) {
      filterMatch["metadata.testament"] = body.filters.testament;
    }
    if (body.filters?.book) {
      filterMatch.book = body.filters.book;
    }

    const hasFilter = Object.keys(filterMatch).length > 0;
    const candidateK = hasFilter ? Math.min(k * 4, 100) : k;

    /**
     * MongoDB aggregation pipeline for vector similarity search in Cosmos DB.
     * 
     * @description
     * Performs a semantic search operation using vector embeddings to find similar documents.
     * The pipeline:
     * 1. Searches using cosine similarity on the embedding vector field
     * 2. Optionally filters results based on provided match criteria
     * 3. Projects specific fields from matching documents including search relevance score
     * 4. Limits results to the specified candidate count
     * 
     * @remarks
     * - Uses Cosmos DB's built-in vector search capability via $search stage
     * - The `searchScore` metadata represents the similarity score of results
     * - Filter matching is conditionally applied based on `hasFilter` flag
     * - Results are sorted by relevance (implicit in $search stage)
     * 
     * @example
     * // Returns documents with fields: id, book, chapter, verse, text, metadata, score
     * 
     * @see {@link https://learn.microsoft.com/en-us/azure/cosmos-db/vector-search} Cosmos DB Vector Search
     */
    const pipeline: Record<string, unknown>[] = [
      {
        $search: {
          cosmosSearch: {
            vector: queryVector,
            path: "embedding",
            k: candidateK,
          },
          returnStoredSource: true,
        },
      },
      ...(hasFilter ? [{ $match: filterMatch }] : []),
      {
        $project: {
          _id: 0,
          id: 1,
          book: 1,
          chapter: 1,
          verse: 1,
          text: 1,
          metadata: 1,
          score: { $meta: "searchScore" },
        },
      },
      { $limit: candidateK },
    ];

    const docs = await collection.aggregate<VerseDoc>(pipeline, { maxTimeMS: 450 }).toArray();

    const results = docs
      .filter((d) => typeof d.score === "number" && (d.score as number) >= minScore)
      .slice(0, k)
      .map((d) => ({
        id: d.id,
        reference: d.id,
        text: d.text,
        book: d.book,
        chapter: d.chapter,
        verse: d.verse,
        testament: d.metadata?.testament ?? null,
        score: d.score ?? 0,
      }));

    const tookMs = Date.now() - startedAt;
    const remaining = req.headers.get("x-ratelimit-remaining");
    const reset = req.headers.get("x-ratelimit-reset");

    return NextResponse.json(
      {
        query: body.query,
        k,
        minScore,
        tookMs,
        count: results.length,
        results,
      },
      {
        status: 200,
        headers: {
          "X-RateLimit-Remaining": remaining || "0",
          "X-RateLimit-Reset": reset || "0",
        },
      }
    );
  } catch (error: unknown) {
    console.error("[API /search] Error:", error);
    const errorName = (error as Record<string, unknown>)?.name;
    if (errorName === "MongoServerError" || errorName === "MongoNetworkTimeoutError") {
      return NextResponse.json({ error: "Database timeout or query failure." }, { status: 500 });
    }
    return NextResponse.json({ error: "Search failed. Please try again." }, { status: 500 });
  }
}

export const POST = searchHandler;