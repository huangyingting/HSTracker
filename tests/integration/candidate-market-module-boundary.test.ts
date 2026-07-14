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
  it("exposes no obsolete Candidate Market analytical entry point", async () => {
    const files = await sourceFiles(sourceRoot);
    const testFiles = await sourceFiles(resolve("tests"));
    const sources = await Promise.all(
      files.map(async (path) => ({
        path,
        source: await readFile(path, "utf8"),
      })),
    );

    expect(
      files.map((path) => relative(sourceRoot, path)),
    ).not.toContain("domain/candidate-market/analyze-candidate-markets.ts");
    expect(
      sources
        .filter(({ source }) =>
          source.includes("candidate-market-v1-recipe"),
        )
        .map(({ path }) => relative(sourceRoot, path)),
    ).toEqual(["domain/trade-analytics/trade-analytics-platform.ts"]);
    for (const { path, source } of sources) {
      expect(source, relative(sourceRoot, path)).not.toMatch(
        /\binterface\s+CandidateMarketAnalysis\b/u,
      );
      expect(source, relative(sourceRoot, path)).not.toMatch(
        /\bruntime\.analyze\s*\(/u,
      );
    }

    const applicationRuntime = sources.find(({ path }) =>
      path.endsWith("runtime/application-runtime.ts"),
    )?.source;
    expect(applicationRuntime).not.toMatch(
      /^\s*analyze\s*\(/mu,
    );

    for (const path of testFiles) {
      if (path.endsWith("candidate-market-module-boundary.test.ts")) {
        continue;
      }
      const source = await readFile(path, "utf8");
      expect(source, relative(resolve("tests"), path)).not.toMatch(
        /analyze-candidate-markets|\.analyze\s*\(/u,
      );
    }
  });

  it("routes public Candidate Market representations through the platform Adapter", async () => {
    const routes = await Promise.all(
      [
        "src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route.ts",
        "src/app/api/v1/analyses/[analysisBuildId]/candidate-markets.csv/route.ts",
      ].map((path) => readFile(resolve(path), "utf8")),
    );

    for (const route of routes) {
      expect(route).toMatch(/executeCandidateMarketV1/u);
      expect(route).not.toMatch(/runtime\.analyze\s*\(/u);
    }
  });

  it("keeps scoring formulas out of routes, adapters, and UI code", async () => {
    const files = (await sourceFiles(sourceRoot)).filter(
      (path) =>
        !path.startsWith(`${candidateMarketModule}${sep}`) &&
        !path.endsWith(
          "domain/trade-analytics/candidate-market-v1-recipe.ts",
        ),
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
