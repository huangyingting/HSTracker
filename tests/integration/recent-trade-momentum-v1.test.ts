import { describe, expect, it } from "vitest";

import {
  computeRecentTradeMomentumV1,
  type RecentTradeMomentumMonthObservation,
  type RecentTradeMomentumV1Input,
} from "../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";

const CUTOFF = "2026-02";
const HISTORY_MONTHS = [
  "2024-03",
  "2024-04",
  "2024-05",
  "2024-06",
  "2024-07",
  "2024-08",
  "2024-09",
  "2024-10",
  "2024-11",
  "2024-12",
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
] as const;
const BASELINE_MONTHS = ["2024-12", "2025-01", "2025-02"] as const;
const RECENT_MONTHS = ["2025-12", "2026-01", "2026-02"] as const;

describe("recent-trade-momentum-v1 recipe", () => {
  it.each([
    ["just below -25%", 749_999, "FALLING_FAST", "-25.0"],
    ["exactly -25%", 750_000, "FALLING_FAST", "-25.0"],
    ["just above -25%", 750_001, "FALLING", "-25.0"],
    ["just below -10%", 899_999, "FALLING", "-10.0"],
    ["exactly -10%", 900_000, "FALLING", "-10.0"],
    ["just above -10%", 900_001, "BROADLY_STABLE", "-10.0"],
    ["just below +10%", 1_099_999, "BROADLY_STABLE", "+10.0"],
    ["exactly +10%", 1_100_000, "RISING", "+10.0"],
    ["just above +10%", 1_100_001, "RISING", "+10.0"],
    ["just below +25%", 1_249_999, "RISING", "+25.0"],
    ["exactly +25%", 1_250_000, "RISING_FAST", "+25.0"],
    ["just above +25%", 1_250_001, "RISING_FAST", "+25.0"],
  ] as const)(
    "classifies %s using unrounded thresholds, not one-decimal display rounding",
    (_label, recentSum, signalState, display) => {
      const outcome = computeRecentTradeMomentumV1(
        recipeInput({
          baselineValues: [330_000, 330_000, 340_000],
          recentValues: splitThreeMonthSum(recentSum),
        }),
      );

      expect(outcome).toMatchObject({
        coverageState: "SUPPORTED",
        signalState,
        baselineMonths: ["2024-12", "2025-01", "2025-02"],
        recentMonths: ["2025-12", "2026-01", "2026-02"],
        baselineValueEur: "1000000",
        recentValueEur: String(recentSum),
        growthPercentDisplay: display,
        recordedHistoryMonths: 24,
        expectedHistoryMonths: 24,
        confidence: "HIGH",
        reasonCodes: [],
      });
    },
  );

  it("rounds displayed percentage half away from zero to one decimal", () => {
    expect(
      computeRecentTradeMomentumV1(
        recipeInput({
          baselineValues: [100_000, 100_000, 200_000],
          recentValues: [150_000, 150_000, 157_000],
        }),
      ),
    ).toMatchObject({
      coverageState: "SUPPORTED",
      signalState: "RISING",
      growthRateDecimal: "0.142500000000",
      growthPercentDisplay: "+14.3",
    });
    expect(
      computeRecentTradeMomentumV1(
        recipeInput({
          baselineValues: [100_000, 100_000, 200_000],
          recentValues: [100_000, 100_000, 143_000],
        }),
      ),
    ).toMatchObject({
      coverageState: "SUPPORTED",
      signalState: "FALLING",
      growthRateDecimal: "-0.142500000000",
      growthPercentDisplay: "-14.3",
    });
  });

  it.each([
    [24, "SUPPORTED", "HIGH", []],
    [20, "SUPPORTED", "MEDIUM", ["RECORDED_HISTORY_20_TO_23"]],
    [18, "SUPPORTED", "LOW", ["RECORDED_HISTORY_18_TO_19"]],
    [17, "SUPPORTED_NO_SIGNAL", null, ["INSUFFICIENT_RECORDED_MONTHS"]],
  ] as const)(
    "applies coverage and confidence outcomes for %i/24 recorded-positive months",
    (recordedMonths, coverageState, confidence, reasons) => {
      const outcome = computeRecentTradeMomentumV1(
        recipeInput({ recordedHistoryMonths: recordedMonths }),
      );

      expect(outcome).toMatchObject({
        coverageState,
        recordedHistoryMonths: recordedMonths,
        expectedHistoryMonths: 24,
        confidence,
        reasonCodes:
          coverageState === "SUPPORTED_NO_SIGNAL" ? reasons : [],
        confidenceReasons:
          coverageState === "SUPPORTED" ? reasons : [],
      });
    },
  );

  it.each([
    [
      "missing comparison month",
      { month: "2025-01", state: "NOT_OBSERVED" },
      "MISSING_COMPARISON_MONTH",
    ],
    [
      "explicit zero comparison month",
      { month: "2025-01", state: "RECORDED_ZERO", valueEur: 0 },
      "INSUFFICIENT_RECORDED_MONTHS",
    ],
    [
      "suppressed comparison month",
      { month: "2025-01", state: "SUPPRESSED_OR_REALLOCATED" },
      "SUPPRESSED_OR_REALLOCATED",
    ],
  ] as const)("returns supported-no-signal for %s", (_label, override, reason) => {
    const outcome = computeRecentTradeMomentumV1(
      recipeInput({
        observationOverrides: [override],
      }),
    );

    expect(outcome).toMatchObject({
      coverageState: "SUPPORTED_NO_SIGNAL",
      signalState: null,
      reasonCodes: [reason],
    });
  });

  it.each([
    ["EUR 249,999 baseline", [80_000, 80_000, 89_999], [100_000, 100_000, 100_000], "SUPPORTED_NO_SIGNAL", "SMALL_BASE"],
    ["EUR 250,000 baseline", [80_000, 80_000, 90_000], [100_000, 100_000, 100_000], "SUPPORTED", null],
    ["exactly 80% concentration", [330_000, 330_000, 340_000], [800_000, 100_000, 100_000], "SUPPORTED", null],
    ["above 80% concentration", [330_000, 330_000, 340_000], [800_001, 100_000, 99_999], "SUPPORTED_NO_SIGNAL", "WINDOW_CONCENTRATION"],
  ] as const)(
    "applies small-base and concentration gate at %s",
    (_label, baselineValues, recentValues, coverageState, reason) => {
      const outcome = computeRecentTradeMomentumV1(
        recipeInput({ baselineValues, recentValues }),
      );

      expect(outcome).toMatchObject({
        coverageState,
        reasonCodes: reason === null ? [] : [reason],
      });
    },
  );

  it.each([
    [
      "preliminary comparison month",
      { preliminaryMonths: ["2026-02"] },
      "MEDIUM",
      ["PRELIMINARY_COMPARISON_MONTH"],
    ],
    [
      "multi-step exact correspondence chain",
      { multiStepMonths: ["2025-12"] },
      "MEDIUM",
      ["MULTI_STEP_EXACT_CORRESPONDENCE"],
    ],
    [
      "revision changes a comparison window by at least 5%",
      { revisionComparisonWindowChangeRate: 0.05 },
      "LOW",
      ["MATERIAL_SOURCE_REVISION"],
    ],
  ] as const)("caps confidence for %s", (_label, options, confidence, reasons) => {
    const outcome = computeRecentTradeMomentumV1(recipeInput(options));

    expect(outcome).toMatchObject({
      coverageState: "SUPPORTED",
      confidence,
      confidenceReasons: reasons,
    });
  });

  it.each([
    ["unsupported market", { marketStatus: "UNSUPPORTED_MARKET" }, "UNSUPPORTED_MARKET"],
    [
      "unsupported product mapping",
      { productMappingStatus: "UNSUPPORTED_PRODUCT_MAPPING" },
      "UNSUPPORTED_PRODUCT_MAPPING",
    ],
    ["source unavailable", { marketStatus: "SOURCE_UNAVAILABLE" }, "SOURCE_UNAVAILABLE"],
  ] as const)("fails closed for %s", (_label, options, coverageState) => {
    expect(computeRecentTradeMomentumV1(recipeInput(options))).toMatchObject({
      coverageState,
      signalState: null,
      reasonCodes: [coverageState],
    });
  });
});

function recipeInput(
  options: Partial<{
    baselineValues: readonly number[];
    recentValues: readonly number[];
    recordedHistoryMonths: number;
    observationOverrides: readonly Readonly<{
      month: string;
      state: RecentTradeMomentumMonthObservation["observationState"];
      valueEur?: number;
    }>[];
    preliminaryMonths: readonly string[];
    multiStepMonths: readonly string[];
    revisionComparisonWindowChangeRate: number;
    marketStatus: RecentTradeMomentumV1Input["marketStatus"];
    productMappingStatus: RecentTradeMomentumV1Input["productMappingStatus"];
  }> = {},
): RecentTradeMomentumV1Input {
  const baselineValues = options.baselineValues ?? [330_000, 330_000, 340_000];
  const recentValues = options.recentValues ?? [360_000, 370_000, 370_000];
  const valuesByMonth = new Map<string, number>();
  for (const [index, month] of BASELINE_MONTHS.entries()) {
    valuesByMonth.set(month, baselineValues[index]!);
  }
  for (const [index, month] of RECENT_MONTHS.entries()) {
    valuesByMonth.set(month, recentValues[index]!);
  }
  for (const month of HISTORY_MONTHS) {
    if (!valuesByMonth.has(month)) {
      valuesByMonth.set(month, 100_000);
    }
  }

  const nonComparisonMonths = HISTORY_MONTHS.filter(
    (month) => !BASELINE_MONTHS.includes(month) && !RECENT_MONTHS.includes(month),
  );
  const missingPositiveCount = Math.max(
    0,
    24 - (options.recordedHistoryMonths ?? 24),
  );
  const missingPositiveMonths = new Set(nonComparisonMonths.slice(0, missingPositiveCount));
  const overrideByMonth = new Map(
    (options.observationOverrides ?? []).map((override) => [override.month, override]),
  );
  const preliminaryMonths = new Set(options.preliminaryMonths ?? []);
  const multiStepMonths = new Set(options.multiStepMonths ?? []);
  const observations = HISTORY_MONTHS.map((month): RecentTradeMomentumMonthObservation => {
    const override = overrideByMonth.get(month);
    if (override !== undefined) {
      return {
        referenceMonth: month,
        observationState: override.state,
        valueEur: override.valueEur ?? null,
        updateState: preliminaryMonths.has(month)
          ? "PRELIMINARY"
          : "FINAL_BY_SOURCE_SCHEDULE",
        mappingChain: multiStepMonths.has(month) ? "MULTI_STEP_EXACT" : "DIRECT_EXACT",
      };
    }
    if (missingPositiveMonths.has(month)) {
      return {
        referenceMonth: month,
        observationState: "NOT_OBSERVED",
        valueEur: null,
        updateState: "FINAL_BY_SOURCE_SCHEDULE",
        mappingChain: "DIRECT_EXACT",
      };
    }
    return {
      referenceMonth: month,
      observationState: "RECORDED_POSITIVE",
      valueEur: valuesByMonth.get(month)!,
      updateState: preliminaryMonths.has(month)
        ? "PRELIMINARY"
        : "FINAL_BY_SOURCE_SCHEDULE",
      mappingChain: multiStepMonths.has(month) ? "MULTI_STEP_EXACT" : "DIRECT_EXACT",
    };
  });

  return {
    recipe: "recent-trade-momentum-v1",
    resultSchemaVersion: "recent-trade-momentum-result-v1",
    monthlyPackageId: "dataset-package-v1-synthetic",
    sourceVintageId: "source-vintage-v1-synthetic",
    reporterIso2: "DE",
    hs12Code: "010121",
    cutoffMonth: CUTOFF,
    eligibleCompleteMonths: HISTORY_MONTHS,
    marketStatus: options.marketStatus ?? "SUPPORTED",
    productMappingStatus: options.productMappingStatus ?? "EXACT_REVIEWED",
    observations,
    revisionComparisonWindowChangeRate:
      options.revisionComparisonWindowChangeRate ?? 0,
  };
}

function splitThreeMonthSum(sum: number): readonly [number, number, number] {
  const first = Math.floor(sum / 3);
  const second = Math.floor(sum / 3);
  return [first, second, sum - first - second];
}
