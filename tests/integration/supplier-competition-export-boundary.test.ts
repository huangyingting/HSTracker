import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SUPPLIER_COMPETITIONS_CSV_COLUMNS } from "../../src/export/supplier-competition-csv";
import {
  SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
  supplierCompetitionCsvUrl,
} from "../../src/export/supplier-competition-csv-contract";

describe("Supplier Competition Result Export boundary", () => {
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

    for (const column of SUPPLIER_COMPETITIONS_CSV_COLUMNS) {
      expect(
        column.split("_").some((token) => forbiddenTokens.has(token)),
        column,
      ).toBe(false);
    }
  });

  it("accepts no locale, sort, page, or field-selection parameter", () => {
    const url = new URL(
      supplierCompetitionCsvUrl({
        analysisBuildId: "analysis-v1",
        importerCode: "76",
        productCode: "010121",
        productSearchBuildId: "products-v1",
        freshnessStatusId: "freshness:v1",
        schemaVersion: SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
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
      resolve("src/export/supplier-competition-csv.ts"),
      "utf8",
    );

    expect(serializer).toMatch(/SupplierCompetitionV1Payload/u);
    expect(serializer).not.toMatch(
      /supplier-competition\/supplier-competition-v1/u,
    );
    expect(serializer).not.toMatch(/trade-evidence-source/u);
  });

  it("serializes the public production evidence source without a company, buyer, shipment, party, or arbitrary-SQL surface", async () => {
    const evidenceSource = await readFile(
      resolve("src/evidence/duckdb-trade-evidence-source.ts"),
      "utf8",
    );
    const forbiddenTokens = [
      /\bcompany\b/iu,
      /\bbuyer\b/iu,
      /\bshipment\b/iu,
      /\bparty\b/iu,
      /\bconsignee\b/iu,
      /\bconsignor\b/iu,
    ];
    for (const pattern of forbiddenTokens) {
      expect(evidenceSource, pattern.source).not.toMatch(pattern);
    }
    // Every query is a fixed, reviewed statement string against the
    // immutable bilateral_year/market_year/economy/product tables --
    // never string-built from caller-controlled identifiers -- so a
    // request cannot smuggle arbitrary SQL through analysisBuildId/
    // importerCode/productCode.
    expect(evidenceSource).not.toMatch(/\$\{[^}]*(?:query|request)\.[a-zA-Z]/u);
  });
});
