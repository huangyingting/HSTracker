import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ACTIVE_DEPLOYMENT_POINTER_KEY as ACTIVE_POINTER_KEY,
  deploymentPairingIdFromKey as pairingIdFromKey,
  parseActiveDeploymentPointer as parsePointer,
  parseDeploymentPairingManifest as parseDeployment,
  readReleaseMetadata,
  releaseObjectIdentity as identity,
  singleChunk as oneChunk,
  type ActiveDeploymentPointer,
  type AnalysisArtifactReference,
  type DeploymentPairingManifest,
  type ProductCatalogReference,
  type ReleaseObjectReference,
} from "./release-manifest";
import type {
  ReleaseObjectIdentity,
  ReleaseObjectStore,
} from "./release-object-store";

const RESULT_SCHEMA_VERSION = "candidate-market-result-v1";
const SCORE_VERSION = "cms-v1";

export type PromoteReleaseInput = {
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
  activatedAt: string;
};

export type RollbackReleaseInput = {
  activatedAt: string;
};

export type PublishedDeployment = {
  schemaVersion: "published-deployment-v1";
  deploymentPairingId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  baciRelease: string;
  activatedAt: string;
  previousDeploymentPairingId: string | null;
};

export class ReleasePublicationError extends Error {
  constructor(
    readonly code:
      | "ACTIVATION_FAILED"
      | "NO_PREVIOUS_DEPLOYMENT"
      | "OBJECT_READBACK_MISMATCH"
      | "PAIRING_INCOMPATIBLE",
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
  artifactPath: string;
  artifactIdentity: ReleaseObjectIdentity;
  manifestBytes: Buffer;
  manifestIdentity: ReleaseObjectIdentity;
};

type ValidatedProductCandidate = {
  baciRelease: string;
  sourceArchiveSha256: string;
  hsRevision: "HS12";
  productSearchBuildId: string;
  catalogSchemaVersion: string;
  catalogPath: string;
  catalogIdentity: ReleaseObjectIdentity;
  manifestBytes: Buffer;
  manifestIdentity: ReleaseObjectIdentity;
};

export class ReleasePublisher {
  constructor(private readonly objectStore: ReleaseObjectStore) {}

  async promote(input: PromoteReleaseInput): Promise<PublishedDeployment> {
    validateUtcTimestamp(input.activatedAt, "activatedAt");
    const [analysis, productCatalog, current] = await Promise.all([
      validateAnalysisCandidate(resolve(input.analysisDirectoryPath)),
      validateProductCandidate(resolve(input.productCatalogDirectoryPath)),
      this.loadCurrentState(),
    ]);
    validatePairing(analysis, productCatalog);
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
          }
        : await this.publishChangedAnalysis(analysis, current);
    const pairingBase = {
      schemaVersion: "deployment-pairing-manifest-v1",
      baciRelease: analysis.baciRelease,
      analysisBuildId: analysisPublication.analysisBuildId,
      analysisReleaseCatalogSha256:
        analysisPublication.releaseCatalogSha256,
      productSearchBuildId: productCatalog.productSearchBuildId,
      analysis: {
        artifact: analysisPublication.artifact,
        releaseCatalog: analysisPublication.releaseCatalog,
      },
      productSearch: productCatalogReference,
    } as const;
    const deploymentPairingId = contentId(
      "deployment-pairing-v1",
      pairingBase,
    );
    const deployment: DeploymentPairingManifest = {
      ...pairingBase,
      deploymentPairingId,
    };
    const deploymentBytes = jsonBytes(deployment);
    const deploymentReference = await this.publishBytes(
      `deployment-pairings/${deploymentPairingId}.json`,
      deploymentBytes,
    );
    const pointer: ActiveDeploymentPointer = {
      schemaVersion: "active-deployment-pointer-v1",
      current: deploymentReference,
      previous: current?.pointer.current ?? null,
      activatedAt: input.activatedAt,
    };
    await this.activatePointer(
      current?.pointerVersion ?? null,
      pointer,
    );

    return publishedDeployment(pointer, deployment);
  }

  async rollback(input: RollbackReleaseInput): Promise<PublishedDeployment> {
    validateUtcTimestamp(input.activatedAt, "activatedAt");
    const current = await this.loadCurrentState();
    if (current === null || current.pointer.previous === null) {
      throw new ReleasePublicationError(
        "NO_PREVIOUS_DEPLOYMENT",
        "No previous deployment pairing is available.",
      );
    }
    const previousBytes = await readVerifiedReference(
      this.objectStore,
      current.pointer.previous,
    );
    const previous = parseDeployment(
      JSON.parse(previousBytes.toString("utf8")),
    );
    const pointer: ActiveDeploymentPointer = {
      schemaVersion: "active-deployment-pointer-v1",
      current: current.pointer.previous,
      previous: current.pointer.current,
      activatedAt: input.activatedAt,
    };
    await this.activatePointer(current.pointerVersion, pointer);
    return publishedDeployment(pointer, previous);
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
  }> {
    const artifact = await this.publishAnalysis(candidate);
    const releaseCatalogBytes = jsonBytes({
      schemaVersion: "analysis-release-catalog-v1",
      current: artifact,
      previous: current?.deployment.analysis.artifact ?? null,
      scoreVersion: SCORE_VERSION,
      resultSchemaVersion: RESULT_SCHEMA_VERSION,
    });
    const releaseCatalogIdentity = identity(releaseCatalogBytes);
    const releaseCatalog = await this.publishBytes(
      `analysis-release-catalogs/${releaseCatalogIdentity.sha256}.json`,
      releaseCatalogBytes,
    );
    return {
      artifact,
      releaseCatalog,
      releaseCatalogSha256: releaseCatalogIdentity.sha256,
      analysisBuildId: contentId("analysis-build-v1", {
        analysisReleaseCatalogSha256: releaseCatalogIdentity.sha256,
        scoreVersion: SCORE_VERSION,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
      }),
    };
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
      `${prefix}/artifact-manifest.json`,
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
      `${prefix}/catalog-manifest.json`,
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
    const expectedIdentity = identity(bytes);
    await this.objectStore.putImmutable(
      key,
      oneChunk(bytes),
      expectedIdentity,
    );
    await verifyStoredObject(this.objectStore, key, expectedIdentity);
    return { key, ...expectedIdentity };
  }

  private async loadCurrentState(): Promise<CurrentState | null> {
    const storedPointer = await this.objectStore.getObject(ACTIVE_POINTER_KEY);
    if (storedPointer === null) {
      return null;
    }
    const pointer = parsePointer(
      JSON.parse(
        (await readReleaseMetadata(storedPointer.body)).toString("utf8"),
      ),
    );
    const deploymentBytes = await readVerifiedReference(
      this.objectStore,
      pointer.current,
    );
    return {
      pointer,
      pointerVersion: storedPointer.version,
      deployment: parseDeployment(JSON.parse(deploymentBytes.toString("utf8"))),
    };
  }

  private async activatePointer(
    expectedVersion: string | null,
    pointer: ActiveDeploymentPointer,
  ): Promise<void> {
    try {
      await this.objectStore.compareAndSwap(
        ACTIVE_POINTER_KEY,
        expectedVersion,
        jsonBytes(pointer),
      );
    } catch (error) {
      throw new ReleasePublicationError(
        "ACTIVATION_FAILED",
        "Deployment pairing activation failed.",
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
  const manifestIdentity = identity(manifestBytes);
  const manifest = record(JSON.parse(manifestBytes.toString("utf8")), "artifact manifest");
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
    !jsonBytes(report.artifactManifest).equals(manifestBytes)
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
    artifactPath,
    artifactIdentity,
    manifestBytes,
    manifestIdentity,
  };
}

async function validateProductCandidate(
  directoryPath: string,
): Promise<ValidatedProductCandidate> {
  const catalogPath = join(directoryPath, "product-catalog.json");
  const manifestPath = join(directoryPath, "catalog-manifest.json");
  const reportPath = join(directoryPath, "catalog-build-report.json");
  const [catalogIdentity, manifestBytes, reportBytes] = await Promise.all([
    fileIdentity(catalogPath),
    readFile(manifestPath),
    readFile(reportPath),
  ]);
  const manifestIdentity = identity(manifestBytes);
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
    !jsonBytes(report.catalogManifest).equals(manifestBytes)
  ) {
    throw new Error("Catalog build report does not match its manifest.");
  }
  const catalog = record(manifest.catalog, "product catalog identity");
  if (
    string(catalog.relativePath, "product catalog relative path") !==
      "product-catalog.json" ||
    count(catalog.bytes, "product catalog bytes") !== catalogIdentity.bytes ||
    sha256String(catalog.sha256, "product catalog SHA-256") !==
      catalogIdentity.sha256
  ) {
    throw new Error("Product catalog does not match its manifest.");
  }
  return {
    baciRelease: string(manifest.baciRelease, "catalog BACI Release"),
    sourceArchiveSha256: sha256String(
      manifest.sourceArchiveSha256,
      "catalog source archive SHA-256",
    ),
    hsRevision: hs12(manifest.hsRevision, "catalog HS revision"),
    productSearchBuildId: productSearchBuildId(manifest.productSearchBuildId),
    catalogSchemaVersion: string(
      catalog.schemaVersion,
      "product catalog schema version",
    ),
    catalogPath,
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
  const actualIdentity = await streamIdentity(stored.body);
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
  const actualIdentity = identity(bytes);
  if (
    actualIdentity.bytes !== reference.bytes ||
    actualIdentity.sha256 !== reference.sha256
  ) {
    throw new Error(`Referenced release object ${reference.key} is corrupt.`);
  }
  return bytes;
}

function publishedDeployment(
  pointer: ActiveDeploymentPointer,
  deployment: DeploymentPairingManifest,
): PublishedDeployment {
  return {
    schemaVersion: "published-deployment-v1",
    deploymentPairingId: deployment.deploymentPairingId,
    analysisBuildId: deployment.analysisBuildId,
    analysisReleaseCatalogSha256:
      deployment.analysisReleaseCatalogSha256,
    productSearchBuildId: deployment.productSearchBuildId,
    baciRelease: deployment.baciRelease,
    activatedAt: pointer.activatedAt,
    previousDeploymentPairingId:
      pointer.previous === null
        ? null
        : pairingIdFromKey(pointer.previous.key),
  };
}

async function fileIdentity(
  path: string,
): Promise<ReleaseObjectIdentity> {
  const [streamed, details] = await Promise.all([
    streamIdentity(createReadStream(path)),
    stat(path),
  ]);
  if (streamed.bytes !== details.size) {
    throw new Error(`File size changed while reading ${path}.`);
  }
  return streamed;
}

async function streamIdentity(
  body: AsyncIterable<Uint8Array>,
): Promise<ReleaseObjectIdentity> {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest("hex") };
}

function contentId(prefix: string, value: unknown): string {
  return `${prefix}-${sha256(jsonBytes(value)).slice(0, 16)}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry) => string(entry, `${label} entry`));
}

function count(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function sha256String(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return candidate;
}

function hs12(value: unknown, label: string): "HS12" {
  if (value !== "HS12") {
    throw new Error(`${label} must be HS12.`);
  }
  return value;
}

function productSearchBuildId(value: unknown): string {
  const candidate = string(value, "product-search build ID");
  if (!/^product-search-v1-[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error("Product-search build ID is malformed.");
  }
  return candidate;
}

function validateUtcTimestamp(value: string, label: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be a UTC timestamp without fractions.`);
  }
}
