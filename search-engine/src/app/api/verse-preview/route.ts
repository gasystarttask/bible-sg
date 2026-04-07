import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@search/lib/mongodb";

type VerseDoc = {
  id?: string;
  reference?: string;
  book?: string;
  chapter?: number;
  verse?: number;
  text?: string;
  metadata?: {
    testament?: string;
    version?: string;
  };
};

const COLLECTION_NAME = process.env.MONGODB_COLLECTION_NAME ?? "verses";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseReference(reference: string): { book: string; chapter: number; verse: number } | null {
  const normalized = reference.trim().replace(/^\[|\]$/g, "");
  // Match "Book Chapter:Verse" or "Book Chapter:Verse-EndVerse" (range)
  const match = normalized.match(/^(.+?)\s+(\d+):(\d+)(?:-\d+)?$/);
  if (!match) return null;

  const book = match[1].trim();
  const chapter = Number(match[2]);
  const verse = Number(match[3]);

  if (!book || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
    return null;
  }

  return { book, chapter, verse };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reference = req.nextUrl.searchParams.get("reference")?.trim();
  if (!reference) {
    return NextResponse.json({ error: "Query param 'reference' is required." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const verses = db.collection<VerseDoc>(COLLECTION_NAME);

    const parsed = parseReference(reference);
    const regex = new RegExp(`^${escapeRegex(reference)}$`, "i");

    const query = parsed
      ? {
          $or: [
            { id: regex },
            { reference: regex },
            {
              book: { $regex: new RegExp(`^${escapeRegex(parsed.book)}$`, "i") },
              chapter: parsed.chapter,
              verse: parsed.verse,
            },
          ],
        }
      : {
          $or: [{ id: regex }, { reference: regex }],
        };

    const doc = await verses.findOne(query, {
      projection: {
        _id: 0,
        id: 1,
        reference: 1,
        book: 1,
        chapter: 1,
        verse: 1,
        text: 1,
        metadata: 1,
      },
    });

    if (!doc?.text) {
      return NextResponse.json({ error: "Verse not found." }, { status: 404 });
    }

    const resolvedReference = doc.reference ?? doc.id ?? `${doc.book} ${doc.chapter}:${doc.verse}`;

    return NextResponse.json(
      {
        reference: resolvedReference,
        text: doc.text,
        book: doc.book,
        chapter: doc.chapter,
        verse: doc.verse,
        metadata: doc.metadata ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[verse-preview] Error:", error);
    return NextResponse.json({ error: "Failed to load verse preview." }, { status: 500 });
  }
}
