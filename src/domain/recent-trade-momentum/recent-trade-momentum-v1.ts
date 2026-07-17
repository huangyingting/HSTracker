export type RecentTradeMomentumObservationState =
  | "RECORDED_POSITIVE"
  | "RECORDED_ZERO"
  | "NOT_OBSERVED"
  | "SUPPRESSED_OR_REALLOCATED"
  | "UNSUPPORTED_PRODUCT_MAPPING"
  | "UNSUPPORTED_MARKET"
  | "SOURCE_UNAVAILABLE";

export type RecentTradeMomentumUpdateState =
  | "PRELIMINARY"
  | "FINAL_BY_SOURCE_SCHEDULE"
  | "HISTORICALLY_REVISED";

export type RecentTradeMomentumCoverageState =
  | "SUPPORTED"
  | "SUPPORTED_NO_SIGNAL"
  | "NOT_OBSERVED"
  | "SUPPRESSED_OR_REALLOCATED"
  | "UNSUPPORTED_MARKET"
  | "UNSUPPORTED_PRODUCT_MAPPING"
  | "SOURCE_UNAVAILABLE";

export type RecentTradeMomentumSignalState =
  | "RISING_FAST"
  | "RISING"
  | "BROADLY_STABLE"
  | "FALLING"
  | "FALLING_FAST";

export type RecentTradeMomentumReasonCode =
  | "INSUFFICIENT_COMPLETE_HISTORY"
  | "INSUFFICIENT_RECORDED_MONTHS"
  | "MISSING_COMPARISON_MONTH"
  | "SMALL_BASE"
  | "WINDOW_CONCENTRATION"
  | "SUPPRESSED_OR_REALLOCATED"
  | "CLASSIFICATION_BREAK"
  | "UNSUPPORTED_PRODUCT_MAPPING"
  | "UNSUPPORTED_MARKET"
  | "SOURCE_UNAVAILABLE";

export type RecentTradeMomentumConfidence = "HIGH" | "MEDIUM" | "LOW";

export type RecentTradeMomentumConfidenceReason =
  | "RECORDED_HISTORY_20_TO_23"
  | "RECORDED_HISTORY_18_TO_19"
  | "PRELIMINARY_COMPARISON_MONTH"
  | "MULTI_STEP_EXACT_CORRESPONDENCE"
  | "MATERIAL_SOURCE_REVISION";

export type RecentTradeMomentumMonthObservation = Readonly<{
  referenceMonth: string;
  observationState: RecentTradeMomentumObservationState;
  valueEur: number | null;
  updateState: RecentTradeMomentumUpdateState;
  mappingChain: "DIRECT_EXACT" | "MULTI_STEP_EXACT";
}>;

export type RecentTradeMomentumV1Input = Readonly<{
  recipe: "recent-trade-momentum-v1";
  resultSchemaVersion: "recent-trade-momentum-result-v1";
  monthlyPackageId: string;
  sourceVintageId: string;
  reporterIso2: string;
  hs12Code: string;
  cutoffMonth: string;
  eligibleCompleteMonths: readonly string[];
  marketStatus: "SUPPORTED" | "UNSUPPORTED_MARKET" | "SOURCE_UNAVAILABLE";
  productMappingStatus: "EXACT_REVIEWED" | "UNSUPPORTED_PRODUCT_MAPPING";
  observations: readonly RecentTradeMomentumMonthObservation[];
  revisionComparisonWindowChangeRate: number;
}>;

export type RecentTradeMomentumOutcome = Readonly<{
  schemaVersion: "recent-trade-momentum-result-v1";
  recipe: "recent-trade-momentum-v1";
  monthlyPackageId: string;
  sourceVintageId: string;
  reporterIso2: string;
  hs12Code: string;
  cutoffMonth: string;
  recentMonths: readonly string[];
  baselineMonths: readonly string[];
  coverageState: RecentTradeMomentumCoverageState;
  signalState: RecentTradeMomentumSignalState | null;
  reasonCodes: readonly RecentTradeMomentumReasonCode[];
  recentValueEur: string | null;
  baselineValueEur: string | null;
  growthRateDecimal: string | null;
  growthPercentDisplay: string | null;
  confidence: RecentTradeMomentumConfidence | null;
  confidenceReasons: readonly RecentTradeMomentumConfidenceReason[];
  recordedHistoryMonths: number;
  expectedHistoryMonths: 24;
}>;

const EXPECTED_HISTORY_MONTHS = 24;
const MINIMUM_RECORDED_HISTORY_MONTHS = 18;
const MINIMUM_WINDOW_VALUE_EUR = 250_000n;

export function computeRecentTradeMomentumV1(
  input: RecentTradeMomentumV1Input,
): RecentTradeMomentumOutcome {
  validateInput(input);
  const recentMonths = previousMonths(input.cutoffMonth, 2, 0);
  const baselineMonths = previousMonths(input.cutoffMonth, 14, 12);
  const historyMonths = previousMonths(input.cutoffMonth, 23, 0);
  const observationsByMonth = new Map(
    input.observations.map((observation) => [observation.referenceMonth, observation]),
  );
  const historyObservations = historyMonths.map((month) =>
    observationsByMonth.get(month),
  );
  const recordedHistoryMonths = historyObservations.filter(
    (observation) => observation?.observationState === "RECORDED_POSITIVE",
  ).length;

  if (input.marketStatus !== "SUPPORTED") {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: input.marketStatus,
      reasonCodes: [input.marketStatus],
      recordedHistoryMonths,
    });
  }
  if (input.productMappingStatus !== "EXACT_REVIEWED") {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "UNSUPPORTED_PRODUCT_MAPPING",
      reasonCodes: ["UNSUPPORTED_PRODUCT_MAPPING"],
      recordedHistoryMonths,
    });
  }
  if (!historyMonths.every((month) => input.eligibleCompleteMonths.includes(month))) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["INSUFFICIENT_COMPLETE_HISTORY"],
      recordedHistoryMonths,
    });
  }

  const comparisonMonths = [...baselineMonths, ...recentMonths];
  const comparisonObservations = comparisonMonths.map((month) =>
    observationsByMonth.get(month),
  );
  if (
    comparisonObservations.some(
      (observation) => observation?.observationState === "SUPPRESSED_OR_REALLOCATED",
    ) ||
    historyObservations.some(
      (observation) => observation?.observationState === "SUPPRESSED_OR_REALLOCATED",
    )
  ) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["SUPPRESSED_OR_REALLOCATED"],
      recordedHistoryMonths,
    });
  }
  if (
    comparisonObservations.some(
      (observation) =>
        observation === undefined || observation.observationState === "NOT_OBSERVED",
    )
  ) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["MISSING_COMPARISON_MONTH"],
      recordedHistoryMonths,
    });
  }
  if (
    comparisonObservations.some(
      (observation) => observation?.observationState !== "RECORDED_POSITIVE",
    )
  ) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["INSUFFICIENT_RECORDED_MONTHS"],
      recordedHistoryMonths,
    });
  }
  if (recordedHistoryMonths < MINIMUM_RECORDED_HISTORY_MONTHS) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["INSUFFICIENT_RECORDED_MONTHS"],
      recordedHistoryMonths,
    });
  }

  const baselineValues = valuesForMonths(observationsByMonth, baselineMonths);
  const recentValues = valuesForMonths(observationsByMonth, recentMonths);
  const baselineValue = sumBigInt(baselineValues);
  const recentValue = sumBigInt(recentValues);
  if (
    baselineValue < MINIMUM_WINDOW_VALUE_EUR ||
    recentValue < MINIMUM_WINDOW_VALUE_EUR
  ) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["SMALL_BASE"],
      recordedHistoryMonths,
      baselineValue,
      recentValue,
    });
  }
  if (
    exceedsConcentrationCap(baselineValues, baselineValue) ||
    exceedsConcentrationCap(recentValues, recentValue)
  ) {
    return noSignal(input, recentMonths, baselineMonths, {
      coverageState: "SUPPORTED_NO_SIGNAL",
      reasonCodes: ["WINDOW_CONCENTRATION"],
      recordedHistoryMonths,
      baselineValue,
      recentValue,
    });
  }

  const signalState = classifySignal(recentValue, baselineValue);
  const growthRate = Number(recentValue) / Number(baselineValue) - 1;
  const confidence = computeConfidence({
    recordedHistoryMonths,
    comparisonObservations: comparisonObservations.filter(
      (observation): observation is RecentTradeMomentumMonthObservation =>
        observation !== undefined,
    ),
    historyObservations: historyObservations.filter(
      (observation): observation is RecentTradeMomentumMonthObservation =>
        observation !== undefined,
    ),
    revisionComparisonWindowChangeRate: input.revisionComparisonWindowChangeRate,
  });

  return {
    schemaVersion: "recent-trade-momentum-result-v1",
    recipe: "recent-trade-momentum-v1",
    monthlyPackageId: input.monthlyPackageId,
    sourceVintageId: input.sourceVintageId,
    reporterIso2: input.reporterIso2,
    hs12Code: input.hs12Code,
    cutoffMonth: input.cutoffMonth,
    recentMonths,
    baselineMonths,
    coverageState: "SUPPORTED",
    signalState,
    reasonCodes: [],
    recentValueEur: recentValue.toString(),
    baselineValueEur: baselineValue.toString(),
    growthRateDecimal: growthRate.toFixed(12),
    growthPercentDisplay: formatGrowthPercent(recentValue, baselineValue),
    confidence: confidence.confidence,
    confidenceReasons: confidence.reasons,
    recordedHistoryMonths,
    expectedHistoryMonths: EXPECTED_HISTORY_MONTHS,
  };
}

function computeConfidence(input: {
  recordedHistoryMonths: number;
  comparisonObservations: readonly RecentTradeMomentumMonthObservation[];
  historyObservations: readonly RecentTradeMomentumMonthObservation[];
  revisionComparisonWindowChangeRate: number;
}): {
  confidence: RecentTradeMomentumConfidence;
  reasons: readonly RecentTradeMomentumConfidenceReason[];
} {
  let confidenceRank = 3;
  const reasons: RecentTradeMomentumConfidenceReason[] = [];
  const cap = (
    rank: number,
    reason: RecentTradeMomentumConfidenceReason,
  ): void => {
    if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
    confidenceRank = Math.min(confidenceRank, rank);
  };

  if (input.recordedHistoryMonths >= 20 && input.recordedHistoryMonths <= 23) {
    cap(2, "RECORDED_HISTORY_20_TO_23");
  } else if (
    input.recordedHistoryMonths >= 18 &&
    input.recordedHistoryMonths <= 19
  ) {
    cap(1, "RECORDED_HISTORY_18_TO_19");
  }
  if (
    input.comparisonObservations.some(
      (observation) => observation.updateState === "PRELIMINARY",
    )
  ) {
    cap(2, "PRELIMINARY_COMPARISON_MONTH");
  }
  if (
    input.historyObservations.some(
      (observation) => observation.mappingChain === "MULTI_STEP_EXACT",
    )
  ) {
    cap(2, "MULTI_STEP_EXACT_CORRESPONDENCE");
  }
  if (input.revisionComparisonWindowChangeRate >= 0.05) {
    cap(1, "MATERIAL_SOURCE_REVISION");
  }

  return {
    confidence: confidenceRank === 3 ? "HIGH" : confidenceRank === 2 ? "MEDIUM" : "LOW",
    reasons,
  };
}

function classifySignal(
  recentValue: bigint,
  baselineValue: bigint,
): RecentTradeMomentumSignalState {
  if (recentValue * 4n >= baselineValue * 5n) {
    return "RISING_FAST";
  }
  if (recentValue * 10n >= baselineValue * 11n) {
    return "RISING";
  }
  if (recentValue * 4n <= baselineValue * 3n) {
    return "FALLING_FAST";
  }
  if (recentValue * 10n <= baselineValue * 9n) {
    return "FALLING";
  }
  return "BROADLY_STABLE";
}

function noSignal(
  input: RecentTradeMomentumV1Input,
  recentMonths: readonly string[],
  baselineMonths: readonly string[],
  options: {
    coverageState: RecentTradeMomentumCoverageState;
    reasonCodes: readonly RecentTradeMomentumReasonCode[];
    recordedHistoryMonths: number;
    recentValue?: bigint;
    baselineValue?: bigint;
  },
): RecentTradeMomentumOutcome {
  return {
    schemaVersion: "recent-trade-momentum-result-v1",
    recipe: "recent-trade-momentum-v1",
    monthlyPackageId: input.monthlyPackageId,
    sourceVintageId: input.sourceVintageId,
    reporterIso2: input.reporterIso2,
    hs12Code: input.hs12Code,
    cutoffMonth: input.cutoffMonth,
    recentMonths,
    baselineMonths,
    coverageState: options.coverageState,
    signalState: null,
    reasonCodes: options.reasonCodes,
    recentValueEur: options.recentValue?.toString() ?? null,
    baselineValueEur: options.baselineValue?.toString() ?? null,
    growthRateDecimal: null,
    growthPercentDisplay: null,
    confidence: null,
    confidenceReasons: [],
    recordedHistoryMonths: options.recordedHistoryMonths,
    expectedHistoryMonths: EXPECTED_HISTORY_MONTHS,
  };
}

function valuesForMonths(
  observationsByMonth: ReadonlyMap<string, RecentTradeMomentumMonthObservation>,
  months: readonly string[],
): bigint[] {
  return months.map((month) => {
    const observation = observationsByMonth.get(month);
    if (
      observation === undefined ||
      observation.observationState !== "RECORDED_POSITIVE" ||
      observation.valueEur === null
    ) {
      throw new Error("Comparison window values must be recorded positive.");
    }
    return BigInt(observation.valueEur);
  });
}

function sumBigInt(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function exceedsConcentrationCap(
  values: readonly bigint[],
  windowTotal: bigint,
): boolean {
  return values.some((value) => value * 100n > windowTotal * 80n);
}

function formatGrowthPercent(recentValue: bigint, baselineValue: bigint): string {
  const diff = recentValue - baselineValue;
  const sign = diff < 0n ? "-" : "+";
  const absoluteDiff = diff < 0n ? -diff : diff;
  const oneDecimalUnits =
    (absoluteDiff * 1000n * 2n + baselineValue) / (baselineValue * 2n);
  const integerPart = oneDecimalUnits / 10n;
  const fractionalPart = oneDecimalUnits % 10n;
  return `${sign}${integerPart}.${fractionalPart}`;
}

function previousMonths(
  cutoffMonth: string,
  startOffset: number,
  endOffset: number,
): string[] {
  const result: string[] = [];
  for (let offset = startOffset; offset >= endOffset; offset -= 1) {
    result.push(addMonths(cutoffMonth, -offset));
  }
  return result;
}

function addMonths(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (match === null) {
    throw new TypeError("Reference month must use YYYY-MM format.");
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const totalMonths = year * 12 + monthIndex + delta;
  const resultYear = Math.floor(totalMonths / 12);
  const resultMonth = (totalMonths % 12) + 1;
  return `${resultYear}-${String(resultMonth).padStart(2, "0")}`;
}

function validateInput(input: RecentTradeMomentumV1Input): void {
  if (input.recipe !== "recent-trade-momentum-v1") {
    throw new TypeError("Recent Trade Momentum recipe is incompatible.");
  }
  if (input.resultSchemaVersion !== "recent-trade-momentum-result-v1") {
    throw new TypeError("Recent Trade Momentum result schema is incompatible.");
  }
  if (!/^[A-Z]{2}$/u.test(input.reporterIso2)) {
    throw new TypeError("Reporter identity must be ISO alpha-2.");
  }
  if (!/^\d{6}$/u.test(input.hs12Code)) {
    throw new TypeError("Recent Trade Momentum product must be an HS12 code.");
  }
  for (const observation of input.observations) {
    if (observation.valueEur !== null) {
      if (
        !Number.isSafeInteger(observation.valueEur) ||
        observation.valueEur < 0
      ) {
        throw new TypeError("Monthly value must be a nonnegative integer EUR amount.");
      }
      if (
        observation.observationState === "RECORDED_POSITIVE" &&
        observation.valueEur <= 0
      ) {
        throw new TypeError("Recorded-positive observations must be positive.");
      }
    }
  }
}
