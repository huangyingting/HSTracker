import { readFile } from "node:fs/promises";

import type { ProductCatalog } from "../catalog/product-catalog";
import { ImmutableProductCatalog } from "../catalog/immutable-product-catalog";
import {
  CmsV1CandidateMarketAnalysis,
  type CandidateMarketAnalysis,
  type PreviousReleaseEvidence,
} from "../domain/candidate-market/analyze-candidate-markets";
import type { CurrentAnalysisDeployment } from "../domain/release/current-analysis";
import { resolveCurrentAnalysisManifest } from "../domain/release/current-analysis";
import { resolveReleaseRevisionComparisonIdentity } from "../domain/release/release-revision";
import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import { DuckDbEconomyDirectory } from "../economy/duckdb-economy-directory";
import type { EconomyDirectory } from "../economy/economy-directory";
import {
  readAnalysisArtifactManifest,
  type AnalysisArtifactManifest,
} from "../evidence/analysis-artifact-manifest";
import { DuckDbTradeEvidenceSource } from "../evidence/duckdb-trade-evidence-source";
import {
  contentAddressedId,
  type AnalysisArtifactReference,
} from "../release/release-manifest";
import {
  ReleaseHydrator,
  type HydratedRelease,
} from "../release/release-hydration";
import type { ReleaseObjectReader } from "../release/release-object-store";

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
    private readonly sourceStatus: SourceStatusSnapshot,
    private readonly analysisSources: readonly DuckDbTradeEvidenceSource[],
    private readonly analysis: CandidateMarketAnalysis,
    private readonly productCatalog: ProductCatalog,
    private readonly economyDirectory: EconomyDirectory,
    private readonly now: () => string,
  ) {}

  static async load(
    input: VerifiedReleaseRuntimeInput,
  ): Promise<VerifiedReleaseRuntime> {
    const hydrated = await new ReleaseHydrator(
      input.objectStore,
    ).hydrateCurrent({
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

    const analysisSources: DuckDbTradeEvidenceSource[] = [];
    try {
      const analysisSource = await DuckDbTradeEvidenceSource.open({
        artifactPath: hydrated.analysisArtifactPath,
        artifactManifestPath: hydrated.analysisArtifactManifestPath,
        analysisBuildId: hydrated.deployment.analysisBuildId,
        analysisReleaseCatalogSha256:
          hydrated.deployment.analysisReleaseCatalogSha256,
      });
      analysisSources.push(analysisSource);
      const previousRelease = await openPreviousRelease(
        hydrated,
        previousManifest,
        analysisSources,
      );
      const [productCatalog, economyDirectory] = await Promise.all([
        ImmutableProductCatalog.open({
          catalogPath: hydrated.productCatalogPath,
          catalogManifestPath: hydrated.productCatalogManifestPath,
        }),
        DuckDbEconomyDirectory.load({
          artifactPath: hydrated.analysisArtifactPath,
          analysisBuildId: hydrated.deployment.analysisBuildId,
        }),
      ]);
      const analysis = new CmsV1CandidateMarketAnalysis(
        analysisSource,
        previousRelease,
      );
      await verifyStartupSmoke(
        hydrated,
        manifest,
        analysis,
        productCatalog,
        economyDirectory,
      );
      const deployment = currentAnalysisDeployment(
        hydrated,
        manifest,
        previousManifest,
      );
      const sourceStatus = fallbackSourceStatus(
        hydrated,
        manifest,
      );
      return new VerifiedReleaseRuntime(
        hydrated,
        manifest,
        previousManifest,
        deployment,
        sourceStatus,
        analysisSources,
        analysis,
        productCatalog,
        economyDirectory,
        input.now ?? currentUtcSecond,
      );
    } catch (error) {
      for (const source of analysisSources) {
        source.close();
      }
      throw error;
    }
  }

  health(buildId: string) {
    const freshness = this.currentAnalysis().freshness;
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
    const freshness = this.currentAnalysis().freshness;
    return freshness.freshnessStatusId === freshnessStatusId
      ? freshness
      : null;
  }

  analyze(
    query: Parameters<CandidateMarketAnalysis["analyze"]>[0],
  ) {
    return this.analysis.analyze(query);
  }

  searchProducts(query: Parameters<ProductCatalog["search"]>[0]) {
    return this.productCatalog.search(query);
  }

  searchEconomies(query: Parameters<EconomyDirectory["search"]>[0]) {
    return this.economyDirectory.search(query);
  }

  close(): void {
    for (const source of this.analysisSources) {
      source.close();
    }
  }
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
openedSources: DuckDbTradeEvidenceSource[],
): Promise<PreviousReleaseEvidence | null> {
if (hydrated.previousAnalysis === null || manifest === null) {
  return null;
}
const source = await DuckDbTradeEvidenceSource.open({
  artifactPath: hydrated.previousAnalysis.artifactPath,
  artifactManifestPath:
    hydrated.previousAnalysis.artifactManifestPath,
  analysisBuildId: hydrated.deployment.analysisBuildId,
  analysisReleaseCatalogSha256:
    hydrated.deployment.analysisReleaseCatalogSha256,
});
openedSources.push(source);
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
  analysis: CandidateMarketAnalysis,
  productCatalog: ProductCatalog,
  economyDirectory: EconomyDirectory,
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
  const [analysisResult, productResult, economyResult] = await Promise.all([
    analysis.analyze({
      analysisBuildId: hydrated.deployment.analysisBuildId,
      exporterCode: benchmark.exporterCode,
      productCode: benchmark.productCode,
    }),
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
  if (
    analysisResult.cohortSize !== benchmark.candidateCount ||
    analysisResult.provenance.baciRelease !==
      hydrated.deployment.baciRelease ||
    analysisResult.analysisReleaseCatalogSha256 !==
      hydrated.deployment.analysisReleaseCatalogSha256 ||
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
): CurrentAnalysisDeployment {
  const cutoff = manifest.finalizedCutoffYear;
  return {
    analysisBuildId: hydrated.deployment.analysisBuildId,
    productSearchBuildId: hydrated.deployment.productSearchBuildId,
    analysisReleaseCatalogSha256:
      hydrated.deployment.analysisReleaseCatalogSha256,
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

function fallbackSourceStatus(
  hydrated: HydratedRelease,
  manifest: AnalysisArtifactManifest,
): SourceStatusSnapshot {
  return {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId: contentAddressedId(
      "source-status-bootstrap-v1",
      {
        deploymentPairingId:
          hydrated.deployment.deploymentPairingId,
        activatedAt: hydrated.deployment.activatedAt,
        baciRelease: hydrated.deployment.baciRelease,
        checkedAt: manifest.builtAt,
        artifactSha256: manifest.artifact.sha256,
      },
    ),
    checkedAt: manifest.builtAt,
    servedBaciRelease: hydrated.deployment.baciRelease,
    latestKnownBaciRelease: hydrated.deployment.baciRelease,
    newerReleaseDetectedAt: null,
    refreshFailed: false,
    rollbackActive: false,
    publishedAt: hydrated.deployment.activatedAt,
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function currentUtcSecond(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}
