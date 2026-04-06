# convert-to-obsidian.ts

## Purpose
`src/scripts/convert-to-obsidian.ts` converts a raw graph JSON file into an Obsidian vault:
- one Markdown file per entity
- relation links appended to source entity files

## Input / Output
- **Input**: JSON matching `RawGraphOutput`
- **Output**: a folder of `.md` files (one per `entity.slug`)

Default values:
- `--input`: `../data/raw_graph.GEN.json`
- `--output`: `../data/bible_obsidian_vault`

## CLI usage

```bash
node dist/scripts/convert-to-obsidian.js --input ../data/raw_graph.GEN.json --output ../data/bible_obsidian_vault
```

If using ts-node:

```bash
npx ts-node src/scripts/convert-to-obsidian.ts --input ../data/raw_graph.GEN.json --output ../data/bible_obsidian_vault
```

## Generated file format
For each entity:
- Title: `# {name}`
- Metadata:
  - Type
  - Description
  - Source verse id
- `## Relations` section

For each relation:
- Appends line to source file:
  - `- **{relation_type}** -> [[{target_slug}]] (v. {evidence_verse_id})`

## Notes
- The script creates the output directory if missing.
- Relation links are appended only if the source entity file exists.
- Ensure your JSON contains `merged_entities` and `chapters[].relations`.