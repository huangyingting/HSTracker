import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { RELEASE_REVISION_NOT_COMPARED_REASONS } from "../domain/release/release-revision";
import { SOURCE_FRESHNESS_STATES } from "../domain/release/source-freshness";

type DiscoveryErrorCode = "HTTP_ERROR" | "INVALID_MANIFEST";
type ManifestSource = CurrentAnalysisManifest["source"];
type ManifestFreshness = CurrentAnalysisManifest["freshness"];
type ManifestRevision = CurrentAnalysisManifest["revisionComparison"];

export class CurrentAnalysisDiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
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
  const response = await fetcher("/api/v1/analyses/current", {
    cache: revalidate ? "no-store" : "default",
    signal,
  });
  if (!response.ok) {
    throw new CurrentAnalysisDiscoveryError(
      "HTTP_ERROR",
      `Current analysis manifest returned ${response.status}.`,
    );
  }

  const candidate: unknown = await response.json();
  if (!isCurrentAnalysisManifest(candidate)) {
    throw new CurrentAnalysisDiscoveryError(
      "INVALID_MANIFEST",
      "The current analysis manifest is malformed or incompatible.",
    );
  }
  return candidate;
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
    !isManifestSource(source)
  ) {
    return false;
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

function isManifestFreshness(
  value: unknown,
  servedBaciRelease: string,
): value is ManifestFreshness {
  if (!isRecord(value)) {
    return false;
  }
  const freshness = value;
  return !(
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
  );
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
