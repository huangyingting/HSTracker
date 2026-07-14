import {
  ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
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
import {
  createRecommendedDatasetMapping,
  recommendedEconomyCatalogIdentity,
  recommendedProductCatalogIdentity,
} from "../domain/trade-analytics/recommended-dataset-mapping";
import { FIXTURE_PRODUCT_CATALOG_ARTIFACT_BYTES } from "../catalog/fixture-product-catalog";
import { FIXTURE_ECONOMY_CATALOG_ARTIFACT_BYTES } from "../economy/fixture-economy-directory";
import { createFixtureCandidateMarketDatasetPackages } from "../evidence/fixture-trade-evidence-source";
import { releaseObjectIdentity } from "./release-object-store";
import { releaseJsonBytes } from "./release-manifest";

export const FIXTURE_CURRENT_AS_OF = "2026-03-01T00:00:00Z";

const fixtureDatasetPackage =
  createFixtureCandidateMarketDatasetPackages().get(
    ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  )!;
const fixtureDatasetPackageBytes = Buffer.from(
  fixtureDatasetPackage.serializedManifest,
  "utf8",
);
const fixtureProductCatalogIdentity = releaseObjectIdentity(
  FIXTURE_PRODUCT_CATALOG_ARTIFACT_BYTES,
);
const fixtureProductCatalogManifestBytes = releaseJsonBytes({
  schemaVersion: "product-catalog-manifest-v1",
  baciRelease: ACCEPTANCE_FIXTURE_RELEASE.baciRelease,
  sourceArchiveSha256: ACCEPTANCE_FIXTURE_ARTIFACT.sha256,
  hsRevision: ACCEPTANCE_FIXTURE_RELEASE.hsRevision,
  productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
  catalog: {
    schemaVersion: "product-catalog-artifact-v1",
    relativePath: "product-catalog.json",
    ...fixtureProductCatalogIdentity,
  },
  builtAt: "2026-01-23T00:00:00Z",
});
const fixtureEconomyCatalogIdentity = releaseObjectIdentity(
  FIXTURE_ECONOMY_CATALOG_ARTIFACT_BYTES,
);
const fixtureEconomyCatalogManifestBytes = releaseJsonBytes({
  schemaVersion: "candidate-market-artifact-manifest-v1",
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  baciRelease: ACCEPTANCE_FIXTURE_RELEASE.baciRelease,
  hsRevision: ACCEPTANCE_FIXTURE_RELEASE.hsRevision,
  declaredAnalysisArtifact: ACCEPTANCE_FIXTURE_ARTIFACT,
  datasetPackageIdentity: fixtureDatasetPackage.identity,
  artifact: {
    schemaVersion: "candidate-market-artifact-v1",
    relativePath: "candidate-market.fixture.json",
    ...fixtureEconomyCatalogIdentity,
  },
});

export const FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES = {
  productCatalog: FIXTURE_PRODUCT_CATALOG_ARTIFACT_BYTES,
  productCatalogManifest: fixtureProductCatalogManifestBytes,
  economyCatalog: FIXTURE_ECONOMY_CATALOG_ARTIFACT_BYTES,
  economyCatalogManifest: fixtureEconomyCatalogManifestBytes,
} as const;

const fixtureProductCatalog = {
  productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
  schemaVersion: "product-catalog-artifact-v1" as const,
  catalog: {
    key: "fixtures/acceptance/v1/product-catalog.json",
    ...fixtureProductCatalogIdentity,
  },
  manifest: {
    key: "fixtures/acceptance/v1/product-catalog-manifest.json",
    ...releaseObjectIdentity(
      fixtureProductCatalogManifestBytes,
    ),
  },
};
const fixtureEconomyCatalog = {
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  schemaVersion: "candidate-market-artifact-v1" as const,
  artifact: {
    key: "fixtures/acceptance/v1/candidate-market.fixture.json",
    ...fixtureEconomyCatalogIdentity,
  },
  manifest: {
    key: "fixtures/acceptance/v1/candidate-market-manifest.json",
    ...releaseObjectIdentity(
      fixtureEconomyCatalogManifestBytes,
    ),
  },
};

export const FIXTURE_RECOMMENDED_DATASET_MAPPING =
  createRecommendedDatasetMapping({
    schemaVersion:
      "recommended-dataset-mapping-manifest-v1",
    recipe: "candidate-market-v1",
    datasetPackage: {
      identity: fixtureDatasetPackage.identity,
      manifest: {
        key: `fixtures/acceptance/v1/${fixtureDatasetPackage.identity}.json`,
        ...releaseObjectIdentity(fixtureDatasetPackageBytes),
      },
    },
    productCatalog: {
      identity:
        recommendedProductCatalogIdentity(fixtureProductCatalog),
      ...fixtureProductCatalog,
    },
    economyCatalog: {
      identity:
        recommendedEconomyCatalogIdentity(fixtureEconomyCatalog),
      ...fixtureEconomyCatalog,
    },
  });

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
  recommendation: {
    recipe: "candidate-market-v1",
    mappingIdentity:
      FIXTURE_RECOMMENDED_DATASET_MAPPING.identity,
    datasetPackageIdentity: fixtureDatasetPackage.identity,
    productCatalogIdentity:
      FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest
        .productCatalog.identity,
    economyCatalogIdentity:
      FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest
        .economyCatalog.identity,
  },
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
