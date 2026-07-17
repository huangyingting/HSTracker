import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RELEASE_REVISION_NOT_COMPARED_REASONS } from "../domain/release/release-revision";
import { SOURCE_FRESHNESS_STATES } from "../domain/release/source-freshness";

type DiscoveryErrorCode = "HTTP_ERROR" | "INVALID_MANIFEST";
type ManifestSource = CurrentAnalysisManifest["source"];
type ManifestFreshness = CurrentAnalysisManifest["freshness"];
type ManifestRevision = CurrentAnalysisManifest["revisionComparison"];
type ManifestRecommendation = CurrentAnalysisManifest["recommendation"];

export class CurrentAnalysisDiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "CurrentAnalysisDiscoveryError";
  }
}

export async function loadCurrentAnalysisManifest({
  fetcher,
  signal,
  revalidate,
}: {
  fetcher: typeof fetch;
  signal: AbortSignal;
  revalidate: boolean;
}): Promise<CurrentAnalysisManifest> {
  return loadManifest({
    path: "/api/v1/analyses/current",
    label: "Current analysis",
    fetcher,
    signal,
    revalidate,
  });
}

export async function loadAnalysisBuildManifest({
  analysisBuildId,
  fetcher,
  signal,
}: {
  analysisBuildId: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<CurrentAnalysisManifest> {
  return loadManifest({
    path: `/api/v1/analyses/${encodeURIComponent(analysisBuildId)}/manifest`,
    label: `Analysis build ${analysisBuildId}`,
    fetcher,
    signal,
    revalidate: true,
  });
}

async function loadManifest({
  path,
  label,
  fetcher,
  signal,
  revalidate,
}: {
  path: string;
  label: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
  revalidate: boolean;
}): Promise<CurrentAnalysisManifest> {
  const response = await fetcher(path, {
    cache: revalidate ? "no-store" : "default",
    signal,
  });
  if (!response.ok) {
    throw new CurrentAnalysisDiscoveryError(
      "HTTP_ERROR",
      `${label} manifest returned ${response.status}.`,
      response.status,
    );
  }

  const candidate = normalizeLegacyManifest(await response.json());
  if (!isCurrentAnalysisManifest(candidate)) {
    throw new CurrentAnalysisDiscoveryError(
      "INVALID_MANIFEST",
      `${label} manifest is malformed or incompatible.`,
    );
  }
  return candidate;
}

function normalizeLegacyManifest(candidate: unknown): unknown {
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.recommendation)
  ) {
    return candidate;
  }
  let changed = false;
  const recommendation: Record<string, unknown> = {
    ...candidate.recommendation,
  };
  if (!Object.hasOwn(recommendation, "tradeExplorer")) {
    recommendation.tradeExplorer = null;
    changed = true;
  }
  if (!Object.hasOwn(recommendation, "opportunityDiscovery")) {
    recommendation.opportunityDiscovery = null;
    changed = true;
  }
  if (!changed) {
    return candidate;
  }
  return {
    ...candidate,
    recommendation,
  };
}

function isCurrentAnalysisManifest(
  candidate: unknown,
): candidate is CurrentAnalysisManifest {
  if (!isRecord(candidate)) {
    return false;
  }
  const source = candidate.source;
  const freshness = candidate.freshness;
  const revision = candidate.revisionComparison;
  if (
    candidate.schemaVersion !== "current-analysis-manifest-v1" ||
    !isNonemptyString(candidate.analysisBuildId) ||
    !isNonemptyString(candidate.productSearchBuildId) ||
    !isSha256(candidate.analysisReleaseCatalogSha256) ||
    !isBenchmarkQueries(candidate.benchmarkQueries) ||
    !isManifestSource(source) ||
    !isManifestRecommendation(candidate.recommendation)
  ) {
    return false;
  }

  function isBenchmarkQueries(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }
    const roles = new Set<string>();
    for (const query of value) {
      if (
        !isRecord(query) ||
        !isOneOf(query.role, [
          "sparse",
          "median",
          "upper-quartile",
          "maximum-row",
        ] as const) ||
        typeof query.productCode !== "string" ||
        !/^\d{6}$/u.test(query.productCode) ||
        typeof query.exporterCode !== "string" ||
        !/^\d{1,3}$/u.test(query.exporterCode) ||
        !Number.isInteger(query.candidateCount) ||
        (query.candidateCount as number) < 0
      ) {
        return false;
      }
      roles.add(query.role);
    }
    return roles.size === value.length;
  }

  return (
    isManifestFreshness(freshness, source.baciRelease) &&
    isManifestRevision(revision)
  );
}

function isManifestSource(value: unknown): value is ManifestSource {
  if (!isRecord(value)) {
    return false;
  }
  const source = value;
  const windows = source.windows;
  const artifact = source.artifact;
  if (
    !isBaciRelease(source.baciRelease) ||
    !isDate(source.sourceUpdateDate) ||
    source.hsRevision !== "HS12" ||
    !isYearRange(source.ingestedYears) ||
    !Number.isInteger(source.finalizedCutoffYear) ||
    !isRecord(windows) ||
    !isYearRange(windows.threeYear) ||
    !isYearRange(windows.score) ||
    !isYearRange(windows.tenYear) ||
    !Number.isInteger(source.provisionalYear) ||
    source.scoreVersion !== "cms-v1" ||
    !isRecord(artifact) ||
    !isNonemptyString(artifact.buildId) ||
    !isNonemptyString(artifact.schemaVersion) ||
    !isInstant(artifact.builtAt) ||
    !isSha256(artifact.sha256)
  ) {
    return false;
  }

  return !(
    windows.threeYear.end !== source.finalizedCutoffYear ||
    windows.score.end !== source.finalizedCutoffYear ||
    windows.tenYear.end !== source.finalizedCutoffYear ||
    source.provisionalYear !== source.finalizedCutoffYear + 1 ||
    source.ingestedYears.end < source.provisionalYear
  );
}

function isManifestRecommendation(
  value: unknown,
): value is ManifestRecommendation {
  if (!isRecord(value)) {
    return false;
  }
  const tradeTrend = value.tradeTrend;
  const supplierCompetition = value.supplierCompetition;
  const recentTradeMomentum = value.recentTradeMomentum ?? null;
  const tradeExplorer = value.tradeExplorer;
  const opportunityDiscovery = value.opportunityDiscovery;
  return (
    value.recipe === "candidate-market-v1" &&
    isRecommendedDatasetMappingIdentity(value.mappingIdentity) &&
    isDatasetPackageIdentity(value.datasetPackageIdentity) &&
    isRecommendedProductCatalogIdentity(value.productCatalogIdentity) &&
    isRecommendedEconomyCatalogIdentity(value.economyCatalogIdentity) &&
    (tradeTrend === null || isTradeTrendRecommendation(tradeTrend)) &&
    (supplierCompetition === null ||
      isSupplierCompetitionRecommendation(supplierCompetition)) &&
    (recentTradeMomentum === null ||
      isRecentTradeMomentumRecommendation(recentTradeMomentum)) &&
    (tradeExplorer === null || isTradeExplorerRecommendation(tradeExplorer)) &&
    (opportunityDiscovery === null ||
      isOpportunityDiscoveryRecommendation(opportunityDiscovery))
  );
}

function isTradeTrendRecommendation(
  value: unknown,
): value is NonNullable<ManifestRecommendation["tradeTrend"]> {
  return (
    isRecord(value) &&
    value.recipe === "trade-trend-v1" &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

function isSupplierCompetitionRecommendation(
  value: unknown,
): value is NonNullable<ManifestRecommendation["supplierCompetition"]> {
  return (
    isRecord(value) &&
    value.recipe === "supplier-competition-v1" &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

function isRecentTradeMomentumRecommendation(
  value: unknown,
): value is NonNullable<ManifestRecommendation["recentTradeMomentum"]> {
  return (
    isRecord(value) &&
    value.recipe === "recent-trade-momentum-v1" &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

function isTradeExplorerRecommendation(
  value: unknown,
): value is NonNullable<ManifestRecommendation["tradeExplorer"]> {
  return (
    isRecord(value) &&
    value.recipe === "trade-explorer-v1" &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

function isOpportunityDiscoveryRecommendation(
  value: unknown,
): value is NonNullable<ManifestRecommendation["opportunityDiscovery"]> {
  return (
    isRecord(value) &&
    value.recipe === "opportunity-discovery-v1" &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

function isManifestFreshness(
  value: unknown,
  servedBaciRelease: string,
): value is ManifestFreshness {
  if (!isRecord(value)) {
    return false;
  }
  const freshness = value;
  if (
    !isNonemptyString(freshness.sourceStatusSnapshotId) ||
    !isNonemptyString(freshness.freshnessStatusId) ||
    !isInstant(freshness.checkedAt) ||
    !isInstant(freshness.checkOverdueAt) ||
    freshness.servedBaciRelease !== servedBaciRelease ||
    !isBaciRelease(freshness.latestKnownBaciRelease) ||
    !isNullableInstant(freshness.newerReleaseDetectedAt) ||
    !isNullableInstant(freshness.refreshDueAt) ||
    !isOneOf(freshness.state, SOURCE_FRESHNESS_STATES) ||
    !isInstant(freshness.effectiveAt)
  ) {
    return false;
  }

  const hasNewerRelease = freshness.newerReleaseDetectedAt !== null;
  const hasRefreshDueAt = freshness.refreshDueAt !== null;
  if (hasNewerRelease !== hasRefreshDueAt) {
    return false;
  }
  if (freshness.state === "UPDATE_IN_PROGRESS") {
    return hasNewerRelease;
  }
  if (
    freshness.state === "LATEST_KNOWN" ||
    freshness.state === "CHECK_OVERDUE"
  ) {
    return !hasNewerRelease;
  }
  return true;
}

function isManifestRevision(value: unknown): value is ManifestRevision {
  if (!isRecord(value)) {
    return false;
  }
  const revision = value;
  if (!(
    isNullableBaciRelease(revision.comparisonRelease) &&
    isNullableSha256(revision.previousArtifactSha256) &&
    (revision.notComparedReason === null ||
      isOneOf(
        revision.notComparedReason,
        RELEASE_REVISION_NOT_COMPARED_REASONS,
      ))
  )) {
    return false;
  }
  const retainsPreviousIdentity =
    revision.notComparedReason === null ||
    revision.notComparedReason === "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW";
  return retainsPreviousIdentity
    ? revision.comparisonRelease !== null &&
        revision.previousArtifactSha256 !== null
    : revision.comparisonRelease === null &&
        revision.previousArtifactSha256 === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value);
}

function isDatasetPackageIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^dataset-package-v1-[0-9a-f]{64}$/u.test(value)
  );
}

function isRecommendedDatasetMappingIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^recommended-dataset-mapping-v1-[0-9a-f]{64}$/u.test(value)
  );
}

function isRecommendedProductCatalogIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^recommended-product-catalog-v1-[0-9a-f]{64}$/u.test(value)
  );
}

function isRecommendedEconomyCatalogIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^recommended-economy-catalog-v1-[0-9a-f]{64}$/u.test(value)
  );
}

function isBaciRelease(value: unknown): value is string {
  return typeof value === "string" && /^V\d{6}$/u.test(value);
}

function isNullableBaciRelease(value: unknown): value is string | null {
  return value === null || isBaciRelease(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
  );
}

function isNullableInstant(value: unknown): value is string | null {
  return value === null || isInstant(value);
}

function isYearRange(value: unknown): value is {
  start: number;
  end: number;
} {
  return (
    isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    Number(value.start) <= Number(value.end)
  );
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.some((member) => member === value);
}
