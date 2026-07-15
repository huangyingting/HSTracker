import { describe, expect, it } from "vitest";

import {
  evaluateSourceFreshness,
  type SourceStatusSnapshot,
} from "../../src/domain/release/source-freshness";

const checkOverdueSnapshot: SourceStatusSnapshot = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status:fixture-check-overdue",
  checkedAt: "2026-03-01T00:00:00Z",
  servedBaciRelease: "V202601",
  latestKnownBaciRelease: "V202601",
  newerReleaseDetectedAt: null,
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2026-03-01T00:00:00Z",
};

const refreshDueSnapshot: SourceStatusSnapshot = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status:fixture-refresh-due",
  checkedAt: "2027-03-01T00:00:00Z",
  servedBaciRelease: "V202601",
  latestKnownBaciRelease: "V202701",
  newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2027-03-02T12:00:00Z",
};

describe("Source Freshness Status", () => {
  it.each([
    ["2026-03-14T23:59:59Z", "LATEST_KNOWN", "2026-03-01T00:00:00Z"],
    ["2026-03-15T00:00:00Z", "CHECK_OVERDUE", "2026-03-15T00:00:00Z"],
    ["2026-03-15T00:00:01Z", "CHECK_OVERDUE", "2026-03-15T00:00:00Z"],
  ] as const)(
    "evaluates the exact 14-day boundary at %s",
    (asOf, expectedState, expectedEffectiveAt) => {
      const status = evaluateSourceFreshness(checkOverdueSnapshot, asOf);

      expect(status).toMatchObject({
        sourceStatusSnapshotId: "source-status:fixture-check-overdue",
        checkedAt: "2026-03-01T00:00:00Z",
        checkOverdueAt: "2026-03-15T00:00:00Z",
        servedBaciRelease: "V202601",
        latestKnownBaciRelease: "V202601",
        newerReleaseDetectedAt: null,
        refreshDueAt: null,
        state: expectedState,
        effectiveAt: expectedEffectiveAt,
        deploymentActivation: {
          mode: "CURRENT",
          fallbackReason: null,
        },
      });
      expect(status.freshnessStatusId).toMatch(
        /^freshness:source-status:fixture-check-overdue:(?:LATEST_KNOWN|CHECK_OVERDUE):[^:]+:[a-f0-9]{64}$/,
      );
    },
  );

  it.each([
    ["2027-03-09T11:59:59Z", "UPDATE_IN_PROGRESS", "2027-03-02T12:00:00Z"],
    ["2027-03-09T12:00:00Z", "REFRESH_DELAYED", "2027-03-09T12:00:00Z"],
    ["2027-03-09T12:00:01Z", "REFRESH_DELAYED", "2027-03-09T12:00:00Z"],
  ] as const)(
    "evaluates the exact seven-day refresh boundary at %s",
    (asOf, expectedState, expectedEffectiveAt) => {
      const status = evaluateSourceFreshness(refreshDueSnapshot, asOf);

      expect(status).toMatchObject({
        checkOverdueAt: "2027-03-15T00:00:00Z",
        refreshDueAt: "2027-03-09T12:00:00Z",
        state: expectedState,
        effectiveAt: expectedEffectiveAt,
      });
    },
  );

  it("keeps a deadline transition ID stable after the transition", () => {
    const atDeadline = evaluateSourceFreshness(
      refreshDueSnapshot,
      "2027-03-09T12:00:00Z",
    );
    const afterDeadline = evaluateSourceFreshness(
      refreshDueSnapshot,
      "2027-03-10T12:00:00Z",
    );

    expect(afterDeadline.freshnessStatusId).toBe(atDeadline.freshnessStatusId);
  });

  it("reports resident fallback without changing Source Freshness Status identity", () => {
    const current = evaluateSourceFreshness(
      checkOverdueSnapshot,
      "2026-03-14T00:00:00Z",
    );
    const fallback = evaluateSourceFreshness(
      checkOverdueSnapshot,
      "2026-03-14T00:00:00Z",
      {
        mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
        reason: "OBJECT_STORE_UNAVAILABLE",
      },
    );

    expect(fallback.freshnessStatusId).toBe(current.freshnessStatusId);
    expect(fallback.deploymentActivation).toEqual({
      mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
      fallbackReason: "OBJECT_STORE_UNAVAILABLE",
    });
  });

  it.each([
    [{ refreshFailed: true, rollbackActive: false }, "REFRESH_DELAYED"],
    [{ refreshFailed: false, rollbackActive: true }, "REFRESH_DELAYED"],
    [{ refreshFailed: false, rollbackActive: false }, "UPDATE_IN_PROGRESS"],
  ] as const)(
    "applies refresh and rollback precedence for %o",
    (override, expectedState) => {
      const status = evaluateSourceFreshness(
        {
          ...refreshDueSnapshot,
          ...override,
          newerReleaseDetectedAt: "2027-03-14T12:00:00Z",
          publishedAt: "2027-03-14T12:00:00Z",
        },
        "2027-03-16T00:00:00Z",
      );

      expect(status.state).toBe(expectedState);
    },
  );

  it("keeps update-in-progress above an otherwise overdue source check", () => {
    const status = evaluateSourceFreshness(
      {
        ...checkOverdueSnapshot,
        latestKnownBaciRelease: "V202701",
        newerReleaseDetectedAt: "2026-03-16T00:00:00Z",
        publishedAt: "2026-03-16T00:00:00Z",
      },
      "2026-03-17T00:00:00Z",
    );

    expect(status).toMatchObject({
      checkOverdueAt: "2026-03-15T00:00:00Z",
      refreshDueAt: "2026-03-23T00:00:00Z",
      state: "UPDATE_IN_PROGRESS",
    });
  });
});
