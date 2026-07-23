import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS } from "../support/market-analysis-production-boundary";

const sourceRoot = resolve("src");
const marketAnalysisModule = resolve("src/domain/market-analysis");

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

// The exact top-level MarketAnalysisV1 keys the contract owns (spec §5.3).
// A product-level score, aggregate confidence, probability, recommendation,
// generated timestamp, or composite Analysis Identity would violate the
// closed contract, so those literal keys must never appear as a top-level
// property of the type literal.
const FORBIDDEN_MARKET_ANALYSIS_V1_KEYS = [
  "recommendation",
  "aggregateConfidence",
  "probability",
  "generatedAt",
  "compositeAnalysisIdentity",
  "recentMomentum",
];

describe("Market Analysis module boundary", () => {
  it("keeps AQ identifiers, a question catalog, and question dispatch out of every production source file", async () => {
    const files = await sourceFiles(sourceRoot);
    const sources = await Promise.all(
      files.map(async (path) => ({
        path,
        source: await readFile(path, "utf8"),
      })),
    );

    for (const { path, source } of sources) {
      for (const pattern of MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS) {
        expect(source, relative(sourceRoot, path)).not.toMatch(pattern);
      }
    }
  });

  it("declares MarketAnalysisV1 with no product-level score, aggregate confidence, probability, recommendation, generated timestamp, or composite identity", async () => {
    const resultSource = await readFile(
      resolve(marketAnalysisModule, "result.ts"),
      "utf8",
    );
    const typeStart = resultSource.indexOf("export type MarketAnalysisV1");
    const typeEnd = resultSource.indexOf("}>;", typeStart) + 3;
    const typeBody = resultSource.slice(typeStart, typeEnd);

    for (const forbidden of FORBIDDEN_MARKET_ANALYSIS_V1_KEYS) {
      expect(typeBody, forbidden).not.toMatch(
        new RegExp(`\\b${forbidden}\\s*:`, "u"),
      );
    }
    // A bare `score:` (as opposed to the reused `candidate.score`, which is
    // nested inside MarketOpportunityEvidence, not a top-level key) must not
    // appear as one of MarketAnalysisV1's own top-level fields either.
    expect(typeBody).not.toMatch(/\n {2}score\s*:/u);
  });

  it("keeps Validation Plan categories as closed structural data with no executable evidence handler", async () => {
    const validationPlanSource = await readFile(
      resolve(marketAnalysisModule, "validation-plan.ts"),
      "utf8",
    );
    const codeOnly = validationPlanSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    expect(codeOnly).not.toMatch(/\bfetch\s*\(/u);
    expect(codeOnly).not.toMatch(/adapter/iu);
    expect(codeOnly).not.toMatch(/handler/iu);
    expect(codeOnly).not.toMatch(/\bcredential/iu);
    expect(codeOnly).not.toMatch(/\broute\b/iu);
    expect(codeOnly).not.toMatch(/^import\s/mu);
  });

  it("imports no evidence source, DuckDB, operational store, Company Trade Context, tariff, logistics, or external HTTP client in the market-analysis contract module", async () => {
    const files = await sourceFiles(marketAnalysisModule);
    const forbiddenImportSpecifierPatterns = [
      /duckdb/iu,
      /operational-store/iu,
      /company-trade-context/iu,
      /tariff/iu,
      /logistics/iu,
      /node:https?/u,
    ];

    for (const path of files) {
      const source = await readFile(path, "utf8");
      const importSpecifiers = [
        ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ].map((match) => match[1]);
      // A direct network call would bypass every existing Adapter, so a bare
      // `fetch(` is checked across the whole file, not just import lines.
      expect(source, relative(sourceRoot, path)).not.toMatch(/\bfetch\s*\(/u);
      for (const specifier of importSpecifiers) {
        for (const pattern of forbiddenImportSpecifierPatterns) {
          expect(specifier, relative(sourceRoot, path)).not.toMatch(pattern);
        }
      }
    }
  });

  it("keeps scoring formulas out of the market-analysis contract module", async () => {
    const files = await sourceFiles(marketAnalysisModule);
    const forbiddenFormulaPatterns = [
      /from\s+["'][^"']*candidate-market\/cms-v1["']/u,
      /marketSize\s*:\s*30[\s\S]{0,200}marketGrowth\s*:\s*25[\s\S]{0,200}recordedFoothold\s*:\s*25[\s\S]{0,200}supplierDiversity\s*:\s*20/u,
      /(?:0\.3|0\.25|0\.2)\s*\*\s*[^;\n]*percentile/u,
    ];

    for (const path of files) {
      const source = await readFile(path, "utf8");
      for (const pattern of forbiddenFormulaPatterns) {
        expect(source, relative(sourceRoot, path)).not.toMatch(pattern);
      }
    }
  });

  it("keeps the AQ-01..AQ-20 traceability fixture out of src/ entirely", async () => {
    const files = await sourceFiles(sourceRoot);
    expect(
      files.some((path) => path.endsWith(`${sep}market-analysis-analyst-needs.ts`)),
    ).toBe(false);
  });
});
