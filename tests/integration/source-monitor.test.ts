import { describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import {
  CepiiBaciReleaseSource,
  SourceMonitor,
  type BaciReleaseSource,
} from "../../src/release/source-monitor";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";

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
      source: fixedSource("V202601"),
      statuses,
    });

    const result = await monitor.check({
      servedBaciRelease: "V202601",
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
      source: fixedSource("V202701"),
      statuses,
    });

    const detected = await monitor.check({
      servedBaciRelease: "V202601",
      checkedAt: "2027-03-02T12:00:00Z",
    });
    const checkedAgain = await monitor.check({
      servedBaciRelease: "V202601",
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
        servedBaciRelease: "V202601",
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
