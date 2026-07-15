import { describe, expect, it } from "vitest";

import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import {
  serializeTradeExplorerCsv,
  TRADE_EXPLORERS_CSV_COLUMNS,
  TradeExplorerCsvRepresentationError,
  type TradeExplorerCsvInput,
} from "../../src/export/trade-explorer-csv";
import { TradeExplorerExportContextError } from "../../src/export/trade-explorer-export-context";
import {
  createTradeExplorerDatasetPackage,
  TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/trade-explorer-v1-dataset-package";

async function fixtureExportInput(
  overrides: Record<string, unknown> = {},
): Promise<TradeExplorerCsvInput> {
  const outcome = await createFixtureApplicationRuntime().tradeAnalytics.execute({
    recipe: "trade-explorer-v1",
    analysisBuildId: "acceptance-fixtures-v1",
    shape: "importing-markets-v1",
    dimensions: ["IMPORT_ECONOMY"],
    measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
    filters: {
      year: { mode: "list", years: [2023] },
      exportEconomy: ["156"],
      importEconomy: ["528", "484", "36", "710"],
      hsProduct: ["010121"],
    },
    sort: { key: "IMPORT_ECONOMY", direction: "asc" },
    ...overrides,
  });
  if (outcome.state !== "success" && outcome.state !== "empty") {
    throw new TypeError(`Expected a completed result, received ${outcome.state}.`);
  }
  const result = {
    ...outcome.payload,
    analysisIdentity: outcome.analysisIdentity,
    datasetPackageIdentity: outcome.datasetPackageIdentity,
  };
  return {
    result,
    manifest: resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      FIXTURE_CURRENT_AS_OF,
    ),
  };
}

describe("trade-explorers-csv-v1 serializer", () => {
  it("emits one row per cohort member plus a total row", async () => {
    const input = await fixtureExportInput();
    const exported = serializeTradeExplorerCsv(input);
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    expect(records[0]).toEqual([...TRADE_EXPLORERS_CSV_COLUMNS]);
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.row_kind)).toEqual([
      "ROW",
      "ROW",
      "ROW",
      "ROW",
      "TOTAL",
    ]);
    expect(rows.slice(0, 4).map((row) => row.dimension_economy_code)).toEqual([
      "36",
      "484",
      "528",
      "710",
    ]);
    expect(rows[4]!.trade_value_usd).toBe("210000");
    expect(rows[4]!.total_included_row_count).toBe("2");
    expect(rows[4]!.total_missing_row_count).toBe("1");
    expect(rows[4]!.dimension_economy_code).toBe("");
  });

  it("emits one contextual EMPTY row when the result has no enumerable rows", async () => {
    const input = await fixtureExportInput({
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["842"],
        importEconomy: ["276"],
        hsProduct: ["010121"],
      },
      sort: null,
    });
    const exported = serializeTradeExplorerCsv(input);
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    const rows = records
      .slice(1)
      .map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      row_kind: "EMPTY",
      analysis_identity: input.result.analysisIdentity,
      shape: "finalized-trend-v1",
      export_economy_codes: "842",
      import_economy_codes: "276",
      hs_product_codes: "010121",
    });
  });

  it("prefixes the byte stream with a UTF-8 BOM and uses CRLF record separators", async () => {
    const input = await fixtureExportInput();
    const exported = serializeTradeExplorerCsv(input);
    expect(exported.bytes.slice(0, 3)).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));
    const text = new TextDecoder().decode(exported.bytes);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("fully quotes every field and doubles embedded quotes", async () => {
    const input = await fixtureExportInput();
    const exported = serializeTradeExplorerCsv(input);
    const text = new TextDecoder().decode(exported.bytes);
    const header = text.split("\r\n")[0]!;
    for (const column of header.split(",")) {
      expect(column.startsWith('"') && column.endsWith('"')).toBe(true);
    }
  });

  it("prefixes a formula-triggering economy name with an apostrophe and records the escaped column", async () => {
    const input = await fixtureExportInput();
    const poisoned: TradeExplorerCsvInput = {
      ...input,
      result: {
        ...input.result,
        rows: input.result.rows.map((row, index) =>
          index === 0 && row.dimensionValue.dimension === "IMPORT_ECONOMY"
            ? {
                ...row,
                dimensionValue: {
                  ...row.dimensionValue,
                  economy: { ...row.dimensionValue.economy, name: "=cmd()" },
                },
              }
            : row,
        ),
      },
    };
    const exported = serializeTradeExplorerCsv(poisoned);
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));
    expect(rows[0]!.dimension_economy_name_en).toBe("'=cmd()");
    expect(rows[0]!.formula_escaped_columns.split("|")).toContain(
      "dimension_economy_name_en",
    );
  });

  it("throws a typed representation-limit error rather than silently truncating an oversized export", async () => {
    const input = await fixtureExportInput();
    const oversized: TradeExplorerCsvInput = {
      ...input,
      result: {
        ...input.result,
        discoveryDisclaimer: "x".repeat(2 * 1024 * 1024),
      },
    };
    expect(() => serializeTradeExplorerCsv(oversized)).toThrow(
      TradeExplorerCsvRepresentationError,
    );
  });

  it("rejects a result whose provenance is incompatible with the bound manifest", async () => {
    const input = await fixtureExportInput();
    const incompatible: TradeExplorerCsvInput = {
      ...input,
      result: {
        ...input.result,
        provenance: { ...input.result.provenance, baciRelease: "V202512" },
      },
    };
    expect(() => serializeTradeExplorerCsv(incompatible)).toThrow(
      TradeExplorerExportContextError,
    );
  });

  it("rejects a result bound to a different Dataset Package", async () => {
    const input = await fixtureExportInput();
    const otherPackage = createTradeExplorerDatasetPackage({
      schemaVersion: "trade-explorer-dataset-package-manifest-v1",
      baciRelease: input.result.provenance.baciRelease,
      hsRevision: "HS12",
      finalizedYearCount: 5,
      finalizedCutoffYear: input.result.provenance.finalizedWindow.end,
      evidenceSha256: "0".repeat(64),
      capabilities: TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
    });
    const incompatible: TradeExplorerCsvInput = {
      ...input,
      result: {
        ...input.result,
        datasetPackageIdentity: otherPackage.identity,
      },
    };
    expect(() => serializeTradeExplorerCsv(incompatible)).toThrow(
      TradeExplorerExportContextError,
    );
  });
});

function parseQuotedCsv(csvWithBom: string): string[][] {
  const csv = csvWithBom.startsWith("\uFEFF") ? csvWithBom.slice(1) : csvWithBom;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let index = 0;

  while (index < csv.length) {
    if (csv[index] !== '"') {
      throw new Error(`Expected an opening quote at byte ${index}.`);
    }
    index += 1;
    cell = "";
    while (index < csv.length) {
      if (csv[index] !== '"') {
        cell += csv[index];
        index += 1;
        continue;
      }
      if (csv[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    record.push(cell);
    if (csv[index] === ",") {
      index += 1;
      continue;
    }
    if (csv.slice(index, index + 2) === "\r\n") {
      records.push(record);
      record = [];
      index += 2;
      continue;
    }
    if (index >= csv.length) {
      break;
    }
    throw new Error(`Unexpected character at byte ${index}.`);
  }
  return records;
}

function recordObject(
  columns: readonly string[],
  values: readonly string[],
): Record<string, string> {
  if (columns.length !== values.length) {
    throw new Error("CSV record column/value length mismatch.");
  }
  return Object.fromEntries(columns.map((column, index) => [column, values[index]!]));
}
