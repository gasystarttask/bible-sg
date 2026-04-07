import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeQuery } from "@search/lib/query-router";

describe("query-router French heuristics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  it("routes French direct-kinship query to fast genealogy profile", async () => {
    const result = await routeQuery({ query: "Qui est le fils de Joseph ?" });

    expect(result.source).toBe("heuristic");
    expect(result.intent).toBe("GENEALOGY");
    expect(result.vectorWeight).toBe(0.8);
    expect(result.graphWeight).toBe(0.2);
    expect(result.k).toBe(6);
  });

  it("extracts French book alias and canonicalizes to LSG French book name", async () => {
    const result = await routeQuery({ query: "Abraham en Egypte dans Genese" });

    expect(result.filters?.book).toBe("Genèse");
    expect(result.filters?.testament).toBe("Ancien Testament");
  });

  it("routes French geography query to hybrid profile", async () => {
    const result = await routeQuery({ query: "Ou Abraham est-il situe en Egypte ?" });

    expect(result.intent).toBe("GEOGRAPHY");
    expect(result.vectorWeight).toBe(0.5);
    expect(result.graphWeight).toBe(0.5);
  });
});
