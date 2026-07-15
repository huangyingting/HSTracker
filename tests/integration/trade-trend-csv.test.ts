import { describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import {
  TRADE_TRENDS_CSV_COLUMNS,
  TradeTrendCsvRepresentationError,
  serializeTradeTrendCsv,
  type TradeTrendCsvInput,
} from "../../src/export/trade-trend-csv";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";

const EXPECTED_COLUMNS = [
  "row_type",
  "export_schema_version",
  "export_id",
  "recipe",
  "analysis_identity",
  "dataset_package_identity",
  "analysis_id",
  "analysis_build_id",
  "analysis_release_catalog_sha256",
  "importer_name_en",
  "importer_code_baci",
  "importer_iso3",
  "importer_identity_note",
  "hs_revision",
  "product_code",
  "product_description_en",
  "product_description_zh_hans",
  "product_translation_status",
  "product_translation_attribution",
  "observation_year",
  "observation_state",
  "observation_value_current_usd",
  "value_unit",
  "is_provisional_year",
  "finalized_window_start",
  "finalized_window_end",
  "provisional_year",
  "ingested_year_start",
  "ingested_year_end",
  "baci_release",
  "source_update_date",
  "summary_state",
  "summary_unavailable_reason",
  "summary_first_recorded_year",
  "summary_first_recorded_value_current_usd",
  "summary_last_recorded_year",
  "summary_last_recorded_value_current_usd",
  "summary_span_years",
  "summary_absolute_change_current_usd",
  "summary_percentage_change_percent",
  "summary_cagr_percent",
  "discovery_disclaimer",
  "artifact_build_id",
  "artifact_schema_version",
  "artifact_sha256",
  "source_status_snapshot_id",
  "freshness_status_id",
  "freshness_state",
  "freshness_checked_at",
  "freshness_effective_at",
  "served_baci_release",
  "latest_known_baci_release",
  "product_search_build_id",
  "source_attribution",
  "source_documentation_url",
  "source_license",
  "source_license_url",
  "formula_escaped_columns",
];

describe("trade-trends-csv-v1 serializer", () => {
  it("declares the exact contextual column order", () => {
    expect(TRADE_TRENDS_CSV_COLUMNS).toEqual(EXPECTED_COLUMNS);
  });

  it("emits exactly six deterministic rows for a complete provisional case", async () => {
    const input = await fixtureExportInput("528");
    const exported = serializeTradeTrendCsv(input);
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.row_type)).toEqual([
      "FINALIZED",
      "FINALIZED",
      "FINALIZED",
      "FINALIZED",
      "FINALIZED",
      "PROVISIONAL",
    ]);
    expect(rows.map((row) => row.observation_year)).toEqual([
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
    ]);
    expect(rows.map((row) => row.observation_state)).toEqual([
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
    ]);
    expect(rows.map((row) => row.observation_value_current_usd)).toEqual([
      "100000",
      "110000",
      "120000",
      "130000",
      "160000",
      "200000",
    ]);
    expect(rows[5]!.is_provisional_year).toBe("true");
    expect(rows[0]!.is_provisional_year).toBe("false");
    for (const row of rows) {
      expect(row.value_unit).toBe("CURRENT_USD");
      expect(row.analysis_identity).toMatch(/^analysis-identity-v1-[a-f0-9]{64}$/u);
      expect(row.dataset_package_identity).toMatch(
        /^dataset-package-v1-[a-f0-9]{64}$/u,
      );
      expect(row.recipe).toBe("trade-trend-v1");
      expect(row.summary_state).toBe("AVAILABLE");
      expect(row.summary_first_recorded_year).toBe("2019");
      expect(row.summary_last_recorded_year).toBe("2023");
      expect(row.summary_absolute_change_current_usd).toBe("60000");
      expect(row.summary_percentage_change_percent).toBe("60.000000");
    }

    const again = serializeTradeTrendCsv(input);
    expect(again.sha256).toBe(exported.sha256);
    expect(again.bytes).toEqual(exported.bytes);
  });

  it("distinguishes missing observation, no recorded flow, and recorded value in a sparse case", async () => {
    const input = await fixtureExportInput("484");
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeTradeTrendCsv(input).bytes),
    );
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows.map((row) => row.observation_state)).toEqual([
      "RECORDED_POSITIVE",
      "MISSING_OBSERVATION",
      "NO_RECORDED_POSITIVE_FLOW",
      "RECORDED_POSITIVE",
      "MISSING_OBSERVATION",
      "MISSING_OBSERVATION",
    ]);
    expect(rows[5]!.row_type).toBe("PROVISIONAL");
    expect(rows[5]!.observation_year).toBe("2024");
    expect(rows[5]!.observation_value_current_usd).toBe("");
    for (const row of rows) {
      expect(row.summary_state).toBe("AVAILABLE");
      expect(row.summary_absolute_change_current_usd).toBe("-50000");
    }
  });

  it("keeps an unavailable trend distinct from no recorded flow", async () => {
    const noFlow = parseQuotedCsv(
      new TextDecoder().decode(
        serializeTradeTrendCsv(await fixtureExportInput("36")).bytes,
      ),
    );
    const noFlowRows = noFlow
      .slice(1)
      .map((record) => recordObject(noFlow[0]!, record));
    expect(noFlowRows.every((row) => row.summary_state === "UNAVAILABLE")).toBe(
      true,
    );
    expect(noFlowRows[0]!.summary_unavailable_reason).toBe(
      "NO_RECORDED_POSITIVE_OBSERVATIONS",
    );
    expect(noFlowRows.slice(0, 5).map((row) => row.observation_state)).toEqual(
      Array(5).fill("NO_RECORDED_POSITIVE_FLOW"),
    );

    const unavailable = parseQuotedCsv(
      new TextDecoder().decode(
        serializeTradeTrendCsv(await fixtureExportInput("710")).bytes,
      ),
    );
    const unavailableRows = unavailable
      .slice(1)
      .map((record) => recordObject(unavailable[0]!, record));
    expect(unavailableRows[0]!.summary_unavailable_reason).toBe(
      "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION",
    );
    expect(unavailableRows[5]!.observation_state).toBe("MISSING_OBSERVATION");
  });

  it("keeps English and Simplified Chinese analytical values identical", async () => {
    const input = await fixtureExportInput("528");
    const zhHansProduct = {
      ...input.product,
      translationStatus: "reviewed" as const,
      auxiliaryDescriptionZhHans: "纯种繁育马：活体",
    };
    const en = parseQuotedCsv(
      new TextDecoder().decode(serializeTradeTrendCsv(input).bytes),
    );
    const zhHans = parseQuotedCsv(
      new TextDecoder().decode(
        serializeTradeTrendCsv({ ...input, product: zhHansProduct }).bytes,
      ),
    );
    const enRows = en.slice(1).map((record) => recordObject(en[0]!, record));
    const zhHansRows = zhHans
      .slice(1)
      .map((record) => recordObject(zhHans[0]!, record));

    const analyticalColumns = TRADE_TRENDS_CSV_COLUMNS.filter(
      (column) =>
        column !== "product_description_zh_hans" &&
        column !== "product_translation_status" &&
        column !== "export_id" &&
        column !== "formula_escaped_columns",
    );
    for (const [index, enRow] of enRows.entries()) {
      const zhHansRow = zhHansRows[index]!;
      for (const column of analyticalColumns) {
        expect(zhHansRow[column], column).toBe(enRow[column]);
      }
    }
  });

  it.each([
    "=SUM(\"quoted\")",
    "+command",
    "-command",
    "@command",
  ])("reversibly protects the formula starter in %j", async (dangerousText) => {
    const input = await fixtureExportInput("528");
    const mutated = withProductDescription(input, dangerousText);

    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeTradeTrendCsv(mutated).bytes),
    );
    const row = recordObject(records[0]!, records[1]!);

    expect(row.product_description_en).toBe(`'${dangerousText}`);
    expect(row.formula_escaped_columns).toBe("product_description_en");
  });

  it("rejects incompatible context and representation overflow", async () => {
    const input = await fixtureExportInput("528");
    expect(() =>
      serializeTradeTrendCsv({
        ...input,
        manifest: {
          ...input.manifest,
          source: {
            ...input.manifest.source,
            baciRelease: "V202602",
          },
        },
      }),
    ).toThrow(/incompatible BACI Release binding/u);

    const oversizedText = "x".repeat(5 * 1024 * 1024);
    expect(() =>
      serializeTradeTrendCsv(withProductDescription(input, oversizedText)),
    ).toThrow(TradeTrendCsvRepresentationError);
  });
});

async function fixtureExportInput(
  importerCode: string,
): Promise<TradeTrendCsvInput> {
  const outcome = await createFixtureApplicationRuntime().tradeAnalytics.execute(
    {
      recipe: "trade-trend-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode,
      productCode: "010121",
    },
  );
  if (outcome.state !== "success") {
    throw new TypeError(`Expected success, received ${outcome.state}.`);
  }
  const result = {
    ...outcome.payload,
    analysisIdentity: outcome.analysisIdentity,
    datasetPackageIdentity: outcome.datasetPackageIdentity,
  };
  const productSearch = await createFixtureProductCatalog().search({
    productSearchBuildId: "acceptance-product-search-v3",
    query: "010121",
    locale: "en",
    limit: 1,
  });
  const product = productSearch.matches[0]?.product;
  if (product === undefined) {
    throw new Error("Fixture product 010121 is unavailable.");
  }

  return {
    result,
    product,
    manifest: resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      FIXTURE_CURRENT_AS_OF,
    ),
  };
}

function withProductDescription(
  input: TradeTrendCsvInput,
  descriptionEn: string,
): TradeTrendCsvInput {
  return {
    ...input,
    product: {
      ...input.product,
      sourceDescriptionEn: descriptionEn,
    },
    result: {
      ...input.result,
      query: {
        ...input.result.query,
        product: {
          ...input.result.query.product,
          descriptionEn,
        },
      },
    },
  };
}

function parseQuotedCsv(csvWithBom: string): string[][] {
  const csv = csvWithBom.startsWith("\uFEFF")
    ? csvWithBom.slice(1)
    : csvWithBom;
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
    throw new Error(`Unexpected delimiter at byte ${index}.`);
  }
  if (record.length > 0) {
    records.push(record);
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
