import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  accessRuntimePath,
  linkRuntimePath,
  makeRuntimeDirectory,
  openRuntimePath,
  readRuntimeDirectory,
  readRuntimeFile,
  removeRuntimePath,
  renameRuntimePath,
  statRuntimePath,
} from "../runtime-file-access";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  MAX_RELEASE_METADATA_BYTES,
  assertDeploymentReleaseCatalog,
  contentAddressedId,
  deploymentPairingIdFromKey,
  parseActiveDeploymentPointer,
  parseAnalysisReleaseCatalog,
  parseDeploymentPairingManifest,
  publishedDeployment,
  readReleaseMetadata,
  releaseJsonBytes,
  sameSourceStatusSnapshot,
  type ActiveDeploymentPointer,
  type AnalysisArtifactReference,
  type AnalysisReleaseCatalog,
  type DeploymentPairingManifest,
  type PublishedDeployment,
  type ReleaseObjectReference,
} from "./release-manifest";
import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import {
  createCandidateMarketDatasetPackage,
} from "../domain/trade-analytics/dataset-package";
import {
  createRecommendedDatasetMapping,
} from "../domain/trade-analytics/recommended-dataset-mapping";
import {
  releaseObjectIdentity,
  singleChunk,
  type ReleaseObject,
  type ReleaseObjectIdentity,
  type ReleaseObjectReader,
} from "./release-object-store";
import { record, string } from "./release-validation";

export type HydrateCurrentReleaseInput = {
  volumePath: string;
};

const RESIDENT_ACTIVATION_FILE = "active-deployment.json";

export type HydratedRelease = {
  deployment: PublishedDeployment;
  deploymentManifest: DeploymentPairingManifest;
  deploymentPointer: ActiveDeploymentPointer;
  sourceStatusFallback: SourceStatusSnapshot;
  analysisReleaseCatalog: AnalysisReleaseCatalog;
  rootPath: string;
  analysisArtifactPath: string;
  analysisArtifactManifestPath: string;
  analysisReleaseCatalogPath: string;
  productCatalogPath: string;
  productCatalogManifestPath: string;
  recommendedDatasetMappingPath: string | null;
  datasetPackageManifestPath: string | null;
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
    const volumePath = resolve(
      /* turbopackIgnore: true */ input.volumePath,
    );
    await makeRuntimeDirectory(volumePath, { recursive: true });
    try {
      const pointer = await this.readPointer();
      const deploymentBytes = await this.readVerifiedObject(pointer.current);
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
      const finalPath = join(
        /* turbopackIgnore: true */ volumePath,
        deployment.deploymentPairingId,
      );
      if (await exists(finalPath)) {
        await verifyResidentReleaseBase(
          finalPath,
          deployment,
          deploymentBytes,
        );
        const releaseCatalog = parseAnalysisReleaseCatalog(
          JSON.parse(
            await readRuntimeFile(
              join(
                /* turbopackIgnore: true */ finalPath,
                "analysis-release-catalog.json",
              ),
              "utf8",
            ),
          ),
        );
        assertDeploymentReleaseCatalog(deployment, releaseCatalog);
        await this.ensureResidentPreviousAnalysis(
          finalPath,
          releaseCatalog,
        );
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
      const mappingObjects =
        await this.readRecommendedDatasetMapping(deployment);
      const partialPath = join(
        /* turbopackIgnore: true */ volumePath,
        `.${deployment.deploymentPairingId}-${process.pid}.partial`,
      );
      await removeRuntimePath(partialPath, {
        force: true,
        recursive: true,
      });
      await makeRuntimeDirectory(partialPath);
      try {
        const downloads: Promise<void>[] = [
          this.materializeVerified(
            volumePath,
            deployment.analysis.artifact.artifact,
            join(
              /* turbopackIgnore: true */ partialPath,
              "candidate-market.duckdb",
            ),
            [
              "candidate-market.duckdb",
              "previous-candidate-market.duckdb",
            ],
          ),
          this.materializeVerified(
            volumePath,
            deployment.analysis.artifact.manifest,
            join(
              /* turbopackIgnore: true */ partialPath,
              "artifact-manifest.json",
            ),
            [
              "artifact-manifest.json",
              "previous-artifact-manifest.json",
            ],
          ),
          this.materializeVerified(
            volumePath,
            deployment.analysis.releaseCatalog,
            join(
              /* turbopackIgnore: true */ partialPath,
              "analysis-release-catalog.json",
            ),
            ["analysis-release-catalog.json"],
            releaseCatalogBytes,
          ),
          this.materializeVerified(
            volumePath,
            deployment.productSearch.catalog,
            join(
              /* turbopackIgnore: true */ partialPath,
              "product-catalog.json",
            ),
            ["product-catalog.json"],
          ),
          this.materializeVerified(
            volumePath,
            deployment.productSearch.manifest,
            join(
              /* turbopackIgnore: true */ partialPath,
              "catalog-manifest.json",
            ),
            ["catalog-manifest.json"],
          ),
          writeVerifiedFile(
            join(
              /* turbopackIgnore: true */ partialPath,
              "deployment-manifest.json",
            ),
            singleChunk(deploymentBytes),
            pointer.current,
          ),
        ];
        if (mappingObjects !== null) {
          downloads.push(
            this.materializeVerified(
              volumePath,
              deployment.recommendedDatasetMapping!.manifest,
              join(
                /* turbopackIgnore: true */ partialPath,
                "recommended-dataset-mapping.json",
              ),
              ["recommended-dataset-mapping.json"],
              mappingObjects.mappingBytes,
            ),
            this.materializeVerified(
              volumePath,
              mappingObjects.packageReference,
              join(
                /* turbopackIgnore: true */ partialPath,
                "dataset-package-manifest.json",
              ),
              ["dataset-package-manifest.json"],
              mappingObjects.packageBytes,
            ),
          );
        }
        if (releaseCatalog.previous !== null) {
          downloads.push(
            this.materializeVerified(
              volumePath,
              releaseCatalog.previous.artifact,
              join(
                /* turbopackIgnore: true */ partialPath,
                "previous-candidate-market.duckdb",
              ),
              [
                "candidate-market.duckdb",
                "previous-candidate-market.duckdb",
              ],
            ),
            this.materializeVerified(
              volumePath,
              releaseCatalog.previous.manifest,
              join(
                /* turbopackIgnore: true */ partialPath,
                "previous-artifact-manifest.json",
              ),
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
          await renameRuntimePath(partialPath, finalPath);
        } catch (error) {
          if (!(await exists(finalPath))) {
            throw error;
          }
          await removeRuntimePath(partialPath, {
            force: true,
            recursive: true,
          });
          await verifyResidentReleaseBase(
            finalPath,
            deployment,
            deploymentBytes,
          );
          await verifyResidentPreviousAnalysis(finalPath, releaseCatalog);
        }
        await syncDirectory(volumePath);
      } catch (error) {
        await removeRuntimePath(partialPath, {
          force: true,
          recursive: true,
        });
        throw error;
      }
      return hydratedRelease(
        finalPath,
        pointer,
        deployment,
        releaseCatalog,
      );
    } catch (error) {
      if (!(error instanceof ActiveDeploymentUnavailableError)) {
        throw error;
      }
      return this.hydrateResidentActivation(volumePath, error);
    }
  }

  async commitResidentActivation(
    hydrated: HydratedRelease,
  ): Promise<void> {
    const volumePath = dirname(hydrated.rootPath);
    const base = {
      schemaVersion: "resident-deployment-activation-v1",
      pointer: hydrated.deploymentPointer,
    } as const;
    const activation = {
      ...base,
      activationId: contentAddressedId(
        "resident-deployment-activation-v1",
        base,
      ),
    };
    const bytes = releaseJsonBytes(activation);
    const partialPath = join(
      /* turbopackIgnore: true */ volumePath,
      `.${RESIDENT_ACTIVATION_FILE}-${process.pid}-${activation.activationId}.partial`,
    );
    const activePath = join(
      /* turbopackIgnore: true */ volumePath,
      RESIDENT_ACTIVATION_FILE,
    );
    await removeRuntimePath(partialPath, { force: true });
    try {
      await writeVerifiedFile(
        partialPath,
        singleChunk(bytes),
        releaseObjectIdentity(bytes),
      );
      await renameRuntimePath(partialPath, activePath);
      await syncDirectory(volumePath);
    } finally {
      await removeRuntimePath(partialPath, { force: true });
    }
    await pruneInactivePairings(volumePath, hydrated.rootPath);
  }

  private async readPointer(): Promise<ActiveDeploymentPointer> {
    const stored = await this.readRemoteObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (stored === null) {
      throw new ActiveDeploymentUnavailableError();
    }
    return parseActiveDeploymentPointer(
      JSON.parse(
        (
          await readReleaseMetadata(
            deploymentAvailabilityStream(stored.body),
          )
        ).toString("utf8"),
      ),
    );
  }

  private async hydrateResidentActivation(
    volumePath: string,
    unavailable: ActiveDeploymentUnavailableError,
  ): Promise<HydratedRelease> {
    let activationBytes: Buffer;
    try {
      activationBytes = await readRuntimeFile(
        join(
          /* turbopackIgnore: true */ volumePath,
          RESIDENT_ACTIVATION_FILE,
        ),
      );
    } catch (error) {
      throw new Error(
        "Object storage is unavailable and no verified resident deployment is active.",
        { cause: new AggregateError([unavailable, error]) },
      );
    }
    if (activationBytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
      throw new Error("Resident deployment activation is oversized.");
    }
    const pointer = parseResidentActivation(
      JSON.parse(activationBytes.toString("utf8")),
    );
    const pairingId = deploymentPairingIdFromKey(
      pointer.current.key,
    );
    const finalPath = join(
      /* turbopackIgnore: true */ volumePath,
      pairingId,
    );
    const deploymentBytes = await readRuntimeFile(
      join(
        /* turbopackIgnore: true */ finalPath,
        "deployment-manifest.json",
      ),
    );
    verifyIdentity(
      releaseObjectIdentity(deploymentBytes),
      pointer.current,
    );
    const deployment = parseDeploymentPairingManifest(
      JSON.parse(deploymentBytes.toString("utf8")),
    );
    if (
      deployment.deploymentPairingId !== pairingId ||
      !sameSourceStatusSnapshot(
        pointer.sourceStatusFallback,
        deployment.sourceStatusFallback,
      )
    ) {
      throw new Error(
        "Resident deployment activation is incompatible.",
      );
    }
    const releaseCatalog = parseAnalysisReleaseCatalog(
      JSON.parse(
        await readRuntimeFile(
          join(
            /* turbopackIgnore: true */ finalPath,
            "analysis-release-catalog.json",
          ),
          "utf8",
        ),
      ),
    );
    assertDeploymentReleaseCatalog(deployment, releaseCatalog);
    await verifyResidentReleaseBase(
      finalPath,
      deployment,
      deploymentBytes,
    );
    await verifyResidentPreviousAnalysis(finalPath, releaseCatalog);
    return hydratedRelease(
      finalPath,
      pointer,
      deployment,
      releaseCatalog,
    );
  }

  private async readVerifiedObject(
    reference: ReleaseObjectReference,
  ): Promise<Buffer> {
    const stored = await this.readRemoteObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }

    const bytes = await readReleaseMetadata(
      deploymentAvailabilityStream(stored.body),
    );
    verifyIdentity(releaseObjectIdentity(bytes), reference);
    return bytes;
  }

  private async readRecommendedDatasetMapping(
    deployment: DeploymentPairingManifest,
  ): Promise<{
    mappingBytes: Buffer;
    packageBytes: Buffer;
    packageReference: ReleaseObjectReference;
  } | null> {
    if (deployment.recommendedDatasetMapping === null) {
      return null;
    }
    const mappingBytes = await this.readVerifiedObject(
      deployment.recommendedDatasetMapping.manifest,
    );
    const mapping = createRecommendedDatasetMapping(
      JSON.parse(mappingBytes.toString("utf8")),
    );
    if (
      mapping.identity !==
      deployment.recommendedDatasetMapping.identity
    ) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Recommended Dataset Mapping identity does not match.",
      );
    }
    const packageReference =
      mapping.manifest.datasetPackage.manifest;
    const packageBytes =
      await this.readVerifiedObject(packageReference);
    const datasetPackage = createCandidateMarketDatasetPackage(
      JSON.parse(packageBytes.toString("utf8")),
    );
    if (
      datasetPackage.identity !==
      mapping.manifest.datasetPackage.identity
    ) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Dataset Package identity does not match.",
      );
    }
    return { mappingBytes, packageBytes, packageReference };
  }

  private async downloadVerified(
    reference: ReleaseObjectReference,
    path: string,
  ): Promise<void> {
    const stored = await this.readRemoteObject(reference.key);
    if (stored === null) {
      throw new Error("A deployment object is unavailable.");
    }
    await writeVerifiedFile(
      path,
      deploymentAvailabilityStream(stored.body),
      reference,
    );
  }

  private async readRemoteObject(
    key: string,
  ): Promise<ReleaseObject | null> {
    try {
      return await this.objectStore.getObject(key);
    } catch (error) {
      throw new ActiveDeploymentUnavailableError({ cause: error });
    }
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
      await linkRuntimePath(reusablePath, path);
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
      const path = join(
        /* turbopackIgnore: true */ rootPath,
        name,
      );
      if (await exists(path)) {
        await verifyFile(path, reference);
        continue;
      }
      const partialPath = join(
        /* turbopackIgnore: true */ rootPath,
        `.${name}-${process.pid}.partial`,
      );
      await removeRuntimePath(partialPath, { force: true });
      try {
        await this.downloadVerified(reference, partialPath);
        await renameRuntimePath(partialPath, path);
        await syncDirectory(rootPath);
      } finally {
        await removeRuntimePath(partialPath, { force: true });
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
  const entries = await readRuntimeDirectory(volumePath);
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !isDeploymentPairingDirectory(entry.name)
    ) {
      continue;
    }
    for (const name of names) {
      const candidatePath = join(
        /* turbopackIgnore: true */ volumePath,
        entry.name,
        name,
      );
      try {
        if (
          (await statRuntimePath(candidatePath)).size !==
          expected.bytes
        ) {
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
  const entries = await readRuntimeDirectory(volumePath);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== activeName &&
          isDeploymentPairingDirectory(entry.name),
      )
      .map((entry) =>
        removeRuntimePath(
          join(
            /* turbopackIgnore: true */ volumePath,
            entry.name,
          ),
          {
            force: true,
            recursive: true,
          },
        ),
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
  const handle = await openRuntimePath(path, "wx");
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
      join(
        /* turbopackIgnore: true */ rootPath,
        "candidate-market.duckdb",
      ),
      deployment.analysis.artifact.artifact,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "artifact-manifest.json",
      ),
      deployment.analysis.artifact.manifest,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "analysis-release-catalog.json",
      ),
      deployment.analysis.releaseCatalog,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "product-catalog.json",
      ),
      deployment.productSearch.catalog,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "catalog-manifest.json",
      ),
      deployment.productSearch.manifest,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "deployment-manifest.json",
      ),
      releaseObjectIdentity(deploymentBytes),
    ),
    verifyResidentRecommendedDatasetMapping(
      rootPath,
      deployment,
    ),
  ]);
}

async function verifyResidentRecommendedDatasetMapping(
  rootPath: string,
  deployment: DeploymentPairingManifest,
): Promise<void> {
  if (deployment.recommendedDatasetMapping === null) {
    return;
  }
  const mappingPath = join(
    /* turbopackIgnore: true */ rootPath,
    "recommended-dataset-mapping.json",
  );
  await verifyFile(
    mappingPath,
    deployment.recommendedDatasetMapping.manifest,
  );
  const mapping = createRecommendedDatasetMapping(
    JSON.parse(await readRuntimeFile(mappingPath, "utf8")),
  );
  if (
    mapping.identity !==
    deployment.recommendedDatasetMapping.identity
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Recommended Dataset Mapping identity does not match.",
    );
  }
  const packagePath = join(
    /* turbopackIgnore: true */ rootPath,
    "dataset-package-manifest.json",
  );
  await verifyFile(
    packagePath,
    mapping.manifest.datasetPackage.manifest,
  );
  const datasetPackage = createCandidateMarketDatasetPackage(
    JSON.parse(await readRuntimeFile(packagePath, "utf8")),
  );
  if (
    datasetPackage.identity !==
    mapping.manifest.datasetPackage.identity
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Dataset Package identity does not match.",
    );
  }
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
      join(
        /* turbopackIgnore: true */ rootPath,
        "previous-candidate-market.duckdb",
      ),
      releaseCatalog.previous.artifact,
    ),
    verifyFile(
      join(
        /* turbopackIgnore: true */ rootPath,
        "previous-artifact-manifest.json",
      ),
      releaseCatalog.previous.manifest,
    ),
  ]);
}

async function verifyFile(
  path: string,
  expected: ReleaseObjectIdentity,
): Promise<void> {
  const handle = await openRuntimePath(path, "r");
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
    deploymentPointer: pointer,
    sourceStatusFallback: deployment.sourceStatusFallback,
    analysisReleaseCatalog,
    rootPath,
    analysisArtifactPath: join(
      /* turbopackIgnore: true */ rootPath,
      "candidate-market.duckdb",
    ),
    analysisArtifactManifestPath: join(
      /* turbopackIgnore: true */ rootPath,
      "artifact-manifest.json",
    ),
    analysisReleaseCatalogPath: join(
      /* turbopackIgnore: true */ rootPath,
      "analysis-release-catalog.json",
    ),
    productCatalogPath: join(
      /* turbopackIgnore: true */ rootPath,
      "product-catalog.json",
    ),
    productCatalogManifestPath: join(
      /* turbopackIgnore: true */ rootPath,
      "catalog-manifest.json",
    ),
    recommendedDatasetMappingPath:
      deployment.recommendedDatasetMapping === null
        ? null
        : join(
            /* turbopackIgnore: true */ rootPath,
            "recommended-dataset-mapping.json",
          ),
    datasetPackageManifestPath:
      deployment.recommendedDatasetMapping === null
        ? null
        : join(
            /* turbopackIgnore: true */ rootPath,
            "dataset-package-manifest.json",
          ),
    deploymentManifestPath: join(
      /* turbopackIgnore: true */ rootPath,
      "deployment-manifest.json",
    ),
    previousAnalysis:
      analysisReleaseCatalog.previous === null
        ? null
        : {
            reference: analysisReleaseCatalog.previous,
            artifactPath: join(
              /* turbopackIgnore: true */ rootPath,
              "previous-candidate-market.duckdb",
            ),
            artifactManifestPath: join(
              /* turbopackIgnore: true */ rootPath,
              "previous-artifact-manifest.json",
            ),
          },
  };
}

function parseResidentActivation(
  value: unknown,
): ActiveDeploymentPointer {
  const activation = record(
    value,
    "resident deployment activation",
  );
  if (
    activation.schemaVersion !==
    "resident-deployment-activation-v1"
  ) {
    throw new Error(
      "Resident deployment activation schema is incompatible.",
    );
  }
  const pointer = parseActiveDeploymentPointer(activation.pointer);
  const base = {
    schemaVersion: "resident-deployment-activation-v1",
    pointer,
  } as const;
  if (
    string(
      activation.activationId,
      "resident deployment activation ID",
    ) !==
    contentAddressedId("resident-deployment-activation-v1", base)
  ) {
    throw new Error(
      "Resident deployment activation identity is inconsistent.",
    );
  }
  return pointer;
}

async function* deploymentAvailabilityStream(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  try {
    for await (const chunk of body) {
      yield chunk;
    }
  } catch (error) {
    throw new ActiveDeploymentUnavailableError({ cause: error });
  }
}

class ActiveDeploymentUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("No active deployment pairing is available.", options);
    this.name = "ActiveDeploymentUnavailableError";
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await openRuntimePath(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await accessRuntimePath(path);
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
