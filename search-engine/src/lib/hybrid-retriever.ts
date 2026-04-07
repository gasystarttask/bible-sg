import { Db, Collection } from "mongodb";
import OpenAI from "openai";
import type { EntityFact, VerseResult } from "@search/types/hybrid";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VECTOR_INDEX_NAME = process.env.MONGODB_VECTOR_INDEX || "vector_idx";

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX = 500;
const RETRIEVE_CACHE_TTL_MS = 45 * 1000;
const RETRIEVE_CACHE_MAX = 300;

interface VerseMetadata {
  testament?: string;
  version?: string;
}

interface VectorDoc {
  _id: unknown;
  id?: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  embedding?: number[];
  metadata?: VerseMetadata;
  entity_slugs?: string[];
  score?: number;
}

interface ProjectedVerseDoc {
  _id: unknown;
  id?: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  metadata?: VerseMetadata;
  entity_slugs?: string[];
  score?: number;
}

interface EntityDoc {
  _id: unknown;
  slug: string;
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
  description_fragments?: string[];
  source_verse_id?: string;
}

interface RelationDoc {
  _id: unknown;
  relation_type?: string;
  type?: string;
  source_slug?: string;
  target_slug?: string;
  source_entity_id?: unknown;
  target_entity_id?: unknown;
  evidence_verse_id?: string;
  evidence_verse_ids?: string[];
}

interface AggregatedRelationDoc {
  relation_type?: string;
  type?: string;
  target_slug?: string;
  target_entity_id?: unknown;
  target?: EntityDoc | null;
}

interface AggregatedEntityDoc {
  slug: string;
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
  relations?: AggregatedRelationDoc[];
}

interface RankedVerseResult extends VerseResult {
  entitySlugs?: string[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const embeddingCache = new Map<string, CacheEntry<number[]>>();
const retrieveCache = new Map<
  string,
  CacheEntry<{
    verses: VerseResult[];
    entityFacts: EntityFact[];
    metadata: {
      vectorWeight: number;
      graphWeight: number;
      totalVectorResults: number;
      totalGraphResults: number;
      cached?: boolean;
    };
  }>
>();

const PER_VERSE_SLUG_RX =
  /-(?:gen|exo|lev|nom|deu|jos|jug|rut|sam|roi|chr|esd|neh|est|job|psa|pro|ecc|esa|jer|eze|dan|hos|joe|amo|abd|jon|mic|nah|hab|sop|agg|zac|mal|mat|mar|luc|jean|act|rom|cor|gal|eph|phi|col|the|tim|tit|phm|heb|jac|pie|jud|apo)(?:-?\d+)?$/i;

function nowMs(): number {
  return Date.now();
}

function setCacheWithCap<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxSize: number
): void {
  cache.set(key, { value, expiresAt: nowMs() + ttlMs });

  if (cache.size <= maxSize) return;

  const first = cache.keys().next();
  if (!first.done) cache.delete(first.value);
}

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= nowMs()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function reciprocalRankFusion(
  lists: RankedVerseResult[][],
  weights: number[],
  k = 60
): RankedVerseResult[] {
  const scores = new Map<string, { score: number; doc: RankedVerseResult }>();

  lists.forEach((list, listIndex) => {
    const weight = weights[listIndex] ?? 1;

    list.forEach((doc, rank) => {
      const rrfScore = weight * (1 / (k + rank + 1));
      const existing = scores.get(doc.id);

      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(doc.id, {
          score: rrfScore,
          doc: { ...doc },
        });
      }
    });
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, doc }) => ({
      ...doc,
      score,
      source: "hybrid" as const,
    }));
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeLoose(value: string): string {
  return stripDiacritics(value).toLowerCase().trim();
}

function tokenizeQuery(query: string): string[] {
  return normalizeLoose(query)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function isGenealogyQuery(query: string): boolean {
  const q = normalizeLoose(query);
  return /(son of|daughter of|father of|mother of|begat|genealogy|lineage|descendant|fils de|fille de|pere de|mere de|engendra|genealogie|descendance)/i.test(q);
}

function rerankByQueryOverlap(query: string, merged: RankedVerseResult[]): RankedVerseResult[] {
  const normalizedQuery = normalizeLoose(query);
  const stopWords = new Set([
    "qui", "est", "le", "la", "les", "de", "des", "du", "dans", "sur", "et",
    "who", "what", "where", "when", "the", "of", "in", "on", "and", "for", "with",
    "fils", "son", "daughter", "father", "mother",
  ]);

  const tokens = Array.from(
    new Set(tokenizeQuery(query).filter((t) => !stopWords.has(t)))
  );

  if (!tokens.length) return merged;

  const relationCue = /(son|daughter|father|mother|begat|fils|fille|pere|mere|engendra)/i;

  return [...merged]
    .map((item) => {
      const haystack = normalizeLoose(`${item.reference} ${item.text}`);
      const overlap = tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
      const relationBoost = relationCue.test(normalizedQuery) && relationCue.test(haystack) ? 1 : 0;
      const lexicalBoost = overlap * 0.0025 + relationBoost * 0.0015;

      return {
        ...item,
        score: item.score + lexicalBoost,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function toId(value: unknown): string {
  return value == null ? "" : String(value);
}

function buildReference(doc: Pick<VectorDoc, "book" | "chapter" | "verse">): string {
  return `${doc.book} ${doc.chapter}:${doc.verse}`;
}

function buildTestamentRegex(input?: string): RegExp | undefined {
  if (!input) return undefined;

  const normalized = normalizeLoose(input);

  if (normalized.includes("old") || normalized.includes("ancien")) {
    return /^Old$/i;
  }

  if (normalized.includes("new") || normalized.includes("nouveau")) {
    return /^New$/i;
  }

  return new RegExp(`^${escapeRegex(input)}$`, "i");
}

const BOOK_ALIASES: Record<string, string[]> = {
  genesis: ["Genesis", "Genèse", "Genese"],
  exodus: ["Exodus", "Exode"],
  leviticus: ["Leviticus", "Lévitique", "Levitique"],
  numbers: ["Numbers", "Nombres"],
  deuteronomy: ["Deuteronomy", "Deutéronome", "Deuteronome"],
  joshua: ["Joshua", "Josué", "Josue"],
  judges: ["Judges", "Juges"],
  ruth: ["Ruth"],
  samuel: ["Samuel", "1 Samuel", "2 Samuel", "I Samuel", "II Samuel"],
  kings: ["Kings", "Rois", "1 Kings", "2 Kings", "1 Rois", "2 Rois"],
  chronicles: [
    "Chronicles",
    "Chroniques",
    "1 Chronicles",
    "2 Chronicles",
    "1 Chroniques",
    "2 Chroniques",
  ],
  ezra: ["Ezra", "Esdras"],
  nehemiah: ["Nehemiah", "Néhémie", "Nehemie"],
  esther: ["Esther"],
  job: ["Job"],
  psalms: ["Psalms", "Psaumes"],
  proverbs: ["Proverbs", "Proverbes"],
  ecclesiastes: ["Ecclesiastes", "Ecclésiaste", "Ecclesiaste"],
  songofsolomon: ["Song of Solomon", "Cantique des Cantiques", "Cantique"],
  isaiah: ["Isaiah", "Ésaïe", "Esaie"],
  jeremiah: ["Jeremiah", "Jérémie", "Jeremie"],
  lamentations: ["Lamentations"],
  ezekiel: ["Ezekiel", "Ézéchiel", "Ezechiel"],
  daniel: ["Daniel"],
  hosea: ["Hosea", "Osée", "Osee"],
  joel: ["Joel", "Joël"],
  amos: ["Amos"],
  obadiah: ["Obadiah", "Abdias"],
  jonah: ["Jonah", "Jonas"],
  micah: ["Micah", "Michée", "Michee"],
  nahum: ["Nahum"],
  habakkuk: ["Habakkuk", "Habacuc"],
  zephaniah: ["Zephaniah", "Sophonie"],
  haggai: ["Haggai", "Aggée", "Aggee"],
  zechariah: ["Zechariah", "Zacharie"],
  malachi: ["Malachi", "Malachie"],
  matthew: ["Matthew", "Matthieu"],
  mark: ["Mark", "Marc"],
  luke: ["Luke", "Luc"],
  john: ["John", "Jean"],
  acts: ["Acts", "Actes"],
  romans: ["Romans", "Romains"],
  corinthians: [
    "Corinthians",
    "Corinthiens",
    "1 Corinthians",
    "2 Corinthians",
    "1 Corinthiens",
    "2 Corinthiens",
  ],
  galatians: ["Galatians", "Galates"],
  ephesians: ["Ephesians", "Éphésiens", "Ephesiens"],
  philippians: ["Philippians", "Philippiens"],
  colossians: ["Colossians", "Colossiens"],
  thessalonians: [
    "Thessalonians",
    "Thessaloniciens",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Thessaloniciens",
    "2 Thessaloniciens",
  ],
  timothy: [
    "Timothy",
    "Timothée",
    "Timothee",
    "1 Timothy",
    "2 Timothy",
    "1 Timothée",
    "2 Timothée",
  ],
  titus: ["Titus", "Tite"],
  philemon: ["Philemon", "Philémon", "Philemon"],
  hebrews: ["Hebrews", "Hébreux", "Hebreux"],
  james: ["James", "Jacques"],
  peter: ["Peter", "Pierre", "1 Peter", "2 Peter", "1 Pierre", "2 Pierre"],
  jude: ["Jude"],
  revelation: ["Revelation", "Apocalypse"],
};

function buildBookRegexes(book?: string): RegExp[] {
  if (!book) return [];

  const normalized = normalizeLoose(book);
  const compact = normalized.replace(/\s+/g, "");
  const variants = BOOK_ALIASES[compact] ?? BOOK_ALIASES[normalized] ?? [book];

  return variants.map((variant) => new RegExp(`^${escapeRegex(variant)}$`, "i"));
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalizeLoose(text);
  const normalizedPhrase = normalizeLoose(phrase);

  const rx = new RegExp(
    `(^|[^a-z0-9])${escapeRegex(normalizedPhrase)}([^a-z0-9]|$)`,
    "i"
  );

  return rx.test(normalizedText);
}

/**
 * Performance-safe fallback entity extraction:
 * - no full-collection scan
 * - candidate retrieval by verse/query tokens
 */
async function extractMentionedEntities(
  texts: string[],
  entitiesCol: Collection<EntityDoc>,
  query: string
): Promise<string[]> {
  if (!texts.length) return [];

  const combinedText = texts.join(" ");
  const tokens = Array.from(
    new Set([...tokenizeQuery(combinedText), ...tokenizeQuery(query)])
  ).slice(0, 32);

  if (!tokens.length) return [];

  const tokenRegexes = tokens.map((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, "i"));

  const candidateEntities = await entitiesCol
    .find(
      {
        $or: [
          { name: { $in: tokenRegexes } },
          { aliases: { $elemMatch: { $in: tokenRegexes } } },
        ],
      },
      { projection: { slug: 1, name: 1, aliases: 1 } }
    )
    .limit(200)
    .toArray();

  const mentioned = new Set<string>();
  for (const entity of candidateEntities) {
    const labels = [entity.name, ...(entity.aliases ?? [])].filter(Boolean);
    if (labels.some((label) => containsNormalizedPhrase(combinedText, label))) {
      mentioned.add(entity.slug);
    }
  }

  return Array.from(mentioned);
}

function dedupeRelations(
  relations: Array<{ type: string; targetName: string; targetSlug: string }>
) {
  const seen = new Set<string>();
  const out: Array<{ type: string; targetName: string; targetSlug: string }> = [];

  for (const relation of relations) {
    const key = `${normalizeLoose(relation.type)}::${normalizeLoose(
      relation.targetSlug || relation.targetName
    )}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relation);
  }

  return out;
}

const GENERIC_ENTITY_NAMES = new Set(
  [
    "fils",
    "fille",
    "homme",
    "femme",
    "pere",
    "mere",
    "seigneur",
    "serviteur",
    "serviteurs",
    "roi",
    "reine",
    "peuple",
    "disciples",
    "anges",
  ].map(normalizeLoose)
);

function isGenericEntityName(name: string): boolean {
  return GENERIC_ENTITY_NAMES.has(normalizeLoose(name));
}

function looksAutoOrphanDescription(description?: string): boolean {
  if (!description) return false;
  const d = normalizeLoose(description);
  return d.includes("relation orpheline") || d.includes("entite creee automatiquement");
}

function hasQueryTokenOverlap(fact: EntityFact, queryTokens: string[]): boolean {
  if (!queryTokens.length) return false;
  const labelText = [fact.name, ...(fact.aliases ?? [])].filter(Boolean).join(" ");
  const labelTokens = new Set(tokenizeQuery(labelText));
  return queryTokens.some((t) => labelTokens.has(t));
}

function scoreAndFilterEntityFacts(
  facts: EntityFact[],
  verses: VerseResult[],
  query: string
): EntityFact[] {
  if (!facts.length) return [];

  const verseText = verses.map((v) => v.text).join(" ");
  const queryNorm = normalizeLoose(query);
  const queryTokens = tokenizeQuery(query);

  const scored = facts.map((fact) => {
    const labels = [fact.name, ...(fact.aliases ?? [])].filter(Boolean);

    const inVerses = labels.some((l) => containsNormalizedPhrase(verseText, l));
    const inQuery = labels.some((l) => containsNormalizedPhrase(queryNorm, l));
    const tokenOverlap = hasQueryTokenOverlap(fact, queryTokens);

    if (!inQuery && !tokenOverlap) return { fact, score: -999 };

    let score = 0;
    if (inVerses) score += 3;
    if (inQuery) score += 4;
    if (tokenOverlap) score += 2;

    const relationCount = fact.relations?.length ?? 0;
    score += Math.min(1.5, relationCount * 0.1);

    if ((fact.description ?? "").length > 20) score += 0.5;

    const slugKey = normalizeLoose(fact.slug);

    if (isGenericEntityName(fact.name)) {
      const strongGenericAnchor = inVerses && relationCount >= 2 && (inQuery || tokenOverlap);
      if (!strongGenericAnchor) return { fact, score: -999 };
      score -= 2;
    }

    if (looksAutoOrphanDescription(fact.description)) score -= 3;
    if (PER_VERSE_SLUG_RX.test(slugKey)) score -= 2;

    return { fact, score };
  });

  const positive = scored
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score);

  const byName = new Map<string, { fact: EntityFact; score: number }>();
  for (const item of positive) {
    const key = normalizeLoose(item.fact.name);
    const prev = byName.get(key);
    if (!prev || item.score > prev.score) byName.set(key, item);
  }

  return Array.from(byName.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ fact }) => ({
      ...fact,
      relations: dedupeRelations(fact.relations ?? []).slice(0, 15),
    }));
}

async function getQueryEmbedding(query: string): Promise<number[]> {
  const key = normalizeLoose(query);
  const cached = getCacheValue(embeddingCache, key);
  if (cached) return cached;

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const vector = embeddingResponse.data[0].embedding;
  setCacheWithCap(embeddingCache, key, vector, EMBEDDING_CACHE_TTL_MS, EMBEDDING_CACHE_MAX);
  return vector;
}

export class HybridRetriever {
  private versesCol: Collection<VectorDoc>;
  private entitiesCol: Collection<EntityDoc>;
  private relationsCol: Collection<RelationDoc>;

  constructor(db: Db) {
    this.versesCol = db.collection<VectorDoc>("verses");
    this.entitiesCol = db.collection<EntityDoc>("entities");
    this.relationsCol = db.collection<RelationDoc>("relations");
  }

  async vectorSearch(
    query: string,
    k: number,
    filters?: { testament?: string; book?: string }
  ): Promise<RankedVerseResult[]> {
    const queryVector = await getQueryEmbedding(query);
    const testamentRx = buildTestamentRegex(filters?.testament);
    const bookRxs = buildBookRegexes(filters?.book);

    const pipeline: Record<string, unknown>[] = [
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(120, k * 30),
          limit: Math.max(24, k * 8),
        },
      },
    ];

    const andClauses: Record<string, unknown>[] = [];
    if (bookRxs.length) andClauses.push({ book: { $in: bookRxs } });
    if (testamentRx) andClauses.push({ "metadata.testament": testamentRx });

    if (andClauses.length) pipeline.push({ $match: { $and: andClauses } });

    pipeline.push({
      $project: {
        _id: 1,
        id: 1,
        book: 1,
        chapter: 1,
        verse: 1,
        text: 1,
        metadata: 1,
        entity_slugs: 1,
        score: { $meta: "vectorSearchScore" },
      },
    });

    const docs = await this.versesCol.aggregate<ProjectedVerseDoc>(pipeline).toArray();

    return docs.slice(0, k).map((doc) => ({
      id: toId(doc._id),
      text: doc.text,
      reference: buildReference(doc),
      score: doc.score ?? 0,
      source: "vector" as const,
      entitySlugs: doc.entity_slugs ?? [],
    }));
  }

  async graphSearch(
    query: string,
    k: number,
    filters?: { testament?: string; book?: string }
  ): Promise<RankedVerseResult[]> {
    const tokens = tokenizeQuery(query);
    if (!tokens.length) return [];

    const keywordRegexes = tokens.map((token) => new RegExp(`\\b${escapeRegex(token)}\\b`, "i"));
    const testamentRx = buildTestamentRegex(filters?.testament);
    const bookRxs = buildBookRegexes(filters?.book);

    const matchedEntities = await this.entitiesCol
      .find(
        {
          $or: [
            { name: { $in: keywordRegexes } },
            { aliases: { $elemMatch: { $in: keywordRegexes } } },
          ],
        },
        { projection: { slug: 1, name: 1, aliases: 1 } }
      )
      .limit(120)
      .toArray();

    if (!matchedEntities.length) return [];

    const entitySlugs = matchedEntities.map((entity) => entity.slug);

    const andClauses: Record<string, unknown>[] = [{ entity_slugs: { $in: entitySlugs } }];
    if (bookRxs.length) andClauses.push({ book: { $in: bookRxs } });
    if (testamentRx) andClauses.push({ "metadata.testament": testamentRx });

    const primaryDocs = await this.versesCol
      .find(
        { $and: andClauses },
        {
          projection: {
            _id: 1,
            book: 1,
            chapter: 1,
            verse: 1,
            text: 1,
            entity_slugs: 1,
          },
        }
      )
      .limit(k)
      .toArray();

    let docs = primaryDocs;

    // Fallback regex only when no primary hit.
    if (docs.length === 0) {
      const fallbackLabels = matchedEntities
        .flatMap((e) => [e.name, ...(e.aliases ?? [])])
        .filter(Boolean)
        .slice(0, 6);

      if (fallbackLabels.length) {
        const textRegexes = fallbackLabels.map(
          (label) => new RegExp(`\\b${escapeRegex(label)}\\b`, "i")
        );

        const fallbackAnd: Record<string, unknown>[] = [{ $or: textRegexes.map((rx) => ({ text: rx })) }];
        if (bookRxs.length) fallbackAnd.push({ book: { $in: bookRxs } });
        if (testamentRx) fallbackAnd.push({ "metadata.testament": testamentRx });

        docs = await this.versesCol
          .find(
            { $and: fallbackAnd },
            {
              projection: {
                _id: 1,
                book: 1,
                chapter: 1,
                verse: 1,
                text: 1,
                entity_slugs: 1,
              },
            }
          )
          .limit(k)
          .toArray();
      }
    }

    return docs.slice(0, k).map((doc, index) => ({
      id: toId(doc._id),
      text: doc.text,
      reference: buildReference(doc),
      score: 1 / (index + 1),
      source: "graph" as const,
      entitySlugs: doc.entity_slugs ?? [],
    }));
  }

  async augmentWithEntityFacts(entitySlugs: string[]): Promise<EntityFact[]> {
    if (!entitySlugs.length) return [];

    const entitiesWithRelations = await this.entitiesCol
      .aggregate<AggregatedEntityDoc>([
        { $match: { slug: { $in: entitySlugs } } },
        {
          $lookup: {
            from: "relations",
            let: { entitySlug: "$slug", entityId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$source_slug", "$$entitySlug"] },
                      { $eq: ["$source_entity_id", "$$entityId"] },
                    ],
                  },
                },
              },
              {
                $lookup: {
                  from: "entities",
                  localField: "target_slug",
                  foreignField: "slug",
                  as: "targetBySlug",
                },
              },
              {
                $lookup: {
                  from: "entities",
                  localField: "target_entity_id",
                  foreignField: "_id",
                  as: "targetById",
                },
              },
              {
                $project: {
                  relation_type: 1,
                  type: 1,
                  target_slug: 1,
                  target_entity_id: 1,
                  target: {
                    $ifNull: [
                      { $arrayElemAt: ["$targetBySlug", 0] },
                      { $arrayElemAt: ["$targetById", 0] },
                    ],
                  },
                },
              },
            ],
            as: "relations",
          },
        },
        {
          $project: {
            slug: 1,
            name: 1,
            type: 1,
            description: 1,
            aliases: 1,
            relations: 1,
          },
        },
      ])
      .toArray();

    if (!entitiesWithRelations.length) return [];

    return entitiesWithRelations.map((entity) => ({
      slug: entity.slug,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      aliases: entity.aliases ?? [],
      relations: (entity.relations ?? []).map((relation) => ({
        type: relation.relation_type ?? relation.type ?? "related_to",
        targetName:
          relation.target?.name ??
          relation.target_slug ??
          (relation.target_entity_id != null ? toId(relation.target_entity_id) : ""),
        targetSlug:
          relation.target?.slug ??
          relation.target_slug ??
          (relation.target_entity_id != null ? toId(relation.target_entity_id) : ""),
      })),
    }));
  }

  async retrieve(
    query: string,
    k = 5,
    vectorWeight = 0.7,
    graphWeight = 0.3,
    minScore = 0.0,
    filters?: { testament?: string; book?: string }
  ) {
    const cacheKey = JSON.stringify({
      q: normalizeLoose(query),
      k,
      vw: vectorWeight,
      gw: graphWeight,
      ms: minScore,
      f: {
        testament: filters?.testament ? normalizeLoose(filters.testament) : undefined,
        book: filters?.book ? normalizeLoose(filters.book) : undefined,
      },
    });

    const cached = getCacheValue(retrieveCache, cacheKey);
    if (cached) {
      return {
        ...cached,
        metadata: { ...cached.metadata, cached: true },
      };
    }

    const vectorSearchK = vectorWeight <= 0.15 ? Math.max(4, k) : k * 2;
    const graphSearchK = graphWeight >= 0.8 ? Math.max(k + 2, 8) : k * 2;

    const [vectorResults, graphResults] = await Promise.all([
      vectorWeight <= 0.1 ? Promise.resolve([]) : this.vectorSearch(query, vectorSearchK, filters),
      graphWeight <= 0.25 ? Promise.resolve([]) : this.graphSearch(query, graphSearchK, filters),
    ]);

    const merged = reciprocalRankFusion(
      [vectorResults, graphResults],
      [vectorWeight, graphWeight]
    );

    const reranked = isGenealogyQuery(query) ? rerankByQueryOverlap(query, merged) : merged;
    const topMerged = reranked.filter((item) => item.score >= minScore).slice(0, k);

    let mentionedEntitySlugs = Array.from(
      new Set(topMerged.flatMap((v) => v.entitySlugs ?? []).filter(Boolean))
    );

    // Fallback only when no entity_slugs are present.
    if (!mentionedEntitySlugs.length) {
      mentionedEntitySlugs = await extractMentionedEntities(
        topMerged.map((verse) => verse.text),
        this.entitiesCol,
        query
      );
    }

    const verses: VerseResult[] = topMerged.map(({ id, text, reference, score, source }) => ({
      id,
      text,
      reference,
      score,
      source,
    }));

    const rawEntityFacts = await this.augmentWithEntityFacts(mentionedEntitySlugs);
    const entityFacts = scoreAndFilterEntityFacts(rawEntityFacts, verses, query);

    const result = {
      verses,
      entityFacts,
      metadata: {
        vectorWeight,
        graphWeight,
        totalVectorResults: vectorResults.length,
        totalGraphResults: graphResults.length,
      },
    };

    setCacheWithCap(retrieveCache, cacheKey, result, RETRIEVE_CACHE_TTL_MS, RETRIEVE_CACHE_MAX);
    return result;
  }
}