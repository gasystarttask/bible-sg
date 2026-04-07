import { describe, expect, it } from "vitest";
import { assembleHybridContext, buildGroundedSystemPrompt, isOutOfDomainQuery, generateGroundedAnswer } from "@search/lib/context-injection";

describe("context-injection", () => {
  it("assembles verses and entity relations into readable context", () => {
    const context = assembleHybridContext(
      [
        {
          id: "v1",
          text: "Fils de Rachel, femme de Jacob: Joseph et Benjamin.",
          reference: "Genèse 46:19",
          score: 0.2,
          source: "hybrid",
        },
      ],
      [
        {
          slug: "joseph",
          name: "Joseph",
          type: "Person",
          aliases: ["Yossef"],
          relations: [
            {
              type: "MOTHER_OF",
              targetName: "Manassé",
              targetSlug: "manasse",
            },
          ],
        },
      ]
    );

    expect(context.text).toContain("[Genèse 46:19]");
    expect(context.text).toContain("Entity: Joseph (Person)");
    expect(context.text).toContain("PARENT_OF -> Manassé");
    expect(context.text).toContain("Yossef => Joseph");
    expect(context.references).toEqual(["Genèse 46:19"]);
  });

  it("builds strict grounding prompt rules in French", () => {
    const prompt = buildGroundedSystemPrompt();

    expect(prompt).toContain("N'utilise aucune connaissance extérieure");
    expect(prompt).toContain("Je ne sais pas d'après les Écritures fournies.");
    expect(prompt).toContain("[Livre Chapitre:Verset]");
    expect(prompt).toContain("Pas de prédication");
  });

  it("includes graph relation exploitation instruction", () => {
    const prompt = buildGroundedSystemPrompt();

    expect(prompt).toContain("SON_OF");
    expect(prompt).toContain("[Graph]");
    expect(prompt).toContain("Graphe de connaissances");
  });

  it("includes Markdown formatting instruction in French", () => {
    const prompt = buildGroundedSystemPrompt();

    expect(prompt).toContain("gras");
    expect(prompt).toContain("**nom**");
  });

  it("includes knowledge graph noise warning note", () => {
    const prompt = buildGroundedSystemPrompt();

    expect(prompt).toContain("bruits ou des relations erronées");
    expect(prompt).toContain("extraction automatique");
    expect(prompt).toContain("bon sens théologique");
  });

  it("detects out-of-domain queries", () => {
    expect(isOutOfDomainQuery("Qui est Elon Musk dans la Bible ?")).toBe(true);
    expect(isOutOfDomainQuery("Qui est Einstein ?")).toBe(true);
    expect(isOutOfDomainQuery("Qui est Jésus ?")).toBe(false);
    expect(isOutOfDomainQuery("Qui est le fils de Joseph ?")).toBe(false);
  });

  it("returns uncertain for out-of-domain query without calling OpenAI", async () => {
    const result = await generateGroundedAnswer({
      query: "Qui est Elon Musk dans la Bible ?",
      verses: [],
      entityFacts: [],
    });

    expect(result.uncertain).toBe(true);
    expect(result.answer).toBe("Je ne sais pas d'après les Écritures fournies.");
    expect(result.citations).toHaveLength(0);
  });
});
