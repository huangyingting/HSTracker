import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  ReleaseObjectIdentity,
  ReleaseObjectReader,
} from "./release-object-store";
import type { PublishedDeployment } from "./release-publication";

const ACTIVE_POINTER_KEY = "deployment-pointers/current.json";
const MAX_METADATA_BYTES = 1024 * 1024;

type ObjectReference = ReleaseObjectIdentity & {
  key: string;
};

type StoredDeployment = {
  deploymentPairingId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  baciRelease: string;
  analysisArtifact: ObjectReference;
  analysisManifest: ObjectReference;
  analysisReleaseCatalog: ObjectReference;
  productCatalog: ObjectReference;
  productCatalogManifest: ObjectReference;
};

type ActivePointer = {
  current: ObjectReference;
  previous: ObjectReference | null;
  activatedAt: string;
};

export type HydrateCurrentReleaseInput = {
  volumePath: string;
};

export type HydratedRelease = {
  deployment: PublishedDeployment;
  rootPath: string;
  analysisArtifactPath: string;
  analysisArtifactManifestPath: string;
  analysisReleaseCatalogPath: string;
  productCatalogPath: string;
  productCatalogManifestPath: string;
  deploymentManifestPath: string;
};

export class ReleaseHydrationError extends Error {
  constructor(
    readonly code: "OBJECT_IDENTITY_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "ReleaseHydrationError";
  }
}

export class ReleaseHydrator {
  constructor(private readonly objectStore: ReleaseObjectReader) {}

  async hydrateCurrent(
    input: HydrateCurrentReleaseInput,
  ): Promise<HydratedRelease> {
    const pointer = await this.readPointer();
    const deploymentBytes = await this.readVerifiedObject(
      pointer.current,
      MAX_METADATA_BYTES,
    );
    const deployment = parseDeployment(
      JSON.parse(deploymentBytes.toString("utf8")),
    );
    const volumePath = resolve(input.volumePath);
    const finalPath = join(volumePath, deployment.deploymentPairingId);
    await mkdir(volumePath, { recursive: true });
    if (await exists(finalPath)) {
      await verifyResidentRelease(finalPath, deployment, deploymentBytes);
      return hydratedRelease(finalPath, pointer, deployment);
    }

    const partialPath = join(
      volumePath,
      `.${deployment.deploymentPairingId}-${process.pid}.partial`,
    );
    await rm(partialPath, { force: true, recursive: true });
    await mkdir(partialPath);
    try {
      await Promise.all([
        this.downloadVerified(
          deployment.analysisArtifact,
          join(partialPath, "candidate-market.duckdb"),
        ),
        this.downloadVerified(
          deployment.analysisManifest,
          join(partialPath, "artifact-manifest.json"),
        ),
        this.downloadVerified(
          deployment.analysisReleaseCatalog,
          join(partialPath, "analysis-release-catalog.json"),
        ),
        this.downloadVerified(
          deployment.productCatalog,
          join(partialPath, "product-catalog.json"),
        ),
        this.downloadVerified(
          deployment.productCatalogManifest,
          join(partialPath, "catalog-manifest.json"),
        ),
        writeVerifiedFile(
          join(partialPath, "deployment-manifest.json"),
          oneChunk(deploymentBytes),
          pointer.current,
        ),
      ]);
      await syncDirectory(partialPath);
      try {
        await rename(partialPath, finalPath);
      } catch (error) {
        if (!(await exists(finalPath))) {
          throw error;
        }
        await rm(partialPath, { force: true, recursive: true });
        await verifyResidentRelease(finalPath, deployment, deploymentBytes);
      }
      await syncDirectory(volumePath);
    } catch (error) {
      await rm(partialPath, { force: true, recursive: true });
      throw error;
    }
    return hydratedRelease(finalPath, pointer, deployment);
  }

  private async readPointer(): Promise<ActivePointer> {
    const stored = await this.objectStore.getObject(ACTIVE_POINTER_KEY);
    if (stored === null) {
      throw new Error("No active deployment pairing is available.");
    }
    return parsePointer(
      JSON.parse(
        (await collect(stored.body, MAX_METADATA_BYTES)).toString("utf8"),
      ),
    );
  }

  private async readVerifiedObject(
    reference: ObjectReference,
    maximumBytes: number,
  ): Promise<Buffer> {
    const stored = await this.objectStore.getObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }
    const bytes = await collect(stored.body, maximumBytes);
    verifyIdentity(identity(bytes), reference);
    return bytes;
  }

  private async downloadVerified(
    reference: ObjectReference,
    path: string,
  ): Promise<void> {
    const stored = await this.objectStore.getObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }
    await writeVerifiedFile(path, stored.body, reference);
  }
}

function parsePointer(value: unknown): ActivePointer {
  const pointer = record(value, "active deployment pointer");
  if (pointer.schemaVersion !== "active-deployment-pointer-v1") {
    throw new Error("Active deployment pointer schema is incompatible.");
  }
  return {
    current: objectReference(pointer.current, "current deployment"),
    previous:
      pointer.previous === null
        ? null
        : objectReference(pointer.previous, "previous deployment"),
    activatedAt: utcTimestamp(pointer.activatedAt, "pointer activatedAt"),
  };
}

function parseDeployment(value: unknown): StoredDeployment {
  const deployment = record(value, "deployment pairing manifest");
  if (deployment.schemaVersion !== "deployment-pairing-manifest-v1") {
    throw new Error("Deployment pairing manifest schema is incompatible.");
  }
  const analysis = record(deployment.analysis, "deployment analysis");
  const analysisArtifact = record(
    analysis.artifact,
    "deployment analysis artifact",
  );
  const productSearch = record(
    deployment.productSearch,
    "deployment product search",
  );
  const releaseCatalog = objectReference(
    analysis.releaseCatalog,
    "analysis release catalog",
  );
  const analysisReleaseCatalogSha256 = sha256String(
    deployment.analysisReleaseCatalogSha256,
    "analysis release catalog SHA-256",
  );
  if (releaseCatalog.sha256 !== analysisReleaseCatalogSha256) {
    throw new Error("Analysis release catalog identity is inconsistent.");
  }
  return {
    deploymentPairingId: pairingId(
      deployment.deploymentPairingId,
      "deployment pairing ID",
    ),
    analysisBuildId: buildId(
      deployment.analysisBuildId,
      "analysis build ID",
    ),
    analysisReleaseCatalogSha256,
    productSearchBuildId: productSearchBuildId(
      deployment.productSearchBuildId,
    ),
    baciRelease: string(deployment.baciRelease, "deployment BACI Release"),
    analysisArtifact: objectReference(
      analysisArtifact.artifact,
      "analysis artifact",
    ),
    analysisManifest: objectReference(
      analysisArtifact.manifest,
      "analysis artifact manifest",
    ),
    analysisReleaseCatalog: releaseCatalog,
    productCatalog: objectReference(
      productSearch.catalog,
      "product catalog",
    ),
    productCatalogManifest: objectReference(
      productSearch.manifest,
      "product catalog manifest",
    ),
  };
}

async function writeVerifiedFile(
  path: string,
  body: AsyncIterable<Uint8Array>,
  expected: ReleaseObjectIdentity,
): Promise<void> {
  const handle = await open(path, "wx");
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.byteLength;
      digest.update(chunk);
      await handle.write(chunk);
    }
    verifyIdentity(
      { bytes, sha256: digest.digest("hex") },
      expected,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyResidentRelease(
  rootPath: string,
  deployment: StoredDeployment,
  deploymentBytes: Buffer,
): Promise<void> {
  await Promise.all([
    verifyFile(
      join(rootPath, "candidate-market.duckdb"),
      deployment.analysisArtifact,
    ),
    verifyFile(
      join(rootPath, "artifact-manifest.json"),
      deployment.analysisManifest,
    ),
    verifyFile(
      join(rootPath, "analysis-release-catalog.json"),
      deployment.analysisReleaseCatalog,
    ),
    verifyFile(
      join(rootPath, "product-catalog.json"),
      deployment.productCatalog,
    ),
    verifyFile(
      join(rootPath, "catalog-manifest.json"),
      deployment.productCatalogManifest,
    ),
    verifyFile(
      join(rootPath, "deployment-manifest.json"),
      identity(deploymentBytes),
    ),
  ]);
}

async function verifyFile(
  path: string,
  expected: ReleaseObjectIdentity,
): Promise<void> {
  const handle = await open(path, "r");
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream()) {
      bytes += chunk.byteLength;
      digest.update(chunk);
    }
  } finally {
    await handle.close();
  }
  verifyIdentity({ bytes, sha256: digest.digest("hex") }, expected);
}

function verifyIdentity(
  actual: ReleaseObjectIdentity,
  expected: ReleaseObjectIdentity,
): void {
  if (
    actual.bytes !== expected.bytes ||
    actual.sha256 !== expected.sha256
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Deployment object identity does not match.",
    );
  }
}

function hydratedRelease(
  rootPath: string,
  pointer: ActivePointer,
  deployment: StoredDeployment,
): HydratedRelease {
  return {
    deployment: {
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
    },
    rootPath,
    analysisArtifactPath: join(rootPath, "candidate-market.duckdb"),
    analysisArtifactManifestPath: join(
      rootPath,
      "artifact-manifest.json",
    ),
    analysisReleaseCatalogPath: join(
      rootPath,
      "analysis-release-catalog.json",
    ),
    productCatalogPath: join(rootPath, "product-catalog.json"),
    productCatalogManifestPath: join(rootPath, "catalog-manifest.json"),
    deploymentManifestPath: join(rootPath, "deployment-manifest.json"),
  };
}

function objectReference(value: unknown, label: string): ObjectReference {
  const reference = record(value, label);
  return {
    key: string(reference.key, `${label} key`),
    bytes: count(reference.bytes, `${label} bytes`),
    sha256: sha256String(reference.sha256, `${label} SHA-256`),
  };
}

function pairingIdFromKey(key: string): string {
  const match =
    /^deployment-pairings\/(deployment-pairing-v1-[a-f0-9]{16})\.json$/u.exec(
      key,
    );
  if (match === null) {
    throw new Error("Deployment pairing key is invalid.");
  }
  return match[1];
}

function pairingId(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^deployment-pairing-v1-[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error(`${label} is malformed.`);
  }
  return candidate;
}

function buildId(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^analysis-build-v1-[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error(`${label} is malformed.`);
  }
  return candidate;
}

function productSearchBuildId(value: unknown): string {
  const candidate = string(value, "product-search build ID");
  if (!/^product-search-v1-[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error("Product-search build ID is malformed.");
  }
  return candidate;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function collect(
  body: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > maximumBytes) {
      throw new Error("Release metadata exceeds its size limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function* oneChunk(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}

function identity(bytes: Buffer): ReleaseObjectIdentity {
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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
