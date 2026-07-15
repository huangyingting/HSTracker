import { createHash } from "node:crypto";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { SupplierCompetitionV1Payload } from "../domain/trade-analytics/supplier-competition-v1-adapter";
import type {
  ProvisionalSupplierShare,
  SupplierCompetitionShare,
} from "../domain/supplier-competition/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import {
  SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
  type SupplierCompetitionCsvIdentity,
} from "./supplier-competition-csv-contract";
import { assertSupplierCompetitionExportContext } from "./supplier-competition-export-context";
import {
  encodeCsvRecord,
  productTranslationStatus,
  protectHumanText,
} from "./csv-grammar";

export { SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION };

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
  | "date"
  | "decimal"
  | "economy-code"
  | "enum"
  | "enum-list"
  | "export-id"
  | "human-text"
  | "identifier"
  | "integer"
  | "iso3"
  | "literal"
  | "percentage-6"
  | "product-code"
  | "sha256"
  | "timestamp"
  | "url"
  | "year-list"
  | "column-list";

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
  ["value_unit", "enum"],
  ["finalized_window_start", "integer"],
  ["finalized_window_end", "integer"],
  ["provisional_year", "integer"],
  ["ingested_year_start", "integer"],
  ["ingested_year_end", "integer"],
  ["baci_release", "baci-release"],
  ["source_update_date", "date"],
  ["cohort_budget", "integer"],
  ["cohort_size", "integer"],
  ["empty_reason", "enum"],
  ["finalized_pooled_value_current_usd", "decimal"],
  ["concentration_state", "enum"],
  ["concentration_hhi", "percentage-6"],
  ["concentration_scale", "integer"],
  ["concentration_unavailable_reason", "enum"],
  ["quality_warnings", "enum-list"],
  ["provisional_market_state", "enum"],
  ["supplier_name_en", "human-text"],
  ["supplier_code_baci", "economy-code"],
  ["supplier_iso3", "iso3"],
  ["supplier_identity_note", "human-text"],
  ["supplier_pooled_value_current_usd", "decimal"],
  ["supplier_share_percent", "percentage-6"],
  ["supplier_recorded_years", "year-list"],
  ["supplier_no_recorded_flow_years", "year-list"],
  ["supplier_missing_years", "year-list"],
  ["supplier_quantity_coverage_rate", "percentage-6"],
  ["supplier_provisional_state", "enum"],
  ["supplier_provisional_value_current_usd", "decimal"],
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

type SupplierCompetitionsCsvColumn = (typeof CSV_SCHEMA)[number][0];
type SupplierCompetitionsCsvRow = Record<SupplierCompetitionsCsvColumn, string>;

export const SUPPLIER_COMPETITIONS_CSV_COLUMNS: readonly SupplierCompetitionsCsvColumn[] =
  Object.freeze(CSV_SCHEMA.map(([column]) => column));

export type SupplierCompetitionCsvInput = {
  result: SupplierCompetitionV1Payload;
  product: Omit<ProductSearchProduct, "translationStatus"> & {
    translationStatus:
      | ProductSearchProduct["translationStatus"]
      | "fallback-english";
  };
  manifest: CurrentAnalysisManifest;
};

export type SupplierCompetitionCsvRepresentation = {
  schemaVersion: typeof SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION;
  exportId: string;
  filename: string;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
};

export class SupplierCompetitionCsvRepresentationError extends Error {
  readonly code = "EXPORT_REPRESENTATION_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "SupplierCompetitionCsvRepresentationError";
  }
}

export function serializeSupplierCompetitionCsv({
  result,
  product,
  manifest,
}: SupplierCompetitionCsvInput): SupplierCompetitionCsvRepresentation {
  validateBoundContext(result, product, manifest);

  const exportId = createExportId({
    analysisBuildId: result.analysisBuildId,
    importerCode: result.query.importer.code,
    productCode: result.query.product.code,
    productSearchBuildId: manifest.productSearchBuildId,
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schemaVersion: SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
  });
  const common = createCommonRow(result, product, manifest, exportId);
  const provisionalByCode = new Map(
    result.provisionalSupplierShares.map((share) => [
      share.economy.code,
      share,
    ]),
  );
  const finalizedCodes = new Set(
    result.supplierShares.map((share) => share.economy.code),
  );
  const rows: SupplierCompetitionsCsvRow[] = [
    ...result.supplierShares.map((share) =>
      createSupplierRow(
        common,
        "SUPPLIER",
        share,
        provisionalByCode.get(share.economy.code) ?? null,
      ),
    ),
    ...result.provisionalSupplierShares
      .filter((share) => !finalizedCodes.has(share.economy.code))
      .map((share) =>
        createProvisionalOnlySupplierRow(common, share),
      ),
  ];
  if (rows.length === 0) {
    rows.push({ ...common, row_type: "EMPTY_ANALYSIS" });
  }
  const records = [
    encodeCsvRecord(SUPPLIER_COMPETITIONS_CSV_COLUMNS),
    ...rows.map(encodeRow),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  if (bytes.byteLength > MAX_ENTITY_BYTES) {
    throw new SupplierCompetitionCsvRepresentationError(
      `Supplier Competition export exceeds ${MAX_ENTITY_BYTES} bytes.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
    exportId,
    filename: [
      "hs-tracker_supplier-competition_for-",
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

function createExportId(identity: SupplierCompetitionCsvIdentity): string {
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
  return `scx1-${digest}`;
}

function createCommonRow(
  result: SupplierCompetitionV1Payload,
  product: SupplierCompetitionCsvInput["product"],
  manifest: CurrentAnalysisManifest,
  exportId: string,
): SupplierCompetitionsCsvRow {
  const concentration = result.concentration;
  return Object.assign(createBlankRow(), {
    export_schema_version: SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
    export_id: exportId,
    recipe: "supplier-competition-v1",
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
    cohort_budget: String(result.cohortBudget),
    cohort_size: String(result.cohortSize),
    empty_reason: result.emptyReason ?? "",
    finalized_pooled_value_current_usd: result.finalizedPooledValueCurrentUsd,
    concentration_state: concentration.state,
    concentration_hhi:
      concentration.state === "COMPUTED"
        ? concentration.herfindahlHirschmanIndex
        : "",
    concentration_scale:
      concentration.state === "COMPUTED" ? String(concentration.scale) : "",
    concentration_unavailable_reason:
      concentration.state === "UNAVAILABLE" ? concentration.reason : "",
    quality_warnings: result.qualityWarnings.join("|"),
    provisional_market_state: result.provisionalMarketState,
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
  } satisfies Partial<SupplierCompetitionsCsvRow>);
}

function createSupplierRow(
  common: SupplierCompetitionsCsvRow,
  rowType: "SUPPLIER",
  share: SupplierCompetitionShare,
  provisional: ProvisionalSupplierShare | null,
): SupplierCompetitionsCsvRow {
  return Object.assign({ ...common }, {
    row_type: rowType,
    supplier_name_en: share.economy.name,
    supplier_code_baci: share.economy.code,
    supplier_iso3: share.economy.iso3 ?? "",
    supplier_identity_note: share.economy.identityNote ?? "",
    supplier_pooled_value_current_usd: share.pooledValueCurrentUsd,
    supplier_share_percent: share.sharePercent,
    supplier_recorded_years: share.recordedYears.join("|"),
    supplier_no_recorded_flow_years: share.noRecordedFlowYears.join("|"),
    supplier_missing_years: share.missingYears.join("|"),
    supplier_quantity_coverage_rate: share.quantityCoverageRate ?? "",
    supplier_provisional_state: provisional?.bilateralState ?? "NOT_APPLICABLE",
    supplier_provisional_value_current_usd:
      provisional?.valueCurrentUsd ?? "",
  } satisfies Partial<SupplierCompetitionsCsvRow>);
}

function createProvisionalOnlySupplierRow(
  common: SupplierCompetitionsCsvRow,
  share: ProvisionalSupplierShare,
): SupplierCompetitionsCsvRow {
  return Object.assign({ ...common }, {
    row_type: "PROVISIONAL_ONLY_SUPPLIER",
    supplier_name_en: share.economy.name,
    supplier_code_baci: share.economy.code,
    supplier_iso3: share.economy.iso3 ?? "",
    supplier_identity_note: share.economy.identityNote ?? "",
    supplier_provisional_state: share.bilateralState,
    supplier_provisional_value_current_usd: share.valueCurrentUsd ?? "",
  } satisfies Partial<SupplierCompetitionsCsvRow>);
}

function createBlankRow(): SupplierCompetitionsCsvRow {
  return Object.fromEntries(
    SUPPLIER_COMPETITIONS_CSV_COLUMNS.map((column) => [column, ""]),
  ) as SupplierCompetitionsCsvRow;
}

function encodeRow(row: SupplierCompetitionsCsvRow): string {
  const escapedColumns = new Set<SupplierCompetitionsCsvColumn>();
  const protectedValues = Object.fromEntries(
    CSV_SCHEMA.filter(([column]) => column !== "formula_escaped_columns").map(
      ([column, kind]) => [
        column,
        kind === "human-text"
          ? protectHumanText(row[column], column, escapedColumns)
          : validateMachineCell(row[column], column, kind),
      ],
    ),
  ) as Partial<SupplierCompetitionsCsvRow>;
  protectedValues.formula_escaped_columns = [...escapedColumns]
    .sort()
    .join("|");
  validateMachineCell(
    protectedValues.formula_escaped_columns,
    "formula_escaped_columns",
    "column-list",
  );

  return encodeCsvRecord(
    SUPPLIER_COMPETITIONS_CSV_COLUMNS.map(
      (column) => protectedValues[column] ?? "",
    ),
  );
}

function validateMachineCell(
  value: string,
  column: SupplierCompetitionsCsvColumn,
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
    "column-list": /^[a-z][a-z0-9_]*(?:\|[a-z][a-z0-9_]*)*$/u,
    date: /^\d{4}-\d{2}-\d{2}$/u,
    decimal: /^\d+(?:\.\d+)?$/u,
    "economy-code": /^\d{1,3}$/u,
    enum: /^[A-Z][A-Z0-9_]*$/u,
    "enum-list": /^[A-Z][A-Z0-9_]*(?:\|[A-Z][A-Z0-9_]*)*$/u,
    "export-id": /^scx1-[a-f0-9]{64}$/u,
    identifier: /^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u,
    integer: /^\d+$/u,
    iso3: /^[A-Z]{3}$/u,
    literal: /^[^\u0000-\u001f\u007f]+$/u,
    "percentage-6": /^-?\d+\.\d{6}$/u,
    "product-code": /^\d{6}$/u,
    sha256: /^[a-f0-9]{64}$/u,
    timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
    url: /^https:\/\/[^\s]+$/u,
    "year-list": /^\d{4}(?:\|\d{4})*$/u,
  };
  if (!patterns[kind].test(value)) {
    throw new TypeError(
      `CSV controlled column ${column} violates its ${kind} grammar.`,
    );
  }
  return value;
}

function validateBoundContext(
  result: SupplierCompetitionV1Payload,
  product: SupplierCompetitionCsvInput["product"],
  manifest: CurrentAnalysisManifest,
): void {
  assertSupplierCompetitionExportContext(result, manifest);
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
      `Supplier Competition export has an incompatible ${mismatch[2]} binding.`,
    );
  }
}
