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
    );
  }
  const payload: unknown = await response.json();
  if (!isMarketAnalysisV1(payload)) {
    throw new MarketAnalysisClientError(
      "INVALID_MARKET_ANALYSIS",
      "Market Analysis payload is malformed.",
    );
  }
  return payload;
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

function isMarketAnalysisV1(value: unknown): value is MarketAnalysisV1 {
  if (!isRecord(value) || value.schemaVersion !== "market-analysis-v1") {
    return false;
  }
  return (
    isContext(value.context) &&
    isAnnualContext(value.annualContext) &&
    Array.isArray(value.constituentAnalyses) &&
    value.constituentAnalyses.length === 3 &&
    value.constituentAnalyses.every(isConstituentAnalysis) &&
    isOpportunity(value.opportunity) &&
    isDemand(value.demand) &&
    isExporterPosition(value.exporterPosition) &&
    isSupplierLandscape(value.supplierLandscape) &&
    isEvidenceQuality(value.evidenceQuality) &&
    isNonemptyString(value.discoveryDisclaimer)
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
    isRecord(value.components) &&
    isRecord(value.confidence) &&
    isOneOf(value.confidence.label, ["HIGH", "MEDIUM", "LOW"] as const) &&
    Array.isArray(value.confidence.deductions) &&
    (value.quantityCoverageRate === null ||
      isNonemptyString(value.quantityCoverageRate)) &&
    isRecord(value.provisionalEvidence) &&
    Array.isArray(value.caveatCodes) &&
    isRecord(value.releaseRevision)
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
    isRecord(value.firstRecordedPositive) &&
    isRecord(value.lastRecordedPositive) &&
    Number.isInteger(value.spanYears) &&
    isNonemptyString(value.absoluteChangeCurrentUsd) &&
    isNonemptyString(value.percentageChangePercent) &&
    isNonemptyString(value.cagrPercent)
  );
}

function isExporterPosition(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.scoreWindowFoothold) &&
    (value.pooledSupplier === null || isSupplierShare(value.pooledSupplier)) &&
    isRecord(value.provisionalBilateral)
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
    (value.emptyReason === null || isNonemptyString(value.emptyReason)) &&
    isNonemptyString(value.finalizedPooledValueCurrentUsd) &&
    Array.isArray(value.supplierShares) &&
    value.supplierShares.every(isSupplierShare) &&
    isConcentration(value.concentration) &&
    Array.isArray(value.qualityWarnings) &&
    value.qualityWarnings.every(isNonemptyString) &&
    isOneOf(value.provisionalMarketState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
      "MISSING_OBSERVATION",
    ] as const) &&
    Array.isArray(value.provisionalSupplierShares)
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
    isRecord(value.confidence) &&
    isYearList(value.observedFinalizedYears) &&
    isYearList(value.missingFinalizedYears) &&
    (value.quantityCoverageRate === null ||
      isNonemptyString(value.quantityCoverageRate)) &&
    Array.isArray(value.caveatCodes) &&
    isRecord(value.stability) &&
    isRecord(value.stability.threeYear) &&
    isRecord(value.stability.tenYear) &&
    isYearList(value.productSeriesDiscontinuityYears) &&
    isRecord(value.releaseRevision) &&
    isRecord(value.releaseRevisionSummary) &&
    isNonemptyString(value.sourceUpdateDate)
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
