import { createHash } from "node:crypto";

import {
  publicDeploymentActivation,
  type DeploymentActivation,
  type PublicDeploymentActivation,
} from "./deployment-activation";
import type { SourceFreshnessState } from "./source-freshness-states";

export {
  SOURCE_FRESHNESS_STATES,
  type SourceFreshnessState,
} from "./source-freshness-states";

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
  // Deployment Activation Mode is reported with Source Freshness Status so
  // fallback is truthful. It is excluded from freshnessStatusId because a
  // control-plane outage never changes source-release freshness identity or
  // pinned analytical values.
  deploymentActivation: PublicDeploymentActivation;
};

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function evaluateSourceFreshness(
  snapshot: SourceStatusSnapshot,
  asOf: string,
  activation: DeploymentActivation = { mode: "CURRENT" },
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
  const resolution: {
    state: SourceFreshnessState;
    effectiveAt: string;
  } = explicitDelay
    ? {
        state: "REFRESH_DELAYED",
        effectiveAt: snapshot.publishedAt,
      }
    : refreshDueAt !== null && asOfInstant >= refreshDueAt
      ? {
          state: "REFRESH_DELAYED",
          effectiveAt: toPublicInstant(refreshDueAt),
        }
      : newerReleaseDetectedAt !== null
        ? {
            state: "UPDATE_IN_PROGRESS",
            effectiveAt: toPublicInstant(newerReleaseDetectedAt),
          }
        : asOfInstant >= checkOverdueAt
          ? {
              state: "CHECK_OVERDUE",
              effectiveAt: toPublicInstant(checkOverdueAt),
            }
          : {
              state: "LATEST_KNOWN",
              effectiveAt: snapshot.publishedAt,
            };
  const { state, effectiveAt } = resolution;
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
    deploymentActivation: publicDeploymentActivation(activation),
  };
}

export function nextSourceFreshnessTransitionAt(
  freshness: EffectiveSourceFreshness,
): string | null {
  const transitionByState: Record<SourceFreshnessState, string | null> = {
    LATEST_KNOWN: freshness.checkOverdueAt,
    UPDATE_IN_PROGRESS: freshness.refreshDueAt,
    REFRESH_DELAYED: null,
    CHECK_OVERDUE: null,
  };
  return transitionByState[freshness.state];
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
