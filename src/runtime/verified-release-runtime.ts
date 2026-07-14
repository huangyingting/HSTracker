import type { ProductCatalog } from "../catalog/product-catalog";
import { ImmutableProductCatalog } from "../catalog/immutable-product-catalog";
import type { CurrentAnalysisDeployment } from "../domain/release/current-analysis";
import { resolveCurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  createCandidateMarketDatasetPackage,
  evaluateCandidateMarketV1DatasetPackage,
  type CandidateMarketDatasetPackage,
} from "../domain/trade-analytics/dataset-package";
import {
  createRecommendedDatasetMapping,
  recommendedEconomyCatalogIdentity,
  recommendedProductCatalogIdentity,
  validateRecommendedDatasetMapping,
  type RecommendedDatasetMapping,
} from "../domain/trade-analytics/recommended-dataset-mapping";
import {
  createCandidateMarketV1TradeAnalyticsPlatform,
  type CandidateMarketV1PreviousReleaseEvidence,
  type TradeAnalyticsPlatform,
} from "../domain/trade-analytics/trade-analytics-platform";
import { resolveReleaseRevisionComparisonIdentity } from "../domain/release/release-revision";
import {
  evaluateSourceFreshness,
  type SourceStatusSnapshot,
} from "../domain/release/source-freshness";
import { DuckDbEconomyDirectory } from "../economy/duckdb-economy-directory";
import type { EconomyDirectory } from "../economy/economy-directory";
import {
  createCandidateMarketDatasetPackageFromArtifacts,
  readAnalysisArtifactManifest,
  type AnalysisArtifactManifest,
} from "../evidence/analysis-artifact-manifest";
import { DuckDbAnalysisDatabase } from "../evidence/duckdb-analysis-database";
import { DuckDbTradeEvidenceSource } from "../evidence/duckdb-trade-evidence-source";
import { currentUtcSecond } from "../operations/utc-clock";
import {
  type AnalysisArtifactReference,
} from "../release/release-manifest";
import {
  ReleaseHydrator,
  type HydratedRelease,
} from "../release/release-hydration";
import {
  releaseObjectIdentity,
  type ReleaseObjectReader,
} from "../release/release-object-store";
import { readRuntimeFile } from "../runtime-file-access";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import type {
  ApplicationRuntimeResources,
  RuntimeRequestOptions,
} from "./application-runtime";
import { serializedWeight } from "./serialized-size";
import type { SourceStatusPollerDiagnostics } from "./source-status-poller";

type VerifiedReleaseRuntimeInput = {
  objectStore: ReleaseObjectReader;
  volumePath: string;
  now?: () => string;
};

export class VerifiedReleaseRuntime {
  private constructor(
    private readonly hydrated: HydratedRelease,
    private readonly manifest: AnalysisArtifactManifest,
    private readonly previousManifest: AnalysisArtifactManifest | null,
    private readonly deployment: CurrentAnalysisDeployment,
    private sourceStatus: SourceStatusSnapshot,
    private readonly analysisDatabase: DuckDbAnalysisDatabase,
    readonly tradeAnalytics: TradeAnalyticsPlatform,
    private readonly productCatalog: ProductCatalog,
    private readonly economyDirectory: EconomyDirectory,
    private readonly now: () => string,
    datasetPackage: CandidateMarketDatasetPackage,
    readonly recommendedDatasetMapping: RecommendedDatasetMapping,
  ) {
    this.retainedSourceStatuses.set(
      sourceStatus.sourceStatusSnapshotId,
      sourceStatus,
    );
  }

  private sourceStatusDiagnostics:
    | (() => SourceStatusPollerDiagnostics)
    | null = null;
  private readonly retainedSourceStatuses = new Map<
    string,
    SourceStatusSnapshot
  >();

  static async load(
    input: VerifiedReleaseRuntimeInput,
  ): Promise<VerifiedReleaseRuntime> {
    const hydrator = new ReleaseHydrator(input.objectStore);
    const hydrated = await hydrator.hydrateCurrent({
      volumePath: input.volumePath,
    });
    const [manifest, previousManifest, catalogManifest] = await Promise.all([
      readAnalysisArtifactManifest(
        hydrated.analysisArtifactManifestPath,
      ),
      hydrated.previousAnalysis === null
        ? Promise.resolve(null)
        : readAnalysisArtifactManifest(
            hydrated.previousAnalysis.artifactManifestPath,
          ),
      readJson(hydrated.productCatalogManifestPath),
    ]);
    validateHydratedPairing(
      hydrated,
      manifest,
      previousManifest,
      catalogManifest,
    );
    const datasetPackage =
      createCandidateMarketDatasetPackageFromArtifacts({
        manifest,
        analysisReleaseCatalogSha256:
          hydrated.deployment.analysisReleaseCatalogSha256,
        previousManifest,
      });
    const recommendedDatasetMapping =
      await loadRecommendedDatasetMapping(
        hydrated,
        datasetPackage,
      );
    const runAnalyticalSmoke =
      evaluateCandidateMarketV1DatasetPackage(datasetPackage)
        .compatible;
    let analysisDatabase: DuckDbAnalysisDatabase | undefined;
    try {
      analysisDatabase = await DuckDbAnalysisDatabase.open({
        currentArtifactPath: hydrated.analysisArtifactPath,
        previousArtifactPath:
          hydrated.previousAnalysis?.artifactPath ?? null,
        servingVolumePath: input.volumePath,
      });
      const analysisSource = await DuckDbTradeEvidenceSource.openShared({
        database: analysisDatabase,
        databaseName: "current",
        artifactPath: hydrated.analysisArtifactPath,
        artifactManifestPath: hydrated.analysisArtifactManifestPath,
        analysisBuildId: hydrated.deployment.analysisBuildId,
        analysisReleaseCatalogSha256:
          hydrated.deployment.analysisReleaseCatalogSha256,
      });
      const previousRelease = await openPreviousRelease(
        hydrated,
        previousManifest,
        analysisDatabase,
      );
      const [productCatalog, economyDirectory] = await Promise.all([
        ImmutableProductCatalog.open({
          catalogPath: hydrated.productCatalogPath,
          catalogManifestPath: hydrated.productCatalogManifestPath,
        }),
        DuckDbEconomyDirectory.loadShared({
          database: analysisDatabase,
          analysisBuildId: hydrated.deployment.analysisBuildId,
        }),
      ]);
      const tradeAnalytics =
        createCandidateMarketV1TradeAnalyticsPlatform({
          evidenceSource: analysisSource,
          previousRelease,
          datasetPackages: new Map([
            [hydrated.deployment.analysisBuildId, datasetPackage],
          ]),
        });
      await verifyStartupSmoke(
        hydrated,
        manifest,
        tradeAnalytics,
        productCatalog,
        economyDirectory,
        runAnalyticalSmoke,
      );
      const deployment = currentAnalysisDeployment(
        hydrated,
        manifest,
        previousManifest,
        recommendedDatasetMapping,
      );
      const sourceStatus = hydrated.sourceStatusFallback;
      assertStatusMicroCacheBudget(deployment, [sourceStatus]);
      await hydrator.commitResidentActivation(hydrated);
      return new VerifiedReleaseRuntime(
        hydrated,
        manifest,
        previousManifest,
        deployment,
        sourceStatus,
        analysisDatabase,
        tradeAnalytics,
        productCatalog,
        economyDirectory,
        input.now ?? currentUtcSecond,
        datasetPackage,
        recommendedDatasetMapping,
      );
    } catch (error) {
      analysisDatabase?.close();
      throw error;
    }
  }

  health(buildId: string) {
    const freshness = this.currentAnalysis().freshness;
    const polling = this.sourceStatusDiagnostics?.() ?? null;
    return {
      status: "ok" as const,
      readiness: "ready" as const,
      buildId,
      deployment: {
        deploymentPairingId:
          this.hydrated.deployment.deploymentPairingId,
        baciRelease: this.hydrated.deployment.baciRelease,
        analysisBuildId: this.hydrated.deployment.analysisBuildId,
        analysisReleaseCatalogSha256:
          this.hydrated.deployment.analysisReleaseCatalogSha256,
        productSearchBuildId:
          this.hydrated.deployment.productSearchBuildId,
        activatedAt: this.hydrated.deployment.activatedAt,
      },
      analysisArtifact: {
        buildId: this.manifest.artifact.buildId,
        schemaVersion: this.manifest.artifact.schemaVersion,
        sha256: this.manifest.artifact.sha256,
      },
      previousAnalysisArtifact:
        this.previousManifest === null
          ? null
          : {
              baciRelease: this.previousManifest.baciRelease,
              buildId: this.previousManifest.artifact.buildId,
              schemaVersion:
                this.previousManifest.artifact.schemaVersion,
              sha256: this.previousManifest.artifact.sha256,
            },
      freshness: {
        sourceStatusSnapshotId: freshness.sourceStatusSnapshotId,
        freshnessStatusId: freshness.freshnessStatusId,
        state: freshness.state,
        degraded:
          freshness.state !== "LATEST_KNOWN" ||
          (polling?.consecutiveFailures ?? 0) > 0,
        polling,
      },
    };
  }

  currentAnalysis() {
    return this.currentAnalysisSnapshot().manifest;
  }

  currentAnalysisSnapshot() {
    const asOf = this.now();
    return {
      asOf,
      manifest: resolveCurrentAnalysisManifest(
        this.deployment,
        this.sourceStatus,
        asOf,
      ),
    };
  }

  resolveFreshnessStatus(freshnessStatusId: string) {
    const now = this.now();
    for (const snapshot of this.retainedSourceStatuses.values()) {
      for (const asOf of freshnessTransitionTimes(snapshot, now)) {
        const freshness = evaluateSourceFreshness(snapshot, asOf);
        if (freshness.freshnessStatusId === freshnessStatusId) {
          return freshness;
        }
      }
    }
    return null;
  }

  sourceStatusFallback(): SourceStatusSnapshot {
    return this.sourceStatus;
  }

  acceptSourceStatus(snapshot: SourceStatusSnapshot): void {
    if (
      snapshot.servedBaciRelease !==
      this.deployment.source.baciRelease
    ) {
      throw new Error(
        "The Source Freshness Status snapshot does not describe the deployed BACI Release.",
      );
    }
    if (
      Date.parse(snapshot.publishedAt) <
      Date.parse(this.sourceStatus.publishedAt)
    ) {
      throw new Error(
        "The Source Freshness Status snapshot publication regressed.",
      );
    }
    const retained = new Map(this.retainedSourceStatuses);
    retained.set(snapshot.sourceStatusSnapshotId, snapshot);
    assertStatusMicroCacheBudget(this.deployment, [...retained.values()]);
    this.replaceRetainedSourceStatuses(retained.values());
    this.sourceStatus = snapshot;
  }

  retainSourceStatuses(snapshots: SourceStatusSnapshot[]): void {
    const retained = new Map<string, SourceStatusSnapshot>();
    retained.set(
      this.sourceStatus.sourceStatusSnapshotId,
      this.sourceStatus,
    );
    for (const snapshot of snapshots) {
      if (
        snapshot.servedBaciRelease ===
        this.deployment.source.baciRelease
      ) {
        retained.set(snapshot.sourceStatusSnapshotId, snapshot);
      }
    }
    assertStatusMicroCacheBudget(this.deployment, [...retained.values()]);
    this.replaceRetainedSourceStatuses(retained.values());
  }

  private replaceRetainedSourceStatuses(
    snapshots: Iterable<SourceStatusSnapshot>,
  ): void {
    this.retainedSourceStatuses.clear();
    for (const snapshot of snapshots) {
      this.retainedSourceStatuses.set(
        snapshot.sourceStatusSnapshotId,
        snapshot,
      );
    }
  }

  observeSourceStatusPolling(
    diagnostics: () => SourceStatusPollerDiagnostics,
  ): void {
    this.sourceStatusDiagnostics = diagnostics;
  }

  normalizeProductSearchQuery(query: string): string {
    return this.productCatalog.normalizeQuery(query);
  }

  searchProducts(
    query: Parameters<ProductCatalog["search"]>[0],
    options?: RuntimeRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    return this.productCatalog.search(query);
  }

  searchEconomies(
    query: Parameters<EconomyDirectory["search"]>[0],
    options?: RuntimeRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    return this.economyDirectory.search(query);
  }

  resources(): ApplicationRuntimeResources {
    const duckDb = this.analysisDatabase.resources();
    return {
      analysisExecution: {
        active: duckDb.activeConnections,
        queued: duckDb.queued,
        maxConcurrent: duckDb.connections,
        maxQueued: RUNTIME_RESOURCE_POLICY.maxQueuedAnalyses,
      },
      caches: {
        analysis: { entries: 0, bytes: 0, maxBytes: 0 },
        search: { entries: 0, bytes: 0, maxBytes: 0 },
        statusMicroCache: {
          bytes: statusMicroCacheWeight(
            this.deployment,
            [...this.retainedSourceStatuses.values()],
          ),
          maxBytes: RUNTIME_RESOURCE_POLICY.statusMicroCacheMaxBytes,
        },
        safetyReserveBytes:
          RUNTIME_RESOURCE_POLICY.cacheSafetyReserveBytes,
      },
      duckDb,
    };
  }

  close(): void {
    this.analysisDatabase.close();
  }
}

function assertStatusMicroCacheBudget(
  deployment: CurrentAnalysisDeployment,
  sourceStatuses: SourceStatusSnapshot[],
): void {
  const bytes = statusMicroCacheWeight(deployment, sourceStatuses);
  if (bytes > RUNTIME_RESOURCE_POLICY.statusMicroCacheMaxBytes) {
    throw new Error(
      "The effective manifest/status micro-cache exceeds its byte cap.",
    );
  }
}

function statusMicroCacheWeight(
  deployment: CurrentAnalysisDeployment,
  sourceStatuses: SourceStatusSnapshot[],
): number {
  return serializedWeight({ deployment, sourceStatuses });
}

function freshnessTransitionTimes(
  snapshot: SourceStatusSnapshot,
  now: string,
): string[] {
  const initial = evaluateSourceFreshness(
    snapshot,
    snapshot.publishedAt,
  );
  return [
    snapshot.publishedAt,
    initial.refreshDueAt,
    initial.checkOverdueAt,
    now,
  ].filter((value): value is string => value !== null);
}

function validateHydratedPairing(
  hydrated: HydratedRelease,
  manifest: AnalysisArtifactManifest,
  previousManifest: AnalysisArtifactManifest | null,
  catalogManifestValue: unknown,
): void {
  const deployment = hydrated.deploymentManifest;
  const analysis = deployment.analysis.artifact;
  validateAnalysisArtifactReference(
    manifest,
    analysis,
    "current",
  );
  if (
    (hydrated.previousAnalysis === null) !==
    (previousManifest === null)
  ) {
    throw new Error("Hydrated previous analysis manifest is missing.");
  }
  if (
    hydrated.previousAnalysis !== null &&
    previousManifest !== null
  ) {
    validateAnalysisArtifactReference(
      previousManifest,
      hydrated.previousAnalysis.reference,
      "previous",
    );
  }
  const catalogManifest = object(
    catalogManifestValue,
    "product catalog manifest",
  );
  if (
    catalogManifest.baciRelease !== deployment.baciRelease ||
    catalogManifest.sourceArchiveSha256 !== analysis.sourceSha256 ||
    catalogManifest.hsRevision !== analysis.hsRevision ||
    catalogManifest.productSearchBuildId !==
      deployment.productSearchBuildId
  ) {
    throw new Error(
      "Hydrated product catalog does not match its deployment pairing.",
    );
  }
}

function validateAnalysisArtifactReference(
manifest: AnalysisArtifactManifest,
reference: AnalysisArtifactReference,
label: string,
): void {
validateProductionScoreWindow(manifest);
if (
  manifest.baciRelease !== reference.baciRelease ||
  manifest.sourceSha256 !== reference.sourceSha256 ||
  manifest.hsRevision !== reference.hsRevision ||
  manifest.artifact.buildId !== reference.artifactBuildId ||
  manifest.artifact.schemaVersion !== reference.artifactSchemaVersion ||
  manifest.artifact.bytes !== reference.artifact.bytes ||
  manifest.artifact.sha256 !== reference.artifact.sha256
) {
  throw new Error(
    `Hydrated ${label} analysis artifact does not match its release catalog.`,
  );
}
}

function validateProductionScoreWindow(
manifest: AnalysisArtifactManifest,
): void {
if (
  manifest.scoreWindow.start !== manifest.finalizedCutoffYear - 4 ||
  manifest.scoreWindow.end !== manifest.finalizedCutoffYear
) {
  throw new Error(
    "The release analysis artifact does not contain the required five-year score window.",
  );
}
}

async function openPreviousRelease(
hydrated: HydratedRelease,
manifest: AnalysisArtifactManifest | null,
database: DuckDbAnalysisDatabase,
): Promise<CandidateMarketV1PreviousReleaseEvidence | null> {
if (hydrated.previousAnalysis === null || manifest === null) {
  return null;
}
const source = await DuckDbTradeEvidenceSource.openShared({
  database,
  databaseName: "previous",
  artifactPath: hydrated.previousAnalysis.artifactPath,
  artifactManifestPath:
    hydrated.previousAnalysis.artifactManifestPath,
  analysisBuildId: hydrated.deployment.analysisBuildId,
  analysisReleaseCatalogSha256:
    hydrated.deployment.analysisReleaseCatalogSha256,
});
return {
  source,
  baciRelease: manifest.baciRelease,
  artifactSha256: manifest.artifact.sha256,
  hsRevision: manifest.hsRevision,
  availableYears: manifest.ingestedYears,
};
}

async function verifyStartupSmoke(
  hydrated: HydratedRelease,
  manifest: AnalysisArtifactManifest,
  tradeAnalytics: TradeAnalyticsPlatform,
  productCatalog: ProductCatalog,
  economyDirectory: EconomyDirectory,
  runAnalyticalSmoke: boolean,
): Promise<void> {
  const benchmarks = manifest.benchmarkQueries.filter(
    ({ role }) => role === "maximum-row",
  );
  if (benchmarks.length !== 1) {
    throw new Error(
      "Analysis artifact must have exactly one startup smoke query.",
    );
  }
  const benchmark = benchmarks[0]!;
  const analysisResultPromise = runAnalyticalSmoke
    ? tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: hydrated.deployment.analysisBuildId,
        exporterCode: benchmark.exporterCode,
        productCode: benchmark.productCode,
      })
    : Promise.resolve(null);
  const [analysisOutcome, productResult, economyResult] = await Promise.all([
    analysisResultPromise,
    productCatalog.search({
      productSearchBuildId:
        hydrated.deployment.productSearchBuildId,
      query: benchmark.productCode,
      locale: "en",
      limit: 1,
    }),
    economyDirectory.search({
      analysisBuildId: hydrated.deployment.analysisBuildId,
      query: benchmark.exporterCode,
      limit: 1,
    }),
  ]);
  const analysisResult =
    analysisOutcome === null
      ? null
      : analysisOutcome.state === "success" ||
          analysisOutcome.state === "empty"
        ? analysisOutcome.payload
        : null;
  if (
    (runAnalyticalSmoke &&
      (analysisResult === null ||
        analysisResult.cohortSize !== benchmark.candidateCount ||
        analysisResult.provenance.baciRelease !==
          hydrated.deployment.baciRelease ||
        analysisResult.analysisReleaseCatalogSha256 !==
          hydrated.deployment.analysisReleaseCatalogSha256)) ||
    productResult.productSearchBuildId !==
      hydrated.deployment.productSearchBuildId ||
    productResult.matches[0]?.product.code !== benchmark.productCode ||
    economyResult.matches[0]?.economy.code !== benchmark.exporterCode
  ) {
    throw new Error("Verified release startup smoke validation failed.");
  }
}

function currentAnalysisDeployment(
  hydrated: HydratedRelease,
  manifest: AnalysisArtifactManifest,
  previousManifest: AnalysisArtifactManifest | null,
  mapping: RecommendedDatasetMapping,
): CurrentAnalysisDeployment {
  const cutoff = manifest.finalizedCutoffYear;
  return {
    analysisBuildId: hydrated.deployment.analysisBuildId,
    productSearchBuildId: hydrated.deployment.productSearchBuildId,
    analysisReleaseCatalogSha256:
      hydrated.deployment.analysisReleaseCatalogSha256,
    benchmarkQueries: manifest.benchmarkQueries,
    recommendation: {
      recipe: "candidate-market-v1",
      mappingIdentity: mapping.identity,
      datasetPackageIdentity:
        mapping.manifest.datasetPackage.identity,
      productCatalogIdentity:
        mapping.manifest.productCatalog.identity,
      economyCatalogIdentity:
        mapping.manifest.economyCatalog.identity,
    },
    source: {
      baciRelease: manifest.baciRelease,
      sourceUpdateDate: manifest.sourceUpdateDate,
      hsRevision: manifest.hsRevision,
      ingestedYears: {
        start: manifest.ingestedYears[0]!,
        end: manifest.ingestedYears.at(-1)!,
      },
      finalizedCutoffYear: cutoff,
      windows: {
        threeYear: { start: cutoff - 2, end: cutoff },
        score: manifest.scoreWindow,
        tenYear: { start: cutoff - 9, end: cutoff },
      },
      provisionalYear: manifest.provisionalYears[0]!,
      scoreVersion: "cms-v1",
      artifact: {
        buildId: manifest.artifact.buildId,
        schemaVersion: manifest.artifact.schemaVersion,
        builtAt: manifest.builtAt,
        sha256: manifest.artifact.sha256,
      },
    },
    revisionComparison: resolveReleaseRevisionComparisonIdentity({
      currentRelease: {
        baciRelease: manifest.baciRelease,
        hsRevision: manifest.hsRevision,
        scoreVersion: "cms-v1",
        scoreWindow: manifest.scoreWindow,
      },
      previousArtifact:
        previousManifest === null
          ? null
          : {
              baciRelease: previousManifest.baciRelease,
              artifactSha256: previousManifest.artifact.sha256,
              hsRevision: previousManifest.hsRevision,
              scoreVersion: "cms-v1",
              availableYears: previousManifest.ingestedYears,
              // Release Revision recomputes prior bytes over the current
              // same-period score window.
              scoreWindowUsed: manifest.scoreWindow,
            },
    }),
  };
}

async function loadRecommendedDatasetMapping(
  hydrated: HydratedRelease,
  expectedPackage: CandidateMarketDatasetPackage,
): Promise<RecommendedDatasetMapping> {
  const catalogs = recommendedCatalogs(hydrated);
  let mapping: RecommendedDatasetMapping;
  if (
    hydrated.recommendedDatasetMappingPath !== null &&
    hydrated.datasetPackageManifestPath !== null
  ) {
    mapping = createRecommendedDatasetMapping(
      await readJson(hydrated.recommendedDatasetMappingPath),
    );
    const publishedPackage = createCandidateMarketDatasetPackage(
      await readJson(hydrated.datasetPackageManifestPath),
    );
    if (publishedPackage.identity !== expectedPackage.identity) {
      throw new TypeError(
        "Recommended Dataset Mapping selected a different Dataset Package.",
      );
    }
  } else {
    const rawManifest = object(
      await readJson(hydrated.analysisArtifactManifestPath),
      "legacy analysis artifact manifest",
    );
    if (
      rawManifest.sourceReportSha256 !== undefined ||
      rawManifest.datasetPackage !== undefined
    ) {
      throw new TypeError(
        "Active deployment is missing its Recommended Dataset Mapping.",
      );
    }
    const packageBytes = Buffer.from(
      expectedPackage.serializedManifest,
      "utf8",
    );
    mapping = createRecommendedDatasetMapping({
      schemaVersion:
        "recommended-dataset-mapping-manifest-v1",
      recipe: "candidate-market-v1",
      datasetPackage: {
        identity: expectedPackage.identity,
        manifest: {
          key: `legacy-normalized-dataset-packages/${expectedPackage.identity}.json`,
          ...releaseObjectIdentity(packageBytes),
        },
      },
      productCatalog: {
        identity: recommendedProductCatalogIdentity(
          catalogs.productCatalog,
        ),
        ...catalogs.productCatalog,
      },
      economyCatalog: {
        identity: recommendedEconomyCatalogIdentity(
          catalogs.economyCatalog,
        ),
        ...catalogs.economyCatalog,
      },
    });
  }
  validateRecommendedDatasetMapping({
    mapping,
    datasetPackage: expectedPackage,
    productCatalog: catalogs.productCatalog,
    economyCatalog: catalogs.economyCatalog,
  });
  if (
    hydrated.deploymentManifest.recommendedDatasetMapping !== null &&
    mapping.identity !==
      hydrated.deploymentManifest.recommendedDatasetMapping.identity
  ) {
    throw new TypeError(
      "Active deployment references a different Recommended Dataset Mapping.",
    );
  }
  return mapping;
}

function recommendedCatalogs(hydrated: HydratedRelease) {
  const productCatalog = {
    productSearchBuildId:
      hydrated.deployment.productSearchBuildId,
    schemaVersion: "product-catalog-artifact-v1" as const,
    catalog: hydrated.deploymentManifest.productSearch.catalog,
    manifest:
      hydrated.deploymentManifest.productSearch.manifest,
  };
  const economyCatalog = {
    analysisBuildId: hydrated.deployment.analysisBuildId,
    schemaVersion: "candidate-market-artifact-v1" as const,
    artifact:
      hydrated.deploymentManifest.analysis.artifact.artifact,
    manifest:
      hydrated.deploymentManifest.analysis.artifact.manifest,
  };
  return {
    productCatalog,
    economyCatalog,
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readRuntimeFile(path, "utf8"));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
