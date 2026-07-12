import { describe, expect, it } from "vitest";

import type { SourceStatusSnapshot } from "../../src/domain/release/source-freshness";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import {
  CepiiBaciReleaseSource,
  SourceMonitor,
  type BaciReleaseSource,
  type SourceMonitorDeployment,
} from "../../src/release/source-monitor";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";

const SOURCE_STATUS_FALLBACK = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status-v1-monitor-fallback",
  checkedAt: "2026-03-01T00:00:00Z",
  servedBaciRelease: "V202601",
  latestKnownBaciRelease: "V202601",
  newerReleaseDetectedAt: null,
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2026-03-01T00:00:00Z",
} satisfies SourceStatusSnapshot;

describe("CEPII source monitor", () => {
  it("publishes a new successful check when the served release is unchanged", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2026-03-01T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-01T00:00:00Z",
    });
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(),
      source: fixedSource("V202601"),
      statuses,
    });

    const result = await monitor.check({
      checkedAt: "2026-03-02T00:00:00Z",
    });

    expect(result.outcome).toBe("unchanged");
    expect(result.status).toMatchObject({
      schemaVersion: "source-status-snapshot-v1",
      sourceStatusSnapshotId: expect.stringMatching(
        /^source-status-v1-[a-f0-9]{16}$/u,
      ),
      checkedAt: "2026-03-02T00:00:00Z",
      checkOverdueAt: "2026-03-16T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshDueAt: null,
      state: "LATEST_KNOWN",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });
    await expect(statuses.current()).resolves.toEqual(result.status);
  });

  it("publishes update-in-progress once and preserves the detection time", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(),
      source: fixedSource("V202701"),
      statuses,
    });

    const detected = await monitor.check({
      checkedAt: "2027-03-02T12:00:00Z",
    });
    const checkedAgain = await monitor.check({
      checkedAt: "2027-03-03T12:00:00Z",
    });

    expect(detected.outcome).toBe("release-detected");
    expect(detected.status).toMatchObject({
      checkedAt: "2027-03-02T12:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshDueAt: "2027-03-09T12:00:00Z",
      state: "UPDATE_IN_PROGRESS",
    });
    expect(checkedAgain.status).toMatchObject({
      checkedAt: "2027-03-03T12:00:00Z",
      newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
      refreshDueAt: "2027-03-09T12:00:00Z",
      state: "UPDATE_IN_PROGRESS",
    });
  });

  it("preserves rollback status when the checked BACI Release is unchanged", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2026-03-01T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: true,
      publishedAt: "2026-03-01T00:00:00Z",
    });
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(),
      source: fixedSource("V202601"),
      statuses,
    });

    const result = await monitor.check({
      checkedAt: "2026-03-02T00:00:00Z",
    });

    expect(result.status).toMatchObject({
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: true,
      state: "REFRESH_DELAYED",
    });
  });

  it("preserves failure timing when a later BACI Release is detected", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-01T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-01T00:00:00Z",
      refreshFailed: true,
      rollbackActive: false,
      publishedAt: "2027-03-01T00:00:00Z",
    });
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(),
      source: fixedSource("V202801"),
      statuses,
    });

    const result = await monitor.check({
      checkedAt: "2027-03-02T00:00:00Z",
    });

    expect(result.status).toMatchObject({
      latestKnownBaciRelease: "V202801",
      newerReleaseDetectedAt: "2027-03-01T00:00:00Z",
      refreshDueAt: "2027-03-08T00:00:00Z",
      refreshFailed: true,
      rollbackActive: false,
      state: "REFRESH_DELAYED",
    });
  });

  it("uses the deployment fallback when the status pointer predates rollback", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-03T01:00:00Z",
      servedBaciRelease: "V202701",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-03T01:00:00Z",
    });
    const rollbackFallback = {
      schemaVersion: "source-status-v1",
      sourceStatusSnapshotId:
        "source-status-v1-rollback-fallback",
      checkedAt: "2027-03-03T01:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-03T02:00:00Z",
      refreshFailed: false,
      rollbackActive: true,
      publishedAt: "2027-03-03T02:00:00Z",
    } satisfies SourceStatusSnapshot;
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(rollbackFallback),
      source: fixedSource("V202701"),
      statuses,
    });

    const result = await monitor.check({
      checkedAt: "2027-03-03T03:00:00Z",
    });

    expect(result.status).toMatchObject({
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2027-03-03T02:00:00Z",
      rollbackActive: true,
      state: "REFRESH_DELAYED",
    });
  });

  it("publishes for the deployment and status active after the source request", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-03T01:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-03T01:00:00Z",
    });
    let activeDeployment: SourceMonitorDeployment = {
      deploymentPairingId: "deployment-pairing-v1-old",
      baciRelease: "V202601",
      sourceStatusFallback: SOURCE_STATUS_FALLBACK,
    };
    const promotedFallback = {
      ...SOURCE_STATUS_FALLBACK,
      sourceStatusSnapshotId: "source-status-v1-promoted-fallback",
      checkedAt: "2027-03-03T02:00:00Z",
      servedBaciRelease: "V202701",
      latestKnownBaciRelease: "V202701",
      publishedAt: "2027-03-03T02:00:00Z",
    } satisfies SourceStatusSnapshot;
    const monitor = new SourceMonitor({
      deployments: {
        async current() {
          return activeDeployment;
        },
      },
      source: {
        async latestHs12Release() {
          activeDeployment = {
            deploymentPairingId: "deployment-pairing-v1-new",
            baciRelease: "V202701",
            sourceStatusFallback: promotedFallback,
          };
          await statuses.publish({
            checkedAt: "2027-03-03T02:00:00Z",
            servedBaciRelease: "V202701",
            latestKnownBaciRelease: "V202701",
            newerReleaseDetectedAt: null,
            refreshFailed: false,
            rollbackActive: false,
            publishedAt: "2027-03-03T02:00:00Z",
          });
          return {
            baciRelease: "V202701",
            sourceUrl:
              "https://www.cepii.fr/DATA_DOWNLOAD/baci/data/" +
              "BACI_HS12_V202701.zip",
          };
        },
      },
      statuses,
    });

    const result = await monitor.check({
      checkedAt: "2027-03-03T03:00:00Z",
    });

    expect(result).toMatchObject({
      outcome: "unchanged",
      status: {
        servedBaciRelease: "V202701",
        latestKnownBaciRelease: "V202701",
        newerReleaseDetectedAt: null,
        state: "LATEST_KNOWN",
      },
    });
  });

  it("does not overwrite a status committed while deployment state is read", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    await statuses.publish({
      checkedAt: "2027-03-03T01:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2027-03-03T01:00:00Z",
    });
    const monitor = new SourceMonitor({
      deployments: {
        async current() {
          await statuses.publish({
            checkedAt: "2027-03-03T02:00:00Z",
            servedBaciRelease: "V202601",
            latestKnownBaciRelease: "V202601",
            newerReleaseDetectedAt: null,
            refreshFailed: true,
            rollbackActive: false,
            publishedAt: "2027-03-03T02:00:00Z",
          });
          return {
            deploymentPairingId: "deployment-pairing-v1-current",
            baciRelease: "V202601",
            sourceStatusFallback: SOURCE_STATUS_FALLBACK,
          };
        },
      },
      source: fixedSource("V202601"),
      statuses,
    });

    await expect(
      monitor.check({
        checkedAt: "2027-03-03T03:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "SourceMonitorError",
      code: "SOURCE_CHECK_FAILED",
    });
    await expect(statuses.current()).resolves.toMatchObject({
      refreshFailed: true,
      publishedAt: "2027-03-03T02:00:00Z",
    });
  });

  it("keeps the last accepted status and reports private diagnostics when a check fails", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    const accepted = await statuses.publish({
      checkedAt: "2026-03-01T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-01T00:00:00Z",
    });
    const privateFailure = new Error(
      "GET https://private-proxy.invalid failed with credential abc",
    );
    const diagnostics: unknown[] = [];
    const monitor = new SourceMonitor({
      deployments: fixedDeployment(),
      source: {
        async latestHs12Release() {
          throw privateFailure;
        },
      },
      statuses,
      observe: (event) => diagnostics.push(event),
    });

    await expect(
      monitor.check({
        checkedAt: "2026-03-02T00:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "SourceMonitorError",
      code: "SOURCE_CHECK_FAILED",
      message: "CEPII source check failed.",
    });
    await expect(statuses.current()).resolves.toEqual(accepted);
    expect(diagnostics).toEqual([
      {
        type: "source-check-failed",
        checkedAt: "2026-03-02T00:00:00Z",
        error: privateFailure,
      },
    ]);
  });

  it("detects the newest HS12 archive from CEPII documentation", async () => {
    const source = new CepiiBaciReleaseSource({
      fetch: async () =>
        new Response(
          [
            '<a href="../data/BACI_HS12_V202601.zip">current</a>',
            '<a href="../data/BACI_HS17_V202701.zip">other edition</a>',
            '<a href="../data/BACI_HS12_V202701.zip">new release</a>',
          ].join("\n"),
          { status: 200 },
        ),
    });

    await expect(source.latestHs12Release()).resolves.toEqual({
      baciRelease: "V202701",
      sourceUrl:
        "https://www.cepii.fr/DATA_DOWNLOAD/baci/data/" +
        "BACI_HS12_V202701.zip",
    });
  });
});

function fixedSource(baciRelease: string): BaciReleaseSource {
  return {
    async latestHs12Release() {
      return {
        baciRelease,
        sourceUrl:
          `https://www.cepii.fr/DATA_DOWNLOAD/baci/data/` +
          `BACI_HS12_${baciRelease}.zip`,
      };
    },
  };
}

function fixedDeployment(
  sourceStatusFallback: SourceStatusSnapshot =
    SOURCE_STATUS_FALLBACK,
) {
  return {
    async current() {
      return {
        deploymentPairingId: "deployment-pairing-v1-current",
        baciRelease: sourceStatusFallback.servedBaciRelease,
        sourceStatusFallback,
      };
    },
  };
}
