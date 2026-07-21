import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ANALYST_NEEDS_TRACEABILITY } from "../support/market-analysis-analyst-needs";
import { MARKET_ANALYSIS_COPY } from "../../src/domain/market-analysis/copy";

const VALID_CAPABILITIES = new Set<string>([
  "Scope",
  "Opportunities",
  ...Object.values(MARKET_ANALYSIS_COPY.en.productAreas),
]);

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

describe("Analyst-needs traceability (AQ-01..AQ-20)", () => {
  it("has exactly 20 rows with unique AQ-01..AQ-20 identifiers", () => {
    expect(ANALYST_NEEDS_TRACEABILITY).toHaveLength(20);

    const ids = ANALYST_NEEDS_TRACEABILITY.map((row) => row.id);
    expect(new Set(ids).size).toBe(20);
    expect([...ids].sort()).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `AQ-${String(index + 1).padStart(2, "0")}`,
      ),
    );
  });

  it("is exactly 10 DIRECT, 5 BOUNDED, and 5 OUTSIDE", () => {
    const counts = { DIRECT: 0, BOUNDED: 0, OUTSIDE: 0 };
    for (const row of ANALYST_NEEDS_TRACEABILITY) {
      counts[row.coverage] += 1;
    }

    expect(counts).toEqual({ DIRECT: 10, BOUNDED: 5, OUTSIDE: 5 });
  });

  it("names only capabilities that exist in the product's Scope/Opportunities stages or its eight Market Analysis product areas", () => {
    for (const row of ANALYST_NEEDS_TRACEABILITY) {
      expect(row.capabilities.length).toBeGreaterThan(0);
      for (const capability of row.capabilities) {
        expect(VALID_CAPABILITIES.has(capability)).toBe(true);
      }
    }
  });

  it("gives every row a non-empty need statement and limitation/interpretation note", () => {
    for (const row of ANALYST_NEEDS_TRACEABILITY) {
      expect(row.need.trim().length).toBeGreaterThan(0);
      expect(row.limitation.trim().length).toBeGreaterThan(0);
    }
  });

  it("never lets AQ identifiers or this fixture leak into production source", async () => {
    const files = await sourceFiles(resolve("src"));
    const sources = await Promise.all(
      files.map(async (path) => readFile(path, "utf8")),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/AQ-\d{2}/u);
      expect(source).not.toMatch(/market-analysis-analyst-needs/u);
      expect(source).not.toMatch(/AnalystQuestionId/u);
      expect(source).not.toMatch(/questionAnswers/u);
    }
  });
});
