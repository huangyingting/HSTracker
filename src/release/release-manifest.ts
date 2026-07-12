import { createHash } from "node:crypto";

import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import type { ReleaseObjectIdentity } from "./release-object-store";
import {
  boolean,
  count,
  hs12,
  prefixedId,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "./release-validation";

export const ACTIVE_DEPLOYMENT_POINTER_KEY =
  "deployment-pointers/current.json";
export const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;

export type ReleaseObjectReference = ReleaseObjectIdentity & {
  key: string;
};

export type AnalysisArtifactReference = {
  baciRelease: string;
  sourceSha256: string;
  hsRevision: "HS12";
  artifactBuildId: string;
  artifactSchemaVersion: string;
  artifact: ReleaseObjectReference;
  manifest: ReleaseObjectReference;
};

export type ProductCatalogReference = {
  baciRelease: string;
  sourceArchiveSha256: string;
  hsRevision: "HS12";
  productSearchBuildId: string;
  catalogSchemaVersion: string;
  catalog: ReleaseObjectReference;
  manifest: ReleaseObjectReference;
};

export type DeploymentPairingManifest = {
  schemaVersion: "deployment-pairing-manifest-v1";
  deploymentPairingId: string;
  baciRelease: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  sourceStatusFallback: SourceStatusSnapshot;
  analysis: {
    artifact: AnalysisArtifactReference;
    releaseCatalog: ReleaseObjectReference;
  };
  productSearch: ProductCatalogReference;
};

export type AnalysisReleaseCatalog = {
  schemaVersion: "analysis-release-catalog-v1";
  current: AnalysisArtifactReference;
  previous: AnalysisArtifactReference | null;
  scoreVersion: "cms-v1";
  resultSchemaVersion: "candidate-market-result-v1";
};

export type ActiveDeploymentPointer = {
  schemaVersion: "active-deployment-pointer-v1";
  current: ReleaseObjectReference;
  previous: ReleaseObjectReference | null;
  sourceStatusFallback: SourceStatusSnapshot;
  activatedAt: string;
};

export type PublishedDeployment = {
  schemaVersion: "published-deployment-v1";
  deploymentPairingId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  baciRelease: string;
  sourceStatusFallback: SourceStatusSnapshot;
  activatedAt: string;
  previousDeploymentPairingId: string | null;
};

export function parseActiveDeploymentPointer(
  value: unknown,
): ActiveDeploymentPointer {
  const pointer = record(value, "active deployment pointer");
  if (pointer.schemaVersion !== "active-deployment-pointer-v1") {
    throw new Error("Active deployment pointer schema is incompatible.");
  }
  return {
    schemaVersion: "active-deployment-pointer-v1",
    current: objectReference(pointer.current, "current deployment"),
    previous:
      pointer.previous === null
        ? null
        : objectReference(pointer.previous, "previous deployment"),
    sourceStatusFallback: parseSourceStatusSnapshot(
      pointer.sourceStatusFallback,
      "active deployment source-status fallback",
    ),
    activatedAt: utcTimestamp(pointer.activatedAt, "pointer activatedAt"),
  };
}

export function parseDeploymentPairingManifest(
  value: unknown,
): DeploymentPairingManifest {
  const deployment = record(value, "deployment pairing manifest");
  if (deployment.schemaVersion !== "deployment-pairing-manifest-v1") {
    throw new Error("Deployment pairing manifest schema is incompatible.");
  }
  const analysis = record(deployment.analysis, "deployment analysis");
  const productSearch = record(
    deployment.productSearch,
    "deployment product search",
  );
  const releaseCatalog = objectReference(
    analysis.releaseCatalog,
    "deployment analysis release catalog",
  );
  const analysisReleaseCatalogSha256 = sha256String(
    deployment.analysisReleaseCatalogSha256,
    "analysis release catalog SHA-256",
  );
  if (releaseCatalog.sha256 !== analysisReleaseCatalogSha256) {
    throw new Error("Analysis release catalog identity is inconsistent.");
  }
  const parsed: DeploymentPairingManifest = {
    schemaVersion: "deployment-pairing-manifest-v1",
    deploymentPairingId: prefixedId(
      deployment.deploymentPairingId,
      "deployment pairing ID",
      "deployment-pairing-v1",
    ),
    baciRelease: string(deployment.baciRelease, "deployment BACI Release"),
    analysisBuildId: prefixedId(
      deployment.analysisBuildId,
      "deployment analysis build ID",
      "analysis-build-v1",
    ),
    analysisReleaseCatalogSha256,
    productSearchBuildId: prefixedId(
      deployment.productSearchBuildId,
      "product-search build ID",
      "product-search-v1",
    ),
    sourceStatusFallback: parseSourceStatusSnapshot(
      deployment.sourceStatusFallback,
      "deployment source-status fallback",
    ),
    analysis: {
      artifact: analysisArtifactReference(
        analysis.artifact,
        "deployment analysis artifact",
      ),
      releaseCatalog,
    },
    productSearch: productCatalogReference(
      productSearch,
      "deployment product search",
    ),
  };
  validateDeploymentPairingManifest(parsed);
  return parsed;
}

export function parseSourceStatusSnapshot(
  value: unknown,
  label = "source-status snapshot",
): SourceStatusSnapshot {
  const snapshot = record(value, label);
  if (snapshot.schemaVersion !== "source-status-v1") {
    throw new Error(`${label} schema is incompatible.`);
  }
  const checkedAt = utcTimestamp(snapshot.checkedAt, `${label} checkedAt`);
  const newerReleaseDetectedAt =
    snapshot.newerReleaseDetectedAt === null
      ? null
      : utcTimestamp(
          snapshot.newerReleaseDetectedAt,
          `${label} newerReleaseDetectedAt`,
        );
  const publishedAt = utcTimestamp(
    snapshot.publishedAt,
    `${label} publishedAt`,
  );
  if (
    Date.parse(checkedAt) > Date.parse(publishedAt) ||
    (newerReleaseDetectedAt !== null &&
      Date.parse(newerReleaseDetectedAt) > Date.parse(publishedAt))
  ) {
    throw new Error(`${label} chronology is invalid.`);
  }
  return {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId: string(
      snapshot.sourceStatusSnapshotId,
      `${label} ID`,
    ),
    checkedAt,
    servedBaciRelease: string(
      snapshot.servedBaciRelease,
      `${label} served BACI Release`,
    ),
    latestKnownBaciRelease: string(
      snapshot.latestKnownBaciRelease,
      `${label} latest known BACI Release`,
    ),
    newerReleaseDetectedAt,
    refreshFailed: boolean(
      snapshot.refreshFailed,
      `${label} refreshFailed`,
    ),
    rollbackActive: boolean(
      snapshot.rollbackActive,
      `${label} rollbackActive`,
    ),
    publishedAt,
  };
}

export function parseAnalysisReleaseCatalog(
  value: unknown,
): AnalysisReleaseCatalog {
  const catalog = record(value, "analysis release catalog");
  if (
    catalog.schemaVersion !== "analysis-release-catalog-v1" ||
    catalog.scoreVersion !== "cms-v1" ||
    catalog.resultSchemaVersion !== "candidate-market-result-v1"
  ) {
    throw new Error("Analysis release catalog schema is incompatible.");
  }
  return {
    schemaVersion: "analysis-release-catalog-v1",
    current: analysisArtifactReference(
      catalog.current,
      "current analysis artifact",
    ),
    previous:
      catalog.previous === null
        ? null
        : analysisArtifactReference(
            catalog.previous,
            "previous analysis artifact",
          ),
    scoreVersion: "cms-v1",
    resultSchemaVersion: "candidate-market-result-v1",
  };
}

export function assertDeploymentReleaseCatalog(
  deployment: DeploymentPairingManifest,
  catalog: AnalysisReleaseCatalog,
): void {
  if (
    !sameAnalysisArtifactReference(
      deployment.analysis.artifact,
      catalog.current,
    )
  ) {
    throw new Error(
      "Deployment analysis artifact does not match its release catalog.",
    );
  }
}

export function deploymentPairingIdFromKey(key: string): string {
  const match =
    /^deployment-pairings\/(deployment-pairing-v1-[a-f0-9]{16})\.json$/u.exec(
      key,
    );
  if (match === null) {
    throw new Error("Deployment pairing key is invalid.");
  }
  return match[1];
}

export function publishedDeployment(
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
    sourceStatusFallback: pointer.sourceStatusFallback,
    activatedAt: pointer.activatedAt,
    previousDeploymentPairingId:
      pointer.previous === null
        ? null
        : deploymentPairingIdFromKey(pointer.previous.key),
  };
}

export function sameSourceStatusSnapshot(
  left: SourceStatusSnapshot,
  right: SourceStatusSnapshot,
): boolean {
  return releaseJsonBytes(left).equals(releaseJsonBytes(right));
}

export async function readReleaseMetadata(
  body: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RELEASE_METADATA_BYTES) {
      throw new Error("Release metadata exceeds its size limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function releaseJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function contentAddressedId(prefix: string, value: unknown): string {
  const sha256 = releaseObjectSha256(releaseJsonBytes(value));
  return `${prefix}-${sha256.slice(0, 16)}`;
}

function analysisArtifactReference(
  value: unknown,
  label: string,
): AnalysisArtifactReference {
  const candidate = record(value, label);
  return {
    baciRelease: string(candidate.baciRelease, `${label} BACI Release`),
    sourceSha256: sha256String(
      candidate.sourceSha256,
      `${label} source SHA-256`,
    ),
    hsRevision: hs12(candidate.hsRevision, `${label} HS revision`),
    artifactBuildId: string(
      candidate.artifactBuildId,
      `${label} build ID`,
    ),
    artifactSchemaVersion: string(
      candidate.artifactSchemaVersion,
      `${label} schema version`,
    ),
    artifact: objectReference(candidate.artifact, `${label} object`),
    manifest: objectReference(candidate.manifest, `${label} manifest`),
  };
}

function productCatalogReference(
  value: unknown,
  label: string,
): ProductCatalogReference {
  const candidate = record(value, label);
  return {
    baciRelease: string(candidate.baciRelease, `${label} BACI Release`),
    sourceArchiveSha256: sha256String(
      candidate.sourceArchiveSha256,
      `${label} source archive SHA-256`,
    ),
    hsRevision: hs12(candidate.hsRevision, `${label} HS revision`),
    productSearchBuildId: prefixedId(
      candidate.productSearchBuildId,
      `${label} product-search build ID`,
      "product-search-v1",
    ),
    catalogSchemaVersion: string(
      candidate.catalogSchemaVersion,
      `${label} schema version`,
    ),
    catalog: objectReference(candidate.catalog, `${label} object`),
    manifest: objectReference(candidate.manifest, `${label} manifest`),
  };
}

function objectReference(
  value: unknown,
  label: string,
): ReleaseObjectReference {
  const reference = record(value, label);
  return {
    key: string(reference.key, `${label} key`),
    bytes: count(reference.bytes, `${label} bytes`),
    sha256: sha256String(reference.sha256, `${label} SHA-256`),
  };
}

function validateDeploymentPairingManifest(
  deployment: DeploymentPairingManifest,
): void {
  const analysis = deployment.analysis.artifact;
  const productSearch = deployment.productSearch;
  if (
    analysis.baciRelease !== deployment.baciRelease ||
    productSearch.baciRelease !== deployment.baciRelease ||
    analysis.sourceSha256 !== productSearch.sourceArchiveSha256 ||
    analysis.hsRevision !== productSearch.hsRevision ||
    productSearch.productSearchBuildId !==
      deployment.productSearchBuildId ||
    deployment.sourceStatusFallback.servedBaciRelease !==
      deployment.baciRelease
  ) {
    throw new Error("Deployment pairing identities are incompatible.");
  }
  if (
    analysis.artifactSchemaVersion !== "candidate-market-artifact-v1" ||
    productSearch.catalogSchemaVersion !== "product-catalog-artifact-v1"
  ) {
    throw new Error("Deployment pairing artifact schema is incompatible.");
  }
  const expectedAnalysisBuildId = contentAddressedId("analysis-build-v1", {
    analysisReleaseCatalogSha256:
      deployment.analysisReleaseCatalogSha256,
    scoreVersion: "cms-v1",
    resultSchemaVersion: "candidate-market-result-v1",
  });
  if (deployment.analysisBuildId !== expectedAnalysisBuildId) {
    throw new Error("Deployment analysis build identity is inconsistent.");
  }
  const pairingIdentity = Object.fromEntries(
    Object.entries(deployment).filter(
      ([key]) => key !== "deploymentPairingId",
    ),
  );
  if (
    deployment.deploymentPairingId !==
    contentAddressedId("deployment-pairing-v1", pairingIdentity)
  ) {
    throw new Error("Deployment pairing identity is inconsistent.");
  }
}

function sameAnalysisArtifactReference(
  left: AnalysisArtifactReference,
  right: AnalysisArtifactReference,
): boolean {
  return (
    left.baciRelease === right.baciRelease &&
    left.sourceSha256 === right.sourceSha256 &&
    left.hsRevision === right.hsRevision &&
    left.artifactBuildId === right.artifactBuildId &&
    left.artifactSchemaVersion === right.artifactSchemaVersion &&
    sameObjectReference(left.artifact, right.artifact) &&
    sameObjectReference(left.manifest, right.manifest)
  );
}

function sameObjectReference(
  left: ReleaseObjectReference,
  right: ReleaseObjectReference,
): boolean {
  return (
    left.key === right.key &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

function releaseObjectSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
