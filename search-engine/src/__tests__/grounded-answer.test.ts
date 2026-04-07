import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@search/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));

const {
  getDbMock,
  retrieveMock,
  HybridRetrieverMock,
  routeQueryMock,
  generateGroundedAnswerMock,
} = vi.hoisted(() => {
  const getDbMock = vi.fn().mockResolvedValue({});
  const retrieveMock = vi.fn().mockResolvedValue({
    verses: [
      {
        id: "v1",
        text: "Fils de Rachel, femme de Jacob: Joseph et Benjamin.",
        reference: "Genèse 46:19",
        score: 0.2,
        source: "hybrid",
      },
    ],
    entityFacts: [],
    metadata: {
      vectorWeight: 0.8,
      graphWeight: 0.2,
      totalVectorResults: 6,
      totalGraphResults: 0,
    },
  });

  const HybridRetrieverMock = vi.fn().mockImplementation(function () {
    return { retrieve: retrieveMock };
  });

  const routeQueryMock = vi.fn().mockResolvedValue({
    intent: "GENEALOGY",
    source: "heuristic",
    reasoning: "Heuristic route selected intent GENEALOGY from query keywords.",
    latencyMs: 0,
    vectorWeight: 0.8,
    graphWeight: 0.2,
    k: 6,
    filters: undefined,
  });

  const generateGroundedAnswerMock = vi.fn().mockResolvedValue({
    answer: "Joseph est fils de Jacob [Genèse 46:19].",
    citations: ["Genèse 46:19"],
    uncertain: false,
    model: "gpt-4o-mini",
    promptVersion: "us-010.v2",
  });

  return {
    getDbMock,
    retrieveMock,
    HybridRetrieverMock,
    routeQueryMock,
    generateGroundedAnswerMock,
  };
});

vi.mock("@search/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@search/lib/hybrid-retriever", () => ({ HybridRetriever: HybridRetrieverMock }));
vi.mock("@search/lib/query-router", () => ({ routeQuery: routeQueryMock }));
vi.mock("@search/lib/context-injection", () => ({ generateGroundedAnswer: generateGroundedAnswerMock }));

function buildRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/grounded-answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getPOST() {
  const mod = await import("@search/app/api/grounded-answer/route");
  return mod.POST;
}

describe("POST /api/grounded-answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 400 when query is missing", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({}));

    expect(res.status).toBe(400);
  });

  it("uses provided retrieval context without calling retriever", async () => {
    const POST = await getPOST();
    const res = await POST(
      buildRequest({
        query: "Qui est le fils de Joseph ?",
        retrieval: {
          verses: [
            {
              id: "v1",
              text: "Fils de Rachel, femme de Jacob: Joseph et Benjamin.",
              reference: "Genèse 46:19",
              score: 0.2,
              source: "hybrid",
            },
          ],
          entityFacts: [],
        },
      })
    );

    expect(res.status).toBe(200);
    expect(HybridRetrieverMock).not.toHaveBeenCalled();
    expect(generateGroundedAnswerMock).toHaveBeenCalledTimes(1);

    const json = await res.json();
    expect(json.answer).toContain("[Genèse 46:19]");
    expect(json.metadata.source).toBe("provided-context");
  });

  it("retrieves context when retrieval payload is absent", async () => {
    const POST = await getPOST();
    const res = await POST(buildRequest({ query: "Qui est le fils de Joseph ?" }));

    expect(res.status).toBe(200);
    expect(routeQueryMock).toHaveBeenCalledTimes(1);
    expect(HybridRetrieverMock).toHaveBeenCalledTimes(1);
    expect(retrieveMock).toHaveBeenCalledTimes(1);

    const json = await res.json();
    expect(json.metadata.source).toBe("retrieved-context");
    expect(json.metadata.retrieval).toBeTruthy();
  });

  it("returns uncertain answer for out-of-domain query", async () => {
    generateGroundedAnswerMock.mockResolvedValueOnce({
      answer: "Je ne sais pas d'après les Écritures fournies.",
      citations: [],
      uncertain: true,
      model: "gpt-4o-mini",
      promptVersion: "us-010.v2",
    });

    const POST = await getPOST();
    const res = await POST(
      buildRequest({
        query: "Qui est Elon Musk dans la Bible ?",
        retrieval: { verses: [], entityFacts: [] },
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.metadata.uncertain).toBe(true);
    expect(json.citations).toHaveLength(0);
  });
});
