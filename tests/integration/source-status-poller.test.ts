import { describe, expect, it } from "vitest";

import {
  evaluateSourceFreshness,
  type SourceStatusSnapshot,
} from "../../src/domain/release/source-freshness";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ACTIVE_SOURCE_STATUS_POINTER_KEY } from "../../src/release/source-status-publication";
import {
  SourceStatusPublisher,
  sourceStatusSnapshot,
} from "../../src/release/source-status-publication";
import { SourceStatusPoller } from "../../src/runtime/source-status-poller";

const FALLBACK: SourceStatusSnapshot = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status:fallback",
  checkedAt: "2026-03-01T00:00:00Z",
  servedBaciRelease: "V202601",
  latestKnownBaciRelease: "V202601",
  newerReleaseDetectedAt: null,
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2026-03-01T00:00:00Z",
};

describe("runtime Source Freshness Status poller", () => {
  it("adopts a verified compatible snapshot and uses 55-60 second jitter", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new SourceStatusPublisher(objectStore).publish({
      checkedAt: "2026-03-02T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });
    const accepted: SourceStatusSnapshot[] = [];
    const poller = new SourceStatusPoller({
      objectStore,
      servedBaciRelease: "V202601",
      fallback: FALLBACK,
      accept: (snapshot) => accepted.push(snapshot),
      now: () => "2026-03-02T00:00:01Z",
      random: () => 0.5,
    });

    await expect(poller.pollOnce()).resolves.toBe("updated");

    expect(accepted).toEqual([sourceStatusSnapshot(published)]);
    expect(poller.nextDelayMs()).toBe(57_500);
    expect(poller.diagnostics()).toEqual({
      currentSourceStatusSnapshotId: published.sourceStatusSnapshotId,
      consecutiveFailures: 0,
      totalFailures: 0,
      lastAttemptAt: "2026-03-02T00:00:01Z",
      lastSuccessfulPollAt: "2026-03-02T00:00:01Z",
      warningActive: false,
      alert: { level: "none", reason: null },
    });
  });

  it("polls immediately and observes the next pointer within one elapsed-adjusted interval", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const statuses = new SourceStatusPublisher(objectStore);
    const first = await statuses.publish({
      checkedAt: "2026-03-02T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });
    const accepted: SourceStatusSnapshot[] = [];
    const scheduled: {
      callback: () => void;
      delayMs: number;
    }[] = [];
    let monotonicNow = 0;
    let now = "2026-03-02T00:00:01Z";
    const poller = new SourceStatusPoller({
      objectStore: {
        async getObject(key) {
          const object = await objectStore.getObject(key);
          if (key === ACTIVE_SOURCE_STATUS_POINTER_KEY) {
            monotonicNow += 4_000;
          }
          return object;
        },
      },
      servedBaciRelease: "V202601",
      fallback: FALLBACK,
      accept: (snapshot) => accepted.push(snapshot),
      now: () => now,
      monotonicNow: () => monotonicNow,
      random: () => 0.5,
      timer: {
        schedule(callback, delayMs) {
          scheduled.push({ callback, delayMs });
          return callback;
        },
        cancel() {},
      },
    });

    poller.start();
    await expect.poll(() => scheduled.length).toBe(1);
    expect(accepted).toEqual([sourceStatusSnapshot(first)]);
    expect(scheduled[0]?.delayMs).toBe(53_500);

    const second = await statuses.publish({
      checkedAt: "2026-03-02T00:01:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202701",
      newerReleaseDetectedAt: "2026-03-02T00:01:00Z",
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:01:00Z",
    });
    now = "2026-03-02T00:01:01Z";
    scheduled.shift()?.callback();
    await expect.poll(() => accepted.length).toBe(2);
    expect(accepted[1]).toEqual(sourceStatusSnapshot(second));
    poller.stop();
  });

  it("warns after three pointer failures and resolves after a successful poll", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const events: unknown[] = [];
    const poller = new SourceStatusPoller({
      objectStore,
      servedBaciRelease: "V202601",
      fallback: FALLBACK,
      accept: () => undefined,
      now: () => "2026-03-02T00:00:01Z",
      observe: (event) => events.push(event),
    });

    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();

    expect(poller.diagnostics()).toMatchObject({
      consecutiveFailures: 3,
      totalFailures: 3,
      warningActive: true,
      alert: {
        level: "warn",
        reason: "status-pointer-poll-failures",
      },
    });
    expect(events).toContainEqual({
      type: "freshness-alert-changed",
      observedAt: "2026-03-02T00:00:01Z",
      previous: { level: "none", reason: null },
      current: {
        level: "warn",
        reason: "status-pointer-poll-failures",
      },
    });

    await new SourceStatusPublisher(objectStore).publish({
      checkedAt: "2026-03-02T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });
    await poller.pollOnce();

    expect(poller.diagnostics()).toMatchObject({
      consecutiveFailures: 0,
      warningActive: false,
      alert: { level: "none", reason: null },
    });
    expect(events.at(-1)).toEqual({
      type: "freshness-alert-changed",
      observedAt: "2026-03-02T00:00:01Z",
      previous: {
        level: "warn",
        reason: "status-pointer-poll-failures",
      },
      current: { level: "none", reason: null },
    });
  });

  it("keeps the last validated snapshot through a mid-run outage and lets it age overdue", async () => {
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new SourceStatusPublisher(objectStore).publish({
      checkedAt: "2026-03-02T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });
    let unavailable = false;
    let now = "2026-03-02T00:00:01Z";
    let active = FALLBACK;
    const poller = new SourceStatusPoller({
      objectStore: {
        getObject(key) {
          return unavailable
            ? Promise.reject(new Error("object storage unavailable"))
            : objectStore.getObject(key);
        },
      },
      servedBaciRelease: "V202601",
      fallback: FALLBACK,
      accept: (snapshot) => {
        active = snapshot;
      },
      now: () => now,
    });
    await poller.pollOnce();
    expect(active.sourceStatusSnapshotId).toBe(
      published.sourceStatusSnapshotId,
    );

    unavailable = true;
    now = "2026-03-16T00:00:00Z";
    await expect(poller.pollOnce()).resolves.toBe("failed");

    expect(active.sourceStatusSnapshotId).toBe(
      published.sourceStatusSnapshotId,
    );
    expect(evaluateSourceFreshness(active, now).state).toBe(
      "CHECK_OVERDUE",
    );
    expect(poller.diagnostics()).toMatchObject({
      consecutiveFailures: 1,
      totalFailures: 1,
      alert: { level: "page", reason: "source-check-overdue" },
    });
  });
});
