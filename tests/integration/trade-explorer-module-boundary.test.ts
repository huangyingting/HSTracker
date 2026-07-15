import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TRADE_EXPLORERS_CSV_COLUMNS } from "../../src/export/trade-explorer-csv";
import {
  TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
  tradeExplorerCsvUrl,
} from "../../src/export/trade-explorer-csv-contract";
import {
  decodeTradeExplorerQuery,
  encodeTradeExplorerQuery,
} from "../../src/domain/trade-analytics/trade-explorer-v1-query-codec";
import { parseTradeExplorerRequestBody } from "../../src/domain/trade-analytics/trade-explorer-v1-request-body";
import type { TradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";

// Every allowed field name Trade Explorer v1 ever accepts, anywhere: the
// closed request body, the closed URL query codec, and the CSV contract's
// two extra export-context parameters. This is the literal allowlist a
// caller-controlled key must be a member of -- see the "no generic
// key/value maps... object keys" assertions below.
const ALLOWED_REQUEST_BODY_KEYS = [
  "shape",
  "dimensions",
  "measures",
  "filters",
  "sort",
];
const ALLOWED_FILTER_KEYS = ["year", "exportEconomy", "importEconomy", "hsProduct"];
const ALLOWED_QUERY_PARAM_KEYS = [
  "shape",
  "measures",
  "years",
  "exportEconomy",
  "importEconomy",
  "hsProduct",
  "sortKey",
  "sortDirection",
];

const FORBIDDEN_TOKENS = new Set([
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

describe("Trade Explorer module boundary", () => {
  it("rejects forbidden fields at the typed platform seam", () => {
    const compileOnly = (platform: TradeAnalyticsPlatform) => {
      const request: Parameters<TradeAnalyticsPlatform["execute"]>[0] = {
        recipe: "trade-explorer-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        shape: "finalized-trend-v1",
        dimensions: ["YEAR"],
        measures: ["TRADE_VALUE_USD"],
        filters: {
          year: { mode: "list", years: [] },
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
        },
        sort: null,
      };
      void platform.execute({
        ...request,
        // @ts-expect-error -- arbitrary query/storage vocabulary is forbidden
        sql: "SELECT * FROM trades",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- physical table selection is forbidden
        table: "bilateral_year",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- physical column selection is forbidden
        column: "value_kusd",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- arbitrary expressions are forbidden
        expression: "1 = 1",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- storage paths are forbidden
        path: "../../data.parquet",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- arbitrary object-key selection is forbidden
        objectKey: "records",
      });
      void platform.execute({
        ...request,
        // @ts-expect-error -- raw source records are forbidden
        rawRecord: { value_kusd: 1 },
      });
    };
    expect(compileOnly).toBeTypeOf("function");
  });

  it("contains only contextual derived-result CSV columns -- no company/buyer/raw/sql vocabulary", () => {
    for (const column of TRADE_EXPLORERS_CSV_COLUMNS) {
      expect(
        column.split("_").some((token) => FORBIDDEN_TOKENS.has(token)),
        column,
      ).toBe(false);
    }
  });

  it("accepts no opaque JSON/base64 blob, locale, page, or arbitrary field-selection CSV parameter", () => {
    const url = new URL(
      tradeExplorerCsvUrl({
        analysisBuildId: "analysis-v1",
        query: {
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
          sort: null,
        },
        freshnessStatusId: "freshness:v1",
        schemaVersion: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
      }),
      "http://localhost",
    );

    const allowedCsvKeys = new Set([
      ...ALLOWED_QUERY_PARAM_KEYS,
      "freshnessStatusId",
      "schema",
    ]);
    for (const key of url.searchParams.keys()) {
      expect(allowedCsvKeys.has(key), key).toBe(true);
    }
    for (const value of url.searchParams.values()) {
      // No value is ever an opaque JSON/base64 blob -- every value is a
      // short semantic token, code, or code list.
      expect(value).not.toMatch(/^[A-Za-z0-9+/]{20,}={0,2}$/u);
      expect(value).not.toMatch(/[{}[\]]/u);
    }
  });

  it("serializes the public payload without importing recipe internals or the raw evidence-source seam", async () => {
    const serializer = await readFile(
      resolve("src/export/trade-explorer-csv.ts"),
      "utf8",
    );
    expect(serializer).toMatch(/TradeExplorerV1Payload/u);
    expect(serializer).not.toMatch(/trade-explorer\/trade-explorer-v1["']/u);
    expect(serializer).not.toMatch(/trade-evidence-source/u);
  });

  it("rejects a request body naming any key outside the closed allowlist, including SQL/prototype-pollution probes", () => {
    const validBody = () => ({
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    for (const poison of [
      { sql: "DROP TABLE trades" },
      { table: "bilateral_year" },
      { column: "value_kusd" },
      { path: "../../etc/passwd" },
      { expression: "1=1" },
      { additionalField: true },
    ]) {
      expect(() =>
        parseTradeExplorerRequestBody({ ...validBody(), ...poison }),
      ).toThrow();
    }

    for (const poison of [
      { sql: "DROP TABLE trades" },
      { rawRecord: true },
    ]) {
      expect(() =>
        parseTradeExplorerRequestBody({
          ...validBody(),
          filters: { ...validBody().filters, ...poison },
        }),
      ).toThrow();
    }
  });

  it("rejects a URL query naming any parameter outside the closed codec allowlist", () => {
    const validParams = () =>
      encodeTradeExplorerQuery({
        shape: "finalized-trend-v1",
        dimensions: ["YEAR"],
        measures: ["TRADE_VALUE_USD"],
        filters: {
          year: { mode: "list", years: [] },
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
        },
        sort: null,
      });

    for (const key of ["sql", "table", "column", "path", "select", "orderBy"]) {
      const params = validParams();
      params.set(key, "1");
      expect(decodeTradeExplorerQuery(params), key).toBeNull();
    }
  });

  it("declares exactly the closed request-body and query-param key sets (no generic key/value map)", () => {
    // A regression guard on the allowlists themselves: if a future change
    // adds a field, it must be added here deliberately rather than
    // silently widening what parseTradeExplorerRequestBody/
    // decodeTradeExplorerQuery accept.
    expect(ALLOWED_REQUEST_BODY_KEYS.sort()).toEqual(
      ["shape", "dimensions", "measures", "filters", "sort"].sort(),
    );
    expect(ALLOWED_FILTER_KEYS.sort()).toEqual(
      ["year", "exportEconomy", "importEconomy", "hsProduct"].sort(),
    );
    expect(ALLOWED_QUERY_PARAM_KEYS.sort()).toEqual(
      [
        "shape",
        "measures",
        "years",
        "exportEconomy",
        "importEconomy",
        "hsProduct",
        "sortKey",
        "sortDirection",
      ].sort(),
    );
  });

  it("declares no generic index signature or untyped record in the public request/query result types", async () => {
    // trade-explorer-v1-request-body.ts's own internal `Record<string,
    // unknown>` casts are deliberately excluded: they exist only to
    // narrow an untyped JSON `unknown` value before its exact keys are
    // validated (see parseTradeExplorerRequestBody/assertExactKeys) --
    // the opposite of accepting a generic key/value map -- so only the
    // genuinely public result/query type declarations are scanned here.
    const files = [
      "src/domain/trade-explorer/result.ts",
      "src/domain/trade-analytics/trade-explorer-v1-query-codec.ts",
    ];
    for (const file of files) {
      const source = await readFile(resolve(file), "utf8");
      expect(source, file).not.toMatch(/\[\s*key\s*:\s*string\s*\]/u);
      expect(source, file).not.toMatch(/Record<string,\s*(?:unknown|any)>/u);
      expect(source, file).not.toMatch(/:\s*any\b/u);
    }
  });

  it("never leaks storage shape: production DuckDB source declares no Trade Explorer loader in #46", async () => {
    const duckDbSource = await readFile(
      resolve("src/evidence/duckdb-trade-evidence-source.ts"),
      "utf8",
    );
    expect(duckDbSource).not.toMatch(/loadTradeExplorerV1Inputs/u);
  });

  it("serializes the fixture evidence source without a company, buyer, shipment, party, or arbitrary-SQL surface", async () => {
    const fixtureSource = await readFile(
      resolve("src/evidence/fixture-trade-evidence-source.ts"),
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
      expect(fixtureSource, pattern.source).not.toMatch(pattern);
    }
  });

  it("exposes the JSON route only as GET/HEAD/POST -- no PUT, PATCH, or DELETE handler", async () => {
    const routeModule = await import(
      "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer/route"
    );
    expect(Object.keys(routeModule).sort()).toEqual(
      ["GET", "HEAD", "POST", "dynamic", "runtime"].sort(),
    );
  });

  it("exposes the CSV route only as GET/HEAD -- an immutable read, never a write surface", async () => {
    const routeModule = await import(
      "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer.csv/route"
    );
    expect(Object.keys(routeModule).sort()).toEqual(
      ["GET", "HEAD", "dynamic", "runtime"].sort(),
    );
  });
});
