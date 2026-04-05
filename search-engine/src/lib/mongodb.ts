import { MongoClient, Db } from "mongodb";

const MONGODB_URI = process.env.DATABASE_URL;
const DB_NAME = process.env.MONGODB_DB_NAME ?? "bible_sg";

if (!MONGODB_URI) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

declare global {
   
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

const client = new MongoClient(MONGODB_URI);
const clientPromise =
  global.__mongoClientPromise ?? (global.__mongoClientPromise = client.connect());

export async function getDb(): Promise<Db> {
  const connectedClient = await clientPromise;
  return connectedClient.db(DB_NAME);
}