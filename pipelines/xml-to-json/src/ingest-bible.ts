import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

// --- Types ---

interface VerseMetadata {
  testament: "Old" | "New";
  version: string;
}

interface Verse {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  metadata: VerseMetadata;
}

// --- Constants ---

const XML_INPUT_PATH = path.resolve(__dirname, "../../../raw-data/french.xml");
const JSON_OUTPUT_PATH = path.resolve(__dirname, "../../../data/processed_bible.json");

/**
 * Old Testament book abbreviations as used in french.xml
 */
const OLD_TESTAMENT_BOOKS = new Set([
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA",
  "1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO",
  "ECC","SON","ISA","JER","LAM","EZE","DAN","HOS","JOE","AMO",
  "OBA","JON","MIC","NAH","HAB","ZEP","HAG","ZEC","MAL",
]);

/**
 * Book name map keyed by abbreviations found in french.xml
 */
const BOOK_NAMES: Record<string, string> = {
  // Old Testament
  GEN: "Genèse",       EXO: "Exode",           LEV: "Lévitique",
  NUM: "Nombres",      DEU: "Deutéronome",      JOS: "Josué",
  JDG: "Juges",        RUT: "Ruth",             "1SA": "1 Samuel",
  "2SA": "2 Samuel",   "1KI": "1 Rois",         "2KI": "2 Rois",
  "1CH": "1 Chroniques","2CH": "2 Chroniques",  EZR: "Esdras",
  NEH: "Néhémie",      EST: "Esther",           JOB: "Job",
  PSA: "Psaumes",      PRO: "Proverbes",        ECC: "Ecclésiaste",
  SON: "Cantique des cantiques",                 ISA: "Ésaïe",
  JER: "Jérémie",      LAM: "Lamentations",     EZE: "Ézéchiel",
  DAN: "Daniel",       HOS: "Osée",             JOE: "Joël",
  AMO: "Amos",         OBA: "Abdias",           JON: "Jonas",
  MIC: "Michée",       NAH: "Nahum",            HAB: "Habacuc",
  ZEP: "Sophonie",     HAG: "Aggée",            ZEC: "Zacharie",
  MAL: "Malachie",
  // New Testament — abbreviations from french.xml
  MAT: "Matthieu",     MAR: "Marc",             LUK: "Luc",
  JOH: "Jean",         ACT: "Actes",            ROM: "Romains",
  "1CO": "1 Corinthiens","2CO": "2 Corinthiens",GAL: "Galates",
  EPH: "Éphésiens",    PHI: "Philippiens",      COL: "Colossiens",
  "1TH": "1 Thessaloniciens","2TH": "2 Thessaloniciens",
  "1TI": "1 Timothée", "2TI": "2 Timothée",    TIT: "Tite",
  PHM: "Philémon",     HEB: "Hébreux",          JAM: "Jacques",
  "1PE": "1 Pierre",   "2PE": "2 Pierre",
  "1JO": "1 Jean",     "2JO": "2 Jean",         "3JO": "3 Jean",
  JUD: "Jude",         REV: "Apocalypse",
};

// --- Helpers ---

/**
 * Parses ID format: "b.GEN.1.1" → { bookAbbr: "GEN", chapter: 1, verse: 1 }
 */
function parseSegId(id: string): { bookAbbr: string; chapter: number; verse: number } | null {
  // Format: b.<BOOK>.<CHAPTER>.<VERSE>
  const parts = id.split(".");
  if (parts.length < 4) return null;
  const bookAbbr = parts[1];
  const chapter = parseInt(parts[2], 10);
  const verse = parseInt(parts[3], 10);
  if (isNaN(chapter) || isNaN(verse)) return null;
  return { bookAbbr, chapter, verse };
}

/**
 * Sanitizes verse text: trims whitespace and decodes XML entities.
 * Returns empty string if text is only whitespace.
 */
function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")  // normalize internal whitespace
    .trim();
}

// --- Core Parser ---

function parseBibleXml(xmlContent: string): Verse[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Force these tags to always be arrays even with a single child
    isArray: (tagName) => ["div", "seg"].includes(tagName),
    trimValues: false, // handle trimming manually to preserve UTF-8
  });

  const root = parser.parse(xmlContent);
  const verses: Verse[] = [];

  // Structure: cesDoc > text > body > div[type=book] > div[type=chapter] > seg[type=verse]
  const body = root?.cesDoc?.text?.body;
  if (!body) {
    console.error("[ERROR] Could not locate <body> in XML. Check the XML structure.");
    process.exit(1);
  }

  const bookDivs: any[] = Array.isArray(body.div) ? body.div : [body.div];

  for (const bookDiv of bookDivs) {
    if (bookDiv?.["@_type"] !== "book") continue;

    const bookId: string = bookDiv?.["@_id"] ?? "";
    const chapterDivs: any[] = Array.isArray(bookDiv.div) ? bookDiv.div : bookDiv.div ? [bookDiv.div] : [];

    for (const chapterDiv of chapterDivs) {
      if (chapterDiv?.["@_type"] !== "chapter") continue;

      // Chapters may have no seg (empty chapters in french.xml)
      if (!chapterDiv.seg) continue;

      const segments: any[] = Array.isArray(chapterDiv.seg) ? chapterDiv.seg : [chapterDiv.seg];

      for (const seg of segments) {
        try {
          const id: string = seg?.["@_id"] ?? "";
          if (!id) throw new Error("Segment is missing an 'id' attribute.");

          const parsedId = parseSegId(id);
          if (!parsedId) throw new Error(`Cannot parse segment ID: "${id}"`);

          const { bookAbbr, chapter, verse } = parsedId;
          const book = BOOK_NAMES[bookAbbr] ?? bookAbbr;
          const testament: "Old" | "New" = OLD_TESTAMENT_BOOKS.has(bookAbbr) ? "Old" : "New";

          // fast-xml-parser puts text content in "#text" when attributes are present
          const rawText = seg?.["#text"] ?? "";
          const text = sanitizeText(rawText);

          // Skip verses with no text (empty segments in source XML)
          if (!text) {
            console.warn(`[WARN] Empty text for segment: ${id}`);
          }

          verses.push({
            id,
            book,
            chapter,
            verse,
            text,
            metadata: { testament, version: "BIBLE(Fr)" },
          });
        } catch (err) {
          console.error(`[ERROR] Skipping malformed segment:`, err);
        }
      }
    }
  }

  return verses;
}

// --- Entry Point ---

const main = (): void => {
  console.log("[INFO] Starting Bible XML → JSON ingestion...");
  console.log(`[INFO] Input:  ${XML_INPUT_PATH}`);
  console.log(`[INFO] Output: ${JSON_OUTPUT_PATH}`);

  if (!fs.existsSync(XML_INPUT_PATH)) {
    console.error(`[ERROR] XML source not found at: ${XML_INPUT_PATH}`);
    process.exit(1);
  }

  // Read with explicit UTF-8 encoding to preserve é, à, œ, etc.
  const xmlContent = fs.readFileSync(XML_INPUT_PATH, { encoding: "utf-8" });
  console.log("[INFO] XML loaded. Parsing...");

  const verses = parseBibleXml(xmlContent);
  console.log(`[INFO] Total verses parsed: ${verses.length}`);

  const emptyVerses = verses.filter(v => !v.text).length;
  if (emptyVerses > 0) {
    console.warn(`[WARN] ${emptyVerses} verses have empty text (source XML may be incomplete).`);
  }

  if (verses.length === 0) {
    console.warn("[WARN] No verses found. Please verify the XML structure.");
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(JSON_OUTPUT_PATH);
  fs.mkdirSync(outputDir, { recursive: true });

  // Write with UTF-8 encoding
  fs.writeFileSync(JSON_OUTPUT_PATH, JSON.stringify(verses, null, 2), { encoding: "utf-8" });
  console.log(`[INFO] Output written to: ${JSON_OUTPUT_PATH}`);
  console.log("[INFO] Ingestion complete ✅");
};

main();