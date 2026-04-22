import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openApiSpec } from "@search/openapi/spec";

async function main(): Promise<void> {
  const outputDir = path.resolve(process.cwd(), "public");
  const outputPath = path.join(outputDir, "openapi.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(openApiSpec, null, 2)}\n`, "utf-8");

  console.log(`OpenAPI spec generated at ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate OpenAPI spec", error);
  process.exit(1);
});
