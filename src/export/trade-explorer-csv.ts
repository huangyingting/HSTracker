import { createHash } from "node:crypto";

import type { TradeExplorerV1Payload } from "../domain/trade-analytics/trade-explorer-v1-adapter";
import type { TradeExplorerRow } from "../domain/trade-explorer/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import {
  TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
} from "./trade-explorer-csv-contract";
import { assertTradeExplorerExportContext } from "./trade-explorer-export-context";
import {
  encodeCsvRecord,
  protectHumanText,
} from "./csv-grammar";

export { TRADE_EXPLORERS_CSV_SCHEMA_VERSION };

const SOURCE_DOCUMENTATION_URL =
  "https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html";
const SOURCE_LICENSE = "Etalab Open Licence 2.0";
const SOURCE_LICENSE_URL =
  "https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf";
const MAX_ENTITY_BYTES = RUNTIME_RESOURCE_POLICY.analysisBudget.maxResultBytes;

type CellKind =
  | "baci-release"
  | "code-list"
  | "column-list"
  | "date"
  | "decimal"
  | "economy-code"
  | "enum"
  | "export-id"
  | "human-text"
  | "identifier"
  | "integer"
  | "iso3"
  | "literal"
  | "product-code"
  | "sha256"
  | "timestamp"
  | "url";

const CSV_SCHEMA = [
  ["row_kind", "enum"],
  ["export_schema_version", "identifier"],
  ["export_id", "export-id"],
  ["recipe", "identifier"],
  ["analysis_identity", "identifier"],
  ["dataset_package_identity", "identifier"],
  ["analysis_id", "identifier"],
  ["analysis_build_id", "identifier"],
  ["analysis_release_catalog_sha256", "sha256"],
  ["shape", "identifier"],
  ["grouped_dimension", "enum"],
  ["measures_requested", "code-list"],
  ["sort_key", "enum"],
  ["sort_direction", "enum"],
  ["export_economy_codes", "code-list"],
  ["import_economy_codes", "code-list"],
  ["hs_product_codes", "code-list"],
  ["years_requested", "code-list"],
  ["hs_revision", "identifier"],
  ["value_unit", "enum"],
  ["ingested_year_start", "integer"],
  ["ingested_year_end", "integer"],
  ["finalized_window_start", "integer"],
  ["finalized_window_end", "integer"],
  ["baci_release", "baci-release"],
  ["source_update_date", "date"],
  ["quality_warnings", "code-list"],
  ["budget_requested_max_years", "integer"],
  ["budget_requested_max_filter_codes", "integer"],
  ["budget_requested_max_result_rows", "integer"],
  ["budget_requested_max_result_bytes", "integer"],
  ["budget_accepted_max_years", "integer"],
  ["budget_accepted_max_filter_codes", "integer"],
  ["budget_accepted_max_result_rows", "integer"],
  ["budget_accepted_max_scan_rows", "integer"],
  ["budget_accepted_max_result_bytes", "integer"],
  ["budget_actual_scan_rows", "integer"],
  ["budget_actual_result_rows", "integer"],
  ["budget_actual_result_bytes", "integer"],
  ["dimension_value_kind", "enum"],
  ["dimension_year", "integer"],
  ["dimension_economy_code", "economy-code"],
  ["dimension_economy_name_en", "human-text"],
  ["dimension_economy_iso3", "iso3"],
  ["dimension_product_code", "product-code"],
  ["dimension_product_description_en", "human-text"],
  ["observation_state", "enum"],
  ["trade_value_usd", "decimal"],
  ["recorded_flow_count", "integer"],
  ["total_included_row_count", "integer"],
  ["total_missing_row_count", "integer"],
  ["discovery_disclaimer", "human-text"],
  ["artifact_build_id", "identifier"],
  ["artifact_schema_version", "identifier"],
  ["artifact_sha256", "sha256"],
  ["evidence_sha256", "sha256"],
  ["source_status_snapshot_id", "identifier"],
  ["freshness_status_id", "identifier"],
  ["freshness_state", "enum"],
  ["freshness_checked_at", "timestamp"],
  ["freshness_effective_at", "timestamp"],
  ["served_baci_release", "baci-release"],
  ["latest_known_baci_release", "baci-release"],
  ["source_attribution", "human-text"],
  ["source_documentation_url", "url"],
  ["source_license", "literal"],
  ["source_license_url", "url"],
  ["formula_escaped_columns", "column-list"],
] as const satisfies readonly (readonly [string, CellKind])[];

type TradeExplorersCsvColumn = (typeof CSV_SCHEMA)[number][0];
type TradeExplorersCsvRow = Record<TradeExplorersCsvColumn, string>;

export const TRADE_EXPLORERS_CSV_COLUMNS: readonly TradeExplorersCsvColumn[] =
  Object.freeze(CSV_SCHEMA.map(([column]) => column));

export type TradeExplorerCsvInput = {
  result: TradeExplorerV1Payload;
  manifest: CurrentAnalysisManifest;
};

export type TradeExplorerCsvRepresentation = {
  schemaVersion: typeof TRADE_EXPLORERS_CSV_SCHEMA_VERSION;
  exportId: string;
  filename: string;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
};

export class TradeExplorerCsvRepresentationError extends Error {
  readonly code = "EXPORT_REPRESENTATION_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "TradeExplorerCsvRepresentationError";
  }
}

export function serializeTradeExplorerCsv({
  result,
  manifest,
}: TradeExplorerCsvInput): TradeExplorerCsvRepresentation {
  assertTradeExplorerExportContext(result, manifest);

  const exportId = createExportId({
    analysisBuildId: result.analysisBuildId,
    analysisIdentity: result.analysisIdentity,
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schemaVersion: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
  });
  const common = createCommonRow(result, manifest, exportId);
  const rows = [
    ...result.rows.map((row) => createRow(common, row)),
    ...(result.totalRow === null ? [] : [createTotalRow(common, result)]),
    ...(result.rows.length === 0 && result.totalRow === null
      ? [createEmptyRow(common)]
      : []),
  ];
  const records = [
    encodeCsvRecord(TRADE_EXPLORERS_CSV_COLUMNS),
    ...rows.map(encodeRow),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  if (bytes.byteLength > MAX_ENTITY_BYTES) {
    throw new TradeExplorerCsvRepresentationError(
      `Trade Explorer export exceeds ${MAX_ENTITY_BYTES} bytes.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
    exportId,
    filename: [
      "hs-tracker_trade-explorer_",
      result.query.shape,
      "_",
      result.provenance.baciRelease,
      "_",
      exportId,
      ".csv",
    ].join(""),
    sha256,
    bytes,
  };
}

function createExportId(identity: {
  analysisBuildId: string;
  analysisIdentity: string;
  freshnessStatusId: string;
  schemaVersion: string;
}): string {
  const digestInput = [
    `schema=${identity.schemaVersion}`,
    `analysis_build_id=${identity.analysisBuildId}`,
    `analysis_identity=${identity.analysisIdentity}`,
    `freshness_status_id=${identity.freshnessStatusId}`,
    "",
  ].join("\n");
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return `tex1-${digest}`;
}

function createCommonRow(
  result: TradeExplorerV1Payload,
  manifest: CurrentAnalysisManifest,
  exportId: string,
): TradeExplorersCsvRow {
  return Object.assign(createBlankRow(), {
    export_schema_version: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
    export_id: exportId,
    recipe: "trade-explorer-v1",
    analysis_identity: result.analysisIdentity,
    dataset_package_identity: result.datasetPackageIdentity,
    analysis_id: result.analysisId,
    analysis_build_id: result.analysisBuildId,
    analysis_release_catalog_sha256: result.analysisReleaseCatalogSha256,
    shape: result.query.shape,
    grouped_dimension: result.query.dimension,
    measures_requested: result.query.measures.join("|"),
    sort_key: result.query.sort.key,
    sort_direction: result.query.sort.direction,
    export_economy_codes: result.query.exportEconomy.join("|"),
    import_economy_codes: result.query.importEconomy.join("|"),
    hs_product_codes: result.query.hsProduct.join("|"),
    years_requested: result.query.years.map(String).join("|"),
    hs_revision: result.provenance.hsRevision,
    value_unit: result.provenance.valueUnit,
    ingested_year_start: String(result.provenance.ingestedYears.start),
    ingested_year_end: String(result.provenance.ingestedYears.end),
    finalized_window_start: String(result.provenance.finalizedWindow.start),
    finalized_window_end: String(result.provenance.finalizedWindow.end),
    baci_release: result.provenance.baciRelease,
    source_update_date: result.provenance.sourceUpdateDate,
    quality_warnings: result.qualityWarnings.join("|"),
    budget_requested_max_years: String(result.budget.requested.maxYears),
    budget_requested_max_filter_codes: String(
      result.budget.requested.maxFilterCodesPerDimension,
    ),
    budget_requested_max_result_rows: String(
      result.budget.requested.maxResultRows,
    ),
    budget_requested_max_result_bytes: String(
      result.budget.requested.maxResultBytes,
    ),
    budget_accepted_max_years: String(result.budget.accepted.maxYears),
    budget_accepted_max_filter_codes: String(
      result.budget.accepted.maxFilterCodesPerDimension,
    ),
    budget_accepted_max_result_rows: String(
      result.budget.accepted.maxResultRows,
    ),
    budget_accepted_max_scan_rows: String(result.budget.accepted.maxScanRows),
    budget_accepted_max_result_bytes: String(
      result.budget.accepted.maxResultBytes,
    ),
    budget_actual_scan_rows: String(result.budget.actual.scanRows),
    budget_actual_result_rows: String(result.budget.actual.resultRows),
    budget_actual_result_bytes: String(result.budget.actual.resultBytes),
    discovery_disclaimer: result.discoveryDisclaimer,
    artifact_build_id: result.provenance.artifactBuildId,
    artifact_schema_version: result.provenance.artifactSchemaVersion,
    artifact_sha256: result.provenance.artifactSha256,
    evidence_sha256: result.provenance.evidenceSha256,
    source_status_snapshot_id: manifest.freshness.sourceStatusSnapshotId,
    freshness_status_id: manifest.freshness.freshnessStatusId,
    freshness_state: manifest.freshness.state,
    freshness_checked_at: manifest.freshness.checkedAt,
    freshness_effective_at: manifest.freshness.effectiveAt,
    served_baci_release: manifest.freshness.servedBaciRelease,
    latest_known_baci_release: manifest.freshness.latestKnownBaciRelease,
    source_attribution: `Source: CEPII BACI, HS 2012, ${result.provenance.baciRelease} (updated ${result.provenance.sourceUpdateDate}), Etalab Open Licence 2.0.`,
    source_documentation_url: SOURCE_DOCUMENTATION_URL,
    source_license: SOURCE_LICENSE,
    source_license_url: SOURCE_LICENSE_URL,
  } satisfies Partial<TradeExplorersCsvRow>);
}

function createRow(
  common: TradeExplorersCsvRow,
  row: TradeExplorerRow,
): TradeExplorersCsvRow {
  const { dimensionValue } = row;
  const dimensionFields: Partial<TradeExplorersCsvRow> =
    dimensionValue.dimension === "YEAR"
      ? { dimension_value_kind: "YEAR", dimension_year: String(dimensionValue.year) }
      : dimensionValue.dimension === "HS_PRODUCT"
        ? {
            dimension_value_kind: "PRODUCT",
            dimension_product_code: dimensionValue.product.code,
            dimension_product_description_en: dimensionValue.product.descriptionEn,
          }
        : {
            dimension_value_kind: "ECONOMY",
            dimension_economy_code: dimensionValue.economy.code,
            dimension_economy_name_en: dimensionValue.economy.name,
            dimension_economy_iso3: dimensionValue.economy.iso3 ?? "",
          };
  return Object.assign({ ...common }, {
    row_kind: "ROW",
    ...dimensionFields,
    observation_state: row.state,
    trade_value_usd: row.tradeValueUsd ?? "",
    recorded_flow_count: row.recordedFlowCount === null ? "" : String(row.recordedFlowCount),
  } satisfies Partial<TradeExplorersCsvRow>);
}

function createTotalRow(
  common: TradeExplorersCsvRow,
  result: TradeExplorerV1Payload,
): TradeExplorersCsvRow {
  const totalRow = result.totalRow!;
  return Object.assign({ ...common }, {
    row_kind: "TOTAL",
    trade_value_usd: totalRow.tradeValueUsd ?? "",
    recorded_flow_count:
      totalRow.recordedFlowCount === null ? "" : String(totalRow.recordedFlowCount),
    total_included_row_count: String(totalRow.includedRowCount),
    total_missing_row_count: String(totalRow.missingRowCount),
  } satisfies Partial<TradeExplorersCsvRow>);
}

function createEmptyRow(
  common: TradeExplorersCsvRow,
): TradeExplorersCsvRow {
  return Object.assign({ ...common }, {
    row_kind: "EMPTY",
  } satisfies Partial<TradeExplorersCsvRow>);
}

function createBlankRow(): TradeExplorersCsvRow {
  return Object.fromEntries(
    TRADE_EXPLORERS_CSV_COLUMNS.map((column) => [column, ""]),
  ) as TradeExplorersCsvRow;
}

function encodeRow(row: TradeExplorersCsvRow): string {
  const escapedColumns = new Set<TradeExplorersCsvColumn>();
  const protectedValues = Object.fromEntries(
    CSV_SCHEMA.filter(([column]) => column !== "formula_escaped_columns").map(
      ([column, kind]) => [
        column,
        kind === "human-text"
          ? protectHumanText(row[column], column, escapedColumns)
          : validateMachineCell(row[column], column, kind),
      ],
    ),
  ) as Partial<TradeExplorersCsvRow>;
  protectedValues.formula_escaped_columns = [...escapedColumns]
    .sort()
    .join("|");
  validateMachineCell(
    protectedValues.formula_escaped_columns,
    "formula_escaped_columns",
    "column-list",
  );

  return encodeCsvRecord(
    TRADE_EXPLORERS_CSV_COLUMNS.map((column) => protectedValues[column] ?? ""),
  );
}

function validateMachineCell(
  value: string,
  column: TradeExplorersCsvColumn,
  kind: Exclude<CellKind, "human-text">,
): string {
  if (value === "") {
    return value;
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(
      `CSV controlled column ${column} contains a forbidden control character.`,
    );
  }

  const patterns: Record<Exclude<CellKind, "human-text">, RegExp> = {
    "baci-release": /^V\d{6}$/u,
    "code-list": /^[A-Za-z0-9][A-Za-z0-9_]*(?:\|[A-Za-z0-9][A-Za-z0-9_]*)*$/u,
    "column-list": /^[a-z][a-z0-9_]*(?:\|[a-z][a-z0-9_]*)*$/u,
    date: /^\d{4}-\d{2}-\d{2}$/u,
    decimal: /^\d+(?:\.\d+)?$/u,
    "economy-code": /^\d{1,3}$/u,
    enum: /^[A-Za-z][A-Za-z0-9_-]*$/u,
    "export-id": /^tex1-[a-f0-9]{64}$/u,
    identifier: /^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u,
    integer: /^\d+$/u,
    iso3: /^[A-Z]{3}$/u,
    literal: /^[^\u0000-\u001f\u007f]+$/u,
    "product-code": /^\d{6}$/u,
    sha256: /^[a-f0-9]{64}$/u,
    timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
    url: /^https:\/\/[^\s]+$/u,
  };
  if (!patterns[kind].test(value)) {
    throw new TypeError(
      `CSV controlled column ${column} violates its ${kind} grammar.`,
    );
  }
  return value;
}
