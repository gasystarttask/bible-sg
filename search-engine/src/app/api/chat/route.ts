import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { HybridRetriever } from "@search/lib/hybrid-retriever";
import { getDb } from "@search/lib/mongodb";
import { rateLimit } from "@search/lib/rate-limit";
import { routeQuery } from "@search/lib/query-router";
import {
  assembleHybridContext,
  buildGroundedStreamingSystemPrompt,
  isOutOfDomainQuery,
} from "@search/lib/context-injection";

const UNKNOWN_RESPONSE = "Je ne sais pas d'après les Écritures fournies.";
const DEFAULT_MODEL = process.env.GROUNDED_ANSWER_MODEL ?? "gpt-4o-mini";

// Custom fetch wrapper to add GitHub authentication headers
const customFetch = (
  input: string | Request | URL,
  options?: RequestInit
): Promise<Response> => {
  const token = process.env.GITHUB_TOKEN;
  const headers = new Headers(options?.headers || {});
  
  // Ensure Authorization header is set
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  
  // Add GitHub-specific headers
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  
  return fetch(input, { ...options, headers });
};

const github = createOpenAI({
  apiKey: process.env.GITHUB_TOKEN,
  baseURL: "https://models.github.ai/inference",
  fetch: customFetch,
});

type ChatPart = { type?: string; text?: string };
type ChatMessage = {
  role?: string;
  content?: string | ChatPart[];
  parts?: ChatPart[];
};

type ChatRequestBody = {
  messages?: ChatMessage[];
};

type UpstreamErrorLike = {
  message?: string;
  statusCode?: number;
  responseHeaders?: Headers | Record<string, string>;
  lastError?: UpstreamErrorLike;
  errors?: UpstreamErrorLike[];
};

function extractMessageText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  const partSource = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];

  return partSource
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractLastUserMessage(body: ChatRequestBody): string | null {
  const messages = body.messages ?? [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const text = extractMessageText(message);
    if (text) return text;
  }

  return null;
}

function getHeaderValue(
  headers: Headers | Record<string, string> | undefined,
  key: string
): string | undefined {
  if (!headers) return undefined;

  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }

  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return entry?.[1];
}

function extractUpstreamRateLimit(error: unknown): { retryAfterSeconds: number } | null {
  const root = error as UpstreamErrorLike;
  const candidates: UpstreamErrorLike[] = [
    root,
    ...(Array.isArray(root.errors) ? root.errors : []),
    ...(root.lastError ? [root.lastError] : []),
  ];

  for (const candidate of candidates) {
    const is429 = candidate.statusCode === 429;
    const saysTooManyRequests = (candidate.message ?? "").toLowerCase().includes("too many requests");

    if (!is429 && !saysTooManyRequests) continue;

    const retryHeader = getHeaderValue(candidate.responseHeaders, "retry-after");
    const fallbackHeader = getHeaderValue(candidate.responseHeaders, "x-ratelimit-timeremaining");
    const parsed = Number(retryHeader ?? fallbackHeader);

    return {
      retryAfterSeconds: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60,
    };
  }

  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const rateLimitResult = rateLimit(req);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { error: "Server misconfiguration: missing GITHUB_TOKEN." },
      { status: 500 }
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = extractLastUserMessage(body);
  if (!query) {
    return NextResponse.json(
      { error: "User message is required." },
      { status: 400 }
    );
  }

  if (isOutOfDomainQuery(query)) {
    return new NextResponse(UNKNOWN_RESPONSE, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const routing = await routeQuery({ query });
    const db = await getDb();
    const retriever = new HybridRetriever(db);
    const retrievalResult = await retriever.retrieve(
      query,
      routing.k,
      routing.vectorWeight,
      routing.graphWeight,
      0,
      routing.filters
    );

    const context = assembleHybridContext(retrievalResult.verses, retrievalResult.entityFacts);
    if (!context.references.length) {
      return new NextResponse(UNKNOWN_RESPONSE, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const result = streamText({
      model: github.chat(DEFAULT_MODEL),
      temperature: 0,
      maxRetries: 0,
      system: buildGroundedStreamingSystemPrompt(),
      prompt: [
        `Question: ${query}`,
        "",
        "Context:",
        context.text,
      ].join("\n"),
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const rateLimit = extractUpstreamRateLimit(error);
    if (rateLimit) {
      const message = `Rate limit reached on GitHub Models. Retry in ${rateLimit.retryAfterSeconds}s.`;
      return NextResponse.json(
        { error: message },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        }
      );
    }

    console.error("[chat] Error:", error);
    return NextResponse.json(
      { error: "Internal server error. Failed to stream chat response." },
      { status: 500 }
    );
  }
}
