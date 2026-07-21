import type { MarketAnalysisV1 } from "../domain/market-analysis/result";

// The Market Analysis browser client -- pre-agreed seam #2 for issue #68.
// It is the one place the browser fetches the existing immutable
// `GET /api/v1/analyses/{analysisBuildId}/market-analysis` route (Slice 3)
// and structurally validates the exact `market-analysis-v1` JSON shape,
// mirroring the pattern `opportunity-discovery-client.ts` already
// establishes for Opportunity Discovery/detail/Recent Momentum. It never
// recomputes a Candidate Market Score, CAGR, supplier share, HHI, or
// momentum value -- every field it returns is exactly what the typed
// `MarketAnalysisV1` route already served.

type MarketAnalysisClientErrorCode = "HTTP_ERROR" | "INVALID_MARKET_ANALYSIS";

export class MarketAnalysisClientError extends Error {
  constructor(
    readonly code: MarketAnalysisClientErrorCode,
    message: string,
    readonly status: number | null = null,
    // The route's own public error code (e.g. `ANALYSIS_BUILD_RETIRED`,
    // `CANDIDATE_MARKET_NOT_FOUND`, `ANALYSIS_RATE_LIMITED`) when the
    // response body carried one, so callers can reuse the exact same
    // typed-status mapping the ranking workspace already applies instead
    // of re-deriving recovery behavior from HTTP status alone.
    readonly publicCode: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "MarketAnalysisClientError";
  }
}

export async function loadMarketAnalysis({
  analysisBuildId,
  exportEconomyCode,
  productCode,
  marketCode,
  fetcher,
  signal,
}: {
  analysisBuildId: string;
  exportEconomyCode: string;
  productCode: string;
  marketCode: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<MarketAnalysisV1> {
  const parameters = new URLSearchParams({
    exporter: exportEconomyCode,
    product: productCode,
    market: marketCode,
  });
  const response = await fetcher(
    `/api/v1/analyses/${encodeURIComponent(analysisBuildId)}/market-analysis?${parameters}`,
    { signal },
  );
  if (!response.ok) {
    const publicCode = await publicErrorCode(response);
    throw new MarketAnalysisClientError(
      "HTTP_ERROR",
      `Market Analysis returned ${response.status}.`,
      response.status,
      publicCode,
      parseRetryAfterSeconds(response.headers.get("Retry-After")),
    );
  }

  const payload: unknown = await response.json();
  if (
    !isMarketAnalysisV1(payload, {
      analysisBuildId,
      exportEconomyCode,
      productCode,
      marketCode,
    })
  ) {
    throw new MarketAnalysisClientError(
      "INVALID_MARKET_ANALYSIS",
      "Market Analysis payload is malformed.",
    );
  }
  return payload;
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

async function publicErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    if (
      isRecord(body) &&
      isRecord(body.error) &&
      isNonemptyString(body.error.code)
    ) {
      return body.error.code;
    }
  } catch {
    // A non-JSON or empty error body still leaves `status` as the only
    // available signal; that is a normal, already-handled case here.
  }
  return null;
}

function isMarketAnalysisV1(
  value: unknown,
  expectedContext: {
    analysisBuildId: string;
    exportEconomyCode: string;
    productCode: string;
    marketCode: string;
  },
): value is MarketAnalysisV1 {
  if (!isRecord(value) || value.schemaVersion !== "market-analysis-v1") {
    return false;
  }
  const structurallyValid =
    isContext(value.context) &&
    isAnnualContext(value.annualContext) &&
    Array.isArray(value.constituentAnalyses) &&
    value.constituentAnalyses.length === 3 &&
    value.constituentAnalyses.every(isConstituentAnalysis) &&
    hasExactConstituentRecipes(value.constituentAnalyses) &&
    isOpportunity(value.opportunity) &&
    isDemand(value.demand) &&
    isExporterPosition(value.exporterPosition) &&
    isSupplierLandscape(value.supplierLandscape) &&
    isEvidenceQuality(value.evidenceQuality) &&
    isNonemptyString(value.discoveryDisclaimer);
  return (
    structurallyValid &&
    hasRequestedContext(value, expectedContext) &&
    hasConsistentSupplierPosition(value)
  );
}

function hasRequestedContext(
  value: Record<string, unknown>,
  expected: {
    analysisBuildId: string;
    exportEconomyCode: string;
    productCode: string;
    marketCode: string;
  },
): boolean {
  return (
    isRecord(value.context) &&
    value.context.analysisBuildId === expected.analysisBuildId &&
    isRecord(value.context.exporter) &&
    value.context.exporter.code === expected.exportEconomyCode &&
    isRecord(value.context.product) &&
    value.context.product.code === expected.productCode &&
    isRecord(value.context.market) &&
    value.context.market.code === expected.marketCode &&
    isRecord(value.opportunity) &&
    isRecord(value.opportunity.candidate) &&
    isRecord(value.opportunity.candidate.economy) &&
    value.opportunity.candidate.economy.code === expected.marketCode
  );
}

function hasExactConstituentRecipes(
  constituents: readonly unknown[],
): boolean {
  const recipes = new Set(
    constituents.map((constituent) =>
      isRecord(constituent) ? constituent.recipe : null,
    ),
  );
  return (
    recipes.size === 3 &&
    recipes.has("candidate-market-v1") &&
    recipes.has("trade-trend-v1") &&
    recipes.has("supplier-competition-v1")
  );
}

function isContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonemptyString(value.analysisBuildId) &&
    isEconomyIdentity(value.exporter) &&
    isProductIdentity(value.product) &&
    isEconomyIdentity(value.market)
  );
}

function isAnnualContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonemptyString(value.baciRelease) &&
    value.hsRevision === "HS12" &&
    isYearRange(value.finalizedWindow) &&
    Number.isInteger(value.provisionalYear) &&
    value.valueUnit === "CURRENT_USD"
  );
}

function isConstituentAnalysis(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.recipe, [
      "candidate-market-v1",
      "trade-trend-v1",
      "supplier-competition-v1",
    ] as const) &&
    isNonemptyString(value.analysisIdentity) &&
    isNonemptyString(value.datasetPackageIdentity)
  );
}

function isOpportunity(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCandidateMarket(value.candidate) &&
    isNonnegativeInteger(value.cohortSize) &&
    isRecord(value.weights) &&
    typeof value.weights.marketSize === "number" &&
    typeof value.weights.marketGrowth === "number" &&
    typeof value.weights.recordedFoothold === "number" &&
    typeof value.weights.supplierDiversity === "number"
  );
}

function isCandidateMarket(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isEconomyIdentity(value.economy) &&
    typeof value.score === "number" &&
    isPositiveInteger(value.rank) &&
    isPositiveInteger(value.rankTieSize) &&
    isNonemptyString(value.rankPercentile) &&
    isYearList(value.observedScoreYears) &&
    isYearList(value.missingScoreYears) &&
    Number.isInteger(value.latestFinalizedObservedYear) &&
    isCandidateComponents(value.components) &&
    isConfidence(value.confidence) &&
    (value.quantityCoverageRate === null ||
      isNonemptyString(value.quantityCoverageRate)) &&
    isProvisionalBilateralEvidence(value.provisionalEvidence) &&
    Array.isArray(value.caveatCodes) &&
    value.caveatCodes.every(isCaveatCode) &&
    isCandidateReleaseRevision(value.releaseRevision)
  );
}

function isCandidateComponents(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.marketSize) &&
    value.marketSize.state === "COMPUTED" &&
    isNonemptyString(value.marketSize.meanCurrentUsd) &&
    isFiniteNumber(value.marketSize.percentile) &&
    isYearList(value.marketSize.yearsUsed) &&
    isRecord(value.marketGrowth) &&
    isOneOf(value.marketGrowth.state, ["COMPUTED", "NEUTRAL"] as const) &&
    (value.marketGrowth.annualRate === null ||
      isNonemptyString(value.marketGrowth.annualRate)) &&
    isFiniteNumber(value.marketGrowth.percentile) &&
    isYearList(value.marketGrowth.yearsUsed) &&
    Array.isArray(value.marketGrowth.reasonCodes) &&
    value.marketGrowth.reasonCodes.every((code) =>
      isOneOf(code, [
        "INSUFFICIENT_OBSERVED_YEARS",
        "BELOW_MATERIALITY_THRESHOLD",
      ] as const),
    ) &&
    isScoreWindowFoothold(value.recordedFoothold) &&
    isRecord(value.supplierDiversity) &&
    isOneOf(value.supplierDiversity.state, ["COMPUTED", "NEUTRAL"] as const) &&
    (value.supplierDiversity.index === null ||
      isNonemptyString(value.supplierDiversity.index)) &&
    isFiniteNumber(value.supplierDiversity.percentile) &&
    isYearList(value.supplierDiversity.yearsUsed) &&
    (value.supplierDiversity.reasonCode === null ||
      value.supplierDiversity.reasonCode ===
        "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR")
  );
}

function isScoreWindowFoothold(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.state === "COMPUTED" &&
    isNonemptyString(value.share) &&
    isFiniteNumber(value.percentile) &&
    isOneOf(value.bilateralFlowState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
    ] as const) &&
    (value.wording === null || isNonemptyString(value.wording))
  );
}

function isConfidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.score) &&
    isOneOf(value.label, ["HIGH", "MEDIUM", "LOW"] as const) &&
    Array.isArray(value.deductions) &&
    value.deductions.every(isConfidenceDeduction) &&
    typeof value.sparseEvidenceCapApplied === "boolean"
  );
}

function isConfidenceDeduction(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.code, [
      "MISSING_SCORE_WINDOW_YEARS",
      "MISSING_CUTOFF_YEAR_EVIDENCE",
      "SMALL_BASE",
      "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
      "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
      "LOW_WINDOW_STABILITY",
      "SMALL_CANDIDATE_COHORT",
      "NO_EXPORTER_PRODUCT_HISTORY",
      "IDENTITY_PROXY",
    ] as const) &&
    isFiniteNumber(value.points)
  );
}

function isCaveatCode(value: unknown): boolean {
  return isOneOf(value, [
    "NO_RECORDED_POSITIVE_FLOW",
    "IDENTITY_PROXY",
    "EXTREME_NOMINAL_GROWTH",
    "DOMINANT_SIZE_OUTLIER",
    "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
    "LOW_WINDOW_STABILITY",
    "STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT",
  ] as const);
}

function isCandidateReleaseRevision(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.state, [
      "NOT_COMPARED",
      "BELOW_THRESHOLD",
      "MATERIAL_CHANGE",
      "NEWLY_ELIGIBLE",
    ] as const) &&
    isNullableFiniteNumber(value.previousReleaseRecomputedScore) &&
    isNullableFiniteNumber(value.scoreChange) &&
    isNullableString(value.previousReleaseRecomputedRankPercentile) &&
    isNullableString(value.rankPercentileChange) &&
    (value.materialChange === null ||
      typeof value.materialChange === "boolean")
  );
}

function isProvisionalBilateralEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.year) &&
    isOneOf(value.marketState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
    ] as const) &&
    isNullableString(value.marketImportCurrentUsd) &&
    isOneOf(value.bilateralState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
      "NOT_APPLICABLE",
    ] as const) &&
    isNullableString(value.bilateralCurrentUsd) &&
    isNullableString(value.recordedBilateralShare) &&
    isNullableString(value.quantityCoverageRate)
  );
}

function isDemand(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.finalizedObservations) &&
    value.finalizedObservations.every(isTradeTrendObservation) &&
    isTradeTrendSummary(value.summary) &&
    (value.provisionalObservation === null ||
      isTradeTrendObservation(value.provisionalObservation))
  );
}

function isTradeTrendObservation(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.year)) {
    return false;
  }
  if (value.state === "RECORDED_POSITIVE") {
    return isNonemptyString(value.valueCurrentUsd);
  }
  return isOneOf(value.state, [
    "NO_RECORDED_POSITIVE_FLOW",
    "MISSING_OBSERVATION",
  ] as const);
}

function isTradeTrendSummary(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.state === "UNAVAILABLE") {
    return isOneOf(value.reason, [
      "NO_RECORDED_POSITIVE_OBSERVATIONS",
      "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION",
    ] as const);
  }
  return (
    value.state === "AVAILABLE" &&
    isRecordedPoint(value.firstRecordedPositive) &&
    isRecordedPoint(value.lastRecordedPositive) &&
    Number.isInteger(value.spanYears) &&
    isNonemptyString(value.absoluteChangeCurrentUsd) &&
    isNonemptyString(value.percentageChangePercent) &&
    isNonemptyString(value.cagrPercent)
  );
}

function isRecordedPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.year) &&
    isNonemptyString(value.valueCurrentUsd)
  );
}

function isExporterPosition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const hasPooledSupplier =
    value.pooledSupplier !== null && isSupplierShare(value.pooledSupplier);
  const hasPooledPosition =
    value.pooledSupplierPosition !== null &&
    isSupplierPosition(value.pooledSupplierPosition);
  return (
    isScoreWindowFoothold(value.scoreWindowFoothold) &&
    ((value.pooledSupplier === null &&
      value.pooledSupplierPosition === null) ||
      (hasPooledSupplier && hasPooledPosition)) &&
    isProvisionalBilateralEvidence(value.provisionalBilateral)
  );
}

function isSupplierPosition(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPositiveInteger(value.rank) &&
    isPositiveInteger(value.cohortSize) &&
    value.rank <= value.cohortSize
  );
}

function isSupplierShare(value: unknown): boolean {
  return (
    isRecord(value) &&
    isEconomyIdentity(value.economy) &&
    isNonemptyString(value.pooledValueCurrentUsd) &&
    isNonemptyString(value.sharePercent) &&
    isYearList(value.recordedYears) &&
    isYearList(value.noRecordedFlowYears) &&
    isYearList(value.missingYears) &&
    (value.quantityCoverageRate === null ||
      isNonemptyString(value.quantityCoverageRate))
  );
}

function isSupplierLandscape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isPositiveInteger(value.cohortBudget) &&
    isNonnegativeInteger(value.cohortSize) &&
    (value.emptyReason === null ||
      value.emptyReason === "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW") &&
    isNonemptyString(value.finalizedPooledValueCurrentUsd) &&
    Array.isArray(value.supplierShares) &&
    value.supplierShares.every(isSupplierShare) &&
    isConcentration(value.concentration) &&
    Array.isArray(value.qualityWarnings) &&
    value.qualityWarnings.every((warning) =>
      isOneOf(warning, [
        "SPARSE_FINALIZED_PERIODS",
        "INCOMPLETE_SUPPLIER_STRUCTURE",
        "CONCENTRATION_UNAVAILABLE",
      ] as const),
    ) &&
    isOneOf(value.provisionalMarketState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
      "MISSING_OBSERVATION",
    ] as const) &&
    Array.isArray(value.provisionalSupplierShares) &&
    value.provisionalSupplierShares.every(isProvisionalSupplierShare)
  );
}

function isProvisionalSupplierShare(value: unknown): boolean {
  return (
    isRecord(value) &&
    isEconomyIdentity(value.economy) &&
    isOneOf(value.bilateralState, [
      "RECORDED_POSITIVE",
      "NO_RECORDED_POSITIVE_FLOW",
      "NOT_APPLICABLE",
    ] as const) &&
    isNullableString(value.valueCurrentUsd)
  );
}

function isConcentration(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.state === "UNAVAILABLE") {
    return value.reason === "NO_POOLED_SUPPLIER_VALUE";
  }
  return (
    value.state === "COMPUTED" &&
    isNonemptyString(value.herfindahlHirschmanIndex) &&
    value.scale === 10000
  );
}

function isEvidenceQuality(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isConfidence(value.confidence) &&
    isYearList(value.observedFinalizedYears) &&
    isYearList(value.missingFinalizedYears) &&
    (value.quantityCoverageRate === null ||
      isNonemptyString(value.quantityCoverageRate)) &&
    Array.isArray(value.caveatCodes) &&
    isRecord(value.stability) &&
    isStabilityEvidence(value.stability.threeYear) &&
    isStabilityEvidence(value.stability.tenYear) &&
    isYearList(value.productSeriesDiscontinuityYears) &&
    isCandidateReleaseRevision(value.releaseRevision) &&
    isReleaseRevisionSummary(value.releaseRevisionSummary) &&
    isNonemptyString(value.sourceUpdateDate)
  );
}

function isStabilityEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    isYearRange(value.window) &&
    isNonnegativeInteger(value.commonCandidateCount) &&
    isOneOf(value.state, [
      "NOT_FLAGGED",
      "LOW",
      "NOT_ESTIMATED_SMALL_COMMON_COHORT",
    ] as const) &&
    isNullableString(value.rankCorrelation)
  );
}

function isReleaseRevisionSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNullableString(value.comparisonRelease) &&
    isNullableString(value.previousArtifactSha256) &&
    (value.notComparedReason === null ||
      isOneOf(value.notComparedReason, [
        "NO_PREVIOUS_ARTIFACT",
        "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
        "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
      ] as const)) &&
    (value.noLongerEligibleCount === null ||
      isNonnegativeInteger(value.noLongerEligibleCount))
  );
}

function hasConsistentSupplierPosition(
  value: Record<string, unknown>,
): boolean {
  if (
    !isRecord(value.context) ||
    !isRecord(value.context.exporter) ||
    !isRecord(value.exporterPosition) ||
    !isRecord(value.supplierLandscape) ||
    !Array.isArray(value.supplierLandscape.supplierShares)
  ) {
    return false;
  }
  const shares = value.supplierLandscape.supplierShares;
  if (value.supplierLandscape.cohortSize !== shares.length) {
    return false;
  }
  const exporterCode = value.context.exporter.code;
  const index = shares.findIndex(
    (share) =>
      isRecord(share) &&
      isRecord(share.economy) &&
      share.economy.code === exporterCode,
  );
  const pooledSupplier = value.exporterPosition.pooledSupplier;
  const position = value.exporterPosition.pooledSupplierPosition;
  if (index === -1) {
    return pooledSupplier === null && position === null;
  }
  return (
    isRecord(pooledSupplier) &&
    sameSupplierShare(pooledSupplier, shares[index]) &&
    isRecord(position) &&
    position.rank === index + 1 &&
    position.cohortSize === shares.length
  );
}

function sameSupplierShare(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    sameEconomyIdentity(left.economy, right.economy) &&
    left.pooledValueCurrentUsd === right.pooledValueCurrentUsd &&
    left.sharePercent === right.sharePercent &&
    sameYearList(left.recordedYears, right.recordedYears) &&
    sameYearList(left.noRecordedFlowYears, right.noRecordedFlowYears) &&
    sameYearList(left.missingYears, right.missingYears) &&
    left.quantityCoverageRate === right.quantityCoverageRate
  );
}

function sameEconomyIdentity(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.code === right.code &&
    left.name === right.name &&
    left.iso3 === right.iso3 &&
    left.identityNote === right.identityNote
  );
}

function sameYearList(left: unknown, right: unknown): boolean {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((year, index) => year === right[index])
  );
}

function isEconomyIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    isEconomyCode(value.code) &&
    isNonemptyString(value.name) &&
    (value.iso3 === null || isNonemptyString(value.iso3)) &&
    (value.identityNote === null || isNonemptyString(value.identityNote))
  );
}

function isProductIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.hsRevision === "HS12" &&
    isProductCode(value.code) &&
    isNonemptyString(value.descriptionEn)
  );
}

function isYearRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    Number(value.start) <= Number(value.end)
  );
}

function isYearList(value: unknown): boolean {
  return Array.isArray(value) && value.every((year) => Number.isInteger(year));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): boolean {
  return value === null || isNonemptyString(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isEconomyCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,3}$/u.test(value);
}

function isProductCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/u.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.some((member) => member === value);
}
