import OpenAI from "openai";
import type { EntityFact, VerseResult } from "@search/types/hybrid";

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

const DEFAULT_MODEL = process.env.GROUNDED_ANSWER_MODEL ?? "gpt-4o-mini";
const UNKNOWN_RESPONSE = "Je ne sais pas d'après les Écritures fournies.";
const PROMPT_VERSION = "us-010.v2";

const OUT_OF_DOMAIN_MARKERS = [
  "elon musk", "einstein", "napoleon", "hitler", "newton", "shakespeare",
  "bitcoin", "internet", "computer", "robot", "artificial intelligence",
  "intelligence artificielle", "ordinateur", "scientifique moderne",
];

export function isOutOfDomainQuery(query: string): boolean {
  const q = query.toLowerCase();
  return OUT_OF_DOMAIN_MARKERS.some((marker) => q.includes(marker));
}

export interface AssembledContext {
  text: string;
  references: string[];
}

export interface GroundedAnswerResult {
  answer: string;
  citations: string[];
  uncertain: boolean;
  model: string;
  promptVersion: string;
}

export interface StreamGroundedAnswerInput {
  query: string;
  verses: VerseResult[];
  entityFacts: EntityFact[];
  model?: string;
  onToken: (token: string) => void;
}

function normalizeLoose(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function canonicalizeRelationType(rawType: string): string {
  const normalized = normalizeLoose(rawType).replace(/\s+/g, "_");
  if (normalized === "mother_of" || normalized === "father_of") {
    return "PARENT_OF";
  }
  return rawType.toUpperCase();
}

export function assembleHybridContext(verses: VerseResult[], entityFacts: EntityFact[]): AssembledContext {
  const verseLines = verses.map((verse) => `[${verse.reference}] ${verse.text}`);
  const aliasLines: string[] = [];

  const entityLines = entityFacts.map((entity) => {
    const aliases = (entity.aliases ?? []).filter(Boolean);
    for (const alias of aliases) {
      aliasLines.push(`${alias} => ${entity.name}`);
    }

    const relationLines = (entity.relations ?? [])
      .slice(0, 12)
      .map((relation) => {
        const relationType = canonicalizeRelationType(relation.type || "RELATED_TO");
        return `- ${relationType} -> ${relation.targetName}`;
      });

    return [
      `Entity: ${entity.name} (${entity.type})`,
      entity.description ? `Description: ${entity.description}` : undefined,
      aliases.length ? `Aliases: ${aliases.join(", ")}` : undefined,
      relationLines.length ? "Relations:" : undefined,
      ...relationLines,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const text = [
    "# Context",
    "## Scriptures",
    ...verseLines,
    "",
    "## Knowledge Graph",
    ...entityLines,
    "",
    "## Alias Mapping",
    ...(aliasLines.length ? aliasLines : ["(none)"]),
  ].join("\n");

  return {
    text,
    references: verses.map((verse) => verse.reference),
  };
}

function extractCitations(answer: string): string[] {
  const matches = answer.match(/\[([^\]]+)\]/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

function validateCitations(citations: string[], allowedReferences: string[]): boolean {
  if (!citations.length) return false;

  const allowed = new Set(allowedReferences.map((ref) => normalizeLoose(ref)));
  return citations.every((citation) => allowed.has(normalizeLoose(citation)));
}

export function buildGroundedSystemPrompt(): string {
  return [
    "Rôle : Assistant biblique universitaire.",
    "Ta base de connaissances est UNIQUEMENT le Contexte fourni (Écritures + Graphe de connaissances).",
    "N'utilise aucune connaissance extérieure pour les affirmations factuelles.",
    "Si le sujet n'est pas présent dans le contexte (ex : personnages modernes, événements contemporains, technologie), réponds avec la phrase exacte : Je ne sais pas d'après les Écritures fournies.",
    "Si la réponse n'est que partiellement présente, réponds également : Je ne sais pas d'après les Écritures fournies. Ne spécule pas.",
    "Pour chaque affirmation factuelle, inclus au moins une citation au format [Livre Chapitre:Verset].",
    "Ne cite que les références présentes dans le contexte fourni. N'invente jamais de référence.",
    "Utilise les alias et les relations du Graphe de connaissances pour lever les ambiguïtés (exemple : Christ = Jésus, Fils de l'homme = Jésus).",
    "Exploite explicitement les relations du graphe pour enrichir la réponse : si le graphe indique que X est SON_OF Y, inclus ce fait avec une citation ou la mention [Graph].",
    "Formate la réponse en Markdown : mets en gras (**nom**) toutes les entités nommées (personnes, lieux) à leur première apparition. Conserve le format [citation] en ligne.",
    "Pas de prédication, pas d'interprétation au-delà du texte. Analyse factuelle uniquement.",
    "Note : Les données du graphe de connaissances peuvent contenir des bruits ou des relations erronées dues à l'extraction automatique. Priorise toujours le texte des versets et utilise ton bon sens théologique pour ignorer les relations incohérentes (ex : parenté inversée ou relations absurdes).",
    "Retourne un JSON : { \"answer\": string, \"usedReferences\": string[] }",
  ].join(" ");
}

function buildGroundedStreamingSystemPrompt(): string {
  return [
    "Rôle : Assistant biblique universitaire.",
    "Ta base de connaissances est UNIQUEMENT le Contexte fourni (Écritures + Graphe de connaissances).",
    "N'utilise aucune connaissance extérieure pour les affirmations factuelles.",
    "Si le sujet n'est pas présent dans le contexte, réponds exactement : Je ne sais pas d'après les Écritures fournies.",
    "Pour chaque affirmation factuelle, ajoute des citations inline au format [Livre Chapitre:Verset].",
    "Ne cite que les références présentes dans le contexte fourni.",
    "Utilise les alias et relations du graphe pour résoudre les ambiguïtés (ex : Christ = Jésus).",
    "Formate la réponse en Markdown et mets en gras (**nom**) les entités nommées à leur première apparition.",
    "Pas de JSON. Retourne uniquement le texte final de la réponse.",
  ].join(" ");
}

export async function generateGroundedAnswerStream(input: StreamGroundedAnswerInput): Promise<GroundedAnswerResult> {
  const model = input.model ?? DEFAULT_MODEL;

  if (isOutOfDomainQuery(input.query)) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  if (!process.env.GITHUB_TOKEN) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  const context = assembleHybridContext(input.verses, input.entityFacts);

  if (!context.references.length) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  const openai = createCopilotClient();

  try {
    const stream = await openai.chat.completions.create({
      model,
      temperature: 0,
      stream: true,
      messages: [
        { role: "system", content: buildGroundedStreamingSystemPrompt() },
        {
          role: "user",
          content: [
            `Question: ${input.query}`,
            "",
            "Context:",
            context.text,
          ].join("\n"),
        },
      ],
    });

    let answer = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (!token) continue;
      answer += token;
      input.onToken(token);
    }

    const cleaned = answer.trim() || UNKNOWN_RESPONSE;
    const citations = extractCitations(cleaned);
    const isUncertain = cleaned === UNKNOWN_RESPONSE;
    const valid = isUncertain || validateCitations(citations, context.references);

    if (!valid) {
      return {
        answer: UNKNOWN_RESPONSE,
        citations: [],
        uncertain: true,
        model,
        promptVersion: PROMPT_VERSION,
      };
    }

    return {
      answer: cleaned,
      citations,
      uncertain: isUncertain,
      model,
      promptVersion: PROMPT_VERSION,
    };
  } catch {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }
}

export async function generateGroundedAnswer(input: {
  query: string;
  verses: VerseResult[];
  entityFacts: EntityFact[];
  model?: string;
}): Promise<GroundedAnswerResult> {
  const model = input.model ?? DEFAULT_MODEL;

  if (isOutOfDomainQuery(input.query)) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  if (!process.env.GITHUB_TOKEN) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  const context = assembleHybridContext(input.verses, input.entityFacts);

  if (!context.references.length) {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }

  const openai = createCopilotClient();

  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildGroundedSystemPrompt() },
        {
          role: "user",
          content: [
            `Question: ${input.query}`,
            "",
            "Context:",
            context.text,
          ].join("\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return {
        answer: UNKNOWN_RESPONSE,
        citations: [],
        uncertain: true,
        model,
        promptVersion: PROMPT_VERSION,
      };
    }

    const parsed = JSON.parse(content) as { answer?: string; usedReferences?: string[] };
    const answer = parsed.answer?.trim() || UNKNOWN_RESPONSE;
    const inlineCitations = extractCitations(answer);
    const references = (parsed.usedReferences ?? []).filter(Boolean);
    const citations = inlineCitations.length ? inlineCitations : references;

    const isUncertain = answer === UNKNOWN_RESPONSE;
    const valid = isUncertain || validateCitations(citations, context.references);

    if (!valid) {
      return {
        answer: UNKNOWN_RESPONSE,
        citations: [],
        uncertain: true,
        model,
        promptVersion: PROMPT_VERSION,
      };
    }

    return {
      answer,
      citations,
      uncertain: answer === UNKNOWN_RESPONSE,
      model,
      promptVersion: PROMPT_VERSION,
    };
  } catch {
    return {
      answer: UNKNOWN_RESPONSE,
      citations: [],
      uncertain: true,
      model,
      promptVersion: PROMPT_VERSION,
    };
  }
}
