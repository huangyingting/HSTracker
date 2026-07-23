import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS } from "../support/market-analysis-production-boundary";

// Static architecture assertions for the Market Analysis presentation
// layer (spec: docs/spec/export-market-analysis-workspace.md §11.5;
// docs/spec/export-market-analysis-workspace-ui-design.md §19.5; issue
// #68). These mirror tests/integration/market-analysis-module-boundary.test.ts
// one layer up: that file proves the product-shaped domain contract has no
// question runtime machinery or copied formulas; this file proves the
// React presentation Modules built on top of it keep the same guarantees
// (issue #68 acceptance criteria: "no AQ ID, question navigation, question
// catalog, or generic Answer Card"; "React implements no Candidate Market
// Score, CAGR, supplier share, HHI, or momentum formula").

const MARKET_ANALYSIS_UI_FILES = [
  "src/app/market-analysis-client.ts",
  "src/app/market-analysis-view.tsx",
  "src/app/market-analysis-panels.tsx",
];

// Formula shapes that would prove React recomputed an already-owned
// Analysis Recipe value instead of only reading and formatting the typed
// result the recipe already produced.
const FORBIDDEN_FORMULA_PATTERNS = [
  // cms-v1's own fixed component weights, reimplemented as a literal.
  /marketSize\s*:\s*30[\s\S]{0,200}marketGrowth\s*:\s*25[\s\S]{0,200}recordedFoothold\s*:\s*25[\s\S]{0,200}supplierDiversity\s*:\s*20/u,
  // A from-scratch CAGR/compound-growth computation (Math.pow/exponent
  // over a ratio), as opposed to reading TradeTrendSummary.cagrPercent.
  /Math\.pow\([^)]*\breturn\b|Math\.pow\(\s*\([^)]*\/\s*[^)]*\)\s*,/u,
  // A from-scratch Herfindahl-Hirschman Index computation (sum of squared
  // shares), as opposed to reading SupplierCompetitionConcentration.
  /\.reduce\([^)]*\*\*\s*2/u,
  /\.reduce\([^)]*Math\.pow\([^,]+,\s*2\)/u,
  // A from-scratch momentum growth-rate/threshold computation, as opposed
  // to reading the already-typed Recent Trade Momentum result fields.
  /recentValueEur\s*[-/]\s*baselineValueEur/u,
];

const FORBIDDEN_IMPORT_PATTERNS = [
  /duckdb/iu,
  /operational-store/iu,
  /company-trade-context/iu,
  /tariff/iu,
  /logistics/iu,
  /node:https?/u,
  /trade-analytics-platform/u,
];

async function readSources(): Promise<
  readonly { path: string; source: string }[]
> {
  return Promise.all(
    MARKET_ANALYSIS_UI_FILES.map(async (path) => ({
      path,
      source: await readFile(resolve(path), "utf8"),
    })),
  );
}

describe("Market Analysis presentation boundary", () => {
  it("keeps AQ identifiers, a question catalog, and question dispatch out of the presentation Modules", async () => {
    const sources = await readSources();
    for (const { path, source } of sources) {
      for (const pattern of MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS) {
        expect(source, path).not.toMatch(pattern);
      }
    }
  });

  it("implements no Candidate Market Score, CAGR, supplier share, HHI, or momentum formula", async () => {
    const sources = await readSources();
    for (const { path, source } of sources) {
      for (const pattern of FORBIDDEN_FORMULA_PATTERNS) {
        expect(source, path).not.toMatch(pattern);
      }
    }
  });

  it("reads the selected exporter's pooled rank from MarketAnalysisV1 instead of deriving it from array order in React", async () => {
    const panelsSource = await readFile(
      resolve("src/app/market-analysis-panels.tsx"),
      "utf8",
    );

    expect(panelsSource).not.toMatch(/\bsupplierPosition\s*\(/u);
    expect(panelsSource).not.toMatch(/supplierShares\.findIndex\s*\(/u);
    expect(panelsSource).toMatch(/pooledSupplierPosition/u);
  });

  it("imports no evidence source, DuckDB, operational store, Company Trade Context, tariff, logistics, or the platform seam directly", async () => {
    const sources = await readSources();
    for (const { path, source } of sources) {
      const importSpecifiers = [
        ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ].map((match) => match[1]);
      expect(source, path).not.toMatch(/\bfetch\s*\(/u);
      for (const specifier of importSpecifiers) {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          expect(specifier, path).not.toMatch(pattern);
        }
      }
    }
  });

  it("orders product areas and Validation Plan categories from the shared product-shaped constants, not a second hard-coded list", async () => {
    const viewSource = await readFile(
      resolve("src/app/market-analysis-view.tsx"),
      "utf8",
    );
    expect(viewSource).toMatch(
      /import\s*\{\s*MARKET_ANALYSIS_PRODUCT_AREAS\s*\}\s*from\s*["']\.\.\/domain\/market-analysis\/product-areas["']/u,
    );

    const panelsSource = await readFile(
      resolve("src/app/market-analysis-panels.tsx"),
      "utf8",
    );
    expect(panelsSource).toMatch(
      /MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES/u,
    );
    // The five categories are mapped, not individually re-declared.
    expect(panelsSource).not.toMatch(/QUANTITY_AND_CUSTOMS_UNIT_VALUE.*label/su);
  });

  it("keeps the Market Snapshot score audit view free of a second cms-v1 weighting table", async () => {
    const panelsSource = await readFile(
      resolve("src/app/market-analysis-panels.tsx"),
      "utf8",
    );
    // Weights are read from the already-computed
    // MarketOpportunityEvidence.weights projection, never re-declared as
    // numeric literals in the presentation layer.
    expect(panelsSource).not.toMatch(/marketSize:\s*30/u);
    expect(panelsSource).not.toMatch(/marketGrowth:\s*25/u);
  });
});
