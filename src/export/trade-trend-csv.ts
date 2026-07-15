import { createHash } from "node:crypto";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { TradeTrendV1Payload } from "../domain/trade-analytics/trade-trend-v1-adapter";
import type { TradeTrendObservation } from "../domain/trade-trend/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import {
  TRADE_TRENDS_CSV_SCHEMA_VERSION,
  type TradeTrendCsvIdentity,
} from "./trade-trend-csv-contract";
import { assertTradeTrendExportContext } from "./trade-trend-export-context";
import {
  encodeCsvRecord,
  productTranslationStatus,
  protectHumanText,
} from "./csv-grammar";

export { TRADE_TRENDS_CSV_SCHEMA_VERSION };

const PRODUCT_TRANSLATION_ATTRIBUTION =
  "Simplified Chinese product description: HS Tracker project auxiliary translation of the CEPII BACI English source description.";
const SOURCE_DOCUMENTATION_URL =
  "https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html";
const SOURCE_LICENSE = "Etalab Open Licence 2.0";
const SOURCE_LICENSE_URL =
  "https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf";
const MAX_ENTITY_BYTES =
  RUNTIME_RESOURCE_POLICY.analysisBudget.maxResultBytes;

type CellKind =
  | "baci-release"
  | "boolean"
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
  | "percentage-6"
  | "product-code"
  | "sha256"
  | "signed-decimal"
  | "timestamp"
  | "url";

const CSV_SCHEMA = [
  ["row_type", "enum"],
  ["export_schema_version", "identifier"],
  ["export_id", "export-id"],
  ["recipe", "identifier"],
  ["analysis_identity", "identifier"],
  ["dataset_package_identity", "identifier"],
  ["analysis_id", "identifier"],
  ["analysis_build_id", "identifier"],
  ["analysis_release_catalog_sha256", "sha256"],
  ["importer_name_en", "human-text"],
  ["importer_code_baci", "economy-code"],
  ["importer_iso3", "iso3"],
  ["importer_identity_note", "human-text"],
  ["hs_revision", "identifier"],
  ["product_code", "product-code"],
  ["product_description_en", "human-text"],
  ["product_description_zh_hans", "human-text"],
  ["product_translation_status", "enum"],
  ["product_translation_attribution", "human-text"],
  ["observation_year", "integer"],
  ["observation_state", "enum"],
  ["observation_value_current_usd", "decimal"],
  ["value_unit", "enum"],
  ["is_provisional_year", "boolean"],
  ["finalized_window_start", "integer"],
  ["finalized_window_end", "integer"],
  ["provisional_year", "integer"],
  ["ingested_year_start", "integer"],
  ["ingested_year_end", "integer"],
  ["baci_release", "baci-release"],
  ["source_update_date", "date"],
  ["summary_state", "enum"],
  ["summary_unavailable_reason", "enum"],
  ["summary_first_recorded_year", "integer"],
  ["summary_first_recorded_value_current_usd", "decimal"],
  ["summary_last_recorded_year", "integer"],
  ["summary_last_recorded_value_current_usd", "decimal"],
  ["summary_span_years", "integer"],
  ["summary_absolute_change_current_usd", "signed-decimal"],
  ["summary_percentage_change_percent", "percentage-6"],
  ["summary_cagr_percent", "percentage-6"],
  ["discovery_disclaimer", "human-text"],
  ["artifact_build_id", "identifier"],
  ["artifact_schema_version", "identifier"],
  ["artifact_sha256", "sha256"],
  ["source_status_snapshot_id", "identifier"],
  ["freshness_status_id", "identifier"],
  ["freshness_state", "enum"],
  ["freshness_checked_at", "timestamp"],
  ["freshness_effective_at", "timestamp"],
  ["served_baci_release", "baci-release"],
  ["latest_known_baci_release", "baci-release"],
  ["product_search_build_id", "identifier"],
  ["source_attribution", "human-text"],
  ["source_documentation_url", "url"],
  ["source_license", "literal"],
  ["source_license_url", "url"],
  ["formula_escaped_columns", "column-list"],
] as const satisfies readonly (readonly [string, CellKind])[];

type TradeTrendsCsvColumn = (typeof CSV_SCHEMA)[number][0];
type TradeTrendsCsvRow = Record<TradeTrendsCsvColumn, string>;

export const TRADE_TRENDS_CSV_COLUMNS: readonly TradeTrendsCsvColumn[] =
  Object.freeze(CSV_SCHEMA.map(([column]) => column));

export type TradeTrendCsvInput = {
  result: TradeTrendV1Payload;
  product: Omit<ProductSearchProduct, "translationStatus"> & {
    translationStatus:
      | ProductSearchProduct["translationStatus"]
      | "fallback-english";
  };
  manifest: CurrentAnalysisManifest;
};

export type TradeTrendCsvRepresentation = {
  schemaVersion: typeof TRADE_TRENDS_CSV_SCHEMA_VERSION;
  exportId: string;
  filename: string;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
};

export class TradeTrendCsvRepresentationError extends Error {
  readonly code = "EXPORT_REPRESENTATION_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "TradeTrendCsvRepresentationError";
  }
}

export function serializeTradeTrendCsv({
  result,
  product,
  manifest,
}: TradeTrendCsvInput): TradeTrendCsvRepresentation {
  validateBoundContext(result, product, manifest);

  const exportId = createExportId({
    analysisBuildId: result.analysisBuildId,
    importerCode: result.query.importer.code,
    productCode: result.query.product.code,
    productSearchBuildId: manifest.productSearchBuildId,
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schemaVersion: TRADE_TRENDS_CSV_SCHEMA_VERSION,
  });
  const common = createCommonRow(result, product, manifest, exportId);
  const rows = [
    ...result.finalizedObservations.map((observation) =>
      createObservationRow(common, "FINALIZED", observation, false),
    ),
    createObservationRow(
      common,
      "PROVISIONAL",
      result.provisionalObservation ?? {
        year: result.provenance.provisionalYear,
        state: "MISSING_OBSERVATION",
      },
      true,
    ),
  ];
  const records = [
    encodeCsvRecord(TRADE_TRENDS_CSV_COLUMNS),
    ...rows.map(encodeRow),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  if (bytes.byteLength > MAX_ENTITY_BYTES) {
    throw new TradeTrendCsvRepresentationError(
      `Trade Trend export exceeds ${MAX_ENTITY_BYTES} bytes.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: TRADE_TRENDS_CSV_SCHEMA_VERSION,
    exportId,
    filename: [
      "hs-tracker_trade-trend_for-",
      result.query.importer.code,
      "_HS12-",
      result.query.product.code,
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

function createExportId(identity: TradeTrendCsvIdentity): string {
  const digestInput = [
    `schema=${identity.schemaVersion}`,
    `analysis_build_id=${identity.analysisBuildId}`,
    `importer_code_baci=${identity.importerCode}`,
    `product_code=${identity.productCode}`,
    `product_search_build_id=${identity.productSearchBuildId}`,
    `freshness_status_id=${identity.freshnessStatusId}`,
    "",
  ].join("\n");
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return `ttx1-${digest}`;
}

function createCommonRow(
  result: TradeTrendV1Payload,
  product: TradeTrendCsvInput["product"],
  manifest: CurrentAnalysisManifest,
  exportId: string,
): TradeTrendsCsvRow {
  const summary = result.summary;
  return Object.assign(createBlankRow(), {
    export_schema_version: TRADE_TRENDS_CSV_SCHEMA_VERSION,
    export_id: exportId,
    recipe: "trade-trend-v1",
    analysis_identity: result.analysisIdentity,
    dataset_package_identity: result.datasetPackageIdentity,
    analysis_id: result.analysisId,
    analysis_build_id: result.analysisBuildId,
    analysis_release_catalog_sha256: result.analysisReleaseCatalogSha256,
    importer_name_en: result.query.importer.name,
    importer_code_baci: result.query.importer.code,
    importer_iso3: result.query.importer.iso3 ?? "",
    importer_identity_note: result.query.importer.identityNote ?? "",
    hs_revision: result.query.product.hsRevision,
    product_code: result.query.product.code,
    product_description_en: result.query.product.descriptionEn,
    product_description_zh_hans:
      product.translationStatus === "fallback-english"
        ? product.sourceDescriptionEn
        : product.auxiliaryDescriptionZhHans,
    product_translation_status: productTranslationStatus(
      product.translationStatus,
    ),
    product_translation_attribution: PRODUCT_TRANSLATION_ATTRIBUTION,
    value_unit: result.provenance.valueUnit,
    finalized_window_start: String(result.provenance.finalizedWindow.start),
    finalized_window_end: String(result.provenance.finalizedWindow.end),
    provisional_year: String(result.provenance.provisionalYear),
    ingested_year_start: String(result.provenance.ingestedYears.start),
    ingested_year_end: String(result.provenance.ingestedYears.end),
    baci_release: result.provenance.baciRelease,
    source_update_date: result.provenance.sourceUpdateDate,
    summary_state: summary.state,
    summary_unavailable_reason:
      summary.state === "UNAVAILABLE" ? summary.reason : "",
    summary_first_recorded_year:
      summary.state === "AVAILABLE"
        ? String(summary.firstRecordedPositive.year)
        : "",
    summary_first_recorded_value_current_usd:
      summary.state === "AVAILABLE"
        ? summary.firstRecordedPositive.valueCurrentUsd
        : "",
    summary_last_recorded_year:
      summary.state === "AVAILABLE"
        ? String(summary.lastRecordedPositive.year)
        : "",
    summary_last_recorded_value_current_usd:
      summary.state === "AVAILABLE"
        ? summary.lastRecordedPositive.valueCurrentUsd
        : "",
    summary_span_years:
      summary.state === "AVAILABLE" ? String(summary.spanYears) : "",
    summary_absolute_change_current_usd:
      summary.state === "AVAILABLE" ? summary.absoluteChangeCurrentUsd : "",
    summary_percentage_change_percent:
      summary.state === "AVAILABLE" ? summary.percentageChangePercent : "",
    summary_cagr_percent:
      summary.state === "AVAILABLE" ? summary.cagrPercent : "",
    discovery_disclaimer: result.discoveryDisclaimer,
    artifact_build_id: result.provenance.artifactBuildId,
    artifact_schema_version: result.provenance.artifactSchemaVersion,
    artifact_sha256: result.provenance.artifactSha256,
    source_status_snapshot_id: manifest.freshness.sourceStatusSnapshotId,
    freshness_status_id: manifest.freshness.freshnessStatusId,
    freshness_state: manifest.freshness.state,
    freshness_checked_at: manifest.freshness.checkedAt,
    freshness_effective_at: manifest.freshness.effectiveAt,
    served_baci_release: manifest.freshness.servedBaciRelease,
    latest_known_baci_release: manifest.freshness.latestKnownBaciRelease,
    product_search_build_id: manifest.productSearchBuildId,
    source_attribution: `Source: CEPII BACI, HS 2012, ${result.provenance.baciRelease} (updated ${result.provenance.sourceUpdateDate}), Etalab Open Licence 2.0.`,
    source_documentation_url: SOURCE_DOCUMENTATION_URL,
    source_license: SOURCE_LICENSE,
    source_license_url: SOURCE_LICENSE_URL,
  } satisfies Partial<TradeTrendsCsvRow>);
}

function createObservationRow(
  common: TradeTrendsCsvRow,
  rowType: "FINALIZED" | "PROVISIONAL",
  observation: TradeTrendObservation,
  isProvisionalYear: boolean,
): TradeTrendsCsvRow {
  return Object.assign({ ...common }, {
    row_type: rowType,
    observation_year: String(observation.year),
    observation_state: observation.state,
    observation_value_current_usd:
      observation.state === "RECORDED_POSITIVE"
        ? observation.valueCurrentUsd
        : "",
    is_provisional_year: String(isProvisionalYear),
  } satisfies Partial<TradeTrendsCsvRow>);
}

function createBlankRow(): TradeTrendsCsvRow {
  return Object.fromEntries(
    TRADE_TRENDS_CSV_COLUMNS.map((column) => [column, ""]),
  ) as TradeTrendsCsvRow;
}

function encodeRow(row: TradeTrendsCsvRow): string {
  const escapedColumns = new Set<TradeTrendsCsvColumn>();
  const protectedValues = Object.fromEntries(
    CSV_SCHEMA.filter(([column]) => column !== "formula_escaped_columns").map(
      ([column, kind]) => [
        column,
        kind === "human-text"
          ? protectHumanText(row[column], column, escapedColumns)
          : validateMachineCell(row[column], column, kind),
      ],
    ),
  ) as Partial<TradeTrendsCsvRow>;
  protectedValues.formula_escaped_columns = [...escapedColumns]
    .sort()
    .join("|");
  validateMachineCell(
    protectedValues.formula_escaped_columns,
    "formula_escaped_columns",
    "column-list",
  );

  return encodeCsvRecord(
    TRADE_TRENDS_CSV_COLUMNS.map((column) => protectedValues[column] ?? ""),
  );
}

function validateMachineCell(
  value: string,
  column: TradeTrendsCsvColumn,
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
    boolean: /^(?:true|false)$/u,
    "column-list": /^[a-z][a-z0-9_]*(?:\|[a-z][a-z0-9_]*)*$/u,
    date: /^\d{4}-\d{2}-\d{2}$/u,
    decimal: /^\d+(?:\.\d+)?$/u,
    "economy-code": /^\d{1,3}$/u,
    enum: /^[A-Z][A-Z0-9_]*$/u,
    "export-id": /^ttx1-[a-f0-9]{64}$/u,
    identifier: /^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u,
    integer: /^\d+$/u,
    iso3: /^[A-Z]{3}$/u,
    literal: /^[^\u0000-\u001f\u007f]+$/u,
    "percentage-6": /^-?\d+\.\d{6}$/u,
    "product-code": /^\d{6}$/u,
    sha256: /^[a-f0-9]{64}$/u,
    "signed-decimal": /^-?\d+(?:\.\d+)?$/u,
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

function validateBoundContext(
  result: TradeTrendV1Payload,
  product: TradeTrendCsvInput["product"],
  manifest: CurrentAnalysisManifest,
): void {
  assertTradeTrendExportContext(result, manifest);
  const productBindings: readonly (readonly [unknown, unknown, string])[] = [
    [result.query.product.hsRevision, product.hsRevision, "product HS revision"],
    [result.query.product.code, product.code, "product code"],
    [
      result.query.product.descriptionEn,
      product.sourceDescriptionEn,
      "product source description",
    ],
  ];
  const mismatch = productBindings.find(([left, right]) => left !== right);
  if (mismatch !== undefined) {
    throw new TypeError(
      `Trade Trend export has an incompatible ${mismatch[2]} binding.`,
    );
  }
}

