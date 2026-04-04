import { OpenAIEmbeddings } from "@langchain/openai";
import { MongoClient, Collection } from "mongodb";

interface VerseSearchResult {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  metadata: {
    testament: "Old" | "New";
    version: string;
  };
  score?: number;
}

const CONFIG = {
  mongodbUri: process.env.DATABASE_URL || "mongodb://localhost:27017",
  openaiApiKey: process.env.OPENAI_API_KEY,
  databaseName: "bible_sg",
  collectionName: "verses",
  vectorIndexName: process.env.VECTOR_INDEX_NAME || "embedding_index",
  embeddingModel: "text-embedding-3-small",
  expectedVersion: process.env.BIBLE_VERSION || "LSG",
  query: process.argv[2] || "Parabole du semeur.",
  limit: 10,
  numCandidates: 100,
  maxLatencyMs: 200,
} as const;

function assertEnv(): void {
  if (!CONFIG.openaiApiKey) {
    console.error("[ERROR] OPENAI_API_KEY is required.");
    process.exit(1);
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function isFrenchVersion(result: VerseSearchResult): boolean {
  const version = normalize(result.metadata?.version ?? "");
  const expected = normalize(CONFIG.expectedVersion);

  return version === expected;
}

function isFrenchRelevantResult(query: string, result: VerseSearchResult): boolean {
  if (!isFrenchVersion(result)) {
    return false;
  }

  const q = normalize(query);
  const book = normalize(result.book);
  const text = normalize(result.text);

  if (q.includes("parabole du semeur") || q.includes("semeur") || q.includes("semence")) {
    return (
      (book === "matthieu" && result.chapter === 13) ||
      (book === "marc" && result.chapter === 4) ||
      (book === "luc" && result.chapter === 8)
    );
  }

  if (q.includes("fils de david")) {
    return text.includes("fils de david");
  }

  const keywords = q
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((token) => token.length >= 4);

  return keywords.some((token) => `${book} ${text}`.includes(token));
}

async function runVectorSearch(
  collection: Collection<VerseSearchResult>,
  queryVector: number[]
): Promise<VerseSearchResult[]> {
  return collection
    .aggregate<VerseSearchResult>([
      {
        $vectorSearch: {
          index: CONFIG.vectorIndexName,
          path: "embedding",
          queryVector,
          numCandidates: CONFIG.numCandidates,
          limit: CONFIG.limit,
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          book: 1,
          chapter: 1,
          verse: 1,
          text: 1,
          metadata: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

async function main(): Promise<void> {
  assertEnv();

  console.log("[INFO] Validating DoD #4 and #5...");
  console.log(`[INFO] Query: "${CONFIG.query}"`);
  console.log(`[INFO] Expected version: "${CONFIG.expectedVersion}"`);

  const embeddings = new OpenAIEmbeddings({
    model: CONFIG.embeddingModel,
    apiKey: CONFIG.openaiApiKey,
  });

  const queryVector = await embeddings.embedQuery(CONFIG.query);
  const client = new MongoClient(CONFIG.mongodbUri);

  try {
    await client.connect();

    const collection = client
      .db(CONFIG.databaseName)
      .collection<VerseSearchResult>(CONFIG.collectionName);

    // Warm-up query to avoid counting cold-start overhead in latency measurement.
    await runVectorSearch(collection, queryVector);

    const start = process.hrtime.bigint();
    const results = await runVectorSearch(collection, queryVector);
    const end = process.hrtime.bigint();

    const latencyMs = Number(end - start) / 1_000_000;
    const frenchResults = results.filter(isFrenchVersion);

    console.log(`[INFO] Search latency: ${latencyMs.toFixed(2)} ms`);
    console.log("[INFO] Top French results:");

    for (const [index, result] of frenchResults.entries()) {
      console.log(
        `${index + 1}. ${result.book} ${result.chapter}:${result.verse} (${result.score?.toFixed(4) ?? "n/a"})`
      );
      console.log(`   ${result.text}`);
    }

    const relevancePassed = frenchResults.some((result) =>
      isFrenchRelevantResult(CONFIG.query, result)
    );
    const latencyPassed = latencyMs <= CONFIG.maxLatencyMs;

    console.log(`\n[CHECK] French results found: ${frenchResults.length > 0 ? "PASS" : "FAIL"}`);
    console.log(`[CHECK] DoD #4 relevance: ${relevancePassed ? "PASS" : "FAIL"}`);
    console.log(`[CHECK] DoD #5 latency < ${CONFIG.maxLatencyMs}ms: ${latencyPassed ? "PASS" : "FAIL"}`);

    if (frenchResults.length === 0 || !relevancePassed || !latencyPassed) {
      process.exit(1);
    }

    console.log("[INFO] Validation passed.");
  } catch (error) {
    console.error("[ERROR] Validation failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();