import { createHash } from "node:crypto";

import type {
  RecentTradeMomentumCoverageState,
  RecentTradeMomentumOutcome,
  RecentTradeMomentumSignalState,
} from "../../domain/recent-trade-momentum/recent-trade-momentum-v1";

export const WATCH_ALERT_EVENT_KIND = "MOMENTUM_SIGNAL" as const;

export type WatchEvaluationState =
  | RecentTradeMomentumSignalState
  | RecentTradeMomentumCoverageState;

export interface WatchEvaluationSnapshot {
  readonly recipeId: string;
  readonly packageId: string;
  readonly cutoffMonth: string;
  readonly resultDigest: string;
  readonly state: WatchEvaluationState;
  readonly growthRateDecimal: string | null;
  readonly confidence: string | null;
  readonly evaluatedAt: string;
  readonly alertEventId: string | null;
}

export type WatchAlertReason =
  | "FIRST_DIRECTIONAL_RESULT"
  | "FIRST_STABLE_RESULT"
  | "FIRST_UNAVAILABLE_RESULT"
  | "DIRECTION_FAMILY_CROSS"
  | "DIRECTION_FASTNESS_CHANGE"
  | "MATERIAL_GROWTH_RATE_CHANGE"
  | "DIRECTIONAL_BECAME_UNAVAILABLE"
  | "UNAVAILABLE_BECAME_DIRECTIONAL"
  | "CONFIDENCE_ONLY_CHANGE"
  | "PACKAGE_IDENTITY_ONLY_CHANGE"
  | "LABEL_ONLY_CHANGE"
  | "IMMATERIAL_GROWTH_RATE_CHANGE"
  | "NO_MATERIAL_CHANGE";

export type WatchAlertDecision =
  | Readonly<{
      alert: true;
      eventKind: typeof WATCH_ALERT_EVENT_KIND;
      reason: WatchAlertReason;
    }>
  | Readonly<{
      alert: false;
      eventKind: null;
      reason: WatchAlertReason;
    }>;

export function decideWatchAlert(
  priorEvaluation: WatchEvaluationSnapshot | null,
  currentResult: RecentTradeMomentumOutcome,
  recipeId: string,
): WatchAlertDecision {
  const current = stateFromOutcome(currentResult);
  if (priorEvaluation === null || priorEvaluation.recipeId !== recipeId) {
    if (isDirectionalState(current.state)) {
      return alert("FIRST_DIRECTIONAL_RESULT");
    }
    if (current.state === "BROADLY_STABLE") {
      return noAlert("FIRST_STABLE_RESULT");
    }
    return noAlert("FIRST_UNAVAILABLE_RESULT");
  }

  const prior = {
    state: priorEvaluation.state,
    growthRateDecimal: priorEvaluation.growthRateDecimal,
    confidence: priorEvaluation.confidence,
  };

  if (isDirectionalState(prior.state) && isUnavailableState(current.state)) {
    return alert("DIRECTIONAL_BECAME_UNAVAILABLE");
  }
  if (isUnavailableState(prior.state) && isDirectionalState(current.state)) {
    return alert("UNAVAILABLE_BECAME_DIRECTIONAL");
  }

  const priorFamily = directionFamily(prior.state);
  const currentFamily = directionFamily(current.state);
  if (
    priorFamily !== null &&
    currentFamily !== null &&
    priorFamily !== currentFamily
  ) {
    return alert("DIRECTION_FAMILY_CROSS");
  }

  if (
    priorFamily !== null &&
    priorFamily === currentFamily &&
    (priorFamily === "rising" || priorFamily === "falling") &&
    prior.state !== current.state
  ) {
    return alert("DIRECTION_FASTNESS_CHANGE");
  }

  const growthDelta = absoluteGrowthDelta(
    prior.growthRateDecimal,
    current.growthRateDecimal,
  );
  if (growthDelta !== null && growthDelta >= 0.1) {
    return alert("MATERIAL_GROWTH_RATE_CHANGE");
  }

  if (
    prior.state === current.state &&
    prior.growthRateDecimal === current.growthRateDecimal &&
    prior.confidence !== current.confidence
  ) {
    return noAlert("CONFIDENCE_ONLY_CHANGE");
  }

  if (
    prior.state === current.state &&
    prior.growthRateDecimal === current.growthRateDecimal &&
    prior.confidence === current.confidence &&
    priorEvaluation.packageId !== currentResult.monthlyPackageId
  ) {
    return noAlert("PACKAGE_IDENTITY_ONLY_CHANGE");
  }

  if (
    prior.state === current.state &&
    prior.growthRateDecimal === current.growthRateDecimal
  ) {
    return noAlert("LABEL_ONLY_CHANGE");
  }

  if (growthDelta !== null && growthDelta < 0.1) {
    return noAlert("IMMATERIAL_GROWTH_RATE_CHANGE");
  }

  return noAlert("NO_MATERIAL_CHANGE");
}

export interface AlertDedupeKeyInput {
  readonly watchId: string;
  readonly recipeId: string;
  readonly cutoffMonth: string;
  readonly packageId: string;
  readonly eventKind: string;
  readonly priorAlertEventId: string | null;
}

export function computeAlertDedupeKey(input: AlertDedupeKeyInput): string {
  return createHash("sha256")
    .update(
      `${input.watchId}${input.recipeId}${input.cutoffMonth}${input.packageId}${input.eventKind}${
        input.priorAlertEventId ?? "null"
      }`,
    )
    .digest("hex");
}

export function stateFromOutcome(result: RecentTradeMomentumOutcome): {
  readonly state: WatchEvaluationState;
  readonly growthRateDecimal: string | null;
  readonly confidence: string | null;
} {
  return {
    state: result.signalState ?? result.coverageState,
    growthRateDecimal: result.growthRateDecimal,
    confidence: result.confidence,
  };
}

function alert(reason: WatchAlertReason): WatchAlertDecision {
  return { alert: true, eventKind: WATCH_ALERT_EVENT_KIND, reason };
}

function noAlert(reason: WatchAlertReason): WatchAlertDecision {
  return { alert: false, eventKind: null, reason };
}

function isDirectionalState(state: WatchEvaluationState): boolean {
  return (
    state === "RISING" ||
    state === "RISING_FAST" ||
    state === "FALLING" ||
    state === "FALLING_FAST"
  );
}

function isUnavailableState(state: WatchEvaluationState): boolean {
  return state !== "RISING" &&
    state !== "RISING_FAST" &&
    state !== "BROADLY_STABLE" &&
    state !== "FALLING" &&
    state !== "FALLING_FAST";
}

function directionFamily(
  state: WatchEvaluationState,
): "rising" | "stable" | "falling" | null {
  if (state === "RISING" || state === "RISING_FAST") {
    return "rising";
  }
  if (state === "BROADLY_STABLE") {
    return "stable";
  }
  if (state === "FALLING" || state === "FALLING_FAST") {
    return "falling";
  }
  return null;
}

function absoluteGrowthDelta(
  previous: string | null,
  current: string | null,
): number | null {
  if (previous === null || current === null) {
    return null;
  }
  const delta = parseDecimalToTrillionths(current) -
    parseDecimalToTrillionths(previous);
  return Number(delta < 0n ? -delta : delta) / 1_000_000_000_000;
}

function parseDecimalToTrillionths(value: string): bigint {
  const match = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?$/u.exec(value);
  if (!match?.groups) {
    return BigInt(Math.round(Number(value) * 1_000_000_000_000));
  }
  const sign = match.groups.sign === "-" ? -1n : 1n;
  const whole = BigInt(match.groups.whole);
  const fraction = BigInt((match.groups.fraction ?? "").padEnd(12, "0").slice(0, 12));
  return sign * (whole * 1_000_000_000_000n + fraction);
}
