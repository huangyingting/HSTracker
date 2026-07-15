import type { ProductCatalog } from "../catalog/product-catalog";
import { ImmutableProductCatalog } from "../catalog/immutable-product-catalog";
import type { CurrentAnalysisDeployment } from "../domain/release/current-analysis";
import { resolveCurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
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
  createTradeAnalyticsPlatform,
  type CandidateMarketV1PreviousReleaseEvidence,
  type TradeAnalyticsPlatform,
  type TradeAnalyticsPlatformInput,
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
  createSupplierCompetitionDatasetPackageFromArtifacts,
  createTradeExplorerDatasetPackageFromArtifacts,
  createTradeTrendDatasetPackageFromArtifacts,
  readAnalysisArtifactManifest,
  type AnalysisArtifactManifest,
} from "../evidence/analysis-artifact-manifest";
import { DuckDbAnalysisDatabase } from "../evidence/duckdb-analysis-database";
import type { TradeEvidenceSource } from "../evidence/trade-evidence-source";
import { DuckDbTradeEvidenceSource } from "../evidence/duckdb-trade-evidence-source";
import { evaluateSupplierCompetitionV1DatasetPackage } from "../domain/trade-analytics/supplier-competition-v1-dataset-package";
import type { SupplierCompetitionDatasetPackage } from "../domain/trade-analytics/supplier-competition-v1-dataset-package";
import { evaluateTradeExplorerV1DatasetPackage } from "../domain/trade-analytics/trade-explorer-v1-dataset-package";
import type { TradeExplorerDatasetPackage } from "../domain/trade-analytics/trade-explorer-v1-dataset-package";
import { evaluateTradeTrendV1DatasetPackage } from "../domain/trade-analytics/trade-trend-v1-dataset-package";
import type { TradeTrendDatasetPackage } from "../domain/trade-analytics/trade-trend-v1-dataset-package";
import { currentUtcSecond } from "../operations/utc-clock";
import {
  type AnalysisArtifactReference,
  type PublishedDeployment,
  type ReleaseObjectReference,
} from "../release/release-manifest";
import {
  ReleaseHydrator,
  type HydratedDeploymentPairing,
} from "../release/release-hydration";
import {
  publicDeploymentActivation,
  type DeploymentActivation,
} from "../domain/release/deployment-activation";
import {
  releaseObjectIdentity,
  type ReleaseObjectReader,
} from "../release/release-object-store";
import {
  evaluateDeploymentRetentionHeadroom,
  statfsFilesystemCapacityProbe,
  type FilesystemCapacityProbe,
} from "../deployment/deployment-retention-footprint";
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
  // Injectable seam for the pre-activation headroom gate (see
  // deployment-retention-footprint.ts); defaults to a real `statfs` probe
  // of `volumePath`. Tests substitute a deterministic capacity.
  filesystemCapacityProbe?: FilesystemCapacityProbe;
};

// Everything one retained deployment pairing (current or a retained
// predecessor) needs to serve requests on its own: its own evidence
// source, dataset packages, Recommended Dataset Mapping, product catalog,
// and economy directory, opened from its own resident directory (see
// issue #44 "bind each retained build to its own evidence source, Dataset
// Packages/Recommended Mapping, catalogs/provenance"). `runtime/
// verified-release-runtime.ts` never shares these across pairings.
type RetainedRuntimeBundle = {
  pairing: HydratedDeploymentPairing;
  manifest: AnalysisArtifactManifest;
  previousManifest: AnalysisArtifactManifest | null;
  datasetPackage: CandidateMarketDatasetPackage;
  tradeTrendDatasetPackage: TradeTrendDatasetPackage;
  supplierCompetitionDatasetPackage: SupplierCompetitionDatasetPackage;
  tradeExplorerDatasetPackage: TradeExplorerDatasetPackage;
  recommendedDatasetMapping: RecommendedDatasetMapping;
  analysisDatabase: DuckDbAnalysisDatabase;
  evidenceSource: DuckDbTradeEvidenceSource;
  previousRelease: CandidateMarketV1PreviousReleaseEvidence | null;
  productCatalog: ImmutableProductCatalog;
  economyDirectory: DuckDbEconomyDirectory;
  deployment: CurrentAnalysisDeployment;
  runAnalyticalSmoke: boolean;
  runTradeTrendSmoke: boolean;
  runSupplierCompetitionSmoke: boolean;
  runTradeExplorerSmoke: boolean;
};

export class VerifiedReleaseRuntime {
  private readonly productCatalogsByBuildId: ReadonlyMap<
    string,
    ProductCatalog
  >;
  private readonly economyDirectoriesByBuildId: ReadonlyMap<
    string,
    EconomyDirectory
  >;
  private readonly bundlesByAnalysisBuildId: ReadonlyMap<
    string,
    RetainedRuntimeBundle
  >;

  private constructor(
    // Every retained pairing in the active window, current-first: [0] is
    // current, followed by up to `DEPLOYMENT_RETENTION_HISTORY_LIMIT`
    // predecessors (see release-manifest.ts).
    private readonly bundles: readonly RetainedRuntimeBundle[],
    private readonly publishedDeployment: PublishedDeployment,
    private readonly deployment: CurrentAnalysisDeployment,
    private sourceStatus: SourceStatusSnapshot,
    readonly tradeAnalytics: TradeAnalyticsPlatform,
    private readonly now: () => string,
    readonly recommendedDatasetMapping: RecommendedDatasetMapping,
    // Fixed for this process's entire lifetime: set once from what
    // `ReleaseHydrator.hydrateCurrent()` returned at startup, and never
    // recomputed while running (see issue #45 "object-store recovery
    // never hot-swaps a running process").
    private readonly deploymentActivation: DeploymentActivation,
  ) {
    this.retainedSourceStatuses.set(
      sourceStatus.sourceStatusSnapshotId,
      sourceStatus,
    );
    this.productCatalogsByBuildId = new Map(
      bundles.map((bundle) => [
        bundle.pairing.deploymentManifest.productSearchBuildId,
        bundle.productCatalog,
      ]),
    );
    this.economyDirectoriesByBuildId = new Map(
      bundles.map((bundle) => [
        bundle.pairing.deploymentManifest.analysisBuildId,
        bundle.economyDirectory,
      ]),
    );
    this.bundlesByAnalysisBuildId = new Map(
      bundles.map((bundle) => [
        bundle.pairing.deploymentManifest.analysisBuildId,
        bundle,
      ]),
    );
  }

  private get current(): RetainedRuntimeBundle {
    return this.bundles[0]!;
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
    // Headroom is evaluated before opening any per-pairing DuckDB
    // instance and, critically, before `commitResidentActivation` below:
    // a window that cannot fit fails closed here and the prior active
    // deployment's resident activation record is left untouched (see
    // issue #44 "fail before pointer activation/committed resident
    // state; preserve prior active deployment on failure").
    const capacityProbe =
      input.filesystemCapacityProbe ?? statfsFilesystemCapacityProbe;
    const footprintPairings = await Promise.all(
      // Each retained pairing's own already-parsed release catalog (from
      // hydration) and resident Recommended Dataset Mapping let the footprint
      // count both Release Revision evidence and the separately materialized
      // Dataset Package manifest.
      hydrated.retained.map(async (pairing) => ({
        pairing: pairing.deploymentManifest,
        releaseCatalog: pairing.analysisReleaseCatalog,
        datasetPackageManifest:
          await residentDatasetPackageManifestReference(pairing),
      })),
    );
    const headroom = evaluateDeploymentRetentionHeadroom(
      footprintPairings,
      capacityProbe(input.volumePath),
    );
    if (!headroom.fits) {
      throw new Error(
        "The Deployment Retention Window does not fit the serving volume's actual capacity.",
      );
    }

    async function residentDatasetPackageManifestReference(
      pairing: HydratedDeploymentPairing,
    ): Promise<ReleaseObjectReference | undefined> {
      if (pairing.recommendedDatasetMappingPath === null) {
        return undefined;
      }
      const mapping = createRecommendedDatasetMapping(
        JSON.parse(
          await readRuntimeFile(pairing.recommendedDatasetMappingPath, "utf8"),
        ),
      );
      return mapping.manifest.datasetPackage.manifest;
    }

    const bundles: RetainedRuntimeBundle[] = [];
    try {
      for (const [index, pairing] of hydrated.retained.entries()) {
        // `current` (index 0) keeps its DuckDB spill directory at the
        // volume root for continuity with existing operational tooling;
        // each retained predecessor spills into its own resident
        // directory instead, so the three never contend for the same
        // spill budget (see deployment-retention-footprint.ts, which
        // reserves one spill allowance per retained pairing).
        bundles.push(
          await openRetainedBundle(
            pairing,
            index === 0 ? input.volumePath : pairing.rootPath,
          ),
        );
      }
      // Every manifest served for this active window advertises the full
      // retained window's own recipe/package identities, so the browser's
      // `resolvePinnedContext` can classify a pinned URL as current,
      // retained, or retired without any network lookup (see issue #44
      // "Current-analysis browser manifest should expose sufficient
      // retained pin/provenance/package metadata").
      const deploymentWindow = bundles.map((bundle) => ({
        analysisBuildId: bundle.pairing.deploymentManifest.analysisBuildId,
        recommendation: bundle.deployment.recommendation,
        baciRelease: bundle.deployment.source.baciRelease,
        artifactSha256: bundle.deployment.source.artifact.sha256,
      }));
      for (const [index, bundle] of bundles.entries()) {
        bundles[index] = {
          ...bundle,
          deployment: { ...bundle.deployment, deploymentWindow },
        };
      }

      const tradeAnalytics = createTradeAnalyticsPlatform(
        buildPlatformInput(bundles),
      );
      // Every retained deployment is smoke-tested at startup, not only
      // current, so an outage restart can trust all three without any
      // request-time verification (see issue #44 "Startup smoke all
      // supported recipes/package mappings per retained deployment").
      for (const bundle of bundles) {
        await verifyStartupSmoke(bundle, tradeAnalytics);
      }

      const current = bundles[0]!;
      const sourceStatus = hydrated.sourceStatusFallback;
      assertStatusMicroCacheBudget(current.deployment, [sourceStatus]);
      // Only an authoritative current startup commits the durable
      // resident activation record. A verified fallback reactivates the
      // last committed record as-is and must not rewrite or prune it --
      // any immutable sibling directory a failed remote candidate left
      // behind stays on disk, untouched, until the next successful
      // current commit prunes it (see issue #45).
      if (hydrated.activation.mode === "CURRENT") {
        await hydrator.commitResidentActivation(hydrated);
      }
      return new VerifiedReleaseRuntime(
        bundles,
        hydrated.deployment,
        current.deployment,
        sourceStatus,
        tradeAnalytics,
        input.now ?? currentUtcSecond,
        current.recommendedDatasetMapping,
        hydrated.activation,
      );
    } catch (error) {
      for (const bundle of bundles) {
        bundle.analysisDatabase.close();
      }
      throw error;
    }
  }

  activation(): DeploymentActivation {
    return this.deploymentActivation;
  }

  health(buildId: string) {
    const freshness = this.currentAnalysis().freshness;
    const polling = this.sourceStatusDiagnostics?.() ?? null;
    return {
      status: "ok" as const,
      readiness: "ready" as const,
      buildId,
      // Stable, machine-readable, bounded-cardinality runtime activation
      // provenance (see issue #45): `CURRENT` when this process hydrated
      // and verified the live active deployment pointer at startup,
      // `LAST_VERIFIED_RESIDENT_FALLBACK` when the current mapping could
      // not be retrieved or validated and startup instead reactivated the
      // last durably committed resident deployment. `fallbackReason`
      // stays `null` outside fallback and never carries a raw error
      // message, so it is safe to expose without leaking diagnostics.
      // `deployment` below already names the exact resident pointer
      // identity being served in either mode.
      activation: publicDeploymentActivation(this.deploymentActivation),
      deployment: {
        deploymentPairingId:
          this.publishedDeployment.deploymentPairingId,
        baciRelease: this.publishedDeployment.baciRelease,
        analysisBuildId: this.publishedDeployment.analysisBuildId,
        analysisReleaseCatalogSha256:
          this.publishedDeployment.analysisReleaseCatalogSha256,
        productSearchBuildId:
          this.publishedDeployment.productSearchBuildId,
        activatedAt: this.publishedDeployment.activatedAt,
      },
      analysisArtifact: {
        buildId: this.current.manifest.artifact.buildId,
        schemaVersion: this.current.manifest.artifact.schemaVersion,
        sha256: this.current.manifest.artifact.sha256,
      },
      previousAnalysisArtifact:
        this.current.previousManifest === null
          ? null
          : {
              baciRelease: this.current.previousManifest.baciRelease,
              buildId: this.current.previousManifest.artifact.buildId,
              schemaVersion:
                this.current.previousManifest.artifact.schemaVersion,
              sha256: this.current.previousManifest.artifact.sha256,
            },
      freshness: {
        sourceStatusSnapshotId: freshness.sourceStatusSnapshotId,
        freshnessStatusId: freshness.freshnessStatusId,
        state: freshness.state,
        deploymentActivation: freshness.deploymentActivation,
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
        this.deploymentActivation,
      ),
    };
  }

  /**
   * Resolves the manifest for any analysisBuildId within the retention
   * window -- current or a retained predecessor -- without any
   * object-store access, or `null` when the build is unknown (older than
   * the window, or never promoted), which callers must treat as retired
   * (see issue #44 "Requests older than the online window return the
   * typed retired outcome"). Current always reflects the live,
   * poll-updated Source Freshness Status via `currentAnalysis()`; a
   * retained predecessor instead reports its own frozen bootstrap status,
   * since retained pairings are immutable historical snapshots that the
   * source-status poller never revises.
   */
  resolveAnalysisManifest(
    analysisBuildId: string,
  ): CurrentAnalysisManifest | null {
    if (analysisBuildId === this.deployment.analysisBuildId) {
      return this.currentAnalysis();
    }
    const bundle = this.bundlesByAnalysisBuildId.get(analysisBuildId);
    if (bundle === undefined) {
      return null;
    }
    return resolveCurrentAnalysisManifest(
      bundle.deployment,
      bundle.pairing.deploymentManifest.sourceStatusFallback,
      bundle.pairing.deploymentManifest.sourceStatusFallback.checkedAt,
      this.deploymentActivation,
    );
  }

  resolveFreshnessStatus(freshnessStatusId: string) {
    const now = this.now();
    for (const snapshot of this.retainedSourceStatuses.values()) {
      for (const asOf of freshnessTransitionTimes(snapshot, now)) {
        const freshness = evaluateSourceFreshness(
          snapshot,
          asOf,
          this.deploymentActivation,
        );
        if (freshness.freshnessStatusId === freshnessStatusId) {
          return freshness;
        }
      }
    }
    // A retained predecessor's own frozen bootstrap status never enters
    // `retainedSourceStatuses` (that map tracks only current's own BACI
    // Release lineage as the source-status poller advances it): a CSV
    // export pinned to a retained build's freshnessStatusId still
    // resolves here so its retained export binds its own exact
    // freshness rather than current's (see issue #44).
    for (const bundle of this.bundles.slice(1)) {
      const snapshot = bundle.pairing.deploymentManifest.sourceStatusFallback;
      for (const asOf of freshnessTransitionTimes(snapshot, now)) {
        const freshness = evaluateSourceFreshness(
          snapshot,
          asOf,
          this.deploymentActivation,
        );
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
    return this.current.productCatalog.normalizeQuery(query);
  }

  // Dispatches by the query's own `productSearchBuildId` to the exact
  // retained catalog it names -- current or a retained predecessor -- so
  // a pinned CSV/JSON export request bound to a retained build resolves
  // its exact product without mixing in current metadata. An
  // unrecognized build falls back to current's catalog, which reproduces
  // today's `retiredProductSearchBuild` rejection unchanged (see issue
  // #44: live typeahead search only ever supplies current's own build ID,
  // so this widening is invisible to it).
  searchProducts(
    query: Parameters<ProductCatalog["search"]>[0],
    options?: RuntimeRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    const catalog =
      this.productCatalogsByBuildId.get(query.productSearchBuildId) ??
      this.current.productCatalog;
    return catalog.search(query);
  }

  // Mirrors `searchProducts` above, dispatching by `analysisBuildId`.
  searchEconomies(
    query: Parameters<EconomyDirectory["search"]>[0],
    options?: RuntimeRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    const directory =
      this.economyDirectoriesByBuildId.get(query.analysisBuildId) ??
      this.current.economyDirectory;
    return directory.search(query);
  }

  resources(): ApplicationRuntimeResources {
    const duckDb = this.current.analysisDatabase.resources();
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
    for (const bundle of this.bundles) {
      bundle.analysisDatabase.close();
    }
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
  hydrated: HydratedDeploymentPairing,
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
hydrated: HydratedDeploymentPairing,
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
  analysisBuildId: hydrated.deploymentManifest.analysisBuildId,
  analysisReleaseCatalogSha256:
    hydrated.deploymentManifest.analysisReleaseCatalogSha256,
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
  bundle: RetainedRuntimeBundle,
  tradeAnalytics: TradeAnalyticsPlatform,
): Promise<void> {
  const manifest = bundle.manifest;
  const analysisBuildId = bundle.pairing.deploymentManifest.analysisBuildId;
  const baciRelease = bundle.pairing.deploymentManifest.baciRelease;
  const analysisReleaseCatalogSha256 =
    bundle.pairing.deploymentManifest.analysisReleaseCatalogSha256;
  const productSearchBuildId =
    bundle.pairing.deploymentManifest.productSearchBuildId;
  const runAnalyticalSmoke = bundle.runAnalyticalSmoke;
  const runTradeTrendSmoke = bundle.runTradeTrendSmoke;
  const runSupplierCompetitionSmoke = bundle.runSupplierCompetitionSmoke;
  const productCatalog = bundle.productCatalog;
  const economyDirectory = bundle.economyDirectory;
  const benchmarks = manifest.benchmarkQueries.filter(
    ({ role }) => role === "maximum-row",
  );
  if (benchmarks.length !== 1) {
    throw new Error(
      "Analysis artifact must have exactly one startup smoke query.",
    );
  }
  const benchmark = benchmarks[0]!;
  const tradeTrendBenchmarks = manifest.tradeTrendBenchmarkQueries.filter(
    ({ role }) => role === "maximum-row",
  );
  if (tradeTrendBenchmarks.length > 1) {
    throw new Error(
      "Analysis artifact must have at most one Trade Trend startup smoke query.",
    );
  }
  const tradeTrendBenchmark = tradeTrendBenchmarks[0] ?? null;
  const shouldRunTradeTrendSmoke =
    runTradeTrendSmoke && tradeTrendBenchmark !== null;
  const supplierCompetitionBenchmarks =
    manifest.supplierCompetitionBenchmarkQueries.filter(
      ({ role }) => role === "maximum-row",
    );
  if (supplierCompetitionBenchmarks.length > 1) {
    throw new Error(
      "Analysis artifact must have at most one Supplier Competition startup smoke query.",
    );
  }
  const supplierCompetitionBenchmark =
    supplierCompetitionBenchmarks[0] ?? null;
  const shouldRunSupplierCompetitionSmoke =
    runSupplierCompetitionSmoke && supplierCompetitionBenchmark !== null;
  const runTradeExplorerSmoke = bundle.runTradeExplorerSmoke;
  if (
    runTradeExplorerSmoke &&
    (manifest.tradeExplorerBenchmarkQueries.length !== 4 ||
      new Set(
        manifest.tradeExplorerBenchmarkQueries.map(({ role }) => role),
      ).size !== 4)
  ) {
    throw new Error(
      "An activated Trade Explorer package requires one benchmark for every representative role.",
    );
  }
  const tradeExplorerBenchmarks = manifest.tradeExplorerBenchmarkQueries.filter(
    ({ role }) => role === "maximum-row",
  );
  if (runTradeExplorerSmoke && tradeExplorerBenchmarks.length !== 1) {
    throw new Error(
      "Analysis artifact has an invalid Trade Explorer startup smoke query set.",
    );
  }
  const tradeExplorerBenchmark = tradeExplorerBenchmarks[0] ?? null;
  const shouldRunTradeExplorerSmoke =
    runTradeExplorerSmoke && tradeExplorerBenchmark !== null;

  const analysisResultPromise = runAnalyticalSmoke
    ? tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId,
        exporterCode: benchmark.exporterCode,
        productCode: benchmark.productCode,
      })
    : Promise.resolve(null);
  const tradeTrendResultPromise = shouldRunTradeTrendSmoke
    ? tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId,
        importerCode: tradeTrendBenchmark!.importerCode,
        productCode: tradeTrendBenchmark!.productCode,
      })
    : Promise.resolve(null);
  const supplierCompetitionResultPromise = shouldRunSupplierCompetitionSmoke
    ? tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId,
        importerCode: supplierCompetitionBenchmark!.importerCode,
        productCode: supplierCompetitionBenchmark!.productCode,
      })
    : Promise.resolve(null);
  // The benchmark's own single implicit shape is finalized-trend-v1 grouped
  // on YEAR (see TradeExplorerArtifactBenchmarkQuery in analysis-artifact-
  // manifest.ts): an empty year list expands to the full five-year
  // finalized window (see normalizeTradeExplorerV1Request), so this smoke
  // query exercises the whole window in one request.
  const tradeExplorerResultPromise = shouldRunTradeExplorerSmoke
    ? tradeAnalytics.execute({
        recipe: "trade-explorer-v1",
        analysisBuildId,
        shape: "finalized-trend-v1",
        dimensions: ["YEAR"],
        measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
        filters: {
          year: { mode: "list", years: [] },
          exportEconomy: [tradeExplorerBenchmark!.exportEconomyCode],
          importEconomy: [tradeExplorerBenchmark!.importEconomyCode],
          hsProduct: [tradeExplorerBenchmark!.hsProductCode],
        },
        sort: null,
      })
    : Promise.resolve(null);
  const [
    analysisOutcome,
    tradeTrendOutcome,
    supplierCompetitionOutcome,
    tradeExplorerOutcome,
    productResult,
    economyResult,
  ] = await Promise.all([
    analysisResultPromise,
    tradeTrendResultPromise,
    supplierCompetitionResultPromise,
    tradeExplorerResultPromise,
    productCatalog.search({
      productSearchBuildId,
      query: benchmark.productCode,
      locale: "en",
      limit: 1,
    }),
    economyDirectory.search({
      analysisBuildId,
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
  const tradeTrendResult =
    tradeTrendOutcome === null
      ? null
      : tradeTrendOutcome.state === "success"
        ? tradeTrendOutcome.payload
        : null;
  const supplierCompetitionResult =
    supplierCompetitionOutcome === null
      ? null
      : supplierCompetitionOutcome.state === "success" ||
          supplierCompetitionOutcome.state === "empty"
        ? supplierCompetitionOutcome.payload
        : null;
  const tradeExplorerResult =
    tradeExplorerOutcome === null
      ? null
      : tradeExplorerOutcome.state === "success"
        ? tradeExplorerOutcome.payload
        : null;
  if (
    (runAnalyticalSmoke &&
      (analysisResult === null ||
        analysisResult.cohortSize !== benchmark.candidateCount ||
        analysisResult.provenance.baciRelease !== baciRelease ||
        analysisResult.analysisReleaseCatalogSha256 !==
          analysisReleaseCatalogSha256)) ||
    (shouldRunTradeTrendSmoke &&
      (tradeTrendResult === null ||
        tradeTrendResult.provenance.baciRelease !== baciRelease ||
        tradeTrendResult.analysisReleaseCatalogSha256 !==
          analysisReleaseCatalogSha256 ||
        tradeTrendResult.query.importer.code !==
          tradeTrendBenchmark!.importerCode ||
        tradeTrendResult.query.product.code !==
          tradeTrendBenchmark!.productCode)) ||
    (shouldRunSupplierCompetitionSmoke &&
      (supplierCompetitionResult === null ||
        supplierCompetitionResult.provenance.baciRelease !== baciRelease ||
        supplierCompetitionResult.analysisReleaseCatalogSha256 !==
          analysisReleaseCatalogSha256 ||
        supplierCompetitionResult.query.importer.code !==
          supplierCompetitionBenchmark!.importerCode ||
        supplierCompetitionResult.query.product.code !==
          supplierCompetitionBenchmark!.productCode)) ||
    (shouldRunTradeExplorerSmoke &&
      (tradeExplorerResult === null ||
        tradeExplorerResult.provenance.baciRelease !== baciRelease ||
        tradeExplorerResult.analysisReleaseCatalogSha256 !==
          analysisReleaseCatalogSha256 ||
        tradeExplorerResult.rowCount !==
          tradeExplorerBenchmark!.groupedRowCount ||
        tradeExplorerResult.query.exportEconomy[0] !==
          tradeExplorerBenchmark!.exportEconomyCode ||
        tradeExplorerResult.query.importEconomy[0] !==
          tradeExplorerBenchmark!.importEconomyCode ||
        tradeExplorerResult.query.hsProduct[0] !==
          tradeExplorerBenchmark!.hsProductCode)) ||
    productResult.productSearchBuildId !== productSearchBuildId ||
    productResult.matches[0]?.product.code !== benchmark.productCode ||
    economyResult.matches[0]?.economy.code !== benchmark.exporterCode
  ) {
    throw new Error("Verified release startup smoke validation failed.");
  }
}

function currentAnalysisDeployment(
  hydrated: HydratedDeploymentPairing,
  manifest: AnalysisArtifactManifest,
  previousManifest: AnalysisArtifactManifest | null,
  mapping: RecommendedDatasetMapping,
  tradeTrendDatasetPackage: TradeTrendDatasetPackage,
  supplierCompetitionDatasetPackage: SupplierCompetitionDatasetPackage,
  tradeExplorerDatasetPackage: TradeExplorerDatasetPackage,
): CurrentAnalysisDeployment {
  const cutoff = manifest.finalizedCutoffYear;
  return {
    analysisBuildId: hydrated.deploymentManifest.analysisBuildId,
    productSearchBuildId: hydrated.deploymentManifest.productSearchBuildId,
    analysisReleaseCatalogSha256:
      hydrated.deploymentManifest.analysisReleaseCatalogSha256,
    // Populated once every retained bundle has been opened (see
    // `VerifiedReleaseRuntime.load`); a bundle is never served before
    // that patch runs.
    deploymentWindow: [],
    benchmarkQueries: manifest.benchmarkQueries,
    tradeExplorerBenchmarkQueries: manifest.tradeExplorerBenchmarkQueries,
    recommendation: {
      recipe: "candidate-market-v1",
      mappingIdentity: mapping.identity,
      datasetPackageIdentity:
        mapping.manifest.datasetPackage.identity,
      productCatalogIdentity:
        mapping.manifest.productCatalog.identity,
      economyCatalogIdentity:
        mapping.manifest.economyCatalog.identity,
      tradeTrend:
        mapping.manifest.tradeTrend === null
          ? null
          : {
              recipe: "trade-trend-v1",
              datasetPackageIdentity: tradeTrendDatasetPackage.identity,
            },
      supplierCompetition:
        mapping.manifest.supplierCompetition === null
          ? null
          : {
              recipe: "supplier-competition-v1",
              datasetPackageIdentity:
                supplierCompetitionDatasetPackage.identity,
            },
      // trade-explorer-v1 activates only when the same closed Recommended
      // Dataset Mapping also declares and gates it (see issue #47), just
      // like tradeTrend/supplierCompetition above; null for legacy,
      // Candidate-Market-only, or Trade-Explorer-undeclared mappings.
      tradeExplorer:
        mapping.manifest.tradeExplorer === null
          ? null
          : {
              recipe: "trade-explorer-v1",
              datasetPackageIdentity: tradeExplorerDatasetPackage.identity,
            },
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
  hydrated: HydratedDeploymentPairing,
  expectedPackage: CandidateMarketDatasetPackage,
  expectedTradeTrendPackage: TradeTrendDatasetPackage,
  expectedSupplierCompetitionPackage: SupplierCompetitionDatasetPackage,
  expectedTradeExplorerPackage: TradeExplorerDatasetPackage,
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
      // A legacy analysis artifact manifest predates capability
      // declarations entirely, so it never went through Trade Trend,
      // Supplier Competition, or Trade Explorer review either: normalize
      // it as Candidate-Market-only rather than deriving support from a
      // default declaration it never published.
      tradeTrend: null,
      supplierCompetition: null,
      tradeExplorer: null,
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
    tradeTrendDatasetPackage:
      mapping.manifest.tradeTrend === null
        ? null
        : expectedTradeTrendPackage,
    supplierCompetitionDatasetPackage:
      mapping.manifest.supplierCompetition === null
        ? null
        : expectedSupplierCompetitionPackage,
    tradeExplorerDatasetPackage:
      mapping.manifest.tradeExplorer === null
        ? null
        : expectedTradeExplorerPackage,
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

function recommendedCatalogs(hydrated: HydratedDeploymentPairing) {
  const productCatalog = {
    productSearchBuildId:
      hydrated.deploymentManifest.productSearchBuildId,
    schemaVersion: "product-catalog-artifact-v1" as const,
    catalog: hydrated.deploymentManifest.productSearch.catalog,
    manifest:
      hydrated.deploymentManifest.productSearch.manifest,
  };
  const economyCatalog = {
    analysisBuildId: hydrated.deploymentManifest.analysisBuildId,
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

/**
 * Hydrates one retained deployment pairing's complete, isolated runtime
 * bundle: its own analysis artifact manifest, product-catalog manifest,
 * Dataset Packages, Recommended Dataset Mapping, DuckDB instance
 * (attaching its own Release Revision "previous" artifact when its
 * release catalog declares one), evidence source, product catalog, and
 * economy directory. Nothing here is shared with another pairing's
 * bundle (see issue #44 "bind each retained build to its own evidence
 * source, Dataset Packages/Recommended Mapping, catalogs/provenance").
 */
async function openRetainedBundle(
  pairing: HydratedDeploymentPairing,
  servingVolumePath: string,
): Promise<RetainedRuntimeBundle> {
  const [manifest, previousManifest, catalogManifest] = await Promise.all([
    readAnalysisArtifactManifest(pairing.analysisArtifactManifestPath),
    pairing.previousAnalysis === null
      ? Promise.resolve(null)
      : readAnalysisArtifactManifest(
          pairing.previousAnalysis.artifactManifestPath,
        ),
    readJson(pairing.productCatalogManifestPath),
  ]);
  validateHydratedPairing(pairing, manifest, previousManifest, catalogManifest);
  const datasetPackage = createCandidateMarketDatasetPackageFromArtifacts({
    manifest,
    analysisReleaseCatalogSha256:
      pairing.deploymentManifest.analysisReleaseCatalogSha256,
    previousManifest,
  });
  const tradeTrendDatasetPackage =
    createTradeTrendDatasetPackageFromArtifacts(manifest);
  const supplierCompetitionDatasetPackage =
    createSupplierCompetitionDatasetPackageFromArtifacts(manifest);
  const tradeExplorerDatasetPackage =
    createTradeExplorerDatasetPackageFromArtifacts(manifest);
  const recommendedDatasetMapping = await loadRecommendedDatasetMapping(
    pairing,
    datasetPackage,
    tradeTrendDatasetPackage,
    supplierCompetitionDatasetPackage,
    tradeExplorerDatasetPackage,
  );
  const runAnalyticalSmoke =
    evaluateCandidateMarketV1DatasetPackage(datasetPackage).compatible;
  const runTradeTrendSmoke =
    recommendedDatasetMapping.manifest.tradeTrend !== null &&
    evaluateTradeTrendV1DatasetPackage(tradeTrendDatasetPackage).compatible;
  const runSupplierCompetitionSmoke =
    recommendedDatasetMapping.manifest.supplierCompetition !== null &&
    evaluateSupplierCompetitionV1DatasetPackage(
      supplierCompetitionDatasetPackage,
    ).compatible;
  const runTradeExplorerSmoke =
    recommendedDatasetMapping.manifest.tradeExplorer !== null &&
    evaluateTradeExplorerV1DatasetPackage(
      tradeExplorerDatasetPackage,
    ).compatible;

  const analysisDatabase = await DuckDbAnalysisDatabase.open({
    currentArtifactPath: pairing.analysisArtifactPath,
    previousArtifactPath: pairing.previousAnalysis?.artifactPath ?? null,
    servingVolumePath,
  });
  try {
    const evidenceSource = await DuckDbTradeEvidenceSource.openShared({
      database: analysisDatabase,
      databaseName: "current",
      artifactPath: pairing.analysisArtifactPath,
      artifactManifestPath: pairing.analysisArtifactManifestPath,
      analysisBuildId: pairing.deploymentManifest.analysisBuildId,
      analysisReleaseCatalogSha256:
        pairing.deploymentManifest.analysisReleaseCatalogSha256,
    });
    const previousRelease = await openPreviousRelease(
      pairing,
      previousManifest,
      analysisDatabase,
    );
    const [productCatalog, economyDirectory] = await Promise.all([
      ImmutableProductCatalog.open({
        catalogPath: pairing.productCatalogPath,
        catalogManifestPath: pairing.productCatalogManifestPath,
      }),
      DuckDbEconomyDirectory.loadShared({
        database: analysisDatabase,
        analysisBuildId: pairing.deploymentManifest.analysisBuildId,
      }),
    ]);
    const deployment = currentAnalysisDeployment(
      pairing,
      manifest,
      previousManifest,
      recommendedDatasetMapping,
      tradeTrendDatasetPackage,
      supplierCompetitionDatasetPackage,
      tradeExplorerDatasetPackage,
    );
    return {
      pairing,
      manifest,
      previousManifest,
      datasetPackage,
      tradeTrendDatasetPackage,
      supplierCompetitionDatasetPackage,
      tradeExplorerDatasetPackage,
      recommendedDatasetMapping,
      analysisDatabase,
      evidenceSource,
      previousRelease,
      productCatalog,
      economyDirectory,
      deployment,
      runAnalyticalSmoke,
      runTradeTrendSmoke,
      runSupplierCompetitionSmoke,
      runTradeExplorerSmoke,
    };
  } catch (error) {
    analysisDatabase.close();
    throw error;
  }
}

/**
 * Builds the deepened per-build binding the closed
 * `TradeAnalyticsPlatform.execute` seam uses to dispatch by
 * analysisBuildId: each retained bundle contributes its own evidence
 * source, Dataset Package, and (for Candidate Market) Release Revision
 * evidence, and a recipe section is omitted entirely -- never populated
 * with an unverified fallback -- when no retained bundle's own
 * Recommended Dataset Mapping declares it (see
 * trade-analytics-platform.ts and recommended-dataset-mapping.ts).
 */
function buildPlatformInput(
  bundles: readonly RetainedRuntimeBundle[],
): TradeAnalyticsPlatformInput {
  const candidateMarketEvidence = new Map<string, TradeEvidenceSource>();
  const candidateMarketPackages = new Map<
    string,
    CandidateMarketDatasetPackage
  >();
  const candidateMarketPreviousRelease = new Map<
    string,
    CandidateMarketV1PreviousReleaseEvidence
  >();
  const tradeTrendEvidence = new Map<string, TradeEvidenceSource>();
  const tradeTrendPackages = new Map<string, TradeTrendDatasetPackage>();
  const supplierCompetitionEvidence = new Map<string, TradeEvidenceSource>();
  const supplierCompetitionPackages = new Map<
    string,
    SupplierCompetitionDatasetPackage
  >();
  const tradeExplorerEvidence = new Map<string, TradeEvidenceSource>();
  const tradeExplorerPackages = new Map<
    string,
    TradeExplorerDatasetPackage
  >();

  for (const bundle of bundles) {
    const buildId = bundle.pairing.deploymentManifest.analysisBuildId;
    candidateMarketEvidence.set(buildId, bundle.evidenceSource);
    candidateMarketPackages.set(buildId, bundle.datasetPackage);
    if (bundle.previousRelease !== null) {
      candidateMarketPreviousRelease.set(buildId, bundle.previousRelease);
    }
    if (bundle.recommendedDatasetMapping.manifest.tradeTrend !== null) {
      tradeTrendEvidence.set(buildId, bundle.evidenceSource);
      tradeTrendPackages.set(buildId, bundle.tradeTrendDatasetPackage);
    }
    if (
      bundle.recommendedDatasetMapping.manifest.supplierCompetition !== null
    ) {
      supplierCompetitionEvidence.set(buildId, bundle.evidenceSource);
      supplierCompetitionPackages.set(
        buildId,
        bundle.supplierCompetitionDatasetPackage,
      );
    }
    if (bundle.recommendedDatasetMapping.manifest.tradeExplorer !== null) {
      tradeExplorerEvidence.set(buildId, bundle.evidenceSource);
      tradeExplorerPackages.set(buildId, bundle.tradeExplorerDatasetPackage);
    }
  }

  return {
    candidateMarket: {
      evidenceSource: candidateMarketEvidence,
      previousRelease: candidateMarketPreviousRelease,
      datasetPackages: candidateMarketPackages,
    },
    ...(tradeTrendPackages.size === 0
      ? {}
      : {
          tradeTrend: {
            evidenceSource: tradeTrendEvidence,
            datasetPackages: tradeTrendPackages,
          },
        }),
    ...(supplierCompetitionPackages.size === 0
      ? {}
      : {
          supplierCompetition: {
            evidenceSource: supplierCompetitionEvidence,
            datasetPackages: supplierCompetitionPackages,
          },
        }),
    ...(tradeExplorerPackages.size === 0
      ? {}
      : {
          tradeExplorer: {
            evidenceSource: tradeExplorerEvidence,
            datasetPackages: tradeExplorerPackages,
          },
        }),
  };
}
