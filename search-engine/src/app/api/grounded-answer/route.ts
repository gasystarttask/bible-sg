import { NextRequest, NextResponse } from "next/server";
import { HybridRetriever } from "@search/lib/hybrid-retriever";
import { getDb } from "@search/lib/mongodb";
import { rateLimit } from "@search/lib/rate-limit";
import { routeQuery } from "@search/lib/query-router";
import { generateGroundedAnswer, generateGroundedAnswerStream } from "@search/lib/context-injection";
import type { GroundedAnswerRequest, GroundedAnswerResponse } from "@search/types/grounded-answer";

type ResolvedContext = {
  verses: NonNullable<GroundedAnswerRequest["retrieval"]>["verses"];
  entityFacts: NonNullable<GroundedAnswerRequest["retrieval"]>["entityFacts"];
  retrievalMetadata: GroundedAnswerResponse["metadata"]["retrieval"];
  source: "provided-context" | "retrieved-context";
};

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
    stream = false,
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

  const resolveContext = async (): Promise<ResolvedContext> => {
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

    return { verses, entityFacts, retrievalMetadata, source };
  };

  try {
    if (stream) {
      const encoder = new TextEncoder();
      const event = (name: string, payload: object): Uint8Array => {
        return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(event("status", { phase: "retrieval_started" }));

          try {
            const { verses, entityFacts, retrievalMetadata, source } = await resolveContext();

            controller.enqueue(
              event("status", {
                phase: "generation_started",
                contextVerses: verses.length,
                contextEntities: entityFacts.length,
              })
            );

            let streamed = "";
            const grounded = await generateGroundedAnswerStream({
              query: query.trim(),
              verses,
              entityFacts,
              onToken(token) {
                streamed += token;
                controller.enqueue(event("token", { token }));
              },
            });

            if (grounded.answer !== streamed.trim()) {
              controller.enqueue(event("replace", { answer: grounded.answer }));
            }

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

            controller.enqueue(event("metadata", response));
            controller.enqueue(event("done", { ok: true }));
            controller.close();
          } catch (error) {
            console.error("[grounded-answer][stream] Error:", error);
            controller.enqueue(
              event("error", { error: "Internal server error. Failed to stream grounded answer." })
            );
            controller.close();
          }
        },
      });

      return new NextResponse(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const { verses, entityFacts, retrievalMetadata, source } = await resolveContext();
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
