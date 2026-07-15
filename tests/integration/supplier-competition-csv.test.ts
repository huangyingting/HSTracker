import { describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import {
  SUPPLIER_COMPETITIONS_CSV_COLUMNS,
  SupplierCompetitionCsvRepresentationError,
  serializeSupplierCompetitionCsv,
  type SupplierCompetitionCsvInput,
} from "../../src/export/supplier-competition-csv";
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
  "value_unit",
  "finalized_window_start",
  "finalized_window_end",
  "provisional_year",
  "ingested_year_start",
  "ingested_year_end",
  "baci_release",
  "source_update_date",
  "cohort_budget",
  "cohort_size",
  "empty_reason",
  "finalized_pooled_value_current_usd",
  "concentration_state",
  "concentration_hhi",
  "concentration_scale",
  "concentration_unavailable_reason",
  "quality_warnings",
  "provisional_market_state",
  "supplier_name_en",
  "supplier_code_baci",
  "supplier_iso3",
  "supplier_identity_note",
  "supplier_pooled_value_current_usd",
  "supplier_share_percent",
  "supplier_recorded_years",
  "supplier_no_recorded_flow_years",
  "supplier_missing_years",
  "supplier_quantity_coverage_rate",
  "supplier_provisional_state",
  "supplier_provisional_value_current_usd",
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

describe("supplier-competitions-csv-v1 serializer", () => {
  it("declares the exact contextual column order", () => {
    expect(SUPPLIER_COMPETITIONS_CSV_COLUMNS).toEqual(EXPECTED_COLUMNS);
  });

  it("emits one deterministic row per finalized supplier for a dispersed case", async () => {
    const input = await fixtureExportInput("76");
    const exported = serializeSupplierCompetitionCsv(input);
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.row_type === "SUPPLIER")).toBe(true);
    expect(rows.map((row) => row.supplier_code_baci).sort()).toEqual([
      "156",
      "392",
      "528",
      "842",
    ]);
    for (const row of rows) {
      expect(row.supplier_share_percent).toBe("25.000000");
      expect(row.supplier_pooled_value_current_usd).toBe("250000");
      expect(row.supplier_provisional_state).toBe("RECORDED_POSITIVE");
      expect(row.supplier_provisional_value_current_usd).toBe("60000");
      expect(row.concentration_state).toBe("COMPUTED");
      expect(row.concentration_hhi).toBe("2500.000000");
      expect(row.value_unit).toBe("CURRENT_USD");
      expect(row.cohort_size).toBe("4");
      expect(row.recipe).toBe("supplier-competition-v1");
      expect(row.analysis_identity).toMatch(
        /^analysis-identity-v1-[a-f0-9]{64}$/u,
      );
      expect(row.dataset_package_identity).toMatch(
        /^dataset-package-v1-[a-f0-9]{64}$/u,
      );
    }

    const again = serializeSupplierCompetitionCsv(input);
    expect(again.sha256).toBe(exported.sha256);
    expect(again.bytes).toEqual(exported.bytes);
  });

  it("keeps a finalized supplier's own provisional no-recorded-flow state distinct from a brand-new provisional-only entrant", async () => {
    const input = await fixtureExportInput("699");
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeSupplierCompetitionCsv(input).bytes),
    );
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(3);
    const china = rows.find((row) => row.supplier_code_baci === "156")!;
    const netherlands = rows.find((row) => row.supplier_code_baci === "528")!;
    const unitedStates = rows.find((row) => row.supplier_code_baci === "842")!;

    expect(china.row_type).toBe("SUPPLIER");
    expect(china.supplier_share_percent).toBe("50.000000");
    expect(china.supplier_provisional_state).toBe("NO_RECORDED_POSITIVE_FLOW");
    expect(china.supplier_provisional_value_current_usd).toBe("");

    expect(netherlands.row_type).toBe("SUPPLIER");
    expect(netherlands.supplier_provisional_state).toBe("RECORDED_POSITIVE");
    expect(netherlands.supplier_provisional_value_current_usd).toBe("300000");

    expect(unitedStates.row_type).toBe("PROVISIONAL_ONLY_SUPPLIER");
    expect(unitedStates.supplier_provisional_state).toBe("RECORDED_POSITIVE");
    expect(unitedStates.supplier_provisional_value_current_usd).toBe("150000");
    // A provisional-only new entrant never contributes to the finalized
    // cohort, so its finalized columns stay blank rather than a fabricated
    // zero.
    expect(unitedStates.supplier_pooled_value_current_usd).toBe("");
    expect(unitedStates.supplier_share_percent).toBe("");
  });

  it("emits one explicit empty-analysis row rather than header-only when no supplier ever recorded a positive value", async () => {
    const input = await fixtureExportInput("616");
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeSupplierCompetitionCsv(input).bytes),
    );
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.row_type).toBe("EMPTY_ANALYSIS");
    expect(rows[0]!.cohort_size).toBe("0");
    expect(rows[0]!.empty_reason).toBe(
      "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
    );
    expect(rows[0]!.concentration_state).toBe("UNAVAILABLE");
    expect(rows[0]!.concentration_unavailable_reason).toBe(
      "NO_POOLED_SUPPLIER_VALUE",
    );
    expect(rows[0]!.supplier_code_baci).toBe("");
  });

  it("distinguishes sparse recorded/missing/no-recorded-flow years and an unknown quantity coverage rate", async () => {
    const input = await fixtureExportInput("404");
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeSupplierCompetitionCsv(input).bytes),
    );
    const rows = records.slice(1).map((record) => recordObject(records[0]!, record));

    const netherlands = rows.find((row) => row.supplier_code_baci === "528")!;
    const mexico = rows.find((row) => row.supplier_code_baci === "484")!;
    expect(netherlands.supplier_recorded_years).toBe("2019|2021|2023");
    expect(netherlands.supplier_missing_years).toBe("2020|2022");
    expect(netherlands.supplier_no_recorded_flow_years).toBe("");
    expect(netherlands.supplier_quantity_coverage_rate).toBe("");
    expect(mexico.supplier_recorded_years).toBe("2019");
    expect(mexico.supplier_no_recorded_flow_years).toBe("2020|2021|2022|2023");
    expect(mexico.supplier_quantity_coverage_rate).toBe("0.750000");
    expect(rows.every((row) => row.supplier_provisional_state === "NOT_APPLICABLE")).toBe(
      true,
    );
    expect(rows[0]!.quality_warnings).toBe(
      "SPARSE_FINALIZED_PERIODS|INCOMPLETE_SUPPLIER_STRUCTURE",
    );
  });

  it("keeps English and Simplified Chinese analytical values identical", async () => {
    const input = await fixtureExportInput("76");
    const zhHansProduct = {
      ...input.product,
      translationStatus: "reviewed" as const,
      auxiliaryDescriptionZhHans: "纯种繁育马：活体",
    };
    const en = parseQuotedCsv(
      new TextDecoder().decode(serializeSupplierCompetitionCsv(input).bytes),
    );
    const zhHans = parseQuotedCsv(
      new TextDecoder().decode(
        serializeSupplierCompetitionCsv({ ...input, product: zhHansProduct })
          .bytes,
      ),
    );
    const enRows = en.slice(1).map((record) => recordObject(en[0]!, record));
    const zhHansRows = zhHans
      .slice(1)
      .map((record) => recordObject(zhHans[0]!, record));

    const analyticalColumns = SUPPLIER_COMPETITIONS_CSV_COLUMNS.filter(
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
    const input = await fixtureExportInput("76");
    const mutated = withProductDescription(input, dangerousText);

    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeSupplierCompetitionCsv(mutated).bytes),
    );
    const row = recordObject(records[0]!, records[1]!);

    expect(row.product_description_en).toBe(`'${dangerousText}`);
    expect(row.formula_escaped_columns).toBe("product_description_en");
  });

  it("rejects incompatible context and representation overflow", async () => {
    const input = await fixtureExportInput("76");
    expect(() =>
      serializeSupplierCompetitionCsv({
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
      serializeSupplierCompetitionCsv(withProductDescription(input, oversizedText)),
    ).toThrow(SupplierCompetitionCsvRepresentationError);
  });
});

async function fixtureExportInput(
  importerCode: string,
): Promise<SupplierCompetitionCsvInput> {
  const outcome = await createFixtureApplicationRuntime().tradeAnalytics.execute(
    {
      recipe: "supplier-competition-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode,
      productCode: "010121",
    },
  );
  if (outcome.state !== "success" && outcome.state !== "empty") {
    throw new TypeError(`Expected success/empty, received ${outcome.state}.`);
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
  input: SupplierCompetitionCsvInput,
  descriptionEn: string,
): SupplierCompetitionCsvInput {
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
