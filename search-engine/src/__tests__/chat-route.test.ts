import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const originalGithubToken = process.env.GITHUB_TOKEN;

vi.mock("@search/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock("@search/lib/hybrid-retriever", () => ({
  HybridRetriever: vi.fn(),
}));

vi.mock("@search/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@search/lib/query-router", () => ({
  routeQuery: vi.fn(),
}));

vi.mock("@search/lib/context-injection", () => ({
  assembleHybridContext: vi.fn(),
  buildGroundedStreamingSystemPrompt: vi.fn().mockReturnValue("system-prompt"),
  isOutOfDomainQuery: vi.fn().mockReturnValue(true),
}));

function buildRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getPOST() {
  const mod = await import("@search/app/api/chat/route");
  return mod.POST;
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterAll(() => {
    process.env.GITHUB_TOKEN = originalGithubToken;
  });

  it("returns the unknown response as a UI message stream for out-of-domain queries", async () => {
    const POST = await getPOST();
    const res = await POST(
      buildRequest({
        messages: [{ role: "user", content: "Who is Elon Musk?" }],
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("text-start");
    expect(text).toContain("Je ne sais pas d'après les Écritures fournies.");
  });
});