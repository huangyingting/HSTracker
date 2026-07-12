import { describe, expect, it } from "vitest";

import type { SourceStatusSnapshot } from "../../src/domain/release/source-freshness";
import { sourceFreshnessAlert } from "../../src/runtime/source-status-poller";

const REFRESHING: SourceStatusSnapshot = {
  schemaVersion: "source-status-v1",
  sourceStatusSnapshotId: "source-status:refreshing",
  checkedAt: "2027-03-01T00:00:00Z",
  servedBaciRelease: "V202601",
  latestKnownBaciRelease: "V202701",
  newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
  refreshFailed: false,
  rollbackActive: false,
  publishedAt: "2027-03-02T12:00:00Z",
};

describe("Source Freshness Status operations alerts", () => {
  it.each([
    ["2027-03-03T11:59:59Z", "none", null],
    ["2027-03-03T12:00:00Z", "warn", "refresh-over-24-hours"],
    ["2027-03-04T11:59:59Z", "warn", "refresh-over-24-hours"],
    ["2027-03-04T12:00:00Z", "page", "refresh-over-48-hours"],
  ] as const)(
    "applies the refresh warning/page boundary at %s",
    (asOf, level, reason) => {
      expect(sourceFreshnessAlert(REFRESHING, asOf)).toEqual({
        level,
        reason,
      });
    },
  );

  it("pages immediately for a known refresh failure", () => {
    expect(
      sourceFreshnessAlert(
        { ...REFRESHING, refreshFailed: true },
        "2027-03-02T12:00:01Z",
      ),
    ).toEqual({ level: "page", reason: "refresh-failed" });
  });
});
