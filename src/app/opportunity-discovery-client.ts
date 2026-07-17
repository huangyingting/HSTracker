import type {
  MarketInvestigationCandidate,
  MarketInvestigationPage,
} from "../domain/opportunity-discovery/result";
import type { OpportunityDetailEvidence } from "../evidence/opportunity-evidence-source";

type OpportunityClientErrorCode =
  | "HTTP_ERROR"
  | "INVALID_PAGE"
  | "INVALID_DETAIL";

export class OpportunityDiscoveryClientError extends Error {
  constructor(
    readonly code: OpportunityClientErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OpportunityDiscoveryClientError";
  }
}

export async function loadMarketInvestigationPage({
  analysisBuildId,
  exporterCode,
  productCodes,
  limit,
  cursor,
  fetcher,
  signal,
}: {
  analysisBuildId: string;
  exporterCode: string;
  productCodes: readonly string[] | null;
  limit: number;
  cursor: string | null;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<MarketInvestigationPage> {
  const parameters = new URLSearchParams({
    exporter: exporterCode,
    limit: String(limit),
  });
  if (cursor !== null) {
    parameters.set("cursor", cursor);
  }
  const canonicalProducts = canonicalProductCodes(productCodes ?? []);
  if (canonicalProducts.length > 0) {
    parameters.set("products", canonicalProducts.join(","));
  }

  const response = await fetcher(
    `/api/v1/analyses/${encodeURIComponent(analysisBuildId)}/opportunities?${parameters}`,
    { signal },
  );
  if (!response.ok) {
    throw new OpportunityDiscoveryClientError(
      "HTTP_ERROR",
      `Opportunity Discovery feed returned ${response.status}.`,
      response.status,
    );
  }
  const payload: unknown = await response.json();
  if (!isMarketInvestigationPage(payload)) {
    throw new OpportunityDiscoveryClientError(
      "INVALID_PAGE",
      "Opportunity Discovery feed payload is malformed.",
    );
  }
  return payload;
}

export async function loadOpportunityDetail({
  analysisBuildId,
  exporterCode,
  productCode,
  importerCode,
  fetcher,
  signal,
}: {
  analysisBuildId: string;
  exporterCode: string;
  productCode: string;
  importerCode: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<OpportunityDetailEvidence> {
  const parameters = new URLSearchParams({ exporter: exporterCode });
  const response = await fetcher(
    `/api/v1/analyses/${encodeURIComponent(analysisBuildId)}/opportunities/${encodeURIComponent(productCode)}/${encodeURIComponent(importerCode)}?${parameters}`,
    { signal },
  );
  if (!response.ok) {
    throw new OpportunityDiscoveryClientError(
      "HTTP_ERROR",
      `Opportunity Discovery detail returned ${response.status}.`,
      response.status,
    );
  }
  const payload: unknown = await response.json();
  if (!isOpportunityDetailEvidence(payload)) {
    throw new OpportunityDiscoveryClientError(
      "INVALID_DETAIL",
      "Opportunity Discovery detail payload is malformed.",
    );
  }
  return payload;
}

function isMarketInvestigationPage(
  value: unknown,
): value is MarketInvestigationPage {
  if (!isRecord(value) || value.schemaVersion !== "market-investigation-result-v1") {
    return false;
  }
  return (
    isNonemptyString(value.analysisBuildId) &&
    isEconomyIdentity(value.exporter) &&
    isOpportunityProvenance(value.provenance) &&
    isNonnegativeInteger(value.cohortSize) &&
    isRecord(value.projection) &&
    isProductCodeListOrNull(value.projection.productCodes) &&
    isPageWindow(value.page) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isMarketInvestigationCandidate) &&
    Array.isArray(value.nonClaims) &&
    value.nonClaims.every(isNonemptyString) &&
    isNonemptyString(value.discoveryDisclaimer)
  );
}

function isMarketInvestigationCandidate(
  value: unknown,
): value is MarketInvestigationCandidate {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isProductIdentity(value.product) &&
    isEconomyIdentity(value.market) &&
    isAxis(value.investigationPriority) &&
    isAxis(value.marketAttractiveness) &&
    isAxis(value.exporterFit) &&
    isRecord(value.components) &&
    isComponent(value.components.marketSize) &&
    isComponent(value.components.marketGrowth) &&
    isComponent(value.components.exporterProductPresence) &&
    isComponent(value.components.recordedFoothold) &&
    isOneOf(value.opportunityType, [
      "UNVALIDATED_MARKET_GAP",
      "EXPANSION_EVIDENCE",
      "GENERAL_INVESTIGATION_EVIDENCE",
    ] as const) &&
    isNonemptyString(value.opportunityTypeCopy) &&
    isOneOf(value.bilateralFlowState, [
      "RECORDED",
      "NO_RECORDED_POSITIVE_FLOW",
    ] as const) &&
    (value.bilateralWording === null || isNonemptyString(value.bilateralWording)) &&
    isYearList(value.observedMarketYears) &&
    isYearList(value.missingMarketYears) &&
    isConfidence(value.confidence) &&
    isRecord(value.stability) &&
    isStability(value.stability.threeYear) &&
    isStability(value.stability.tenYear) &&
    isReleaseRevision(value.releaseRevision) &&
    Array.isArray(value.evidenceFlags) &&
    value.evidenceFlags.every((flag) =>
      isOneOf(flag, [
        "NO_RECORDED_BILATERAL_FLOW",
        "NO_RECORDED_PRODUCT_EXPORT",
        "EXTREME_NOMINAL_GROWTH",
        "IDENTITY_PROXY",
      ] as const),
    ) &&
    isPositiveInteger(value.competitionRank) &&
    isPositiveInteger(value.competitionRankTieSize) &&
    isCandidateMarketDrillDown(value.candidateMarketDrillDown)
  );
}

function isOpportunityDetailEvidence(
  value: unknown,
): value is OpportunityDetailEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonemptyString(value.analysisBuildId) &&
    isEconomyIdentity(value.exporter) &&
    isProductIdentity(value.product) &&
    isEconomyIdentity(value.market) &&
    isCandidateMarketDrillDown(value.candidateMarketDrillDown) &&
    isYearRange(value.scoreWindow) &&
    Array.isArray(value.marketYears) &&
    value.marketYears.every(
      (year) =>
        isRecord(year) &&
        Number.isInteger(year.year) &&
        isNonemptyString(year.worldValueKusd) &&
        (year.bilateralValueKusd === null ||
          isNonemptyString(year.bilateralValueKusd)),
    )
  );
}

function isOpportunityProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonemptyString(value.baciRelease) &&
    isNonemptyString(value.sourceUpdateDate) &&
    value.hsRevision === "HS12" &&
    Number.isInteger(value.finalizedCutoffYear) &&
    isYearRange(value.scoreWindow) &&
    Number.isInteger(value.provisionalYear) &&
    value.recipeVersion === "opportunity-discovery-v1" &&
    value.resultSchemaVersion === "market-investigation-result-v1" &&
    isNonemptyString(value.artifactBuildId) &&
    isNonemptyString(value.artifactSchemaVersion) &&
    isSha256(value.artifactSha256) &&
    value.valueUnit === "CURRENT_USD"
  );
}

function isPageWindow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPositiveInteger(value.limit) &&
    (value.requestedCursor === null || isNonemptyString(value.requestedCursor)) &&
    (value.nextCursor === null || isNonemptyString(value.nextCursor)) &&
    isNonnegativeInteger(value.returnedCount)
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

function isAxis(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonemptyString(value.rawUnrounded) &&
    typeof value.display === "number" &&
    Number.isInteger(value.display) &&
    value.display >= 0 &&
    value.display <= 100
  );
}

function isComponent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.state, ["COMPUTED", "NEUTRAL"] as const) &&
    (value.rawValue === null || isNonemptyString(value.rawValue)) &&
    isNonemptyString(value.percentileUnrounded) &&
    isNonnegativeInteger(value.percentileBasisPoints) &&
    typeof value.percentileDisplay === "number" &&
    Number.isInteger(value.percentileDisplay) &&
    value.percentileDisplay >= 0 &&
    value.percentileDisplay <= 100
  );
}

function isConfidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    Number.isInteger(value.score) &&
    value.score >= 0 &&
    value.score <= 100 &&
    isOneOf(value.label, ["HIGH", "MEDIUM", "LOW"] as const) &&
    Array.isArray(value.deductions) &&
    value.deductions.every(
      (deduction) =>
        isRecord(deduction) &&
        isNonemptyString(deduction.code) &&
        isNonnegativeInteger(deduction.points),
    ) &&
    typeof value.sparseEvidenceCapApplied === "boolean"
  );
}

function isStability(value: unknown): boolean {
  return (
    isRecord(value) &&
    isYearRange(value.window) &&
    isOneOf(value.state, [
      "NOT_FLAGGED",
      "LOW_ALTERNATE_WINDOW_STABILITY",
      "COHORT_ENTRY",
      "COHORT_EXIT",
    ] as const) &&
    (value.priorityDelta === null || isNonemptyString(value.priorityDelta))
  );
}

function isReleaseRevision(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.state, [
      "NOT_COMPARED",
      "NOT_FLAGGED",
      "MATERIAL_RELEASE_REVISION",
    ] as const) &&
    (value.priorityDelta === null || isNonemptyString(value.priorityDelta)) &&
    (value.rankPercentileDelta === null ||
      isNonemptyString(value.rankPercentileDelta)) &&
    (value.cohortTransition === null ||
      isOneOf(value.cohortTransition, [
        "COMMON",
        "COHORT_ENTRY",
        "COHORT_EXIT",
      ] as const))
  );
}

function isCandidateMarketDrillDown(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.recipe === "candidate-market-v1" &&
    isEconomyCode(value.exporterCode) &&
    isProductIdentity(value.product) &&
    isEconomyCode(value.focusMarketCode)
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

function isProductCodeListOrNull(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.every(isProductCode));
}

function canonicalProductCodes(codes: readonly string[]): readonly string[] {
  return [...new Set(codes.filter(isProductCode))].sort(
    (left, right) => Number(left) - Number(right),
  );
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

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
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
