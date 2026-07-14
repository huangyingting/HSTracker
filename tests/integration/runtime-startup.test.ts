import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  contentAddressedId,
  releaseJsonBytes,
} from "../../src/release/release-manifest";
import {
  releaseObjectIdentity,
  singleChunk,
  type ReleaseObject,
} from "../../src/release/release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
import { getApplicationRuntime } from "../../src/runtime/application-runtime";
import { startApplicationRuntime } from "../../src/runtime/runtime-startup";
import { writeRuntimeReleaseCandidate } from "../support/runtime-release";

const temporaryDirectories: string[] = [];
const stops: (() => void)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) {
    stop();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Next.js runtime startup", () => {
  it("installs bounded execution in fixture mode", async () => {
    const started = await startApplicationRuntime({
      environment: {
        NODE_ENV: "test",
        HS_TRACKER_RUNTIME_MODE: "fixture",
      },
    });
    stops.push(started.stop);
    const query = {
      recipe: "candidate-market-v1" as const,
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    };

    const first = await started.runtime.tradeAnalytics.execute(query);
    const second = await started.runtime.tradeAnalytics.execute(query);

    expect(second).toBe(first);
  });

  it("installs the release runtime only after hydration and smoke validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-startup-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const started = await startApplicationRuntime({
      environment: {
        NODE_ENV: "production",
        APP_BUILD_ID: "runtime-test-build",
        HS_TRACKER_RUNTIME_MODE: "release",
        HS_TRACKER_RELEASE_VOLUME_PATH: join(root, "volume"),
      },
      objectStore,
      now: () => "2026-07-12T02:00:00Z",
    });
    stops.push(started.stop);

    expect(getApplicationRuntime().currentAnalysis()).toMatchObject({
      analysisBuildId: published.analysisBuildId,
      productSearchBuildId: published.productSearchBuildId,
      source: { baciRelease: published.baciRelease },
    });
    await expect
      .poll(
        () =>
          (
            started.runtime.health("runtime-test-build") as {
              freshness: {
                polling: { consecutiveFailures: number };
              };
            }
          ).freshness.polling.consecutiveFailures,
      )
      .toBe(1);
    expect(started.runtime.health("runtime-test-build")).toMatchObject({
      status: "ok",
      readiness: "ready",
      freshness: {
        degraded: true,
        polling: { consecutiveFailures: 1 },
      },
    });
  }, 20_000);

  it("serves the embedded fallback before adopting a polled status snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-startup-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    const retainedStatus = await statuses.publish({
      checkedAt: "2026-07-12T02:00:30Z",
      servedBaciRelease: published.baciRelease,
      latestKnownBaciRelease: published.baciRelease,
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-07-12T02:00:30Z",
    });
    const status = await statuses.publish({
      checkedAt: "2026-07-12T02:01:00Z",
      servedBaciRelease: published.baciRelease,
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2026-07-12T02:01:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-07-12T02:01:00Z",
    });

    const started = await startApplicationRuntime({
      environment: {
        NODE_ENV: "production",
        APP_BUILD_ID: "runtime-test-build",
        HS_TRACKER_RUNTIME_MODE: "release",
        HS_TRACKER_RELEASE_VOLUME_PATH: join(root, "volume"),
      },
      objectStore,
      now: () => "2026-07-12T02:02:00Z",
    });
    stops.push(started.stop);
    const startupSnapshotId =
      started.runtime.currentAnalysis().freshness.sourceStatusSnapshotId;

    expect(startupSnapshotId).not.toBe(status.sourceStatusSnapshotId);
    await expect
      .poll(
        () =>
          started.runtime.currentAnalysis().freshness
            .sourceStatusSnapshotId,
      )
      .toBe(status.sourceStatusSnapshotId);
    expect(started.runtime.health("runtime-test-build")).toMatchObject({
      status: "ok",
      readiness: "ready",
      freshness: {
        sourceStatusSnapshotId: status.sourceStatusSnapshotId,
        state: "UPDATE_IN_PROGRESS",
        degraded: true,
        polling: {
          currentSourceStatusSnapshotId:
            status.sourceStatusSnapshotId,
          consecutiveFailures: 0,
          totalFailures: 0,
          lastSuccessfulPollAt: "2026-07-12T02:02:00Z",
        },
      },
    });
    expect(
      started.runtime.resolveFreshnessStatus(
        retainedStatus.freshnessStatusId,
      ),
    ).toMatchObject({
      sourceStatusSnapshotId:
        retainedStatus.sourceStatusSnapshotId,
      freshnessStatusId: retainedStatus.freshnessStatusId,
      state: "LATEST_KNOWN",
    });
  }, 20_000);

  it("fails closed when release mode has no serving volume", async () => {
    await expect(
      startApplicationRuntime({
        environment: {
          NODE_ENV: "production",
          APP_BUILD_ID: "runtime-test-build",
          HS_TRACKER_RUNTIME_MODE: "release",
        },
        objectStore: new InMemoryReleaseObjectStore(),
      }),
    ).rejects.toMatchObject({
      name: "RuntimeStartupConfigurationError",
      code: "ENVIRONMENT_INVALID",
    });
  });

  it("fails closed when production has no application build identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-startup-"));
    temporaryDirectories.push(root);

    await expect(
      startApplicationRuntime({
        environment: {
          NODE_ENV: "production",
          HS_TRACKER_RUNTIME_MODE: "release",
          HS_TRACKER_RELEASE_VOLUME_PATH: join(root, "volume"),
        },
        objectStore: new InMemoryReleaseObjectStore(),
      }),
    ).rejects.toMatchObject({
      name: "RuntimeStartupConfigurationError",
      code: "ENVIRONMENT_INVALID",
      message: "APP_BUILD_ID is required.",
    });
  });

  it("fails closed when the serving volume path is not absolute", async () => {
    await expect(
      startApplicationRuntime({
        environment: {
          NODE_ENV: "production",
          HS_TRACKER_RUNTIME_MODE: "release",
          HS_TRACKER_RELEASE_VOLUME_PATH: "relative-volume",
        },
        objectStore: new InMemoryReleaseObjectStore(),
      }),
    ).rejects.toMatchObject({
      name: "RuntimeStartupConfigurationError",
      code: "ENVIRONMENT_INVALID",
      message: "HS_TRACKER_RELEASE_VOLUME_PATH must be an absolute path.",
    });
  });

  it("fails closed when write-scoped credentials reach the runtime", async () => {
    await expect(
      startApplicationRuntime({
        environment: {
          NODE_ENV: "production",
          HS_TRACKER_RUNTIME_MODE: "release",
          HS_TRACKER_RELEASE_VOLUME_PATH: "/data/releases",
          HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID: "must-not-be-present",
        },
        objectStore: new InMemoryReleaseObjectStore(),
      }),
    ).rejects.toMatchObject({
      name: "RuntimeStartupConfigurationError",
      code: "ENVIRONMENT_INVALID",
      message:
        "Write-scoped release credentials must not be available to the runtime.",
    });
  });

  it("leaves the process unready when a paired catalog manifest is incompatible", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-startup-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    await activateIncompatibleCatalogManifest(objectStore);
    const runtimeBeforeStartup = getApplicationRuntime();

    await expect(
      startApplicationRuntime({
        environment: {
          NODE_ENV: "production",
          APP_BUILD_ID: "runtime-test-build",
          HS_TRACKER_RUNTIME_MODE: "release",
          HS_TRACKER_RELEASE_VOLUME_PATH: join(root, "volume"),
        },
        objectStore,
        now: () => "2026-07-12T02:00:00Z",
      }),
    ).rejects.toThrow(
      "Hydrated product catalog does not match its deployment pairing.",
    );
    expect(getApplicationRuntime()).toBe(runtimeBeforeStartup);
  }, 20_000);

  it.each([
    {
      name: "BACI Release identity",
      mutate: (deployment: MutableDeploymentDocument) => {
        deployment.baciRelease = "V202501";
      },
      recomputePairingId: false,
      error: "Deployment pairing identities are incompatible.",
    },
    {
      name: "analysis build identity",
      mutate: (deployment: MutableDeploymentDocument) => {
        deployment.analysisBuildId =
          "analysis-build-v1-ffffffffffffffff";
      },
      recomputePairingId: false,
      error: "Deployment analysis build identity is inconsistent.",
    },
    {
      name: "deployment pairing identity",
      mutate: (deployment: MutableDeploymentDocument) => {
        deployment.deploymentPairingId =
          "deployment-pairing-v1-ffffffffffffffff";
      },
      recomputePairingId: false,
      error: "Deployment pairing identity is inconsistent.",
    },
    {
      name: "analysis release-catalog reference",
      mutate: (deployment: MutableDeploymentDocument) => {
        deployment.analysis.artifact.artifactBuildId =
          "candidate-market-artifact-v1-ffffffffffffffff";
      },
      recomputePairingId: true,
      error:
        "Deployment analysis artifact does not match its release catalog.",
    },
  ])(
    "leaves the process unready when the deployment has a tampered $name",
    async ({ mutate, recomputePairingId, error }) => {
      const root = await mkdtemp(join(tmpdir(), "hs-tracker-startup-"));
      temporaryDirectories.push(root);
      const candidate = await writeRuntimeReleaseCandidate(
        join(root, "candidate"),
      );
      const objectStore = new InMemoryReleaseObjectStore();
      await new ReleasePublisher(objectStore).promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      });
      await activateTamperedDeployment(
        objectStore,
        mutate,
        recomputePairingId,
      );
      const runtimeBeforeStartup = getApplicationRuntime();

      await expect(
        startApplicationRuntime({
          environment: {
            NODE_ENV: "production",
            APP_BUILD_ID: "runtime-test-build",
            HS_TRACKER_RUNTIME_MODE: "release",
            HS_TRACKER_RELEASE_VOLUME_PATH: join(root, "volume"),
          },
          objectStore,
          now: () => "2026-07-12T02:00:00Z",
        }),
      ).rejects.toThrow(error);
      expect(getApplicationRuntime()).toBe(runtimeBeforeStartup);
    },
    20_000,
  );
});

type MutableDeploymentDocument = {
  deploymentPairingId: string;
  baciRelease: string;
  analysisBuildId: string;
  analysis: {
    artifact: {
      artifactBuildId: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  productSearch: {
    manifest: { key: string; bytes: number; sha256: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

async function activateIncompatibleCatalogManifest(
  objectStore: InMemoryReleaseObjectStore,
): Promise<void> {
  const storedPointer = await requiredObject(
    objectStore.getObject(ACTIVE_DEPLOYMENT_POINTER_KEY),
  );
  const pointer = JSON.parse(
    (await collect(storedPointer)).toString("utf8"),
  ) as {
    current: { key: string; bytes: number; sha256: string };
  };
  const deployment = JSON.parse(
    (
      await collect(
        await requiredObject(
          objectStore.getObject(pointer.current.key),
        ),
      )
    ).toString("utf8"),
  ) as {
    deploymentPairingId: string;
    productSearch: {
      manifest: { key: string; bytes: number; sha256: string };
    };
    [key: string]: unknown;
  };
  const catalogManifest = JSON.parse(
    (
      await collect(
        await requiredObject(
          objectStore.getObject(
            deployment.productSearch.manifest.key,
          ),
        ),
      )
    ).toString("utf8"),
  ) as Record<string, unknown>;
  const incompatibleManifestBytes = releaseJsonBytes({
    ...catalogManifest,
    baciRelease: "V202501",
  });
  const incompatibleManifestIdentity = releaseObjectIdentity(
    incompatibleManifestBytes,
  );
  const incompatibleManifestKey =
    `test/incompatible-catalog-manifest/` +
    `${incompatibleManifestIdentity.sha256}.json`;
  await objectStore.putImmutable(
    incompatibleManifestKey,
    singleChunk(incompatibleManifestBytes),
    incompatibleManifestIdentity,
  );
  deployment.productSearch.manifest = {
    key: incompatibleManifestKey,
    ...incompatibleManifestIdentity,
  };
  const pairingIdentity = Object.fromEntries(
    Object.entries(deployment).filter(
      ([key]) => key !== "deploymentPairingId",
    ),
  );
  deployment.deploymentPairingId = contentAddressedId(
    "deployment-pairing-v1",
    pairingIdentity,
  );
  const deploymentBytes = releaseJsonBytes(deployment);
  const deploymentIdentity = releaseObjectIdentity(deploymentBytes);
  const deploymentKey =
    `deployment-pairings/${deployment.deploymentPairingId}.json`;
  await objectStore.putImmutable(
    deploymentKey,
    singleChunk(deploymentBytes),
    deploymentIdentity,
  );
  const pointerBytes = releaseJsonBytes({
    ...pointer,
    current: { key: deploymentKey, ...deploymentIdentity },
  });
  await objectStore.compareAndSwap(
    ACTIVE_DEPLOYMENT_POINTER_KEY,
    storedPointer.version,
    pointerBytes,
  );
}

async function activateTamperedDeployment(
  objectStore: InMemoryReleaseObjectStore,
  mutate: (deployment: MutableDeploymentDocument) => void,
  recomputePairingId: boolean,
): Promise<void> {
  const storedPointer = await requiredObject(
    objectStore.getObject(ACTIVE_DEPLOYMENT_POINTER_KEY),
  );
  const pointer = JSON.parse(
    (await collect(storedPointer)).toString("utf8"),
  ) as {
    current: { key: string; bytes: number; sha256: string };
    [key: string]: unknown;
  };
  const deployment = JSON.parse(
    (
      await collect(
        await requiredObject(
          objectStore.getObject(pointer.current.key),
        ),
      )
    ).toString("utf8"),
  ) as MutableDeploymentDocument;
  mutate(deployment);
  if (recomputePairingId) {
    const pairingIdentity = Object.fromEntries(
      Object.entries(deployment).filter(
        ([key]) => key !== "deploymentPairingId",
      ),
    );
    deployment.deploymentPairingId = contentAddressedId(
      "deployment-pairing-v1",
      pairingIdentity,
    );
  }
  const deploymentBytes = releaseJsonBytes(deployment);
  const deploymentIdentity = releaseObjectIdentity(deploymentBytes);
  const deploymentKey =
    `test/tampered-deployment/` +
    `${deploymentIdentity.sha256}.json`;
  await objectStore.putImmutable(
    deploymentKey,
    singleChunk(deploymentBytes),
    deploymentIdentity,
  );
  const pointerBytes = releaseJsonBytes({
    ...pointer,
    current: { key: deploymentKey, ...deploymentIdentity },
  });
  await objectStore.compareAndSwap(
    ACTIVE_DEPLOYMENT_POINTER_KEY,
    storedPointer.version,
    pointerBytes,
  );
}

async function requiredObject(
  value: Promise<ReleaseObject | null>,
): Promise<ReleaseObject>;
async function requiredObject(
  value: ReleaseObject | null,
): Promise<ReleaseObject>;
async function requiredObject(
  value: Promise<ReleaseObject | null> | ReleaseObject | null,
): Promise<ReleaseObject> {
  const resolved = await value;
  if (resolved === null) {
    throw new Error("Expected a stored release object.");
  }
  return resolved;
}

async function collect(stored: ReleaseObject): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stored.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
