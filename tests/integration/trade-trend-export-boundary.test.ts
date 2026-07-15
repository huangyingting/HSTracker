import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TRADE_TRENDS_CSV_COLUMNS } from "../../src/export/trade-trend-csv";
import {
  TRADE_TRENDS_CSV_SCHEMA_VERSION,
  tradeTrendCsvUrl,
} from "../../src/export/trade-trend-csv-contract";

describe("Trade Trend Result Export boundary", () => {
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

    for (const column of TRADE_TRENDS_CSV_COLUMNS) {
      expect(
        column.split("_").some((token) => forbiddenTokens.has(token)),
        column,
      ).toBe(false);
    }
  });

  it("accepts no locale, sort, page, or field-selection parameter", () => {
    const url = new URL(
      tradeTrendCsvUrl({
        analysisBuildId: "analysis-v1",
        importerCode: "528",
        productCode: "010121",
        productSearchBuildId: "products-v1",
        freshnessStatusId: "freshness:v1",
        schemaVersion: TRADE_TRENDS_CSV_SCHEMA_VERSION,
      }),
      "http://localhost",
    );

    expect([...url.searchParams.keys()]).toEqual([
      "importer",
      "product",
      "productSearchBuildId",
      "freshnessStatusId",
      "schema",
    ]);
  });

  it("serializes the public payload without importing recipe internals or raw evidence", async () => {
    const serializer = await readFile(
      resolve("src/export/trade-trend-csv.ts"),
      "utf8",
    );

    expect(serializer).toMatch(/TradeTrendV1Payload/u);
    expect(serializer).not.toMatch(/trade-trend\/trade-trend-v1/u);
    expect(serializer).not.toMatch(/trade-evidence-source/u);
  });
});
