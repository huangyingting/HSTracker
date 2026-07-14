import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import {
  evaluateCandidateMarketV1DatasetPackage,
  type CandidateMarketDatasetPackage,
} from "../domain/trade-analytics/dataset-package";
import {
  createRecommendedDatasetMapping,
  recommendedEconomyCatalogIdentity,
  recommendedProductCatalogIdentity,
  type RecommendedDatasetMapping,
} from "../domain/trade-analytics/recommended-dataset-mapping";
import {
  createCandidateMarketDatasetPackageFromArtifacts,
  parseAnalysisArtifactManifest,
  type AnalysisArtifactManifest,
} from "../evidence/analysis-artifact-manifest";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  assertDeploymentReleaseCatalog,
  contentAddressedId,
  parseActiveDeploymentPointer,
  parseAnalysisReleaseCatalog,
  parseDeploymentPairingManifest,
  parseSourceStatusSnapshot,
  publishedDeployment,
  readReleaseMetadata,
  releaseJsonBytes,
  sameSourceStatusSnapshot,
  type ActiveDeploymentPointer,
  type AnalysisArtifactReference,
  type DeploymentPairingManifest,
  type PublishedDeployment,
  type ProductCatalogReference,
  type ReleaseObjectReference,
} from "./release-manifest";
import {
  releaseObjectIdentity,
  singleChunk,
  streamReleaseObjectIdentity,
  type ReleaseObjectIdentity,
  type ReleaseObjectStore,
} from "./release-object-store";
import {
  createPublishedSourceStatusSnapshot,
  sourceStatusSnapshot,
} from "./source-status-publication";
import { validateDeploymentActivation } from "./deployment-activation-validation";
import {
  count,
  hs12,
  prefixedId,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "./release-validation";

const RESULT_SCHEMA_VERSION = "candidate-market-result-v1";
const SCORE_VERSION = "cms-v1";

export type { PublishedDeployment } from "./release-manifest";

export type PromoteReleaseInput = {
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
  activatedAt: string;
  sourceStatusFallback?: SourceStatusSnapshot;
  expectedBaciRelease?: string;
  expectedCurrentDeploymentPairingId?: string | null;
};

export type RollbackReleaseInput = {
  activatedAt: string;
  sourceStatus?: SourceStatusSnapshot;
  expectedCurrentDeploymentPairingId?: string;
};

export class ReleasePublicationError extends Error {
  constructor(
    readonly code:
      | "ACTIVATION_FAILED"
      | "ACTIVATION_PRECONDITION_FAILED"
      | "NO_PREVIOUS_DEPLOYMENT"
      | "OBJECT_READBACK_MISMATCH"
      | "PAIRING_INCOMPATIBLE"
      | "SMOKE_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReleasePublicationError";
  }
}

type CurrentState = {
  pointer: ActiveDeploymentPointer;
  pointerVersion: string;
  deployment: DeploymentPairingManifest;
};

type ValidatedAnalysisCandidate = {
  baciRelease: string;
  sourceSha256: string;
  hsRevision: "HS12";
  artifactBuildId: string;
  artifactSchemaVersion: string;
  builtAt: string;
  artifactPath: string;
  manifestPath: string;
  artifactIdentity: ReleaseObjectIdentity;
  manifestBytes: Buffer;
  manifestIdentity: ReleaseObjectIdentity;
  manifest: AnalysisArtifactManifest;
};

type ValidatedProductCandidate = {
  baciRelease: string;
  sourceArchiveSha256: string;
  hsRevision: "HS12";
  productSearchBuildId: string;
  catalogSchemaVersion: string;
  catalogPath: string;
  manifestPath: string;
  catalogIdentity: ReleaseObjectIdentity;
  manifestBytes: Buffer;
  manifestIdentity: ReleaseObjectIdentity;
};

export class ReleasePublisher {
  constructor(private readonly objectStore: ReleaseObjectStore) {}

  async promote(input: PromoteReleaseInput): Promise<PublishedDeployment> {
    utcTimestamp(input.activatedAt, "activatedAt");
    const [analysis, productCatalog, current] = await Promise.all([
      validateAnalysisCandidate(resolve(input.analysisDirectoryPath)),
      validateProductCandidate(resolve(input.productCatalogDirectoryPath)),
      this.loadCurrentState(),
    ]);
    validatePairing(analysis, productCatalog);
    if (
      input.expectedCurrentDeploymentPairingId !== undefined &&
      input.expectedCurrentDeploymentPairingId !==
        (current?.deployment.deploymentPairingId ?? null)
    ) {
      throw new ReleasePublicationError(
        "ACTIVATION_PRECONDITION_FAILED",
        "Active deployment changed before promotion.",
      );
    }
    if (
      input.expectedBaciRelease !== undefined &&
      analysis.baciRelease !== input.expectedBaciRelease
    ) {
      throw new ReleasePublicationError(
        "PAIRING_INCOMPATIBLE",
        "Accepted candidates do not match the requested BACI Release.",
      );
    }
    const sourceStatusFallback = parseSourceStatusSnapshot(
      input.sourceStatusFallback ??
        bootstrapSourceStatus(analysis, input.activatedAt),
    );
    if (
      sourceStatusFallback.servedBaciRelease !== analysis.baciRelease
    ) {
      throw new ReleasePublicationError(
        "PAIRING_INCOMPATIBLE",
        "Source Freshness Status does not match the deployment BACI Release.",
      );
    }
    if (
      current !== null &&
      candidateMatchesDeployment(analysis, productCatalog, current.deployment)
    ) {
      return publishedDeployment(current.pointer, current.deployment);
    }

    const productCatalogReference =
      await this.publishProductCatalog(productCatalog);
    const analysisPublication =
      current !== null &&
      analysisCandidateMatchesDeployment(analysis, current.deployment)
        ? {
            artifact: current.deployment.analysis.artifact,
            releaseCatalog: current.deployment.analysis.releaseCatalog,
            releaseCatalogSha256:
              current.deployment.analysisReleaseCatalogSha256,
            analysisBuildId: current.deployment.analysisBuildId,
            previousArtifact: await previousArtifactReference(
              this.objectStore,
              current.deployment.analysis.releaseCatalog,
            ),
          }
        : await this.publishChangedAnalysis(analysis, current);
    await Promise.all([
      verifyStoredObject(
        this.objectStore,
        analysisPublication.artifact.artifact.key,
        analysisPublication.artifact.artifact,
      ),
      verifyStoredObject(
        this.objectStore,
        analysisPublication.artifact.manifest.key,
        analysisPublication.artifact.manifest,
      ),
      verifyStoredObject(
        this.objectStore,
        analysisPublication.releaseCatalog.key,
        analysisPublication.releaseCatalog,
      ),
    ]);
    const datasetPackage = await this.createAndPublishDatasetPackage(
      analysis,
      analysisPublication.releaseCatalogSha256,
      analysisPublication.previousArtifact,
    );
    const recommendedDatasetMapping =
      await this.createAndPublishMapping({
        datasetPackage,
        analysisBuildId: analysisPublication.analysisBuildId,
        artifact: analysisPublication.artifact,
        productCatalogBuildId:
          productCatalog.productSearchBuildId,
        productCatalog: productCatalogReference,
      });
    const pairingBase = {
      schemaVersion: "deployment-pairing-manifest-v1",
      baciRelease: analysis.baciRelease,
      analysisBuildId: analysisPublication.analysisBuildId,
      analysisReleaseCatalogSha256:
        analysisPublication.releaseCatalogSha256,
      productSearchBuildId: productCatalog.productSearchBuildId,
      sourceStatusFallback,
      analysis: {
        artifact: analysisPublication.artifact,
        releaseCatalog: analysisPublication.releaseCatalog,
      },
      productSearch: productCatalogReference,
      recommendedDatasetMapping,
    } as const;
    const deploymentPairingId = contentAddressedId(
      "deployment-pairing-v1",
      pairingBase,
    );
    const deployment: DeploymentPairingManifest = {
      ...pairingBase,
      deploymentPairingId,
    };
    const deploymentBytes = releaseJsonBytes(deployment);
    const deploymentReference = await this.publishBytes(
      `deployment-pairings/${deploymentPairingId}.json`,
      deploymentBytes,
    );
    const validatedDeployment =
      await this.validateForActivation(
        deploymentReference,
        input.activatedAt,
      );
    const pointer: ActiveDeploymentPointer = {
      schemaVersion: "active-deployment-pointer-v1",
      current: deploymentReference,
      previous: current?.pointer.current ?? null,
      sourceStatusFallback:
        validatedDeployment.sourceStatusFallback,
      activatedAt: input.activatedAt,
    };
    await this.activatePointer(
      current?.pointerVersion ?? null,
      pointer,
    );

    return publishedDeployment(pointer, validatedDeployment);
  }

  async rollback(input: RollbackReleaseInput): Promise<PublishedDeployment> {
    utcTimestamp(input.activatedAt, "activatedAt");
    const current = await this.loadCurrentState();
    if (current === null || current.pointer.previous === null) {
      throw new ReleasePublicationError(
        "NO_PREVIOUS_DEPLOYMENT",
        "No previous deployment pairing is available.",
      );
    }
    if (
      input.expectedCurrentDeploymentPairingId !== undefined &&
      input.expectedCurrentDeploymentPairingId !==
        current.deployment.deploymentPairingId
    ) {
      throw new ReleasePublicationError(
        "ACTIVATION_PRECONDITION_FAILED",
        "Active deployment changed before rollback.",
      );
    }
    const previousBytes = await readVerifiedReference(
      this.objectStore,
      current.pointer.previous,
    );
    const previous = parseDeploymentPairingManifest(
      JSON.parse(previousBytes.toString("utf8")),
    );
    const sourceStatusFallback = rollbackSourceStatus(
      parseSourceStatusSnapshot(
        input.sourceStatus ??
          current.deployment.sourceStatusFallback,
      ),
      previous.baciRelease,
      input.activatedAt,
    );
    if (
      sourceStatusFallback.servedBaciRelease !== previous.baciRelease
    ) {
      throw new ReleasePublicationError(
        "PAIRING_INCOMPATIBLE",
        "Rollback Source Freshness Status does not match the target deployment.",
      );
    }
    const recommendedDatasetMapping =
      previous.recommendedDatasetMapping ??
      (await this.createAndPublishRollbackMapping(previous));
    const pairingBase = {
      schemaVersion: "deployment-pairing-manifest-v1",
      baciRelease: previous.baciRelease,
      analysisBuildId: previous.analysisBuildId,
      analysisReleaseCatalogSha256:
        previous.analysisReleaseCatalogSha256,
      productSearchBuildId: previous.productSearchBuildId,
      sourceStatusFallback,
      analysis: previous.analysis,
      productSearch: previous.productSearch,
      recommendedDatasetMapping,
    } as const;
    const deployment: DeploymentPairingManifest = {
      ...pairingBase,
      deploymentPairingId: contentAddressedId(
        "deployment-pairing-v1",
        pairingBase,
      ),
    };
    const deploymentReference = await this.publishBytes(
      `deployment-pairings/${deployment.deploymentPairingId}.json`,
      releaseJsonBytes(deployment),
    );
    const validatedDeployment =
      await this.validateForActivation(
        deploymentReference,
        input.activatedAt,
      );
    const pointer: ActiveDeploymentPointer = {
      schemaVersion: "active-deployment-pointer-v1",
      current: deploymentReference,
      previous: current.pointer.current,
      sourceStatusFallback,
      activatedAt: input.activatedAt,
    };
    await this.activatePointer(current.pointerVersion, pointer);
    return publishedDeployment(pointer, validatedDeployment);
  }

  async current(): Promise<PublishedDeployment | null> {
    const state = await this.loadCurrentState();
    return state === null
      ? null
      : publishedDeployment(state.pointer, state.deployment);
  }

  private async publishChangedAnalysis(
    candidate: ValidatedAnalysisCandidate,
    current: CurrentState | null,
  ): Promise<{
    artifact: AnalysisArtifactReference;
    releaseCatalog: ReleaseObjectReference;
    releaseCatalogSha256: string;
    analysisBuildId: string;
    previousArtifact: AnalysisArtifactReference | null;
  }> {
    const artifact = await this.publishAnalysis(candidate);
    const releaseCatalogBytes = releaseJsonBytes({
      schemaVersion: "analysis-release-catalog-v1",
      current: artifact,
      previous: current?.deployment.analysis.artifact ?? null,
      scoreVersion: SCORE_VERSION,
      resultSchemaVersion: RESULT_SCHEMA_VERSION,
    });
    const releaseCatalogIdentity = releaseObjectIdentity(
      releaseCatalogBytes,
    );
    const releaseCatalog = await this.publishBytes(
      `analysis-release-catalogs/${releaseCatalogIdentity.sha256}.json`,
      releaseCatalogBytes,
    );
    return {
      artifact,
      releaseCatalog,
      releaseCatalogSha256: releaseCatalogIdentity.sha256,
      analysisBuildId: contentAddressedId("analysis-build-v1", {
        analysisReleaseCatalogSha256: releaseCatalogIdentity.sha256,
        scoreVersion: SCORE_VERSION,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
      }),
      previousArtifact:
        current?.deployment.analysis.artifact ?? null,
    };
  }

  private async createAndPublishDatasetPackage(
    analysis: ValidatedAnalysisCandidate,
    analysisReleaseCatalogSha256: string,
    previousArtifact: AnalysisArtifactReference | null,
  ): Promise<{
    package: CandidateMarketDatasetPackage;
    reference: ReleaseObjectReference;
  }> {
    const previousManifest =
      previousArtifact === null
        ? null
        : await this.readPreviousAnalysisManifest(
            previousArtifact,
          );
    return this.createAndPublishDatasetPackageFromManifests({
      manifest: analysis.manifest,
      analysisReleaseCatalogSha256,
      previousManifest,
    });
  }

  private async createAndPublishDatasetPackageFromManifests(input: {
    manifest: AnalysisArtifactManifest;
    analysisReleaseCatalogSha256: string;
    previousManifest: AnalysisArtifactManifest | null;
  }): Promise<{
    package: CandidateMarketDatasetPackage;
    reference: ReleaseObjectReference;
  }> {
    const datasetPackage =
      createCandidateMarketDatasetPackageFromArtifacts(input);
    const compatibility =
      evaluateCandidateMarketV1DatasetPackage(datasetPackage);
    if (!compatibility.compatible) {
      throw new ReleasePublicationError(
        "PAIRING_INCOMPATIBLE",
        `Candidate Market Dataset Package is incompatible: ${compatibility.reason}.`,
      );
    }
    const reference = await this.publishBytes(
      `dataset-packages/${datasetPackage.identity}.json`,
      Buffer.from(datasetPackage.serializedManifest, "utf8"),
    );
    return { package: datasetPackage, reference };
  }

  private async createAndPublishRollbackMapping(
    target: DeploymentPairingManifest,
  ) {
    const releaseCatalog = parseAnalysisReleaseCatalog(
      JSON.parse(
        (
          await readVerifiedReference(
            this.objectStore,
            target.analysis.releaseCatalog,
          )
        ).toString("utf8"),
      ),
    );
    assertDeploymentReleaseCatalog(target, releaseCatalog);
    const [manifest, previousManifest] = await Promise.all([
      this.readAnalysisArtifactManifest(
        releaseCatalog.current,
      ),
      releaseCatalog.previous === null
        ? Promise.resolve(null)
        : this.readAnalysisArtifactManifest(
            releaseCatalog.previous,
          ),
    ]);
    const datasetPackage =
      await this.createAndPublishDatasetPackageFromManifests({
        manifest,
        analysisReleaseCatalogSha256:
          target.analysisReleaseCatalogSha256,
        previousManifest,
      });
    return this.createAndPublishMapping({
      datasetPackage,
      analysisBuildId: target.analysisBuildId,
      artifact: target.analysis.artifact,
      productCatalogBuildId:
        target.productSearchBuildId,
      productCatalog: target.productSearch,
    });
  }

  private async readPreviousAnalysisManifest(
    previousArtifact: AnalysisArtifactReference,
  ): Promise<AnalysisArtifactManifest> {
    return this.readAnalysisArtifactManifest(previousArtifact);
  }

  private async readAnalysisArtifactManifest(
    artifact: AnalysisArtifactReference,
  ): Promise<AnalysisArtifactManifest> {
    await verifyStoredObject(
      this.objectStore,
      artifact.artifact.key,
      artifact.artifact,
    );
    return parseAnalysisArtifactManifest(
      JSON.parse(
        (
          await readVerifiedReference(
            this.objectStore,
            artifact.manifest,
          )
        ).toString("utf8"),
      ),
    );
  }

  private async createAndPublishMapping(input: {
    datasetPackage: {
      package: CandidateMarketDatasetPackage;
      reference: ReleaseObjectReference;
    };
    analysisBuildId: string;
    artifact: AnalysisArtifactReference;
    productCatalogBuildId: string;
    productCatalog: ProductCatalogReference;
  }) {
    const productCatalog = {
      productSearchBuildId: input.productCatalogBuildId,
      schemaVersion: "product-catalog-artifact-v1" as const,
      catalog: input.productCatalog.catalog,
      manifest: input.productCatalog.manifest,
    };
    const economyCatalog = {
      analysisBuildId: input.analysisBuildId,
      schemaVersion: "candidate-market-artifact-v1" as const,
      artifact: input.artifact.artifact,
      manifest: input.artifact.manifest,
    };
    const mapping: RecommendedDatasetMapping =
      createRecommendedDatasetMapping({
        schemaVersion:
          "recommended-dataset-mapping-manifest-v1",
        recipe: "candidate-market-v1",
        datasetPackage: {
          identity: input.datasetPackage.package.identity,
          manifest: input.datasetPackage.reference,
        },
        productCatalog: {
          identity:
            recommendedProductCatalogIdentity(productCatalog),
          ...productCatalog,
        },
        economyCatalog: {
          identity:
            recommendedEconomyCatalogIdentity(economyCatalog),
          ...economyCatalog,
        },
      });
    const manifest = await this.publishBytes(
      `recommended-dataset-mappings/${mapping.identity}.json`,
      Buffer.from(mapping.serializedManifest, "utf8"),
    );
    return { identity: mapping.identity, manifest };
  }

  private async publishAnalysis(
    candidate: ValidatedAnalysisCandidate,
  ): Promise<AnalysisArtifactReference> {
    const prefix =
      `releases/${candidate.baciRelease}/${candidate.artifactIdentity.sha256}`;
    const artifact = await this.publishFile(
      `${prefix}/candidate-market.duckdb`,
      candidate.artifactPath,
      candidate.artifactIdentity,
    );
    const manifest = await this.publishBytes(
      `${prefix}/manifests/${candidate.manifestIdentity.sha256}.json`,
      candidate.manifestBytes,
    );
    return {
      baciRelease: candidate.baciRelease,
      sourceSha256: candidate.sourceSha256,
      hsRevision: candidate.hsRevision,
      artifactBuildId: candidate.artifactBuildId,
      artifactSchemaVersion: candidate.artifactSchemaVersion,
      artifact,
      manifest,
    };
  }

  private async publishProductCatalog(
    candidate: ValidatedProductCandidate,
  ): Promise<ProductCatalogReference> {
    const prefix =
      `product-search-catalogs/${candidate.productSearchBuildId}` +
      `/${candidate.catalogIdentity.sha256}`;
    const catalog = await this.publishFile(
      `${prefix}/product-catalog.json`,
      candidate.catalogPath,
      candidate.catalogIdentity,
    );
    const manifest = await this.publishBytes(
      `${prefix}/manifests/${candidate.manifestIdentity.sha256}.json`,
      candidate.manifestBytes,
    );
    return {
      baciRelease: candidate.baciRelease,
      sourceArchiveSha256: candidate.sourceArchiveSha256,
      hsRevision: candidate.hsRevision,
      productSearchBuildId: candidate.productSearchBuildId,
      catalogSchemaVersion: candidate.catalogSchemaVersion,
      catalog,
      manifest,
    };
  }

  private async publishFile(
    key: string,
    path: string,
    expectedIdentity: ReleaseObjectIdentity,
  ): Promise<ReleaseObjectReference> {
    await this.objectStore.putImmutable(
      key,
      createReadStream(path),
      expectedIdentity,
    );
    await verifyStoredObject(this.objectStore, key, expectedIdentity);
    return { key, ...expectedIdentity };
  }

  private async publishBytes(
    key: string,
    bytes: Buffer,
  ): Promise<ReleaseObjectReference> {
    const expectedIdentity = releaseObjectIdentity(bytes);
    await this.objectStore.putImmutable(
      key,
      singleChunk(bytes),
      expectedIdentity,
    );
    await verifyStoredObject(this.objectStore, key, expectedIdentity);
    return { key, ...expectedIdentity };
  }

  private async loadCurrentState(): Promise<CurrentState | null> {
    const storedPointer = await this.objectStore.getObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (storedPointer === null) {
      return null;
    }
    const pointer = parseActiveDeploymentPointer(
      JSON.parse(
        (await readReleaseMetadata(storedPointer.body)).toString("utf8"),
      ),
    );
    const deploymentBytes = await readVerifiedReference(
      this.objectStore,
      pointer.current,
    );
    const deployment = parseDeploymentPairingManifest(
      JSON.parse(deploymentBytes.toString("utf8")),
    );
    if (
      !sameSourceStatusSnapshot(
        pointer.sourceStatusFallback,
        deployment.sourceStatusFallback,
      )
    ) {
      throw new Error(
        "Active deployment Source Freshness Status fallback is incompatible.",
      );
    }
    return {
      pointer,
      pointerVersion: storedPointer.version,
      deployment,
    };
  }

  private async activatePointer(
    expectedVersion: string | null,
    pointer: ActiveDeploymentPointer,
  ): Promise<void> {
    try {
      await this.objectStore.compareAndSwap(
        ACTIVE_DEPLOYMENT_POINTER_KEY,
        expectedVersion,
        releaseJsonBytes(pointer),
      );
    } catch (error) {
      throw new ReleasePublicationError(
        "ACTIVATION_FAILED",
        "Deployment pairing activation failed.",
        { cause: error },
      );
    }
  }

  private async validateForActivation(
    deploymentReference: ReleaseObjectReference,
    activatedAt: string,
  ): Promise<DeploymentPairingManifest> {
    try {
      return await validateDeploymentActivation({
        objectStore: this.objectStore,
        deploymentReference,
        activatedAt,
      });
    } catch (error) {
      const smokeFailure =
        error instanceof Error && /smoke/u.test(error.message);
      throw new ReleasePublicationError(
        smokeFailure
          ? "SMOKE_FAILED"
          : "PAIRING_INCOMPATIBLE",
        smokeFailure
          ? "Deployment activation smoke analysis failed."
          : "Deployment activation validation failed.",
        { cause: error },
      );
    }
  }
}

async function validateAnalysisCandidate(
  directoryPath: string,
): Promise<ValidatedAnalysisCandidate> {
  const artifactPath = join(directoryPath, "candidate-market.duckdb");
  const manifestPath = join(directoryPath, "artifact-manifest.json");
  const reportPath = join(directoryPath, "artifact-build-report.json");
  const [artifactIdentity, manifestBytes, reportBytes] = await Promise.all([
    fileIdentity(artifactPath),
    readFile(manifestPath),
    readFile(reportPath),
  ]);
  const manifestIdentity = releaseObjectIdentity(manifestBytes);
  const manifest = record(JSON.parse(manifestBytes.toString("utf8")), "artifact manifest");
  const parsedManifest = parseAnalysisArtifactManifest(manifest);
  const report = record(JSON.parse(reportBytes.toString("utf8")), "artifact build report");
  if (
    manifest.schemaVersion !== "candidate-market-artifact-manifest-v1" ||
    report.schemaVersion !== "candidate-market-artifact-build-report-v1" ||
    report.status !== "accepted"
  ) {
    throw new Error("Analysis candidate is not an accepted artifact build.");
  }
  if (
    sha256String(report.artifactManifestSha256, "artifact manifest SHA-256") !==
      manifestIdentity.sha256 ||
    !releaseJsonBytes(report.artifactManifest).equals(manifestBytes)
  ) {
    throw new Error("Analysis build report does not match its artifact manifest.");
  }
  const artifact = record(manifest.artifact, "analysis artifact identity");
  if (
    string(artifact.relativePath, "analysis artifact relative path") !==
      "candidate-market.duckdb" ||
    count(artifact.bytes, "analysis artifact bytes") !== artifactIdentity.bytes ||
    sha256String(artifact.sha256, "analysis artifact SHA-256") !==
      artifactIdentity.sha256
  ) {
    throw new Error("Analysis artifact does not match its manifest.");
  }
  const scoreVersions = stringArray(
    manifest.scoreVersionsSupported,
    "score versions",
  );
  if (!scoreVersions.includes(SCORE_VERSION)) {
    throw new Error("Analysis artifact does not support cms-v1.");
  }
  return {
    baciRelease: string(manifest.baciRelease, "analysis BACI Release"),
    sourceSha256: sha256String(manifest.sourceSha256, "analysis source SHA-256"),
    hsRevision: hs12(manifest.hsRevision, "analysis HS revision"),
    artifactBuildId: string(artifact.buildId, "analysis artifact build ID"),
    artifactSchemaVersion: string(
      artifact.schemaVersion,
      "analysis artifact schema version",
    ),
    builtAt: utcTimestamp(manifest.builtAt, "analysis build time"),
    artifactPath,
    manifestPath,
    artifactIdentity,
    manifestBytes,
    manifestIdentity,
    manifest: parsedManifest,
  };
}

function bootstrapSourceStatus(
  analysis: ValidatedAnalysisCandidate,
  activatedAt: string,
): SourceStatusSnapshot {
  const fields = {
    checkedAt: analysis.builtAt,
    servedBaciRelease: analysis.baciRelease,
    latestKnownBaciRelease: analysis.baciRelease,
    newerReleaseDetectedAt: null,
    refreshFailed: false,
    rollbackActive: false,
    publishedAt: activatedAt,
  } as const;
  return {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId: contentAddressedId(
      "source-status-bootstrap-v1",
      fields,
    ),
    ...fields,
  };
}

function rollbackSourceStatus(
  latest: SourceStatusSnapshot,
  servedBaciRelease: string,
  activatedAt: string,
): SourceStatusSnapshot {
  const latestKnownBaciRelease = latest.latestKnownBaciRelease;
  const fields = {
    checkedAt: latest.checkedAt,
    servedBaciRelease,
    latestKnownBaciRelease,
    newerReleaseDetectedAt:
      servedBaciRelease === latestKnownBaciRelease
        ? null
        : latest.newerReleaseDetectedAt ?? activatedAt,
    refreshFailed: false,
    rollbackActive: true,
    publishedAt: activatedAt,
  } as const;
  return sourceStatusSnapshot(
    createPublishedSourceStatusSnapshot(fields),
  );
}

async function validateProductCandidate(
  directoryPath: string,
): Promise<ValidatedProductCandidate> {
  const catalogPath = join(directoryPath, "product-catalog.json");
  const manifestPath = join(directoryPath, "catalog-manifest.json");
  const reportPath = join(directoryPath, "catalog-build-report.json");
  const [catalogIdentity, catalogBytes, manifestBytes, reportBytes] = await Promise.all([
    fileIdentity(catalogPath),
    readFile(catalogPath),
    readFile(manifestPath),
    readFile(reportPath),
  ]);
  const manifestIdentity = releaseObjectIdentity(manifestBytes);
  const manifest = record(JSON.parse(manifestBytes.toString("utf8")), "catalog manifest");
  const report = record(JSON.parse(reportBytes.toString("utf8")), "catalog build report");
  if (
    manifest.schemaVersion !== "product-catalog-manifest-v1" ||
    report.schemaVersion !== "product-catalog-build-report-v1" ||
    report.status !== "accepted"
  ) {
    throw new Error("Product-search candidate is not an accepted catalog build.");
  }
  if (
    sha256String(report.catalogManifestSha256, "catalog manifest SHA-256") !==
      manifestIdentity.sha256 ||
    !releaseJsonBytes(report.catalogManifest).equals(manifestBytes)
  ) {
    throw new Error("Catalog build report does not match its manifest.");
  }
  const catalog = record(manifest.catalog, "product catalog identity");
  const catalogArtifact = record(
    JSON.parse(catalogBytes.toString("utf8")),
    "product catalog artifact",
  );
  if (
    catalog.schemaVersion !== "product-catalog-artifact-v1" ||
    catalogArtifact.schemaVersion !==
      "product-catalog-artifact-v1" ||
    string(catalog.relativePath, "product catalog relative path") !==
      "product-catalog.json" ||
    count(catalog.bytes, "product catalog bytes") !== catalogIdentity.bytes ||
    sha256String(catalog.sha256, "product catalog SHA-256") !==
      catalogIdentity.sha256
  ) {
    throw new Error(
      "Product catalog schema is incompatible or does not match its manifest.",
    );
  }
  return {
    baciRelease: string(manifest.baciRelease, "catalog BACI Release"),
    sourceArchiveSha256: sha256String(
      manifest.sourceArchiveSha256,
      "catalog source archive SHA-256",
    ),
    hsRevision: hs12(manifest.hsRevision, "catalog HS revision"),
    productSearchBuildId: prefixedId(
      manifest.productSearchBuildId,
      "product-search build ID",
      "product-search-v1",
    ),
    catalogSchemaVersion: string(
      catalog.schemaVersion,
      "product catalog schema version",
    ),
    catalogPath,
    manifestPath,
    catalogIdentity,
    manifestBytes,
    manifestIdentity,
  };
}

function validatePairing(
  analysis: ValidatedAnalysisCandidate,
  catalog: ValidatedProductCandidate,
): void {
  if (
    analysis.baciRelease !== catalog.baciRelease ||
    analysis.sourceSha256 !== catalog.sourceArchiveSha256 ||
    analysis.hsRevision !== catalog.hsRevision
  ) {
    throw new ReleasePublicationError(
      "PAIRING_INCOMPATIBLE",
      "Analysis and product-search candidates are incompatible.",
    );
  }
}

function candidateMatchesDeployment(
  analysis: ValidatedAnalysisCandidate,
  catalog: ValidatedProductCandidate,
  deployment: DeploymentPairingManifest,
): boolean {
  return (
    deployment.recommendedDatasetMapping !== null &&
    analysisCandidateMatchesDeployment(analysis, deployment) &&
    productCandidateMatchesDeployment(catalog, deployment)
  );
}

function analysisCandidateMatchesDeployment(
  analysis: ValidatedAnalysisCandidate,
  deployment: DeploymentPairingManifest,
): boolean {
  const publishedAnalysis = deployment.analysis.artifact;
  return (
    publishedAnalysis.baciRelease === analysis.baciRelease &&
    publishedAnalysis.sourceSha256 === analysis.sourceSha256 &&
    publishedAnalysis.hsRevision === analysis.hsRevision &&
    publishedAnalysis.artifactBuildId === analysis.artifactBuildId &&
    publishedAnalysis.artifactSchemaVersion ===
      analysis.artifactSchemaVersion &&
    sameIdentity(publishedAnalysis.artifact, analysis.artifactIdentity) &&
    sameIdentity(publishedAnalysis.manifest, analysis.manifestIdentity)
  );
}

function productCandidateMatchesDeployment(
  catalog: ValidatedProductCandidate,
  deployment: DeploymentPairingManifest,
): boolean {
  const publishedCatalog = deployment.productSearch;
  return (
    publishedCatalog.baciRelease === catalog.baciRelease &&
    publishedCatalog.sourceArchiveSha256 === catalog.sourceArchiveSha256 &&
    publishedCatalog.hsRevision === catalog.hsRevision &&
    publishedCatalog.productSearchBuildId === catalog.productSearchBuildId &&
    publishedCatalog.catalogSchemaVersion === catalog.catalogSchemaVersion &&
    sameIdentity(publishedCatalog.catalog, catalog.catalogIdentity) &&
    sameIdentity(publishedCatalog.manifest, catalog.manifestIdentity)
  );
}

function sameIdentity(
  published: ReleaseObjectIdentity,
  candidate: ReleaseObjectIdentity,
): boolean {
  return (
    published.bytes === candidate.bytes &&
    published.sha256 === candidate.sha256
  );
}

async function previousArtifactReference(
  objectStore: ReleaseObjectStore,
  releaseCatalog: ReleaseObjectReference,
): Promise<AnalysisArtifactReference | null> {
  return parseAnalysisReleaseCatalog(
    JSON.parse(
      (
        await readVerifiedReference(
          objectStore,
          releaseCatalog,
        )
      ).toString("utf8"),
    ),
  ).previous;
}

async function verifyStoredObject(
  objectStore: ReleaseObjectStore,
  key: string,
  expectedIdentity: ReleaseObjectIdentity,
): Promise<void> {
  const stored = await objectStore.getObject(key);
  if (stored === null) {
    throw new ReleasePublicationError(
      "OBJECT_READBACK_MISMATCH",
      `Uploaded release object ${key} is unavailable.`,
    );
  }
  const actualIdentity = await streamReleaseObjectIdentity(stored.body);
  if (
    actualIdentity.bytes !== expectedIdentity.bytes ||
    actualIdentity.sha256 !== expectedIdentity.sha256
  ) {
    throw new ReleasePublicationError(
      "OBJECT_READBACK_MISMATCH",
      `Uploaded release object ${key} failed read-back verification.`,
    );
  }
}

async function readVerifiedReference(
  objectStore: ReleaseObjectStore,
  reference: ReleaseObjectReference,
): Promise<Buffer> {
  const stored = await objectStore.getObject(reference.key);
  if (stored === null) {
    throw new Error(`Referenced release object ${reference.key} is unavailable.`);
  }
  const bytes = await readReleaseMetadata(stored.body);
  const actualIdentity = releaseObjectIdentity(bytes);
  if (
    actualIdentity.bytes !== reference.bytes ||
    actualIdentity.sha256 !== reference.sha256
  ) {
    throw new Error(`Referenced release object ${reference.key} is corrupt.`);
  }
  return bytes;
}

async function fileIdentity(
  path: string,
): Promise<ReleaseObjectIdentity> {
  const [streamed, details] = await Promise.all([
    streamReleaseObjectIdentity(createReadStream(path)),
    stat(path),
  ]);
  if (streamed.bytes !== details.size) {
    throw new Error(`File size changed while reading ${path}.`);
  }
  return streamed;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry) => string(entry, `${label} entry`));
}
