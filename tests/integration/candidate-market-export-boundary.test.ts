import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CANDIDATE_MARKETS_CSV_COLUMNS } from "../../src/export/candidate-market-csv";
import {
  CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  candidateMarketCsvUrl,
} from "../../src/export/candidate-market-csv-contract";

describe("Candidate Market Result Export boundary", () => {
  it("contains only contextual derived-result columns", () => {
    const forbiddenTokens = new Set([
      "brand",
      "buyer",
      "company",
      "consignee",
      "consignor",
      "document",
      "entity",
      "model",
      "party",
      "raw",
      "seller",
      "shipment",
      "sql",
    ]);

    for (const column of CANDIDATE_MARKETS_CSV_COLUMNS) {
      expect(
        column.split("_").some((token) => forbiddenTokens.has(token)),
        column,
      ).toBe(false);
      if (column.includes("supplier")) {
        expect(column, column).toMatch(/^supplier_diversity_/u);
      }
    }
  });

  it("accepts no shortlist, candidate, locale, sort, page, or field selection", () => {
    const url = new URL(
      candidateMarketCsvUrl({
        analysisBuildId: "analysis-v1",
        exporterCode: "156",
        productCode: "010121",
        productSearchBuildId: "products-v1",
        freshnessStatusId: "freshness:v1",
        schemaVersion: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
      }),
      "http://localhost",
    );

    expect([...url.searchParams.keys()]).toEqual([
      "exporter",
      "product",
      "productSearchBuildId",
      "freshnessStatusId",
      "schema",
    ]);
  });

  it("serializes the public result without importing score implementation or raw evidence", async () => {
    const serializer = await readFile(
      resolve("src/export/candidate-market-csv.ts"),
      "utf8",
    );

    expect(serializer).toMatch(/CandidateMarketResult/u);
    expect(serializer).toMatch(
      /from "\.\.\/domain\/candidate-market\/result"/u,
    );
    expect(serializer).not.toMatch(/candidate-market\/cms-v1/u);
    expect(serializer).not.toMatch(/trade-evidence-source/u);
    expect(serializer).not.toMatch(
      /0\.(?:30|25|20)\s*\*\s*[a-z_]+_percentile/u,
    );
  });
});
