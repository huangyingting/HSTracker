import {
  ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
} from "../../test/fixtures/acceptance/v1/metadata";
import {
  resolveCurrentAnalysisManifest,
  type CurrentAnalysisDeployment,
  type CurrentAnalysisManifest,
} from "../domain/release/current-analysis";
import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import {
  evaluateSourceFreshness,
  type EffectiveSourceFreshness,
} from "../domain/release/source-freshness";

export const FIXTURE_CURRENT_AS_OF = "2026-03-01T00:00:00Z";

export const FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT: CurrentAnalysisDeployment = {
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
  analysisReleaseCatalogSha256:
    ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  benchmarkQueries: [
    {
      role: "sparse",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 2,
    },
    {
      role: "median",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 2,
    },
    {
      role: "upper-quartile",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 2,
    },
    {
      role: "maximum-row",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 2,
    },
  ],
  source: {
    ...ACCEPTANCE_FIXTURE_RELEASE,
    windows: {
      threeYear: { start: 2021, end: 2023 },
      score: { start: 2019, end: 2023 },
      tenYear: { start: 2014, end: 2023 },
    },
    scoreVersion: "cms-v1",
    artifact: {
      buildId: "acceptance-fixtures-v1-core-artifact",
      schemaVersion: ACCEPTANCE_FIXTURE_ARTIFACT.schemaVersion,
      builtAt: "2026-01-23T00:00:00Z",
      sha256: ACCEPTANCE_FIXTURE_ARTIFACT.sha256,
    },
  },
  revisionComparison: {
    comparisonRelease: null,
    previousArtifactSha256: null,
    notComparedReason: "NO_PREVIOUS_ARTIFACT",
  },
};

export const FIXTURE_SOURCE_STATUS_SNAPSHOT: SourceStatusSnapshot = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status:acceptance-fixtures-v1",
  checkedAt: "2026-03-01T00:00:00Z",
  servedBaciRelease: ACCEPTANCE_FIXTURE_RELEASE.baciRelease,
  latestKnownBaciRelease: ACCEPTANCE_FIXTURE_RELEASE.baciRelease,
  newerReleaseDetectedAt: null,
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2026-03-01T00:00:00Z",
};

const FIXTURE_RELEASE_INCOMPATIBLE_SOURCE_STATUS_SNAPSHOT: SourceStatusSnapshot =
  {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId:
      "source-status:acceptance-fixtures-v1-release-incompatible",
    checkedAt: "2026-03-01T00:00:00Z",
    servedBaciRelease: "V202501",
    latestKnownBaciRelease: "V202501",
    newerReleaseDetectedAt: null,
    refreshFailed: false,
    rollbackActive: false,
    publishedAt: "2026-03-01T00:00:00Z",
  };

export const FIXTURE_RELEASE_INCOMPATIBLE_FRESHNESS_STATUS =
  evaluateSourceFreshness(
    FIXTURE_RELEASE_INCOMPATIBLE_SOURCE_STATUS_SNAPSHOT,
    FIXTURE_CURRENT_AS_OF,
  );

export function resolveFixtureCurrentAnalysisManifest(): CurrentAnalysisManifest {
  return resolveCurrentAnalysisManifest(
    FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
    FIXTURE_SOURCE_STATUS_SNAPSHOT,
    FIXTURE_CURRENT_AS_OF,
  );
}

export function resolveFixtureExportFreshnessStatus(
  freshnessStatusId: string,
): EffectiveSourceFreshness | null {
  const candidates = [
    resolveFixtureCurrentAnalysisManifest().freshness,
    FIXTURE_RELEASE_INCOMPATIBLE_FRESHNESS_STATUS,
  ];
  return (
    candidates.find(
      (freshness) => freshness.freshnessStatusId === freshnessStatusId,
    ) ?? null
  );
}
