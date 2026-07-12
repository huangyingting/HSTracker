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

import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  parseActiveDeploymentPointer,
  parseDeploymentPairingManifest,
  publishedDeployment,
  readReleaseMetadata,
  releaseObjectIdentity,
  singleChunk,
  type ActiveDeploymentPointer,
  type DeploymentPairingManifest,
  type PublishedDeployment,
  type ReleaseObjectReference,
} from "./release-manifest";
import type {
  ReleaseObjectIdentity,
  ReleaseObjectReader,
} from "./release-object-store";

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
    const deploymentBytes = await this.readVerifiedObject(pointer.current);
    const deployment = parseDeploymentPairingManifest(
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
          deployment.analysis.artifact.artifact,
          join(partialPath, "candidate-market.duckdb"),
        ),
        this.downloadVerified(
          deployment.analysis.artifact.manifest,
          join(partialPath, "artifact-manifest.json"),
        ),
        this.downloadVerified(
          deployment.analysis.releaseCatalog,
          join(partialPath, "analysis-release-catalog.json"),
        ),
        this.downloadVerified(
          deployment.productSearch.catalog,
          join(partialPath, "product-catalog.json"),
        ),
        this.downloadVerified(
          deployment.productSearch.manifest,
          join(partialPath, "catalog-manifest.json"),
        ),
        writeVerifiedFile(
          join(partialPath, "deployment-manifest.json"),
          singleChunk(deploymentBytes),
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

  private async readPointer(): Promise<ActiveDeploymentPointer> {
    const stored = await this.objectStore.getObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (stored === null) {
      throw new Error("No active deployment pairing is available.");
    }
    return parseActiveDeploymentPointer(
      JSON.parse(
        (await readReleaseMetadata(stored.body)).toString("utf8"),
      ),
    );
  }

  private async readVerifiedObject(
    reference: ReleaseObjectReference,
  ): Promise<Buffer> {
    const stored = await this.objectStore.getObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }
    const bytes = await readReleaseMetadata(stored.body);
    verifyIdentity(releaseObjectIdentity(bytes), reference);
    return bytes;
  }

  private async downloadVerified(
    reference: ReleaseObjectReference,
    path: string,
  ): Promise<void> {
    const stored = await this.objectStore.getObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }
    await writeVerifiedFile(path, stored.body, reference);
  }
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
  deployment: DeploymentPairingManifest,
  deploymentBytes: Buffer,
): Promise<void> {
  await Promise.all([
    verifyFile(
      join(rootPath, "candidate-market.duckdb"),
      deployment.analysis.artifact.artifact,
    ),
    verifyFile(
      join(rootPath, "artifact-manifest.json"),
      deployment.analysis.artifact.manifest,
    ),
    verifyFile(
      join(rootPath, "analysis-release-catalog.json"),
      deployment.analysis.releaseCatalog,
    ),
    verifyFile(
      join(rootPath, "product-catalog.json"),
      deployment.productSearch.catalog,
    ),
    verifyFile(
      join(rootPath, "catalog-manifest.json"),
      deployment.productSearch.manifest,
    ),
    verifyFile(
      join(rootPath, "deployment-manifest.json"),
      releaseObjectIdentity(deploymentBytes),
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
  pointer: ActiveDeploymentPointer,
  deployment: DeploymentPairingManifest,
): HydratedRelease {
  return {
    deployment: publishedDeployment(pointer, deployment),
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
