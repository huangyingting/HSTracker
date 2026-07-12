import { createHash } from "node:crypto";

import type { ReleaseObjectIdentity } from "./release-object-store";

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
  analysis: {
    artifact: AnalysisArtifactReference;
    releaseCatalog: ReleaseObjectReference;
  };
  productSearch: ProductCatalogReference;
};

export type ActiveDeploymentPointer = {
  schemaVersion: "active-deployment-pointer-v1";
  current: ReleaseObjectReference;
  previous: ReleaseObjectReference | null;
  activatedAt: string;
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
  return {
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

export async function* singleChunk(
  bytes: Uint8Array,
): AsyncIterable<Uint8Array> {
  yield bytes;
}

export function releaseObjectIdentity(
  bytes: Uint8Array,
): ReleaseObjectIdentity {
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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

function prefixedId(
  value: unknown,
  label: string,
  prefix: string,
): string {
  const candidate = string(value, label);
  if (!new RegExp(`^${prefix}-[a-f0-9]{16}$`, "u").test(candidate)) {
    throw new Error(`${label} is malformed.`);
  }
  return candidate;
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

function utcTimestamp(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(candidate) ||
    Number.isNaN(Date.parse(candidate))
  ) {
    throw new Error(`${label} must be a UTC timestamp without fractions.`);
  }
  return candidate;
}
