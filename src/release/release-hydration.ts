import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  assertDeploymentReleaseCatalog,
  parseActiveDeploymentPointer,
  parseAnalysisReleaseCatalog,
  parseDeploymentPairingManifest,
  publishedDeployment,
  readReleaseMetadata,
  type ActiveDeploymentPointer,
  type AnalysisArtifactReference,
  type AnalysisReleaseCatalog,
  type DeploymentPairingManifest,
  type PublishedDeployment,
  type ReleaseObjectReference,
} from "./release-manifest";
import {
  releaseObjectIdentity,
  singleChunk,
  type ReleaseObjectIdentity,
  type ReleaseObjectReader,
} from "./release-object-store";

export type HydrateCurrentReleaseInput = {
  volumePath: string;
};

export type HydratedRelease = {
  deployment: PublishedDeployment;
  deploymentManifest: DeploymentPairingManifest;
  analysisReleaseCatalog: AnalysisReleaseCatalog;
  rootPath: string;
  analysisArtifactPath: string;
  analysisArtifactManifestPath: string;
  analysisReleaseCatalogPath: string;
  productCatalogPath: string;
  productCatalogManifestPath: string;
  deploymentManifestPath: string;
  previousAnalysis: {
    reference: AnalysisArtifactReference;
    artifactPath: string;
    artifactManifestPath: string;
  } | null;
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
      await verifyResidentReleaseBase(
        finalPath,
        deployment,
        deploymentBytes,
      );
      const releaseCatalog = parseAnalysisReleaseCatalog(
        JSON.parse(
          await readFile(
            join(finalPath, "analysis-release-catalog.json"),
            "utf8",
          ),
        ),
      );
      assertDeploymentReleaseCatalog(deployment, releaseCatalog);
      await this.ensureResidentPreviousAnalysis(
        finalPath,
        releaseCatalog,
      );
      await pruneInactivePairings(volumePath, finalPath);
      return hydratedRelease(
        finalPath,
        pointer,
        deployment,
        releaseCatalog,
      );
    }

    const releaseCatalogBytes = await this.readVerifiedObject(
      deployment.analysis.releaseCatalog,
    );
    const releaseCatalog = parseAnalysisReleaseCatalog(
      JSON.parse(releaseCatalogBytes.toString("utf8")),
    );
    assertDeploymentReleaseCatalog(deployment, releaseCatalog);
    const partialPath = join(
      volumePath,
      `.${deployment.deploymentPairingId}-${process.pid}.partial`,
    );
    await rm(partialPath, { force: true, recursive: true });
    await mkdir(partialPath);
    try {
      const downloads: Promise<void>[] = [
        this.materializeVerified(
          volumePath,
          deployment.analysis.artifact.artifact,
          join(partialPath, "candidate-market.duckdb"),
          [
            "candidate-market.duckdb",
            "previous-candidate-market.duckdb",
          ],
        ),
        this.materializeVerified(
          volumePath,
          deployment.analysis.artifact.manifest,
          join(partialPath, "artifact-manifest.json"),
          [
            "artifact-manifest.json",
            "previous-artifact-manifest.json",
          ],
        ),
        this.materializeVerified(
          volumePath,
          deployment.analysis.releaseCatalog,
          join(partialPath, "analysis-release-catalog.json"),
          ["analysis-release-catalog.json"],
          releaseCatalogBytes,
        ),
        this.materializeVerified(
          volumePath,
          deployment.productSearch.catalog,
          join(partialPath, "product-catalog.json"),
          ["product-catalog.json"],
        ),
        this.materializeVerified(
          volumePath,
          deployment.productSearch.manifest,
          join(partialPath, "catalog-manifest.json"),
          ["catalog-manifest.json"],
        ),
        writeVerifiedFile(
          join(partialPath, "deployment-manifest.json"),
          singleChunk(deploymentBytes),
          pointer.current,
        ),
      ];
      if (releaseCatalog.previous !== null) {
        downloads.push(
          this.materializeVerified(
            volumePath,
            releaseCatalog.previous.artifact,
            join(partialPath, "previous-candidate-market.duckdb"),
            [
              "candidate-market.duckdb",
              "previous-candidate-market.duckdb",
            ],
          ),
          this.materializeVerified(
            volumePath,
            releaseCatalog.previous.manifest,
            join(partialPath, "previous-artifact-manifest.json"),
            [
              "artifact-manifest.json",
              "previous-artifact-manifest.json",
            ],
          ),
        );
      }
      await Promise.all(downloads);
      await syncDirectory(partialPath);
      try {
        await rename(partialPath, finalPath);
      } catch (error) {
        if (!(await exists(finalPath))) {
          throw error;
        }
        await rm(partialPath, { force: true, recursive: true });
        await verifyResidentReleaseBase(
          finalPath,
          deployment,
          deploymentBytes,
        );
        await verifyResidentPreviousAnalysis(finalPath, releaseCatalog);
      }
      await syncDirectory(volumePath);
      await pruneInactivePairings(volumePath, finalPath);
    } catch (error) {
      await rm(partialPath, { force: true, recursive: true });
      throw error;
    }
    return hydratedRelease(
      finalPath,
      pointer,
      deployment,
      releaseCatalog,
    );
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

  private async materializeVerified(
    volumePath: string,
    reference: ReleaseObjectReference,
    path: string,
    reusableNames: readonly string[],
    knownBytes?: Uint8Array,
  ): Promise<void> {
    const reusablePath = await findReusableFile(
      volumePath,
      reusableNames,
      reference,
    );
    if (reusablePath !== null) {
      await link(reusablePath, path);
      return;
    }
    if (knownBytes !== undefined) {
      await writeVerifiedFile(
        path,
        singleChunk(knownBytes),
        reference,
      );
      return;
    }
    await this.downloadVerified(reference, path);
  }

  private async ensureResidentPreviousAnalysis(
    rootPath: string,
    releaseCatalog: AnalysisReleaseCatalog,
  ): Promise<void> {
    if (releaseCatalog.previous === null) {
      return;
    }

    const files = [
      {
        name: "previous-candidate-market.duckdb",
        reference: releaseCatalog.previous.artifact,
      },
      {
        name: "previous-artifact-manifest.json",
        reference: releaseCatalog.previous.manifest,
      },
    ] as const;
    for (const { name, reference } of files) {
      const path = join(rootPath, name);
      if (await exists(path)) {
        await verifyFile(path, reference);
        continue;
      }
      const partialPath = join(
        rootPath,
        `.${name}-${process.pid}.partial`,
      );
      await rm(partialPath, { force: true });
      try {
        await this.downloadVerified(reference, partialPath);
        await rename(partialPath, path);
        await syncDirectory(rootPath);
      } finally {
        await rm(partialPath, { force: true });
      }
    }
    await verifyResidentPreviousAnalysis(rootPath, releaseCatalog);
  }
}

async function findReusableFile(
  volumePath: string,
  names: readonly string[],
  expected: ReleaseObjectIdentity,
): Promise<string | null> {
  const entries = await readdir(volumePath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !isDeploymentPairingDirectory(entry.name)
    ) {
      continue;
    }
    for (const name of names) {
      const candidatePath = join(volumePath, entry.name, name);
      try {
        if ((await stat(candidatePath)).size !== expected.bytes) {
          continue;
        }
        await verifyFile(candidatePath, expected);
        return candidatePath;
      } catch (error) {
        if (
          isEnoent(error) ||
          error instanceof ReleaseHydrationError
        ) {
          continue;
        }
        throw error;
      }
    }
  }
  return null;
}

async function pruneInactivePairings(
  volumePath: string,
  activePath: string,
): Promise<void> {
  const activeName = activePath.slice(volumePath.length + 1);
  const entries = await readdir(volumePath, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== activeName &&
          isDeploymentPairingDirectory(entry.name),
      )
      .map((entry) =>
        rm(join(volumePath, entry.name), {
          force: true,
          recursive: true,
        }),
      ),
  );
  await syncDirectory(volumePath);
}

function isDeploymentPairingDirectory(name: string): boolean {
  return /^deployment-pairing-v1-[a-f0-9]{16}$/u.test(name);
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

async function verifyResidentReleaseBase(
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

async function verifyResidentPreviousAnalysis(
  rootPath: string,
  releaseCatalog: AnalysisReleaseCatalog,
): Promise<void> {
  if (releaseCatalog.previous === null) {
    return;
  }
  await Promise.all([
    verifyFile(
      join(rootPath, "previous-candidate-market.duckdb"),
      releaseCatalog.previous.artifact,
    ),
    verifyFile(
      join(rootPath, "previous-artifact-manifest.json"),
      releaseCatalog.previous.manifest,
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
  analysisReleaseCatalog: AnalysisReleaseCatalog,
): HydratedRelease {
  return {
    deployment: publishedDeployment(pointer, deployment),
    deploymentManifest: deployment,
    analysisReleaseCatalog,
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
    previousAnalysis:
      analysisReleaseCatalog.previous === null
        ? null
        : {
            reference: analysisReleaseCatalog.previous,
            artifactPath: join(
              rootPath,
              "previous-candidate-market.duckdb",
            ),
            artifactManifestPath: join(
              rootPath,
              "previous-artifact-manifest.json",
            ),
          },
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
