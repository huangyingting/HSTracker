import { describe, expect, it } from "vitest";

import type {
  RecentTradeMomentumCoverageState,
  RecentTradeMomentumOutcome,
  RecentTradeMomentumSignalState,
} from "../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";
import {
  computeAlertDedupeKey,
  decideWatchAlert,
  type WatchEvaluationSnapshot,
} from "../../src/operations/watch/watch-alert-decision";

const RECIPE = "recent-trade-momentum-v1";

describe("Opportunity Watch alert decision", () => {
  it("alerts when the first eligible result is rising", () => {
    expect(decideWatchAlert(null, outcome("RISING", "0.142000000000"), RECIPE)).toEqual({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "FIRST_DIRECTIONAL_RESULT",
    });
  });

  it("alerts when the first eligible result is rising fast", () => {
    expect(
      decideWatchAlert(null, outcome("RISING_FAST", "0.251000000000"), RECIPE),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "FIRST_DIRECTIONAL_RESULT",
    });
  });

  it("alerts when the first eligible result is falling", () => {
    expect(
      decideWatchAlert(null, outcome("FALLING", "-0.142000000000"), RECIPE),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "FIRST_DIRECTIONAL_RESULT",
    });
  });

  it("alerts when the first eligible result is falling fast", () => {
    expect(
      decideWatchAlert(null, outcome("FALLING_FAST", "-0.251000000000"), RECIPE),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "FIRST_DIRECTIONAL_RESULT",
    });
  });

  it("does not alert on the first broadly stable result", () => {
    expect(
      decideWatchAlert(null, outcome("BROADLY_STABLE", "0.012000000000"), RECIPE),
    ).toEqual({
      alert: false,
      eventKind: null,
      reason: "FIRST_STABLE_RESULT",
    });
  });

  it("alerts when direction crosses from rising to stable", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.120000000000"),
        outcome("BROADLY_STABLE", "0.020000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTION_FAMILY_CROSS",
    });
  });

  it("alerts when direction crosses from stable to falling", () => {
    expect(
      decideWatchAlert(
        prior("BROADLY_STABLE", "0.020000000000"),
        outcome("FALLING", "-0.110000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTION_FAMILY_CROSS",
    });
  });

  it("alerts when direction crosses from falling to rising", () => {
    expect(
      decideWatchAlert(
        prior("FALLING", "-0.110000000000"),
        outcome("RISING", "0.110000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTION_FAMILY_CROSS",
    });
  });

  it("alerts when rising changes between ordinary and fast", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.110000000000"),
        outcome("RISING_FAST", "0.260000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTION_FASTNESS_CHANGE",
    });
  });

  it("alerts when falling changes between ordinary and fast", () => {
    expect(
      decideWatchAlert(
        prior("FALLING_FAST", "-0.260000000000"),
        outcome("FALLING", "-0.110000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTION_FASTNESS_CHANGE",
    });
  });

  it("alerts at exactly ten percentage points of unrounded growth-rate change", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.110000000000"),
        outcome("RISING", "0.210000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "MATERIAL_GROWTH_RATE_CHANGE",
    });
  });

  it("alerts when prior direction becomes supported no-signal", () => {
    expect(
      decideWatchAlert(
        prior("FALLING", "-0.120000000000"),
        outcome(null, null, "SUPPORTED_NO_SIGNAL"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTIONAL_BECAME_UNAVAILABLE",
    });
  });

  it("alerts when prior direction becomes unsupported", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.120000000000"),
        outcome(null, null, "UNSUPPORTED_MARKET"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "DIRECTIONAL_BECAME_UNAVAILABLE",
    });
  });

  it("alerts when a previously unavailable result becomes directional", () => {
    expect(
      decideWatchAlert(
        prior("SOURCE_UNAVAILABLE", null),
        outcome("RISING", "0.120000000000"),
        RECIPE,
      ),
    ).toMatchObject({
      alert: true,
      eventKind: "MOMENTUM_SIGNAL",
      reason: "UNAVAILABLE_BECAME_DIRECTIONAL",
    });
  });

  it("does not alert on confidence-only changes", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.120000000000", "LOW"),
        outcome("RISING", "0.120000000000", "SUPPORTED", "HIGH"),
        RECIPE,
      ),
    ).toEqual({
      alert: false,
      eventKind: null,
      reason: "CONFIDENCE_ONLY_CHANGE",
    });
  });

  it("does not alert on package identity alone", () => {
    expect(
      decideWatchAlert(
        { ...prior("RISING", "0.120000000000"), packageId: "pkg-previous" },
        outcome("RISING", "0.120000000000", "SUPPORTED", "HIGH", "pkg-current"),
        RECIPE,
      ),
    ).toEqual({
      alert: false,
      eventKind: null,
      reason: "PACKAGE_IDENTITY_ONLY_CHANGE",
    });
  });

  it("does not alert on label changes with the same state and rate", () => {
    expect(
      decideWatchAlert(
        { ...prior("BROADLY_STABLE", "0.050000000000"), resultDigest: "old-copy" },
        {
          ...outcome("BROADLY_STABLE", "0.050000000000", "SUPPORTED", "HIGH", "pkg-prior"),
          growthPercentDisplay: "+5.0%",
        },
        RECIPE,
      ),
    ).toEqual({
      alert: false,
      eventKind: null,
      reason: "LABEL_ONLY_CHANGE",
    });
  });

  it("does not alert below ten percentage points when the state threshold is not crossed", () => {
    expect(
      decideWatchAlert(
        prior("RISING", "0.110000000000"),
        outcome("RISING", "0.209900000000"),
        RECIPE,
      ),
    ).toEqual({
      alert: false,
      eventKind: null,
      reason: "IMMATERIAL_GROWTH_RATE_CHANGE",
    });
  });

  it("uses the exact canonical SHA-256 dedupe-key formula", () => {
    expect(
      computeAlertDedupeKey({
        watchId: "watch-123",
        recipeId: RECIPE,
        cutoffMonth: "2026-06",
        packageId: "dataset-package-v1-abc",
        eventKind: "MOMENTUM_SIGNAL",
        priorAlertEventId: null,
      }),
    ).toBe("7d3585af898a0afa9d99bff321a67d605fa3cb2e2cb34c129c7b66ec45fa2e56");
  });
});

function prior(
  state: WatchEvaluationSnapshot["state"],
  growthRateDecimal: string | null,
  confidence = "HIGH",
): WatchEvaluationSnapshot {
  return {
    recipeId: RECIPE,
    packageId: "pkg-prior",
    cutoffMonth: "2026-05",
    resultDigest: "literal-prior-digest",
    state,
    growthRateDecimal,
    confidence,
    evaluatedAt: "2026-06-01T00:00:00.000Z",
    alertEventId: null,
  };
}

function outcome(
  signalState: RecentTradeMomentumSignalState | null,
  growthRateDecimal: string | null,
  coverageState: RecentTradeMomentumCoverageState = "SUPPORTED",
  confidence: "HIGH" | "MEDIUM" | "LOW" | null = "HIGH",
  packageId = "pkg-current",
): RecentTradeMomentumOutcome {
  return {
    schemaVersion: "recent-trade-momentum-result-v1",
    recipe: RECIPE,
    monthlyPackageId: packageId,
    sourceVintageId: "source-vintage-2026-06",
    reporterIso2: "DE",
    hs12Code: "010121",
    cutoffMonth: "2026-06",
    recentMonths: ["2026-04", "2026-05", "2026-06"],
    baselineMonths: ["2025-04", "2025-05", "2025-06"],
    coverageState,
    signalState,
    reasonCodes: coverageState === "SUPPORTED" ? [] : ["SOURCE_UNAVAILABLE"],
    recentValueEur: signalState === null ? null : "1142000",
    baselineValueEur: signalState === null ? null : "1000000",
    growthRateDecimal,
    growthPercentDisplay: growthRateDecimal === null ? null : "+14.2%",
    confidence,
    confidenceReasons: [],
    recordedHistoryMonths: 24,
    expectedHistoryMonths: 24,
  };
}
