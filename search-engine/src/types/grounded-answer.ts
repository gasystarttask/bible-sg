import type { EntityFact, HybridFilters, HybridSearchResponse, VerseResult } from "@search/types/hybrid";

export interface GroundedAnswerRequest {
  query: string;
  retrieval?: {
    verses: VerseResult[];
    entityFacts: EntityFact[];
    metadata?: HybridSearchResponse["metadata"];
  };
  k?: number;
  vectorWeight?: number;
  graphWeight?: number;
  filters?: HybridFilters;
  minScore?: number;
}

export interface GroundedAnswerResponse {
  query: string;
  answer: string;
  citations: string[];
  metadata: {
    model: string;
    promptVersion: string;
    uncertain: boolean;
    source: "provided-context" | "retrieved-context";
    contextVerses: number;
    contextEntities: number;
    processingTimeMs: number;
    retrieval?: HybridSearchResponse["metadata"];
  };
}
