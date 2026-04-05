import * as fs from "fs";
import * as path from "path";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MongoClient, Db, Collection } from "mongodb";

// --- Types ---

interface Verse {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  metadata: {
    testament: "Old" | "New";
    version: string;
  };
}

interface VerseWithEmbedding extends Verse {
  embedding: number[];
}

// --- Configuration ---

const CONFIG = {
  jsonInputPath: path.resolve(__dirname, "../../../data/processed_bible.json"),
  mongodbUri: process.env.DATABASE_URL || "mongodb://localhost:27017",
  openaiApiKey: process.env.OPENAI_API_KEY,
  databaseName: "bible_sg",
  collectionName: "verses",
  batchSize: 100,
  retryAttempts: 3,
  retryDelayMs: 1000,
} as const;

// --- Utility Functions ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// --- Validation ---

function validateEnvironment(): void {
  if (!CONFIG.openaiApiKey) {
    console.error("[ERROR] OPENAI_API_KEY environment variable not set.");
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.jsonInputPath)) {
    console.error(`[ERROR] JSON input file not found: ${CONFIG.jsonInputPath}`);
    process.exit(1);
  }
}

// --- Data Loading ---

function loadVerses(): Verse[] {
  const data = JSON.parse(
    fs.readFileSync(CONFIG.jsonInputPath, { encoding: "utf-8" })
  ) as Verse[];
  console.log(`[INFO] Loaded ${data.length} verses from JSON.`);
  return data;
}

// --- API Retry Logic ---

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = CONFIG.retryAttempts
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isRateLimitError(err)) {
        await handleRateLimit(attempt);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Max retry attempts exceeded");
}

function isRateLimitError(err: any): boolean {
  return err?.status === 429 || err?.code === "rate_limit_exceeded";
}

async function handleRateLimit(attempt: number): Promise<void> {
  const delayMs = CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
  console.warn(
    `[WARN] Rate limited. Retrying in ${delayMs}ms (attempt ${attempt}/${CONFIG.retryAttempts})...`
  );
  await sleep(delayMs);
}

// --- Database Setup ---

async function setupDatabase(collection: Collection<VerseWithEmbedding>): Promise<void> {
  // Create unique index on ID
  await collection.createIndex({ id: 1 }, { unique: true });
  console.log("[INFO] Ensured unique index on 'id' field.");

  // Create vector search index
  await setupVectorIndex(collection);
}

async function setupVectorIndex(collection: Collection<VerseWithEmbedding>): Promise<void> {
  const db = collection.db;
  try {
    await db.command({
      createIndexes: CONFIG.collectionName,
      indexes: [
        {
            key: { embedding: "cosmosSearch" },
            name: "vector_idx",
            cosmosSearchOptions: {
                kind: "vector-hnsw",
                similarity: "COS",
                dimensions: 1536
            }
        },
      ],
    });
    console.log("[INFO] Created vector search index (HNSW).");
  } catch (err: any) {
    if (err?.codeName !== "IndexAlreadyExists") {
      console.warn(`[WARN] Vector index creation failed: ${err?.message}`);
    }
  }
}

// --- Embedding Generation ---

async function generateBatchEmbeddings(
  embeddings: OpenAIEmbeddings,
  texts: string[]
): Promise<number[][]> {
  return retryWithBackoff(() => embeddings.embedDocuments(texts));
}

// --- Database Operations ---

async function upsertVerseWithEmbedding(
  collection: Collection<VerseWithEmbedding>,
  doc: VerseWithEmbedding
): Promise<boolean> {
  try {
    await collection.updateOne(
      { id: doc.id },
      { $set: doc },
      { upsert: true }
    );
    return true;
  } catch (err: any) {
    if (err?.code === 11000) {
      console.warn(`[WARN] Skipping duplicate verse: ${doc.id}`);
      return false;
    }
    throw err;
  }
}

// --- Batch Processing ---

async function processBatch(
  batchIndex: number,
  batch: Verse[],
  embeddings: OpenAIEmbeddings,
  collection: Collection<VerseWithEmbedding>,
  totalBatches: number
): Promise<{ processed: number; skipped: number }> {
  console.log(
    `[INFO] Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} verses)...`
  );

  const batchTexts = batch.map((v) => v.text);
  const batchEmbeddings = await generateBatchEmbeddings(embeddings, batchTexts);

  let processed = 0;
  let skipped = 0;

  for (let idx = 0; idx < batch.length; idx++) {
    const doc: VerseWithEmbedding = {
      ...batch[idx],
      embedding: batchEmbeddings[idx],
    };

    const inserted = await upsertVerseWithEmbedding(collection, doc);
    inserted ? processed++ : skipped++;
  }

  console.log(
    `[INFO] Batch ${batchIndex + 1} complete. (+${processed} processed, +${skipped} skipped)`
  );

  return { processed, skipped };
}

function getArgValue(argNames: string[]): string | undefined {
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    for (const name of argNames) {
      if (token === name) {
        return argv[i + 1];
      }

      if (token.startsWith(`${name}=`)) {
        return token.slice(name.length + 1);
      }
    }
  }

  return undefined;
}

function resolveStartBatch(totalBatches: number): number {
  const raw = getArgValue(["--start-batch", "--sart-batch"]);

  if (!raw) return 1;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > totalBatches) {
    console.error(
      `[ERROR] Invalid start batch "${raw}". Expected an integer between 1 and ${totalBatches}.`
    );
    process.exit(1);
  }

  return parsed;
}

// --- Main Pipeline ---

async function vectorizeBible(): Promise<void> {
  console.log("[INFO] Starting Bible vectorization pipeline...");
  console.log(`[INFO] Input: ${CONFIG.jsonInputPath}`);
  console.log(`[INFO] Database: ${CONFIG.mongodbUri}`);

  // Validate
  validateEnvironment();

  // Load data
  const verses = loadVerses();

  // Initialize OpenAI
  const embeddings = new OpenAIEmbeddings({
    apiKey: CONFIG.openaiApiKey,
    modelName: "text-embedding-3-small",
  });

  // Connect to MongoDB
  const client = new MongoClient(CONFIG.mongodbUri);

  try {
    await client.connect();
    console.log("[INFO] Connected to MongoDB.");

    const db = client.db(CONFIG.databaseName);
    const collection = db.collection<VerseWithEmbedding>(CONFIG.collectionName);

    // Setup database
    await setupDatabase(collection);

    // Process batches
    const batches = chunkArray(verses, CONFIG.batchSize);
    const startBatch = resolveStartBatch(batches.length);

    if (startBatch > 1) {
      console.log(`[INFO] Resuming from batch ${startBatch}/${batches.length}...`);
    }

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (let i = startBatch - 1; i < batches.length; i++) {
      const { processed, skipped } = await processBatch(
        i,
        batches[i],
        embeddings,
        collection,
        batches.length
      );
      totalProcessed += processed;
      totalSkipped += skipped;
    }

    // Verify
    await verifyResults(collection, totalProcessed, totalSkipped);
  } finally {
    await client.close();
    console.log("[INFO] MongoDB connection closed.");
  }
}

async function verifyResults(
  collection: Collection<VerseWithEmbedding>,
  processed: number,
  skipped: number
): Promise<void> {
  const totalCount = await collection.countDocuments();
  console.log(`[INFO] Total documents in collection: ${totalCount}`);

  if (totalCount === 0) {
    console.warn("[WARN] No documents were inserted.");
    process.exit(1);
  }

  console.log("[INFO] ✅ Vectorization complete!");
  console.log(`[INFO] Summary: ${processed} inserted/updated, ${skipped} skipped.`);
}

// --- Entry Point ---

vectorizeBible().catch((err) => {
  console.error("[FATAL] Pipeline failed:", err);
  process.exit(1);
});