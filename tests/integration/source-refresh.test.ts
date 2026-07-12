import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleaseHydrator } from "../../src/release/release-hydration";
import { ReleasePublisher } from "../../src/release/release-publication";
import { SourceRefreshOrchestrator } from "../../src/release/source-refresh";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
import { writeAcceptedReleaseCandidate } from "../fixtures/release-candidate";

describe("source refresh orchestration", () => {
  it("builds and atomically promotes a detected release before clearing its warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-refresh-"));
    const initialCandidate = await writeAcceptedReleaseCandidate(
      join(root, "initial"),
      {
        baciRelease: "V202601",
      },
    );
    const refreshedCandidate = await writeAcceptedReleaseCandidate(
      join(root, "refreshed"),
      {
        baciRelease: "V202701",
        sourceSha256: "b".repeat(64),
        sourceUpdateDate: "2027-01-22",
        builtAt: "2027-03-03T00:00:00Z",
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-4444444444444444",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const deployments = new ReleasePublisher(objectStore);
    const initial = await deployments.promote({
      ...initialCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: initial.baciRelease,
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-02T12:00:00Z",
    });
    const build = vi.fn(async () => refreshedCandidate);
    const orchestrator = new SourceRefreshOrchestrator({
      deployments,
      statuses,
    });

    const result = await orchestrator.refresh({
      baciRelease: "V202701",
      activatedAt: "2027-03-03T01:00:00Z",
      build,
    });

    expect(build).toHaveBeenCalledWith({
      baciRelease: "V202701",
      signal: undefined,
    });
    expect(result.deployment).toMatchObject({
      baciRelease: "V202701",
      previousDeploymentPairingId: initial.deploymentPairingId,
    });
    expect(result.status).toMatchObject({
      servedBaciRelease: "V202701",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      state: "LATEST_KNOWN",
    });
    await expect(deployments.current()).resolves.toEqual(
      result.deployment,
    );
    const hydrated = await new ReleaseHydrator(objectStore).hydrateCurrent({
      volumePath: join(root, "volume"),
    });
    expect(
      hydrated.deploymentManifest.sourceStatusFallback,
    ).toMatchObject({
      sourceStatusSnapshotId: result.status.sourceStatusSnapshotId,
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: "V202701",
      latestKnownBaciRelease: "V202701",
      publishedAt: "2027-03-03T01:00:00Z",
    });
  });

  it("keeps the accepted deployment and publishes delayed status on a private build failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-refresh-"));
    const initialCandidate = await writeAcceptedReleaseCandidate(
      join(root, "initial"),
      { baciRelease: "V202601" },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const deployments = new ReleasePublisher(objectStore);
    const initial = await deployments.promote({
      ...initialCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: initial.baciRelease,
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-02T12:00:00Z",
    });
    const privateFailure = new Error(
      "validation failed in /private/workspace/source.zip",
    );
    const diagnostics: unknown[] = [];
    const orchestrator = new SourceRefreshOrchestrator({
      deployments,
      statuses,
      observe: (event) => diagnostics.push(event),
    });

    await expect(
      orchestrator.refresh({
        baciRelease: "V202701",
        activatedAt: "2027-03-03T01:00:00Z",
        build: async () => {
          throw privateFailure;
        },
      }),
    ).rejects.toMatchObject({
      name: "SourceRefreshError",
      code: "REFRESH_FAILED",
      message: "BACI release refresh failed.",
    });

    await expect(deployments.current()).resolves.toEqual(initial);
    const status = await statuses.current();
    expect(status).toMatchObject({
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: true,
      rollbackActive: false,
      state: "REFRESH_DELAYED",
    });
    expect(JSON.stringify(status)).not.toContain("private/workspace");
    expect(diagnostics).toEqual([
      {
        type: "refresh-failed",
        baciRelease: "V202701",
        failedAt: "2027-03-03T01:00:00Z",
        error: privateFailure,
      },
    ]);
  });

  it("rejects a build for the wrong BACI release before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-refresh-"));
    const initialCandidate = await writeAcceptedReleaseCandidate(
      join(root, "initial"),
      { baciRelease: "V202601" },
    );
    const wrongCandidate = await writeAcceptedReleaseCandidate(
      join(root, "wrong"),
      {
        baciRelease: "V202801",
        sourceSha256: "c".repeat(64),
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-5555555555555555",
        productSearchBuildId: "product-search-v1-5555555555555555",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const deployments = new ReleasePublisher(objectStore);
    const initial = await deployments.promote({
      ...initialCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-02T12:00:00Z",
    });
    const orchestrator = new SourceRefreshOrchestrator({
      deployments,
      statuses,
    });

    await expect(
      orchestrator.refresh({
        baciRelease: "V202701",
        activatedAt: "2027-03-03T01:00:00Z",
        build: async () => wrongCandidate,
      }),
    ).rejects.toMatchObject({
      name: "SourceRefreshError",
      code: "REFRESH_FAILED",
    });

    await expect(deployments.current()).resolves.toEqual(initial);
    await expect(statuses.current()).resolves.toMatchObject({
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      refreshFailed: true,
      state: "REFRESH_DELAYED",
    });
  });

  it("preserves a newer successful source check that lands while the build runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-refresh-"));
    const initialCandidate = await writeAcceptedReleaseCandidate(
      join(root, "initial"),
      { baciRelease: "V202601" },
    );
    const refreshedCandidate = await writeAcceptedReleaseCandidate(
      join(root, "refreshed"),
      {
        baciRelease: "V202701",
        sourceSha256: "b".repeat(64),
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-4444444444444444",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const deployments = new ReleasePublisher(objectStore);
    await deployments.promote({
      ...initialCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-02T12:00:00Z",
    });
    let finishBuild!: (
      candidate: typeof refreshedCandidate,
    ) => void;
    let markBuildStarted!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      markBuildStarted = resolve;
    });
    const buildFinished = new Promise<typeof refreshedCandidate>(
      (resolve) => {
        finishBuild = resolve;
      },
    );
    const orchestrator = new SourceRefreshOrchestrator({
      deployments,
      statuses,
    });

    const refreshing = orchestrator.refresh({
      baciRelease: "V202701",
      activatedAt: "2027-03-04T01:00:00Z",
      build: async () => {
        markBuildStarted();
        return buildFinished;
      },
    });
    await buildStarted;
    await statuses.publish({
      checkedAt: "2027-03-03T12:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-03T12:00:00Z",
    });
    finishBuild(refreshedCandidate);

    await expect(refreshing).resolves.toMatchObject({
      status: {
        checkedAt: "2027-03-03T12:00:00Z",
        servedBaciRelease: "V202701",
        latestKnownBaciRelease: "V202701",
      },
    });
  });

  it("rolls back through the atomic pairing path and immediately marks freshness delayed", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-refresh-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
      { baciRelease: "V202601" },
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        baciRelease: "V202701",
        sourceSha256: "b".repeat(64),
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-4444444444444444",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const deployments = new ReleasePublisher(objectStore);
    const first = await deployments.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const second = await deployments.promote({
      ...secondCandidate,
      activatedAt: "2027-03-03T01:00:00Z",
    });
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-03T01:00:00Z",
      servedBaciRelease: second.baciRelease,
      latestKnownBaciRelease: second.baciRelease,
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-03T01:00:00Z",
    });
    const orchestrator = new SourceRefreshOrchestrator({
      deployments,
      statuses,
    });

    const rolledBack = await orchestrator.rollback({
      activatedAt: "2027-03-03T02:00:00Z",
    });

    expect(rolledBack.deployment).toMatchObject({
      deploymentPairingId: first.deploymentPairingId,
      previousDeploymentPairingId: second.deploymentPairingId,
    });
    expect(rolledBack.status).toMatchObject({
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-03T02:00:00Z",
      refreshFailed: false,
      rollbackActive: true,
      state: "REFRESH_DELAYED",
    });
    await expect(deployments.current()).resolves.toEqual(
      rolledBack.deployment,
    );
  });
});
