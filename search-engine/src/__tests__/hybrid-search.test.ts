import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ---
vi.mock("@search/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));

const { retrieveMock, HybridRetrieverMock, getDbMock } = vi.hoisted(() => {
  const retrieveMock = vi.fn().mockResolvedValue({
    verses: [],
    entityFacts: [],
    metadata: {
      vectorWeight: 0.7,
      graphWeight: 0.3,
      totalVectorResults: 0,
      totalGraphResults: 0,
    },
  });

  const HybridRetrieverMock = vi.fn().mockImplementation(function () {
    return { retrieve: retrieveMock };
  });

  const getDbMock = vi.fn().mockResolvedValue({});

  return { retrieveMock, HybridRetrieverMock, getDbMock };
});

vi.mock("@search/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock("@search/lib/mongodb", () => ({
  getDb: getDbMock,
}));

vi.mock("@search/lib/hybrid-retriever", () => ({
  HybridRetriever: HybridRetrieverMock,
}));

function buildRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/hybrid-search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getPOST() {
  const mod = await import("@search/app/api/hybrid-search/route");
  return mod.POST;
}

describe("POST /api/hybrid-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 400 if query is missing", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ k: 5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 if query is an empty string", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 if weights do not sum to 1.0", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Abraham", vectorWeight: 0.5, graphWeight: 0.3 }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with correct structure for valid query", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Abraham's journey" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("metadata");
  });

  it("returns 200 and applies default weights (0.7 / 0.3)", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Abraham's journey" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.metadata.vectorWeight).toBe(0.7);
    expect(json.metadata.graphWeight).toBe(0.3);
  });

  it("returns 200 with filters applied", async () => {
    const POST = await getPOST();
    const res = await POST(
      buildRequest({
        query: "Abraham's journey",
        filters: { testament: "Old Testament", book: "Genesis" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { rateLimit } = await import("@search/lib/rate-limit");
    vi.mocked(rateLimit).mockReturnValueOnce({ success: false });
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Abraham" }));
    expect(res.status).toBe(429);
  });

  it("calls retriever with default params", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Abraham's journey" }));

    expect(res.status).toBe(200);
    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(HybridRetrieverMock).toHaveBeenCalledTimes(1);

    expect(retrieveMock).toHaveBeenCalledWith(
    "Abraham's journey",
    5,
    0.7,
    0.3,
    0.0,
    undefined
    );
  });
});