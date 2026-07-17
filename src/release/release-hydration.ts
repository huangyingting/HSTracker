import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  DuckDBInstance,
  type DuckDBConnection,
} from "@duckdb/node-api";

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
import type {
  DeploymentActivation,
  ResidentActivationFallbackReason,
} from "../domain/release/deployment-activation";
import {
  createCandidateMarketDatasetPackage,
} from "../domain/trade-analytics/dataset-package";
import {
  createOpportunityDiscoveryDatasetPackage,
} from "../domain/trade-analytics/opportunity-discovery-v1-dataset-package";
import {
  DuckDbOpportunityCandidateIndex,
  DuckDbOpportunityEvidenceSource,
} from "../evidence/duckdb-opportunity-source";
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
import { count, record, string } from "./release-validation";

export type HydrateCurrentReleaseInput = {
  volumePath: string;
};

const RESIDENT_ACTIVATION_FILE = "active-deployment.json";

export type HydratedDeploymentPairing = {
  deploymentManifest: DeploymentPairingManifest;
  analysisReleaseCatalog: AnalysisReleaseCatalog;
  rootPath: string;
  analysisArtifactPath: string;
  analysisArtifactManifestPath: string;
  analysisReleaseCatalogPath: string;
  productCatalogPath: string;
  productCatalogManifestPath: string;
  recommendedDatasetMappingPath: string | null;
  datasetPackageManifestPath: string | null;
  opportunityDatasetPackageManifestPath: string | null;
  opportunityIndexDirectoryPath: string | null;
  opportunityIndexPath: string | null;
  opportunityIndexManifestPath: string | null;
  deploymentManifestPath: string;
  previousAnalysis: {
    reference: AnalysisArtifactReference;
    artifactPath: string;
    artifactManifestPath: string;
  } | null;
};

export type HydratedRelease = HydratedDeploymentPairing & {
  deployment: PublishedDeployment;
  deploymentPointer: ActiveDeploymentPointer;
  sourceStatusFallback: SourceStatusSnapshot;
  // Every retained pairing in the active window, current-first: index 0 is
  // this same current pairing (identical to the top-level fields above),
  // followed by up to `DEPLOYMENT_RETENTION_HISTORY_LIMIT` predecessors,
  // each fully hydrated and verified into its own resident directory. No
  // request-time object-store hydration is needed for any of them once
  // startup completes (see issue #44).
  retained: readonly HydratedDeploymentPairing[];
  activation: DeploymentActivation;
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

// Typed failure at the remote-candidate hydration seam (see issue #45):
// raised only while resolving the pointer or materializing/validating one
// pointer-named candidate pairing (current or a retained predecessor), never
// while independently reverifying an already-committed resident activation
// (`verifyResidentPairing`/`hydrateResidentActivation`), which fails closed
// on its own terms instead. `OBJECT_STORE_UNAVAILABLE` covers a missing
// pointer object or any object-store read/stream failure.
// `CURRENT_DEPLOYMENT_INVALID` covers a candidate that was reachable but
// failed identity, schema, or semantic validation -- for example a corrupt
// or mismatched Recommended Dataset Mapping or Dataset Package -- so a
// broken newly pointed mapping cannot take down a known-good resident
// deployment.
export class RemoteCandidateActivationError extends Error {
  constructor(
    readonly code: ResidentActivationFallbackReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteCandidateActivationError";
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
      const current = await this.hydratePairing(
        volumePath,
        pointer.current,
      );
      if (
        !sameSourceStatusSnapshot(
          pointer.sourceStatusFallback,
          current.deploymentManifest.sourceStatusFallback,
        )
      ) {
        throw new RemoteCandidateActivationError(
          "CURRENT_DEPLOYMENT_INVALID",
          "Active deployment Source Freshness Status fallback is incompatible.",
        );
      }
      // Every retained predecessor hydrates into its own sibling
      // directory after `current` so it can reuse `current`'s
      // already-resident, content-addressed files via hardlink (see
      // `materializeVerified`/`findReusableFile`) rather than
      // re-downloading unchanged objects. Each predecessor keeps its own
      // manifest, release catalog, product catalog, and Recommended
      // Dataset Mapping -- it is never hydrated from `current`'s (see
      // issue #44 "bind each retained build to its own ... catalogs/
      // provenance").
      const history = await Promise.all(
        pointer.history.map((reference) =>
          this.hydratePairing(volumePath, reference),
        ),
      );
      return {
        ...current,
        deployment: publishedDeployment(pointer, current.deploymentManifest),
        deploymentPointer: pointer,
        sourceStatusFallback: current.deploymentManifest.sourceStatusFallback,
        retained: [current, ...history],
        activation: { mode: "CURRENT" },
      };
    } catch (error) {
      if (!(error instanceof RemoteCandidateActivationError)) {
        throw error;
      }
      return this.hydrateResidentActivation(volumePath, error);
    }
  }

  /**
   * Hydrates one deployment pairing (current or a retained predecessor)
   * into its own resident directory, reusing an already-verified resident
   * directory when present and otherwise downloading into a
   * process-specific `.partial` directory before an atomic rename. This
   * is the sole per-pairing hydration path: `hydrateCurrent()` calls it
   * once for `pointer.current` and once per `pointer.history` entry.
   * Remote retrieval and candidate validation sites classify only their own
   * failures as fallback-eligible. Local filesystem and programming failures
   * pass through unchanged and fail readiness rather than being mislabeled as
   * a bad current deployment.
   */
  private async hydratePairing(
    volumePath: string,
    deploymentReference: ReleaseObjectReference,
  ): Promise<HydratedDeploymentPairing> {
    const deploymentBytes = await this.readVerifiedObject(
      deploymentReference,
    );
    const deployment = parseRemoteCandidateMetadata(
      () =>
        parseDeploymentPairingManifest(
          JSON.parse(deploymentBytes.toString("utf8")),
        ),
    );
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
      await this.ensureResidentPreviousAnalysis(finalPath, releaseCatalog);
      return hydratedPairing(finalPath, deployment, releaseCatalog);
    }

    const releaseCatalogBytes = await this.readVerifiedObject(
      deployment.analysis.releaseCatalog,
    );
    const releaseCatalog = parseRemoteCandidateMetadata(
      () =>
        parseAnalysisReleaseCatalog(
          JSON.parse(releaseCatalogBytes.toString("utf8")),
        ),
    );
    parseRemoteCandidateMetadata(() =>
      assertDeploymentReleaseCatalog(deployment, releaseCatalog),
    );
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
          deploymentReference,
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
        if (
          mappingObjects.opportunityPackageReference !== null &&
          mappingObjects.opportunityPackageBytes !== null
        ) {
          downloads.push(
            this.materializeVerified(
              volumePath,
              mappingObjects.opportunityPackageReference,
              join(
                /* turbopackIgnore: true */ partialPath,
                "opportunity-dataset-package-manifest.json",
              ),
              ["opportunity-dataset-package-manifest.json"],
              mappingObjects.opportunityPackageBytes,
            ),
          );
        }
      }
      if (deployment.opportunityIndex !== null) {
        downloads.push(
          this.materializeVerified(
            volumePath,
            deployment.opportunityIndex.object,
            join(
              /* turbopackIgnore: true */ partialPath,
              "opportunity-index.duckdb",
            ),
            ["opportunity-index.duckdb"],
          ),
          this.materializeVerified(
            volumePath,
            deployment.opportunityIndex.manifest,
            join(
              /* turbopackIgnore: true */ partialPath,
              "opportunity-index-manifest.json",
            ),
            ["opportunity-index-manifest.json"],
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
      await verifyResidentOpportunityIndex(partialPath, deployment);
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
    return hydratedPairing(finalPath, deployment, releaseCatalog);
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
    await pruneInactivePairings(
      volumePath,
      hydrated.retained.map((pairing) => pairing.rootPath),
    );
  }

  private async readPointer(): Promise<ActiveDeploymentPointer> {
    const stored = await this.readRemoteObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (stored === null) {
      throw new RemoteCandidateActivationError(
        "OBJECT_STORE_UNAVAILABLE",
        "No active deployment pairing is available.",
      );
    }
    try {
      const bytes = await readReleaseMetadata(
        deploymentAvailabilityStream(stored.body),
      );
      return parseActiveDeploymentPointer(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (error instanceof RemoteCandidateActivationError) {
        throw error;
      }
      throw new RemoteCandidateActivationError(
        "CURRENT_DEPLOYMENT_INVALID",
        deepestErrorMessage(error),
        { cause: error },
      );
    }
  }

  /**
   * Reactivates the entire last durably committed resident activation
   * record -- current plus its retained history, from one atomic record
   * written only by `commitResidentActivation` -- when the live active
   * deployment pointer's own candidate could not be retrieved or
   * validated (see issue #45). This method never mixes remote current
   * with resident evidence, never writes or prunes the durable record, and
   * independently reverifies every resident byte from its own pairing
   * directories rather than trusting anything `hydrateCandidatePairing`
   * already inspected, so corrupt, incomplete, incompatible, or
   * identity-mismatched resident state still fails closed here instead of
   * partially serving.
   */
  private async hydrateResidentActivation(
    volumePath: string,
    candidateFailure: RemoteCandidateActivationError,
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
      candidateFailure.cause ??= error;
      throw candidateFailure;
    }
    if (activationBytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
      throw new Error("Resident deployment activation is oversized.");
    }
    const pointer = parseResidentActivation(
      JSON.parse(activationBytes.toString("utf8")),
    );
    const current = await this.verifyResidentPairing(
      volumePath,
      pointer.current,
    );
    if (
      !sameSourceStatusSnapshot(
        pointer.sourceStatusFallback,
        current.deploymentManifest.sourceStatusFallback,
      )
    ) {
      throw new Error(
        "Resident deployment activation is incompatible.",
      );
    }
    // Every retained predecessor was smoke-tested and committed together
    // with `current` (see `commitResidentActivation`), so an outage
    // restart re-verifies and makes all of them available again without
    // any request-time object-store access (see issue #44 "support
    // outage restart only after all are smoke-tested").
    const history = await Promise.all(
      pointer.history.map((reference) =>
        this.verifyResidentPairing(volumePath, reference),
      ),
    );
    return {
      ...current,
      deployment: publishedDeployment(pointer, current.deploymentManifest),
      deploymentPointer: pointer,
      sourceStatusFallback: current.deploymentManifest.sourceStatusFallback,
      retained: [current, ...history],
      activation: {
        mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
        reason: candidateFailure.code,
      },
    };
  }

  private async verifyResidentPairing(
    volumePath: string,
    reference: ReleaseObjectReference,
  ): Promise<HydratedDeploymentPairing> {
    const pairingId = deploymentPairingIdFromKey(reference.key);
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
      reference,
    );
    const deployment = parseDeploymentPairingManifest(
      JSON.parse(deploymentBytes.toString("utf8")),
    );
    if (deployment.deploymentPairingId !== pairingId) {
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
    return hydratedPairing(finalPath, deployment, releaseCatalog);
  }

  private async readVerifiedObject(
    reference: ReleaseObjectReference,
  ): Promise<Buffer> {
    const stored = await this.readRemoteObject(reference.key);
    if (stored === null) {
      throw new RemoteCandidateActivationError(
        "OBJECT_STORE_UNAVAILABLE",
        `A deployment object is unavailable: ${reference.key}.`,
      );
    }

    try {
      const bytes = await readReleaseMetadata(
        deploymentAvailabilityStream(stored.body),
      );
      verifyIdentity(releaseObjectIdentity(bytes), reference);
      return bytes;
    } catch (error) {
      if (error instanceof RemoteCandidateActivationError) {
        throw error;
      }
      throw invalidRemoteCandidate(error);
    }
  }

  private async readRecommendedDatasetMapping(
    deployment: DeploymentPairingManifest,
  ): Promise<{
    mappingBytes: Buffer;
    packageBytes: Buffer;
    packageReference: ReleaseObjectReference;
    opportunityPackageBytes: Buffer | null;
    opportunityPackageReference: ReleaseObjectReference | null;
  } | null> {
    if (deployment.recommendedDatasetMapping === null) {
      return null;
    }
    const mappingBytes = await this.readVerifiedObject(
      deployment.recommendedDatasetMapping.manifest,
    );
    const mapping = parseRemoteCandidateMetadata(
      () =>
        createRecommendedDatasetMapping(
          JSON.parse(mappingBytes.toString("utf8")),
        ),
    );
    if (
      mapping.identity !==
      deployment.recommendedDatasetMapping.identity
    ) {
      throw new RemoteCandidateActivationError(
        "CURRENT_DEPLOYMENT_INVALID",
        "Recommended Dataset Mapping identity does not match.",
      );
    }
    const packageReference =
      mapping.manifest.datasetPackage.manifest;
    const packageBytes =
      await this.readVerifiedObject(packageReference);
    const datasetPackage = parseRemoteCandidateMetadata(
      () =>
        createCandidateMarketDatasetPackage(
          JSON.parse(packageBytes.toString("utf8")),
        ),
    );
    if (
      datasetPackage.identity !==
      mapping.manifest.datasetPackage.identity
    ) {
      throw new RemoteCandidateActivationError(
        "CURRENT_DEPLOYMENT_INVALID",
        "Dataset Package identity does not match.",
      );
    }
    const opportunityPackageReference =
      mapping.manifest.opportunity?.datasetPackage.manifest ?? null;
    const opportunityPackageBytes =
      opportunityPackageReference === null
        ? null
        : await this.readVerifiedObject(opportunityPackageReference);
    if (
      opportunityPackageReference !== null &&
      opportunityPackageBytes !== null
    ) {
      const opportunityPackage = parseRemoteCandidateMetadata(
        () =>
          createOpportunityDiscoveryDatasetPackage(
            JSON.parse(opportunityPackageBytes.toString("utf8")),
          ),
      );
      if (
        opportunityPackage.identity !==
        mapping.manifest.opportunity!.datasetPackage.identity
      ) {
        throw new RemoteCandidateActivationError(
          "CURRENT_DEPLOYMENT_INVALID",
          "Opportunity Dataset Package identity does not match.",
        );
      }
    }
    return {
      mappingBytes,
      packageBytes,
      packageReference,
      opportunityPackageBytes,
      opportunityPackageReference,
    };
  }

  private async downloadVerified(
    reference: ReleaseObjectReference,
    path: string,
  ): Promise<void> {
    const stored = await this.readRemoteObject(reference.key);
    if (stored === null) {
      throw new RemoteCandidateActivationError(
        "OBJECT_STORE_UNAVAILABLE",
        `A deployment object is unavailable: ${reference.key}.`,
      );
    }
    try {
      await writeVerifiedFile(
        path,
        deploymentAvailabilityStream(stored.body),
        reference,
      );
    } catch (error) {
      if (
        error instanceof RemoteCandidateActivationError
      ) {
        throw error;
      }
      if (error instanceof ReleaseHydrationError) {
        throw invalidRemoteCandidate(error);
      }
      throw error;
    }
  }

  private async readRemoteObject(
    key: string,
  ): Promise<ReleaseObject | null> {
    try {
      return await this.objectStore.getObject(key);
    } catch (error) {
      throw new RemoteCandidateActivationError(
        "OBJECT_STORE_UNAVAILABLE",
        deepestErrorMessage(error),
        { cause: error },
      );
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
  retainedPaths: readonly string[],
): Promise<void> {
  const retainedNames = new Set(
    retainedPaths.map((path) => path.slice(volumePath.length + 1)),
  );
  const entries = await readRuntimeDirectory(volumePath);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !retainedNames.has(entry.name) &&
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
  await verifyResidentOpportunityIndex(rootPath, deployment);
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
  if (mapping.manifest.opportunity === null) {
    if (deployment.opportunityIndex !== null) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index is undeclared by its mapping.",
      );
    }
    return;
  }
  if (
    deployment.opportunityIndex === null ||
    deployment.opportunityIndex.object.key !==
      mapping.manifest.opportunity.index.object.key ||
    deployment.opportunityIndex.object.bytes !==
      mapping.manifest.opportunity.index.object.bytes ||
    deployment.opportunityIndex.object.sha256 !==
      mapping.manifest.opportunity.index.object.sha256
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Opportunity Index reference does not match its mapping.",
    );
  }
  const opportunityPackagePath = join(
    /* turbopackIgnore: true */ rootPath,
    "opportunity-dataset-package-manifest.json",
  );
  await verifyFile(
    opportunityPackagePath,
    mapping.manifest.opportunity.datasetPackage.manifest,
  );
  const opportunityPackage = createOpportunityDiscoveryDatasetPackage(
    JSON.parse(await readRuntimeFile(opportunityPackagePath, "utf8")),
  );
  if (
    opportunityPackage.identity !==
    mapping.manifest.opportunity.datasetPackage.identity
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Opportunity Dataset Package identity does not match.",
    );
  }
}

async function verifyResidentOpportunityIndex(
  rootPath: string,
  deployment: DeploymentPairingManifest,
): Promise<void> {
  if (deployment.opportunityIndex === null) {
    return;
  }
  const indexPath = join(
    /* turbopackIgnore: true */ rootPath,
    "opportunity-index.duckdb",
  );
  const manifestPath = join(
    /* turbopackIgnore: true */ rootPath,
    "opportunity-index-manifest.json",
  );
  await Promise.all([
    verifyFile(indexPath, deployment.opportunityIndex.object),
    verifyFile(manifestPath, deployment.opportunityIndex.manifest),
  ]);
  const manifest = record(
    JSON.parse(await readRuntimeFile(manifestPath, "utf8")),
    "resident Opportunity Index manifest",
  );
  const sourceArtifact = record(
    manifest.sourceArtifact,
    "resident Opportunity Index source artifact",
  );
  const index = record(manifest.index, "resident Opportunity Index object");
  if (
    manifest.schemaVersion !== "opportunity-index-manifest-v1" ||
    manifest.indexSchemaVersion !== "opportunity-index-v1" ||
    string(index.relativePath, "resident Opportunity Index relative path") !==
      "opportunity-index.duckdb" ||
    string(sourceArtifact.sha256, "resident Opportunity Index source SHA-256") !==
      deployment.analysis.artifact.artifact.sha256 ||
    string(sourceArtifact.buildId, "resident Opportunity Index source build ID") !==
      deployment.analysis.artifact.artifactBuildId ||
    count(sourceArtifact.bytes, "resident Opportunity Index source bytes") !==
      deployment.analysis.artifact.artifact.bytes ||
    count(index.bytes, "resident Opportunity Index bytes") !==
      deployment.opportunityIndex.object.bytes ||
    string(index.sha256, "resident Opportunity Index SHA-256") !==
      deployment.opportunityIndex.object.sha256
  ) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Opportunity Index manifest does not match its deployment.",
    );
  }
  await reconcileOpportunityIndexCohorts(rootPath, manifest);
  await smokeOpportunityIndex(rootPath, deployment);
}

async function reconcileOpportunityIndexCohorts(
  rootPath: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const scoreWindow = record(
    manifest.scoreWindow,
    "resident Opportunity Index score window",
  );
  const startYear = count(scoreWindow.start, "Opportunity Index score start");
  const endYear = count(scoreWindow.end, "Opportunity Index score end");
  const indexInstance = await DuckDBInstance.create(
    join(/* turbopackIgnore: true */ rootPath, "opportunity-index.duckdb"),
    { access_mode: "READ_ONLY" },
  );
  const artifactInstance = await DuckDBInstance.create(
    join(/* turbopackIgnore: true */ rootPath, "candidate-market.duckdb"),
    { access_mode: "READ_ONLY" },
  );
  try {
    const [indexConnection, artifactConnection] = await Promise.all([
      indexInstance.connect(),
      artifactInstance.connect(),
    ]);
    const duplicateKeys = await queryScalarNumber(
      indexConnection,
      "SELECT COUNT(*) FROM (SELECT exporter_code, product_id, importer_code FROM opportunity_candidate GROUP BY 1,2,3 HAVING COUNT(*) > 1)",
    );
    if (duplicateKeys !== 0) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index contains duplicate candidate keys.",
      );
    }
    const persisted = await queryNumberPairs(
      indexConnection,
      "SELECT exporter_code, COUNT(*) FROM opportunity_candidate GROUP BY exporter_code ORDER BY exporter_code",
    );
    const exporterCount = count(
      manifest.exporterCount,
      "resident Opportunity Index exporter count",
    );
    if (persisted.size === 0 || persisted.size !== exporterCount) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index exporter set is incomplete.",
      );
    }
    const eligible = await queryNumberPairs(
      artifactConnection,
      eligibleCohortSql([...persisted.keys()], startYear, endYear),
    );
    for (const [exporterCode, persistedCount] of persisted) {
      if (
        eligible.get(exporterCode) !== persistedCount
      ) {
        throw new ReleaseHydrationError(
          "OBJECT_IDENTITY_MISMATCH",
          `Resident Opportunity Index cohort reconciliation failed for exporter ${exporterCode}.`,
        );
      }
    }
    if (eligible.size !== persisted.size) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index cohort exporter set is incomplete.",
      );
    }
  } finally {
    indexInstance.closeSync();
    artifactInstance.closeSync();
  }
}

async function smokeOpportunityIndex(
  rootPath: string,
  deployment: DeploymentPairingManifest,
): Promise<void> {
  const first = await firstOpportunityCandidate(rootPath);
  const candidateIndex = await DuckDbOpportunityCandidateIndex.open({
    indexDirectoryPath: rootPath,
    analysisArtifactPath: join(
      /* turbopackIgnore: true */ rootPath,
      "candidate-market.duckdb",
    ),
    servingVolumePath: rootPath,
  });
  const evidenceSource = await DuckDbOpportunityEvidenceSource.open({
    indexDirectoryPath: rootPath,
    analysisArtifactPath: join(
      /* turbopackIgnore: true */ rootPath,
      "candidate-market.duckdb",
    ),
    servingVolumePath: rootPath,
  });
  try {
    const page = await candidateIndex.page(
      {
        analysisBuildId: deployment.analysisBuildId,
        exportEconomyCode: String(first.exporterCode),
        limit: 1,
        cursor: null,
        productCodes: null,
      },
      `hydration-opportunity-smoke:${deployment.analysisBuildId}`,
    );
    if (page.cohortSize < 1 || page.candidates.length !== 1) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index smoke page is inconsistent.",
      );
    }
    const candidate = page.candidates[0]!;
    const detail = await evidenceSource.loadDetail({
      analysisBuildId: deployment.analysisBuildId,
      exportEconomyCode: String(first.exporterCode),
      productCode: candidate.product.code,
      marketCode: candidate.market.code,
    });
    if (
      detail.analysisBuildId !== page.analysisBuildId ||
      detail.product.code !== candidate.product.code ||
      detail.market.code !== candidate.market.code ||
      detail.marketYears.length !== 5
    ) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index smoke detail is inconsistent.",
      );
    }
  } finally {
    candidateIndex.close();
    evidenceSource.close();
  }
}

async function firstOpportunityCandidate(
  rootPath: string,
): Promise<{ exporterCode: number }> {
  const instance = await DuckDBInstance.create(
    join(/* turbopackIgnore: true */ rootPath, "opportunity-index.duckdb"),
    { access_mode: "READ_ONLY" },
  );
  try {
    const connection = await instance.connect();
    const reader = await connection.runAndReadAll(
      "SELECT exporter_code FROM opportunity_candidate ORDER BY exporter_code LIMIT 1",
    );
    const exporterCode = reader.getRows()[0]?.[0];
    if (exporterCode === undefined) {
      throw new ReleaseHydrationError(
        "OBJECT_IDENTITY_MISMATCH",
        "Resident Opportunity Index has no smoke candidate.",
      );
    }
    return { exporterCode: Number(exporterCode) };
  } finally {
    instance.closeSync();
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

async function queryScalarNumber(
  connection: DuckDBConnection,
  sql: string,
): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  const value = reader.getRows()[0]?.[0];
  if (value === undefined) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Opportunity Index reconciliation returned no scalar.",
    );
  }
  return Number(value);
}

async function queryNumberPairs(
  connection: DuckDBConnection,
  sql: string,
): Promise<Map<number, number>> {
  const reader = await connection.runAndReadAll(sql);
  return new Map(
    reader.getRows().map((row) => [Number(row[0]), Number(row[1])]),
  );
}

function eligibleCohortSql(
  exporterCodes: readonly number[],
  startYear: number,
  endYear: number,
): string {
  if (exporterCodes.length === 0) {
    throw new ReleaseHydrationError(
      "OBJECT_IDENTITY_MISMATCH",
      "Resident Opportunity Index has no exporters to reconcile.",
    );
  }
  const values = exporterCodes.map((code) => `(${code})`).join(", ");
  return (
    `WITH stats(exporter_code) AS (VALUES ${values}), ` +
    `eligible_pairs AS (` +
    `SELECT DISTINCT product_id, importer_code FROM market_year ` +
    `WHERE year BETWEEN ${startYear} AND ${endYear}) ` +
    `SELECT stats.exporter_code, COUNT(*) ` +
    `FROM stats CROSS JOIN eligible_pairs ` +
    `WHERE eligible_pairs.importer_code <> stats.exporter_code ` +
    `GROUP BY stats.exporter_code ORDER BY stats.exporter_code`
  );
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

function hydratedPairing(
  rootPath: string,
  deployment: DeploymentPairingManifest,
  analysisReleaseCatalog: AnalysisReleaseCatalog,
): HydratedDeploymentPairing {
  return {
    deploymentManifest: deployment,
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
    opportunityDatasetPackageManifestPath:
      deployment.opportunityIndex === null
        ? null
        : join(
            /* turbopackIgnore: true */ rootPath,
            "opportunity-dataset-package-manifest.json",
          ),
    opportunityIndexDirectoryPath:
      deployment.opportunityIndex === null ? null : rootPath,
    opportunityIndexPath:
      deployment.opportunityIndex === null
        ? null
        : join(
            /* turbopackIgnore: true */ rootPath,
            "opportunity-index.duckdb",
          ),
    opportunityIndexManifestPath:
      deployment.opportunityIndex === null
        ? null
        : join(
            /* turbopackIgnore: true */ rootPath,
            "opportunity-index-manifest.json",
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
  const storedPointer = record(
    activation.pointer,
    "resident active deployment pointer",
  );
  const pointer = parseActiveDeploymentPointer(storedPointer);
  const base = {
    schemaVersion: "resident-deployment-activation-v1",
    pointer,
  } as const;
  const activationId = string(
    activation.activationId,
    "resident deployment activation ID",
  );
  const currentActivationId = contentAddressedId(
    "resident-deployment-activation-v1",
    base,
  );
  const isLegacyPointer =
    storedPointer.history === undefined &&
    Object.prototype.hasOwnProperty.call(storedPointer, "previous");
  const legacyActivationId = isLegacyPointer
    ? contentAddressedId("resident-deployment-activation-v1", {
        schemaVersion: "resident-deployment-activation-v1",
        pointer: {
          schemaVersion: pointer.schemaVersion,
          current: pointer.current,
          previous: pointer.history[0] ?? null,
          sourceStatusFallback: pointer.sourceStatusFallback,
          activatedAt: pointer.activatedAt,
        },
      })
    : null;
  if (
    activationId !== currentActivationId &&
    activationId !== legacyActivationId
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
    throw new RemoteCandidateActivationError(
      "OBJECT_STORE_UNAVAILABLE",
      deepestErrorMessage(error),
      { cause: error },
    );
  }
}

function deepestErrorMessage(error: unknown): string {
  let current = error;
  while (
    current instanceof Error &&
    current.cause instanceof Error
  ) {
    current = current.cause;
  }
  return current instanceof Error
    ? current.message
    : "The current deployment could not be validated.";
}

function invalidRemoteCandidate(
  error: unknown,
): RemoteCandidateActivationError {
  return new RemoteCandidateActivationError(
    "CURRENT_DEPLOYMENT_INVALID",
    deepestErrorMessage(error),
    error instanceof Error ? { cause: error } : undefined,
  );
}

function parseRemoteCandidateMetadata<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof RemoteCandidateActivationError) {
      throw error;
    }
    throw invalidRemoteCandidate(error);
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
