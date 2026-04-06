export interface HybridSearchRequest {
  query: string;
  k?: number;
  vectorWeight?: number;
  graphWeight?: number;
  filters?: {
    testament?: "Old Testament" | "New Testament";
    book?: string;
  };
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
  };
}