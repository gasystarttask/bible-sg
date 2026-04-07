import { NextRequest, NextResponse } from "next/server";
import { HybridRetriever } from "@search/lib/hybrid-retriever";
import { HybridSearchRequest, HybridSearchResponse } from "@search/types/hybrid";
import { rateLimit } from "@search/lib/rate-limit";
import { getDb } from "@search/lib/mongodb";
import { routeQuery } from "@search/lib/query-router";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  // --- Rate Limiting (OpenAI cost protection) ---
  const rateLimitResult = rateLimit(req);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  // --- Parse & Validate Body ---
  let body: HybridSearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    query,
    k,
    vectorWeight,
    graphWeight,
    filters,
    minScore = 0.0,
  } = body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { error: "Field 'query' is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  if (
    vectorWeight != null &&
    graphWeight != null &&
    Number((vectorWeight + graphWeight).toFixed(3)) !== 1.0
  ) {
    return NextResponse.json(
      { error: "'vectorWeight' + 'graphWeight' must equal 1.0." },
      { status: 400 }
    );
  }

  // --- Execute Hybrid Retrieval ---
  try {
    const routing = await routeQuery({
      query: query.trim(),
      requested: {
        k,
        vectorWeight,
        graphWeight,
        filters,
      },
    });

    console.info("[hybrid-search][route-plan]", {
      query: query.trim(),
      intent: routing.intent,
      source: routing.source,
      reasoning: routing.reasoning,
      vectorWeight: routing.vectorWeight,
      graphWeight: routing.graphWeight,
      k: routing.k,
      filters: routing.filters,
      latencyMs: routing.latencyMs,
    });

    const db = await getDb()
    const retriever = new HybridRetriever(db);

    const result = await retriever.retrieve(
      query.trim(),
      routing.k,
      routing.vectorWeight,
      routing.graphWeight,
      minScore,
      routing.filters
    );

    const processingTimeMs = Date.now() - start;

    const response: HybridSearchResponse = {
      query: query.trim(),
      verses: result.verses,
      entityFacts: result.entityFacts,
      metadata: {
        ...result.metadata,
        processingTimeMs,
        routing: {
          intent: routing.intent,
          source: routing.source,
          reasoning: routing.reasoning,
          latencyMs: routing.latencyMs,
          filters: routing.filters,
          k: routing.k,
        },
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("[hybrid-search] Error:", error);
    return NextResponse.json(
      { error: "Internal server error. Failed to execute hybrid search." },
      { status: 500 }
    );
  }
}