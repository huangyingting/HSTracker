import { createHash } from "node:crypto";

export const SOURCE_FRESHNESS_STATES = [
  "LATEST_KNOWN",
  "UPDATE_IN_PROGRESS",
  "REFRESH_DELAYED",
  "CHECK_OVERDUE",
] as const;

export type SourceFreshnessState = (typeof SOURCE_FRESHNESS_STATES)[number];

export type SourceStatusSnapshot = {
  schemaVersion: "source-status-v1";
  sourceStatusSnapshotId: string;
  checkedAt: string;
  servedBaciRelease: string;
  latestKnownBaciRelease: string;
  newerReleaseDetectedAt: string | null;
  refreshFailed: boolean;
  rollbackActive: boolean;
  publishedAt: string;
};

export type EffectiveSourceFreshness = {
  sourceStatusSnapshotId: string;
  freshnessStatusId: string;
  checkedAt: string;
  checkOverdueAt: string;
  servedBaciRelease: string;
  latestKnownBaciRelease: string;
  newerReleaseDetectedAt: string | null;
  refreshDueAt: string | null;
  state: SourceFreshnessState;
  effectiveAt: string;
};

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function evaluateSourceFreshness(
  snapshot: SourceStatusSnapshot,
  asOf: string,
): EffectiveSourceFreshness {
  const checkedAt = parseUtcInstant(snapshot.checkedAt);
  const checkOverdueAt = new Date(checkedAt.getTime() + 14 * DAY_MILLISECONDS);
  const asOfInstant = parseUtcInstant(asOf);
  const newerReleaseDetectedAt =
    snapshot.newerReleaseDetectedAt === null
      ? null
      : parseUtcInstant(snapshot.newerReleaseDetectedAt);
  const refreshDueAt =
    newerReleaseDetectedAt === null
      ? null
      : new Date(newerReleaseDetectedAt.getTime() + 7 * DAY_MILLISECONDS);
  const explicitDelay = snapshot.refreshFailed || snapshot.rollbackActive;
  const state: SourceFreshnessState = explicitDelay
    ? "REFRESH_DELAYED"
    : refreshDueAt !== null && asOfInstant >= refreshDueAt
      ? "REFRESH_DELAYED"
      : newerReleaseDetectedAt !== null
        ? "UPDATE_IN_PROGRESS"
        : asOfInstant >= checkOverdueAt
          ? "CHECK_OVERDUE"
          : "LATEST_KNOWN";
  const effectiveAt = explicitDelay
    ? snapshot.publishedAt
    : state === "REFRESH_DELAYED"
      ? toPublicInstant(refreshDueAt!)
      : state === "UPDATE_IN_PROGRESS"
        ? snapshot.newerReleaseDetectedAt!
        : state === "CHECK_OVERDUE"
          ? toPublicInstant(checkOverdueAt)
          : snapshot.publishedAt;
  const publicFields = {
    sourceStatusSnapshotId: snapshot.sourceStatusSnapshotId,
    checkedAt: snapshot.checkedAt,
    checkOverdueAt: toPublicInstant(checkOverdueAt),
    servedBaciRelease: snapshot.servedBaciRelease,
    latestKnownBaciRelease: snapshot.latestKnownBaciRelease,
    newerReleaseDetectedAt: snapshot.newerReleaseDetectedAt,
    refreshDueAt: refreshDueAt === null ? null : toPublicInstant(refreshDueAt),
    state,
    effectiveAt,
  } as const;
  const digest = createHash("sha256")
    .update(JSON.stringify(publicFields))
    .digest("hex");

  return {
    ...publicFields,
    freshnessStatusId: [
      "freshness",
      snapshot.sourceStatusSnapshotId,
      state,
      encodeURIComponent(effectiveAt),
      digest,
    ].join(":"),
  };
}

export function nextSourceFreshnessTransitionAt(
  freshness: EffectiveSourceFreshness,
): string | null {
  if (freshness.state === "LATEST_KNOWN") {
    return freshness.checkOverdueAt;
  }
  if (freshness.state === "UPDATE_IN_PROGRESS") {
    return freshness.refreshDueAt;
  }
  return null;
}

function parseUtcInstant(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) {
    throw new TypeError(
      `Expected a whole-second UTC instant, received ${value}.`,
    );
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Expected a valid UTC instant, received ${value}.`);
  }
  return instant;
}

function toPublicInstant(instant: Date): string {
  return instant.toISOString().replace(".000Z", "Z");
}
