import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve("src");
const candidateMarketModule = resolve("src/domain/candidate-market");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );

  return files.flat().filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

describe("Candidate Market module boundary", () => {
  it("keeps scoring formulas out of routes, adapters, and UI code", async () => {
    const files = (await sourceFiles(sourceRoot)).filter(
      (path) => !path.startsWith(`${candidateMarketModule}${sep}`),
    );
    const forbiddenFormulaPatterns = [
      /from\s+["'][^"']*candidate-market\/cms-v1["']/,
      /marketSize\s*:\s*30[\s\S]{0,200}marketGrowth\s*:\s*25[\s\S]{0,200}recordedFoothold\s*:\s*25[\s\S]{0,200}supplierDiversity\s*:\s*20/,
      /(?:0\.3|0\.25|0\.2)\s*\*\s*[^;\n]*percentile/,
    ];

    for (const path of files) {
      const source = await readFile(path, "utf8");
      for (const pattern of forbiddenFormulaPatterns) {
        expect(source, relative(sourceRoot, path)).not.toMatch(pattern);
      }
    }
  });
});
