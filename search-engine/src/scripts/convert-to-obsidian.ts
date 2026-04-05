import fs from 'node:fs';
import path from 'node:path';

interface CliOptions {
  inputPath: string;
  outputDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key?.startsWith('--') && val && !val.startsWith('--')) {
      args.set(key, val);
      i += 1;
    }
  }

  const inputPath = args.get('--input') ?? '../data/raw_graph.GEN.json';
  const outputDir = args.get('--output') ?? '../data/bible_obsidian_vault';

  return { inputPath, outputDir };
}

function main(): void {
  const { inputPath, outputDir } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);

  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Créer un fichier par entité
  data.merged_entities.forEach((entity: any) => {
    const content = `# ${entity.name}\n\n` +
      `**Type**: ${entity.type}\n` +
      `**Description**: ${entity.description}\n` +
      `**Source**: ${entity.source_verse_id}\n\n` +
      `## Relations\n`;

    fs.writeFileSync(path.join(outputDir, `${entity.slug}.md`), content, 'utf8');
  });

  // 2. Ajouter les liens (relations) dans les fichiers
  data.chapters.forEach((chapter: any) => {
    chapter.relations.forEach((rel: any) => {
      const sourceFile = path.join(outputDir, `${rel.source_slug}.md`);
      if (fs.existsSync(sourceFile)) {
        const link = `- **${rel.relation_type}** -> [[${rel.target_slug}]] (v. ${rel.evidence_verse_id})\n`;
        fs.appendFileSync(sourceFile, link, 'utf8');
      }
    });
  });

  console.log(`✅ Vault Obsidian généré dans ${outputDir}`);
}

main();