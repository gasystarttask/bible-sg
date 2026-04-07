export type QueryIntent =
  | "THEOLOGY"
  | "GENEALOGY"
  | "GEOGRAPHY"
  | "CHRONOLOGY"
  | "GENERAL";

export interface HybridFilters {
  testament?: "Old Testament" | "New Testament" | "Ancien Testament" | "Nouveau Testament";
  book?: string;
}

export interface HybridSearchRequest {
  query: string;
  k?: number;
  vectorWeight?: number;
  graphWeight?: number;
  filters?: HybridFilters;
  minScore?: number;
}

export interface VerseResult {
  id: string;
  text: string;
  reference: string;
  score: number;
  source: "vector" | "graph" | "hybrid";
}

export interface EntityFact {
  slug: string;
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
  relations?: {
    type: string;
    targetName: string;
    targetSlug: string;
  }[];
}

export interface HybridSearchResponse {
  verses: VerseResult[];
  entityFacts: EntityFact[];
  query: string;
  metadata: {
    vectorWeight: number;
    graphWeight: number;
    totalVectorResults: number;
    totalGraphResults: number;
    processingTimeMs: number;
    routing?: {
      intent: QueryIntent;
      source: "llm" | "heuristic";
      reasoning: string;
      latencyMs: number;
      filters?: HybridFilters;
      k: number;
    };
  };
}