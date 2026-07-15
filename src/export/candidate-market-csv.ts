import { createHash } from "node:crypto";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import {
  CANDIDATE_MARKET_SCORE_FORMULA,
  type CandidateMarket,
  type CandidateMarketResult,
  type CaveatCode,
} from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import {
  CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  type CandidateMarketCsvIdentity,
} from "./candidate-market-csv-contract";
import { assertCandidateMarketExportContext } from "./candidate-market-export-context";
import {
  encodeCsvRecord,
  productTranslationStatus,
  protectHumanText,
} from "./csv-grammar";

export { CANDIDATE_MARKETS_CSV_SCHEMA_VERSION };

const PRODUCT_TRANSLATION_ATTRIBUTION =
  "Simplified Chinese product description: HS Tracker project auxiliary translation of the CEPII BACI English source description.";
const SOURCE_DOCUMENTATION_URL =
  "https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html";
const SOURCE_LICENSE = "Etalab Open Licence 2.0";
const SOURCE_LICENSE_URL =
  "https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf";
const MAX_CANDIDATE_ROWS =
  RUNTIME_RESOURCE_POLICY.analysisBudget.maxResultRows;
const MAX_ENTITY_BYTES =
  RUNTIME_RESOURCE_POLICY.analysisBudget.maxResultBytes;

type CellKind =
  | "baci-release"
  | "boolean"
  | "column-list"
  | "date"
  | "decimal-6"
  | "deduction-list"
  | "economy-code"
  | "enum"
  | "export-id"
  | "human-text"
  | "identifier"
  | "integer"
  | "iso3"
  | "literal"
  | "percentage-3"
  | "product-code"
  | "sha256"
  | "signed-integer"
  | "timestamp"
  | "token-list"
  | "url"
  | "year-list";

const CSV_SCHEMA = [
  ["row_type", "enum"],
  ["export_schema_version", "identifier"],
  ["export_id", "export-id"],
  ["empty_reason", "enum"],
  ["exporter_name_en", "human-text"],
  ["exporter_code_baci", "economy-code"],
  ["exporter_iso3", "iso3"],
  ["hs_revision", "identifier"],
  ["product_code", "product-code"],
  ["product_description_en", "human-text"],
  ["product_description_zh_hans", "human-text"],
  ["product_translation_status", "enum"],
  ["product_translation_attribution", "human-text"],
  ["candidate_market_name_en", "human-text"],
  ["candidate_market_code_baci", "economy-code"],
  ["candidate_market_iso3", "iso3"],
  ["candidate_market_identity_note", "human-text"],
  ["rank", "integer"],
  ["rank_tie_size", "integer"],
  ["rank_percentile", "percentage-3"],
  ["cohort_size", "integer"],
  ["candidate_market_score", "integer"],
  ["data_confidence_label", "enum"],
  ["data_confidence_score", "integer"],
  ["observed_score_year_count", "integer"],
  ["observed_score_years", "year-list"],
  ["missing_score_years", "year-list"],
  ["latest_finalized_observed_year", "integer"],
  ["finalized_cutoff_year", "integer"],
  ["score_window_start", "integer"],
  ["score_window_end", "integer"],
  ["score_formula", "human-text"],
  ["market_size_state", "enum"],
  ["market_size_mean_current_usd", "integer"],
  ["market_size_percentile", "integer"],
  ["market_growth_state", "enum"],
  ["market_growth_reason_codes", "token-list"],
  ["market_growth_annual_rate", "decimal-6"],
  ["market_growth_percentile", "integer"],
  ["recorded_foothold_state", "enum"],
  ["recorded_foothold_share", "decimal-6"],
  ["bilateral_flow_state", "enum"],
  ["recorded_foothold_percentile", "integer"],
  ["supplier_diversity_state", "enum"],
  ["supplier_diversity_reason_code", "enum"],
  ["supplier_diversity_index", "decimal-6"],
  ["supplier_diversity_years_used", "year-list"],
  ["supplier_diversity_percentile", "integer"],
  ["confidence_deductions", "deduction-list"],
  ["sparse_evidence_cap_applied", "boolean"],
  ["quantity_coverage_rate", "decimal-6"],
  ["stability_3y_window_start", "integer"],
  ["stability_3y_window_end", "integer"],
  ["stability_3y_state", "enum"],
  ["stability_3y_spearman", "decimal-6"],
  ["stability_10y_window_start", "integer"],
  ["stability_10y_window_end", "integer"],
  ["stability_10y_state", "enum"],
  ["stability_10y_spearman", "decimal-6"],
  ["product_series_discontinuity_years", "year-list"],
  ["caveat_codes", "token-list"],
  ["caveat_text", "human-text"],
  ["provisional_year", "integer"],
  ["provisional_state", "enum"],
  ["provisional_market_import_current_usd", "integer"],
  ["provisional_bilateral_current_usd", "integer"],
  ["provisional_bilateral_state", "enum"],
  ["provisional_recorded_bilateral_share", "decimal-6"],
  ["provisional_quantity_coverage_rate", "decimal-6"],
  ["revision_comparison_release", "baci-release"],
  ["release_revision_state", "enum"],
  ["previous_release_recomputed_score", "integer"],
  ["score_change", "signed-integer"],
  ["previous_release_recomputed_rank_percentile", "percentage-3"],
  ["rank_percentile_change", "percentage-3"],
  ["release_revision_material_change", "boolean"],
  ["release_revision_not_compared_reason", "enum"],
  ["release_revision_no_longer_eligible_count", "integer"],
  ["previous_artifact_sha256", "sha256"],
  ["baci_release", "baci-release"],
  ["source_update_date", "date"],
  ["ingested_year_start", "integer"],
  ["ingested_year_end", "integer"],
  ["score_version", "identifier"],
  ["analysis_id", "identifier"],
  ["analysis_build_id", "identifier"],
  ["analysis_release_catalog_sha256", "sha256"],
  ["product_search_build_id", "identifier"],
  ["source_status_snapshot_id", "identifier"],
  ["freshness_status_id", "identifier"],
  ["freshness_state", "enum"],
  ["freshness_checked_at", "timestamp"],
  ["freshness_effective_at", "timestamp"],
  ["served_baci_release", "baci-release"],
  ["latest_known_baci_release", "baci-release"],
  ["artifact_build_id", "identifier"],
  ["artifact_schema_version", "identifier"],
  ["artifact_built_at", "timestamp"],
  ["artifact_sha256", "sha256"],
  ["source_attribution", "human-text"],
  ["source_documentation_url", "url"],
  ["source_license", "literal"],
  ["source_license_url", "url"],
  ["discovery_disclaimer", "human-text"],
  ["formula_escaped_columns", "column-list"],
] as const satisfies readonly (readonly [string, CellKind])[];

type CandidateMarketsCsvColumn = (typeof CSV_SCHEMA)[number][0];
type CandidateMarketsCsvRow = Record<CandidateMarketsCsvColumn, string>;

export const CANDIDATE_MARKETS_CSV_COLUMNS: readonly CandidateMarketsCsvColumn[] =
  Object.freeze(CSV_SCHEMA.map(([column]) => column));

export type CandidateMarketCsvInput = {
  result: CandidateMarketResult;
  product: Omit<ProductSearchProduct, "translationStatus"> & {
    translationStatus:
      | ProductSearchProduct["translationStatus"]
      | "fallback-english";
  };
  manifest: CurrentAnalysisManifest;
};

export type CandidateMarketCsvRepresentation = {
  schemaVersion: typeof CANDIDATE_MARKETS_CSV_SCHEMA_VERSION;
  exportId: string;
  filename: string;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
};

export class CandidateMarketCsvRepresentationError extends Error {
  readonly code = "EXPORT_REPRESENTATION_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "CandidateMarketCsvRepresentationError";
  }
}

export function serializeCandidateMarketCsv({
  result,
  product,
  manifest,
}: CandidateMarketCsvInput): CandidateMarketCsvRepresentation {
  validateBoundContext(result, product, manifest);
  if (
    result.candidates.length > MAX_CANDIDATE_ROWS ||
    result.cohortSize > MAX_CANDIDATE_ROWS
  ) {
    throw new CandidateMarketCsvRepresentationError(
      `Candidate Market export exceeds ${MAX_CANDIDATE_ROWS} rows.`,
    );
  }
  if (result.cohortSize !== result.candidates.length) {
    throw new TypeError(
      "Candidate Market export cohort size does not match its result rows.",
    );
  }

  const exportId = createExportId({
    analysisBuildId: result.analysisBuildId,
    exporterCode: result.query.exporter.code,
    productCode: result.query.product.code,
    productSearchBuildId: manifest.productSearchBuildId,
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schemaVersion: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  });
  const common = createCommonRow(result, product, manifest, exportId);
  const rows =
    result.candidates.length === 0
      ? [createEmptyAnalysisRow(common, result)]
      : [...result.candidates]
          .sort(
            (left, right) =>
              left.rank - right.rank ||
              Number(left.economy.code) - Number(right.economy.code),
          )
          .map((candidate) => createCandidateRow(common, result, candidate));
  const records = [
    encodeCsvRecord(CANDIDATE_MARKETS_CSV_COLUMNS),
    ...rows.map(encodeRow),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  if (bytes.byteLength > MAX_ENTITY_BYTES) {
    throw new CandidateMarketCsvRepresentationError(
      `Candidate Market export exceeds ${MAX_ENTITY_BYTES} bytes.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
    exportId,
    filename: [
      "hs-tracker_candidate-markets_from-",
      result.query.exporter.code,
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

function createExportId(identity: CandidateMarketCsvIdentity): string {
  const digestInput = [
    `schema=${identity.schemaVersion}`,
    `analysis_build_id=${identity.analysisBuildId}`,
    `exporter_code_baci=${identity.exporterCode}`,
    `product_code=${identity.productCode}`,
    `product_search_build_id=${identity.productSearchBuildId}`,
    `freshness_status_id=${identity.freshnessStatusId}`,
    "",
  ].join("\n");
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return `cmx1-${digest}`;
}

function createCommonRow(
  result: CandidateMarketResult,
  product: CandidateMarketCsvInput["product"],
  manifest: CurrentAnalysisManifest,
  exportId: string,
): CandidateMarketsCsvRow {
  return Object.assign(createBlankRow(), {
    export_schema_version: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
    export_id: exportId,
    exporter_name_en: result.query.exporter.name,
    exporter_code_baci: result.query.exporter.code,
    exporter_iso3: result.query.exporter.iso3 ?? "",
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
    cohort_size: String(result.cohortSize),
    finalized_cutoff_year: String(result.provenance.finalizedCutoffYear),
    score_window_start: String(result.provenance.scoreWindow.start),
    score_window_end: String(result.provenance.scoreWindow.end),
    score_formula: CANDIDATE_MARKET_SCORE_FORMULA,
    provisional_year: String(result.provenance.provisionalYear),
    revision_comparison_release:
      result.releaseRevisionSummary.comparisonRelease ?? "",
    release_revision_not_compared_reason:
      result.releaseRevisionSummary.notComparedReason ?? "",
    release_revision_no_longer_eligible_count:
      result.releaseRevisionSummary.noLongerEligibleCount === null
        ? ""
        : String(result.releaseRevisionSummary.noLongerEligibleCount),
    previous_artifact_sha256:
      result.releaseRevisionSummary.previousArtifactSha256 ?? "",
    baci_release: result.provenance.baciRelease,
    source_update_date: result.provenance.sourceUpdateDate,
    ingested_year_start: String(result.provenance.ingestedYears.start),
    ingested_year_end: String(result.provenance.ingestedYears.end),
    score_version: result.provenance.scoreVersion,
    analysis_id: result.analysisId,
    analysis_build_id: result.analysisBuildId,
    analysis_release_catalog_sha256: result.analysisReleaseCatalogSha256,
    product_search_build_id: manifest.productSearchBuildId,
    source_status_snapshot_id: manifest.freshness.sourceStatusSnapshotId,
    freshness_status_id: manifest.freshness.freshnessStatusId,
    freshness_state: manifest.freshness.state,
    freshness_checked_at: manifest.freshness.checkedAt,
    freshness_effective_at: manifest.freshness.effectiveAt,
    served_baci_release: manifest.freshness.servedBaciRelease,
    latest_known_baci_release: manifest.freshness.latestKnownBaciRelease,
    artifact_build_id: manifest.source.artifact.buildId,
    artifact_schema_version: manifest.source.artifact.schemaVersion,
    artifact_built_at: manifest.source.artifact.builtAt,
    artifact_sha256: manifest.source.artifact.sha256,
    source_attribution: `Source: CEPII BACI, HS 2012, ${result.provenance.baciRelease} (updated ${result.provenance.sourceUpdateDate}), Etalab Open Licence 2.0.`,
    source_documentation_url: SOURCE_DOCUMENTATION_URL,
    source_license: SOURCE_LICENSE,
    source_license_url: SOURCE_LICENSE_URL,
    discovery_disclaimer: result.discoveryDisclaimer,
  } satisfies Partial<CandidateMarketsCsvRow>);
}

function createCandidateRow(
  common: CandidateMarketsCsvRow,
  result: CandidateMarketResult,
  candidate: CandidateMarket,
): CandidateMarketsCsvRow {
  const revision = candidate.releaseRevision;
  return Object.assign({ ...common }, {
    row_type: "CANDIDATE",
    empty_reason: "",
    candidate_market_name_en: candidate.economy.name,
    candidate_market_code_baci: candidate.economy.code,
    candidate_market_iso3: candidate.economy.iso3 ?? "",
    candidate_market_identity_note: candidate.economy.identityNote ?? "",
    rank: String(candidate.rank),
    rank_tie_size: String(candidate.rankTieSize),
    rank_percentile: candidate.rankPercentile,
    candidate_market_score: String(candidate.score),
    data_confidence_label: candidate.confidence.label,
    data_confidence_score: String(candidate.confidence.score),
    observed_score_year_count: String(candidate.observedScoreYears.length),
    observed_score_years: joinList(candidate.observedScoreYears),
    missing_score_years: joinList(candidate.missingScoreYears),
    latest_finalized_observed_year: String(
      candidate.latestFinalizedObservedYear,
    ),
    market_size_state: candidate.components.marketSize.state,
    market_size_mean_current_usd: formatCurrentUsd(
      candidate.components.marketSize.meanCurrentUsd,
    ),
    market_size_percentile: String(
      candidate.components.marketSize.percentile,
    ),
    market_growth_state: candidate.components.marketGrowth.state,
    market_growth_reason_codes: joinList(
      candidate.components.marketGrowth.reasonCodes,
    ),
    market_growth_annual_rate:
      candidate.components.marketGrowth.annualRate ?? "",
    market_growth_percentile: String(
      candidate.components.marketGrowth.percentile,
    ),
    recorded_foothold_state: candidate.components.recordedFoothold.state,
    recorded_foothold_share: candidate.components.recordedFoothold.share,
    bilateral_flow_state:
      candidate.components.recordedFoothold.bilateralFlowState,
    recorded_foothold_percentile: String(
      candidate.components.recordedFoothold.percentile,
    ),
    supplier_diversity_state: candidate.components.supplierDiversity.state,
    supplier_diversity_reason_code:
      candidate.components.supplierDiversity.reasonCode ?? "",
    supplier_diversity_index:
      candidate.components.supplierDiversity.index ?? "",
    supplier_diversity_years_used: joinList(
      candidate.components.supplierDiversity.yearsUsed,
    ),
    supplier_diversity_percentile: String(
      candidate.components.supplierDiversity.percentile,
    ),
    confidence_deductions: candidate.confidence.deductions
      .map(({ code, points }) => `${code}=${points}`)
      .join("|"),
    sparse_evidence_cap_applied: String(
      candidate.confidence.sparseEvidenceCapApplied,
    ),
    quantity_coverage_rate: candidate.quantityCoverageRate ?? "",
    stability_3y_window_start: String(result.stability.threeYear.window.start),
    stability_3y_window_end: String(result.stability.threeYear.window.end),
    stability_3y_state: result.stability.threeYear.state,
    stability_3y_spearman:
      result.stability.threeYear.rankCorrelation ?? "",
    stability_10y_window_start: String(result.stability.tenYear.window.start),
    stability_10y_window_end: String(result.stability.tenYear.window.end),
    stability_10y_state: result.stability.tenYear.state,
    stability_10y_spearman:
      result.stability.tenYear.rankCorrelation ?? "",
    product_series_discontinuity_years: joinList(
      result.productSeriesDiscontinuityYears,
    ),
    caveat_codes: joinList(candidate.caveatCodes),
    caveat_text: candidate.caveatCodes.map(caveatText).join("; "),
    provisional_state: candidate.provisionalEvidence.marketState,
    provisional_market_import_current_usd:
      candidate.provisionalEvidence.marketImportCurrentUsd === null
        ? ""
        : formatCurrentUsd(
            candidate.provisionalEvidence.marketImportCurrentUsd,
          ),
    provisional_bilateral_current_usd:
      candidate.provisionalEvidence.bilateralCurrentUsd === null
        ? ""
        : formatCurrentUsd(candidate.provisionalEvidence.bilateralCurrentUsd),
    provisional_bilateral_state: candidate.provisionalEvidence.bilateralState,
    provisional_recorded_bilateral_share:
      candidate.provisionalEvidence.recordedBilateralShare ?? "",
    provisional_quantity_coverage_rate:
      candidate.provisionalEvidence.quantityCoverageRate ?? "",
    release_revision_state: revision.state,
    previous_release_recomputed_score:
      revision.previousReleaseRecomputedScore === null
        ? ""
        : String(revision.previousReleaseRecomputedScore),
    score_change:
      revision.scoreChange === null ? "" : String(revision.scoreChange),
    previous_release_recomputed_rank_percentile:
      revision.previousReleaseRecomputedRankPercentile ?? "",
    rank_percentile_change: revision.rankPercentileChange ?? "",
    release_revision_material_change:
      revision.materialChange === null ? "" : String(revision.materialChange),
    release_revision_not_compared_reason:
      revision.state === "NOT_COMPARED"
        ? (result.releaseRevisionSummary.notComparedReason ?? "")
        : "",
  } satisfies Partial<CandidateMarketsCsvRow>);
}

function createEmptyAnalysisRow(
  common: CandidateMarketsCsvRow,
  result: CandidateMarketResult,
): CandidateMarketsCsvRow {
  return Object.assign({ ...common }, {
    row_type: "EMPTY_ANALYSIS",
    empty_reason:
      result.emptyReason ?? "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
    release_revision_not_compared_reason: "",
  } satisfies Partial<CandidateMarketsCsvRow>);
}

function createBlankRow(): CandidateMarketsCsvRow {
  return Object.fromEntries(
    CANDIDATE_MARKETS_CSV_COLUMNS.map((column) => [column, ""]),
  ) as CandidateMarketsCsvRow;
}

function encodeRow(row: CandidateMarketsCsvRow): string {
  const escapedColumns = new Set<CandidateMarketsCsvColumn>();
  const protectedValues = Object.fromEntries(
    CSV_SCHEMA.filter(([column]) => column !== "formula_escaped_columns").map(
      ([column, kind]) => [
        column,
        kind === "human-text"
          ? protectHumanText(row[column], column, escapedColumns)
          : validateMachineCell(row[column], column, kind),
      ],
    ),
  ) as Partial<CandidateMarketsCsvRow>;
  protectedValues.formula_escaped_columns = [...escapedColumns]
    .sort()
    .join("|");
  validateMachineCell(
    protectedValues.formula_escaped_columns,
    "formula_escaped_columns",
    "column-list",
  );

  return encodeCsvRecord(
    CANDIDATE_MARKETS_CSV_COLUMNS.map(
      (column) => protectedValues[column] ?? "",
    ),
  );
}

function validateMachineCell(
  value: string,
  column: CandidateMarketsCsvColumn,
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
    "decimal-6": /^-?\d+\.\d{6}$/u,
    "deduction-list": /^[A-Z][A-Z0-9_]*=\d+(?:\|[A-Z][A-Z0-9_]*=\d+)*$/u,
    "economy-code": /^\d{1,3}$/u,
    enum: /^[A-Z][A-Z0-9_]*$/u,
    "export-id": /^cmx1-[a-f0-9]{64}$/u,
    identifier: /^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u,
    integer: /^\d+$/u,
    iso3: /^[A-Z]{3}$/u,
    literal: /^[^\u0000-\u001f\u007f]+$/u,
    "percentage-3": /^-?\d+\.\d{3}$/u,
    "product-code": /^\d{6}$/u,
    sha256: /^[a-f0-9]{64}$/u,
    "signed-integer": /^-?\d+$/u,
    timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
    "token-list": /^[A-Z][A-Z0-9_]*(?:\|[A-Z][A-Z0-9_]*)*$/u,
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

function joinList(values: readonly (number | string)[]): string {
  return values.join("|");
}

function formatCurrentUsd(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (match === null) {
    throw new TypeError(`Current USD value ${value} is not a decimal.`);
  }
  const whole = BigInt(match[1]!);
  const rounded = (match[2]?.[0] ?? "0") >= "5" ? whole + 1n : whole;
  return rounded.toString();
}


function caveatText(code: CaveatCode): string {
  const text: Record<CaveatCode, string> = {
    NO_RECORDED_POSITIVE_FLOW:
      "No recorded bilateral flow in the score window.",
    IDENTITY_PROXY: "Source identity proxy.",
    EXTREME_NOMINAL_GROWTH: "Extreme nominal growth.",
    DOMINANT_SIZE_OUTLIER: "Dominant Market Size outlier.",
    POSSIBLE_PRODUCT_SERIES_DISCONTINUITY:
      "Possible discontinuity or exceptional global shock.",
    LOW_WINDOW_STABILITY: "Low window stability.",
    STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT:
      "Stability not estimated - small common cohort.",
  };
  return text[code];
}

function validateBoundContext(
  result: CandidateMarketResult,
  product: CandidateMarketCsvInput["product"],
  manifest: CurrentAnalysisManifest,
): void {
  assertCandidateMarketExportContext(result, manifest);
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
      `Candidate Market CSV has an incompatible ${mismatch[2]} binding.`,
    );
  }
  if (result.candidates.length === 0 && result.emptyReason === null) {
    throw new TypeError("An empty Candidate Market export requires a reason.");
  }
  if (result.candidates.length > 0 && result.emptyReason !== null) {
    throw new TypeError(
      "A non-empty Candidate Market export cannot have an empty reason.",
    );
  }
}
