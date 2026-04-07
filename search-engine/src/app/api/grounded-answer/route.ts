import { NextRequest, NextResponse } from "next/server";
import { HybridRetriever } from "@search/lib/hybrid-retriever";
import { getDb } from "@search/lib/mongodb";
import { rateLimit } from "@search/lib/rate-limit";
import { routeQuery } from "@search/lib/query-router";
import { generateGroundedAnswer } from "@search/lib/context-injection";
import type { GroundedAnswerRequest, GroundedAnswerResponse } from "@search/types/grounded-answer";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const rateLimitResult = rateLimit(req);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: GroundedAnswerRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    query,
    retrieval,
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

  try {
    let verses = retrieval?.verses;
    let entityFacts = retrieval?.entityFacts;
    let retrievalMetadata = retrieval?.metadata;
    let source: "provided-context" | "retrieved-context" = "provided-context";

    if (!verses || !entityFacts) {
      const routing = await routeQuery({
        query: query.trim(),
        requested: {
          k,
          vectorWeight,
          graphWeight,
          filters,
        },
      });

      const db = await getDb();
      const retriever = new HybridRetriever(db);
      const retrievalResult = await retriever.retrieve(
        query.trim(),
        routing.k,
        routing.vectorWeight,
        routing.graphWeight,
        minScore,
        routing.filters
      );

      verses = retrievalResult.verses;
      entityFacts = retrievalResult.entityFacts;
      retrievalMetadata = {
        ...retrievalResult.metadata,
        processingTimeMs: Date.now() - start,
        routing: {
          intent: routing.intent,
          source: routing.source,
          reasoning: routing.reasoning,
          latencyMs: routing.latencyMs,
          filters: routing.filters,
          k: routing.k,
        },
      };

      source = "retrieved-context";
    }

    const grounded = await generateGroundedAnswer({
      query: query.trim(),
      verses,
      entityFacts,
    });

    const response: GroundedAnswerResponse = {
      query: query.trim(),
      answer: grounded.answer,
      citations: grounded.citations,
      metadata: {
        model: grounded.model,
        promptVersion: grounded.promptVersion,
        uncertain: grounded.uncertain,
        source,
        contextVerses: verses.length,
        contextEntities: entityFacts.length,
        processingTimeMs: Date.now() - start,
        retrieval: retrievalMetadata,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("[grounded-answer] Error:", error);
    return NextResponse.json(
      { error: "Internal server error. Failed to generate grounded answer." },
      { status: 500 }
    );
  }
}
