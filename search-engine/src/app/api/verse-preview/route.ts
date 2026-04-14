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

const VERSE_PROJECTION = {
  _id: 0,
  id: 1,
  reference: 1,
  book: 1,
  chapter: 1,
  verse: 1,
  text: 1,
  metadata: 1,
} as const;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitReferenceCandidates(reference: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const part of reference.split(/\s*;\s*/)) {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    candidates.push(normalized);
  }

  return candidates.length > 0 ? candidates : [reference.trim()];
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

    const candidates = splitReferenceCandidates(reference);
    const parsed = parseReference(candidates[0]);

    let doc: VerseDoc | null = null;

    // Fast path 1: indexed compound lookup { book, chapter, verse }
    if (parsed) {
      doc = await verses.findOne(
        { book: parsed.book, chapter: parsed.chapter, verse: parsed.verse },
        { projection: VERSE_PROJECTION }
      );
    }

    // Fast path 2: indexed exact match on reference / id fields
    if (!doc?.text) {
      for (const candidate of candidates) {
        doc = await verses.findOne(
          { $or: [{ reference: candidate }, { id: candidate }] },
          { projection: VERSE_PROJECTION }
        );
        if (doc?.text) break;
      }
    }

    // Slow fallback: case-insensitive regex (handles casing / diacritic variants)
    if (!doc?.text) {
      const regexes = candidates.map((c) => new RegExp(`^${escapeRegex(c)}$`, "i"));
      const idOrRefClauses = regexes.flatMap((rx) => [{ id: rx }, { reference: rx }]);
      const fallbackQuery = parsed
        ? {
            $or: [
              ...idOrRefClauses,
              {
                book: { $regex: new RegExp(`^${escapeRegex(parsed.book)}$`, "i") },
                chapter: parsed.chapter,
                verse: parsed.verse,
              },
            ],
          }
        : { $or: idOrRefClauses };
      doc = await verses.findOne(fallbackQuery, { projection: VERSE_PROJECTION });
    }

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
