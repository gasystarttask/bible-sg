import OpenAI from "openai";
import type { HybridFilters, QueryIntent } from "@search/types/hybrid";

function createCopilotClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.GITHUB_TOKEN ?? "none",
    baseURL: "https://models.github.ai/inference",
    defaultHeaders: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

type RouterDecisionShape = {
  intent: QueryIntent;
  vectorWeight: number;
  graphWeight: number;
  k: number;
  filters?: HybridFilters;
  reasoning: string;
};

export interface QueryRoutingDecision extends RouterDecisionShape {
  source: "llm" | "heuristic";
  latencyMs: number;
}

export interface QueryRouterInput {
  query: string;
  requested?: {
    k?: number;
    vectorWeight?: number;
    graphWeight?: number;
      filters?: HybridFilters;
  };
  timeoutMs?: number;
}

const ROUTER_MODEL = process.env.QUERY_ROUTER_MODEL ?? "gpt-4o-mini";
const ROUTER_TIMEOUT_MS = 450;

const LSG_BOOK_NAMES: Record<string, string> = {
  Genesis: "Genèse",
  Exodus: "Exode",
  Leviticus: "Lévitique",
  Numbers: "Nombres",
  Deuteronomy: "Deutéronome",
  Joshua: "Josué",
  Judges: "Juges",
  Ruth: "Ruth",
  "1 Samuel": "1 Samuel",
  "2 Samuel": "2 Samuel",
  "1 Kings": "1 Rois",
  "2 Kings": "2 Rois",
  "1 Chronicles": "1 Chroniques",
  "2 Chronicles": "2 Chroniques",
  Ezra: "Esdras",
  Nehemiah: "Néhémie",
  Esther: "Esther",
  Job: "Job",
  Psalms: "Psaumes",
  Proverbs: "Proverbes",
  Ecclesiastes: "Ecclésiaste",
  "Song of Solomon": "Cantique des Cantiques",
  Isaiah: "Ésaïe",
  Jeremiah: "Jérémie",
  Lamentations: "Lamentations",
  Ezekiel: "Ézéchiel",
  Daniel: "Daniel",
  Hosea: "Osée",
  Joel: "Joël",
  Amos: "Amos",
  Obadiah: "Abdias",
  Jonah: "Jonas",
  Micah: "Michée",
  Nahum: "Nahum",
  Habakkuk: "Habacuc",
  Zephaniah: "Sophonie",
  Haggai: "Aggée",
  Zechariah: "Zacharie",
  Malachi: "Malachie",
  Matthew: "Matthieu",
  Mark: "Marc",
  Luke: "Luc",
  John: "Jean",
  Acts: "Actes",
  Romans: "Romains",
  "1 Corinthians": "1 Corinthiens",
  "2 Corinthians": "2 Corinthiens",
  Galatians: "Galates",
  Ephesians: "Éphésiens",
  Philippians: "Philippiens",
  Colossians: "Colossiens",
  "1 Thessalonians": "1 Thessaloniciens",
  "2 Thessalonians": "2 Thessaloniciens",
  "1 Timothy": "1 Timothée",
  "2 Timothy": "2 Timothée",
  Titus: "Tite",
  Philemon: "Philémon",
  Hebrews: "Hébreux",
  James: "Jacques",
  "1 Peter": "1 Pierre",
  "2 Peter": "2 Pierre",
  "1 John": "1 Jean",
  "2 John": "2 Jean",
  "3 John": "3 Jean",
  Jude: "Jude",
  Revelation: "Apocalypse",
};

const NEW_TESTAMENT_KEYS = new Set([
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
]);

const INTENT_CONFIG: Record<QueryIntent, Pick<RouterDecisionShape, "vectorWeight" | "graphWeight" | "k">> = {
  THEOLOGY: { vectorWeight: 0.9, graphWeight: 0.1, k: 5 },
  GENEALOGY: { vectorWeight: 0.1, graphWeight: 0.9, k: 6 },
  GEOGRAPHY: { vectorWeight: 0.5, graphWeight: 0.5, k: 8 },
  CHRONOLOGY: { vectorWeight: 0.4, graphWeight: 0.6, k: 8 },
  GENERAL: { vectorWeight: 0.8, graphWeight: 0.2, k: 5 },
};

const BOOK_ALIASES: Record<string, string[]> = {
  Genesis: ["genesis", "genese"],
  Exodus: ["exodus", "exode"],
  Leviticus: ["leviticus", "levitique"],
  Numbers: ["numbers", "nombres"],
  Deuteronomy: ["deuteronomy", "deuteronome"],
  Joshua: ["joshua", "josue"],
  Judges: ["judges", "juges"],
  Ruth: ["ruth"],
  "1 Samuel": ["1 samuel", "1 sam"],
  "2 Samuel": ["2 samuel", "2 sam"],
  "1 Kings": ["1 kings", "1 rois"],
  "2 Kings": ["2 kings", "2 rois"],
  "1 Chronicles": ["1 chronicles", "1 chroniques"],
  "2 Chronicles": ["2 chronicles", "2 chroniques"],
  Ezra: ["ezra", "esdras"],
  Nehemiah: ["nehemiah", "nehemie"],
  Esther: ["esther"],
  Job: ["job"],
  Psalms: ["psalms", "psaumes", "psaume"],
  Proverbs: ["proverbs", "proverbes"],
  Ecclesiastes: ["ecclesiastes", "ecclesiaste"],
  "Song of Solomon": ["song of solomon", "cantique des cantiques", "cantique"],
  Isaiah: ["isaiah", "esaie"],
  Jeremiah: ["jeremiah", "jeremie"],
  Lamentations: ["lamentations"],
  Ezekiel: ["ezekiel", "ezechiel"],
  Daniel: ["daniel"],
  Hosea: ["hosea", "osee"],
  Joel: ["joel"],
  Amos: ["amos"],
  Obadiah: ["obadiah", "abdias"],
  Jonah: ["jonah", "jonas"],
  Micah: ["micah", "michee"],
  Nahum: ["nahum"],
  Habakkuk: ["habakkuk", "habacuc"],
  Zephaniah: ["zephaniah", "sophonie"],
  Haggai: ["haggai", "aggee"],
  Zechariah: ["zechariah", "zacharie"],
  Malachi: ["malachi", "malachie"],
  Matthew: ["matthew", "matthieu"],
  Mark: ["mark", "marc"],
  Luke: ["luke", "luc"],
  John: ["john", "jean"],
  Acts: ["acts", "actes"],
  Romans: ["romans", "romains"],
  "1 Corinthians": ["1 corinthians", "1 corinthiens"],
  "2 Corinthians": ["2 corinthians", "2 corinthiens"],
  Galatians: ["galatians", "galates"],
  Ephesians: ["ephesians", "ephesiens"],
  Philippians: ["philippians", "philippiens"],
  Colossians: ["colossians", "colossiens"],
  "1 Thessalonians": ["1 thessalonians", "1 thessaloniciens"],
  "2 Thessalonians": ["2 thessalonians", "2 thessaloniciens"],
  "1 Timothy": ["1 timothy", "1 timothee"],
  "2 Timothy": ["2 timothy", "2 timothee"],
  Titus: ["titus", "tite"],
  Philemon: ["philemon"],
  Hebrews: ["hebrews", "hebreux"],
  James: ["james", "jacques"],
  "1 Peter": ["1 peter", "1 pierre"],
  "2 Peter": ["2 peter", "2 pierre"],
  "1 John": ["1 john", "1 jean"],
  "2 John": ["2 john", "2 jean"],
  "3 John": ["3 john", "3 jean"],
  Jude: ["jude"],
  Revelation: ["revelation", "apocalypse"],
};

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLsgBookName(input?: string): string | undefined {
  if (!input) return undefined;

  const normalizedInput = normalizeText(input);
  for (const [canonicalBook, aliases] of Object.entries(BOOK_ALIASES)) {
    const allCandidates = [canonicalBook, ...aliases];
    if (allCandidates.some((candidate) => normalizeText(candidate) === normalizedInput)) {
      return LSG_BOOK_NAMES[canonicalBook] ?? canonicalBook;
    }
  }

  return input;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeWeights(vectorWeight: number, graphWeight: number): { vectorWeight: number; graphWeight: number } {
  const vw = Number.isFinite(vectorWeight) ? Math.max(0, vectorWeight) : 0;
  const gw = Number.isFinite(graphWeight) ? Math.max(0, graphWeight) : 0;
  const total = vw + gw;
  if (total <= 0) {
    return { vectorWeight: 0.7, graphWeight: 0.3 };
  }

  return {
    vectorWeight: Number((vw / total).toFixed(3)),
    graphWeight: Number((gw / total).toFixed(3)),
  };
}

function detectTestament(book?: string): HybridFilters["testament"] | undefined {
  if (!book) return undefined;

  const normalizedBook = normalizeText(book);
  const isNewTestament = Array.from(NEW_TESTAMENT_KEYS).some((bookKey) => {
    const lsgName = LSG_BOOK_NAMES[bookKey] ?? bookKey;
    return normalizeText(bookKey) === normalizedBook || normalizeText(lsgName) === normalizedBook;
  });

  return isNewTestament ? "Nouveau Testament" : "Ancien Testament";
}

function extractBookFromQuery(query: string): string | undefined {
  const normalized = ` ${normalizeText(query)} `;

  for (const [book, aliases] of Object.entries(BOOK_ALIASES)) {
    for (const alias of aliases) {
      if (normalized.includes(` ${normalizeText(alias)} `)) {
        return toLsgBookName(book);
      }
    }
  }

  return undefined;
}

function heuristicIntent(query: string): QueryIntent {
  const q = normalizeText(query);
  if (/(son of|daughter of|father of|mother of|begat|descendant|lineage|genealogy|ancestor|brother of|sister of|fils de|fille de|pere de|mere de|engendra|descendance|genealogie|ancetre|frere de|soeur de)/.test(q)) {
    return "GENEALOGY";
  }
  if (/(where|located|location|egypt|israel|jerusalem|bethlehem|nazareth|canaan|region|city|mount|river|ou|situe|emplacement|lieu|ville|mont|fleuve|riviere)/.test(q)) {
    return "GEOGRAPHY";
  }
  if (/(when|timeline|before|after|during|century|year|reign|chronology|sequence|order of events|quand|chronologie|avant|apres|pendant|siecle|annee|regne|ordre des evenements)/.test(q)) {
    return "CHRONOLOGY";
  }
  if (/(what does the bible say|meaning|theme|theology|faith|hope|love|grace|sin|salvation|perseverance|forgiveness|wisdom|que dit la bible|signification|theme|theologie|foi|esperance|amour|grace|peche|salut|perseverance|pardon|sagesse|jesus|j[eé]sus|christ|messie|messiah|saint.?esprit|holy.?spirit)/.test(q)) {
    return "THEOLOGY";
  }
  return "GENERAL";
}

function isDirectKinshipQuestion(query: string): boolean {
  const q = normalizeText(query);
  return /(qui est .*fils de|qui est .*fille de|who is .*son of|who is .*daughter of|fils de|daughter of|son of)/i.test(q);
}

function heuristicRoute(query: string): QueryRoutingDecision {
  const intent = heuristicIntent(query);
  const base =
    intent === "GENEALOGY" && isDirectKinshipQuestion(query)
      ? { vectorWeight: 0.8, graphWeight: 0.2, k: 6 }
      : INTENT_CONFIG[intent];
  const book = extractBookFromQuery(query);
  const filters = book ? { book, testament: detectTestament(book) } : undefined;

  return {
    intent,
    vectorWeight: base.vectorWeight,
    graphWeight: base.graphWeight,
    k: base.k,
    filters,
    reasoning: `Heuristic route selected intent ${intent} from query keywords.`,
    source: "heuristic",
    latencyMs: 0,
  };
}

async function llmRoute(query: string, timeoutMs: number): Promise<QueryRoutingDecision | null> {
  if (!process.env.GITHUB_TOKEN) {
    return null;
  }

  const openai = createCopilotClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const completion = await openai.chat.completions.create(
      {
        model: ROUTER_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a multilingual (English/French) query router for Bible retrieval. Return only JSON with this schema: { intent, vectorWeight, graphWeight, k, filters: { testament?, book? }, reasoning }. intent must be one of THEOLOGY, GENEALOGY, GEOGRAPHY, CHRONOLOGY, GENERAL. Canonicalize book names to LSG French names (e.g., Genese -> Genèse, Matthew -> Matthieu). Prefer French testament labels (Ancien Testament / Nouveau Testament). Ensure vectorWeight + graphWeight ~= 1. Keep reasoning under 160 chars.",
          },
          {
            role: "user",
            content: query,
          },
        ],
      },
      { signal: controller.signal }
    );

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return null;
    }

    const parsed = JSON.parse(content) as Partial<RouterDecisionShape>;
    if (!parsed.intent || !(parsed.intent in INTENT_CONFIG)) {
      return null;
    }

    const normalized = normalizeWeights(
      parsed.vectorWeight ?? INTENT_CONFIG[parsed.intent].vectorWeight,
      parsed.graphWeight ?? INTENT_CONFIG[parsed.intent].graphWeight
    );

    const book = toLsgBookName(parsed.filters?.book ?? extractBookFromQuery(query));
    const filters: HybridFilters | undefined =
      parsed.filters || book
        ? {
            book,
            testament: parsed.filters?.testament ?? detectTestament(book),
          }
        : undefined;

    return {
      intent: parsed.intent,
      vectorWeight: normalized.vectorWeight,
      graphWeight: normalized.graphWeight,
      k: clampInt(parsed.k ?? INTENT_CONFIG[parsed.intent].k, 1, 20),
      filters,
      reasoning: parsed.reasoning?.trim() || `LLM classified query as ${parsed.intent}.`,
      source: "llm",
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function routeQuery(input: QueryRouterInput): Promise<QueryRoutingDecision> {
  const query = input.query.trim();
  const timeoutMs = input.timeoutMs ?? ROUTER_TIMEOUT_MS;
  const fallback = heuristicRoute(query);
  const routed = (await llmRoute(query, timeoutMs)) ?? fallback;

  const mergedK = input.requested?.k ?? routed.k;
  const mergedFilters = {
    ...routed.filters,
    ...input.requested?.filters,
  };

  const mergedWeights = normalizeWeights(
    input.requested?.vectorWeight ?? routed.vectorWeight,
    input.requested?.graphWeight ?? routed.graphWeight
  );

  const applyKinshipFastProfile = routed.intent === "GENEALOGY" && isDirectKinshipQuestion(query);
  const finalWeights =
    applyKinshipFastProfile &&
    input.requested?.vectorWeight == null &&
    input.requested?.graphWeight == null
      ? { vectorWeight: 0.8, graphWeight: 0.2 }
      : mergedWeights;

  return {
    ...routed,
    ...finalWeights,
    k: clampInt(mergedK, 1, 20),
    filters: Object.keys(mergedFilters).length ? mergedFilters : undefined,
    reasoning:
      input.requested?.vectorWeight != null ||
      input.requested?.graphWeight != null ||
      input.requested?.k != null ||
      input.requested?.filters != null
        ? `${routed.reasoning} Request overrides were applied.`
        : routed.reasoning,
  };
}
