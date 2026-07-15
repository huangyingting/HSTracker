import {
  divideHalfUp,
  formatFixedDecimal as formatFixed,
  formatFixedDecimalScale as formatFixedScale,
  normalizeFixedDecimal as normalizeFixed,
  parsePositiveFixedDecimal as parsePositiveDecimal,
  tenTo,
  type FixedDecimal,
} from "../fixed-decimal";
import type {
  TradeTrendObservation,
  TradeTrendResult,
  TradeTrendSummary,
  TradeTrendV1Inputs,
} from "./result";

const FINALIZED_YEAR_COUNT = 5;
const PERCENTAGE_DIGITS = 6;
const TRADE_TREND_DISCLAIMER =
  "Trade Trend evidence describes recorded nominal imports and is a discovery aid, not a forecast, recommendation, or prediction of commercial success.";

export function computeTradeTrendV1(
  inputs: TradeTrendV1Inputs,
): TradeTrendResult {
  assertReleaseConsistency(inputs);
  const finalizedObservations = canonicalFinalizedObservations(inputs);
  const provisionalObservation = canonicalProvisionalObservation(inputs);

  return {
    schemaVersion: "trade-trend-result-v1",
    analysisId: `trade-trend:${inputs.analysisBuildId}:${inputs.importer.code}:${inputs.product.code}`,
    analysisBuildId: inputs.analysisBuildId,
    analysisReleaseCatalogSha256: inputs.analysisReleaseCatalogSha256,
    query: {
      importer: inputs.importer,
      product: inputs.product,
    },
    provenance: {
      baciRelease: inputs.release.baciRelease,
      sourceUpdateDate: inputs.release.sourceUpdateDate,
      hsRevision: inputs.release.hsRevision,
      ingestedYears: inputs.release.ingestedYears,
      finalizedWindow: {
        start: inputs.release.finalizedCutoffYear - (FINALIZED_YEAR_COUNT - 1),
        end: inputs.release.finalizedCutoffYear,
      },
      provisionalYear: inputs.release.provisionalYear,
      artifactBuildId: inputs.artifact.buildId,
      artifactSchemaVersion: inputs.artifact.schemaVersion,
      artifactSha256: inputs.artifact.sha256,
      valueUnit: "CURRENT_USD",
    },
    finalizedObservations,
    summary: summaryFor(finalizedObservations),
    provisionalObservation,
    discoveryDisclaimer: TRADE_TREND_DISCLAIMER,
  };
}

function assertReleaseConsistency(inputs: TradeTrendV1Inputs): void {
  if (inputs.artifact.baciRelease !== inputs.release.baciRelease) {
    throw new TypeError("A Trade Trend cannot mix BACI Releases.");
  }
  if (
    inputs.product.hsRevision !== "HS12" ||
    inputs.release.hsRevision !== "HS12"
  ) {
    throw new TypeError("Trade Trend v1 requires an HS12 product.");
  }
}

function canonicalFinalizedObservations(
  inputs: TradeTrendV1Inputs,
): readonly TradeTrendObservation[] {
  const windowStart =
    inputs.release.finalizedCutoffYear - (FINALIZED_YEAR_COUNT - 1);
  const byYear = new Map<number, TradeTrendObservation>();
  for (const observation of inputs.finalizedObservations) {
    if (
      !Number.isSafeInteger(observation.year) ||
      observation.year < windowStart ||
      observation.year > inputs.release.finalizedCutoffYear ||
      byYear.has(observation.year)
    ) {
      throw new TypeError(
        "Trade Trend finalized observations must be unique members of the five-year finalized window.",
      );
    }
    byYear.set(observation.year, canonicalObservation(observation));
  }

  const observations = Array.from(
    { length: FINALIZED_YEAR_COUNT },
    (_, index) => byYear.get(windowStart + index),
  );
  if (observations.some((observation) => observation === undefined)) {
    throw new TypeError(
      "Trade Trend requires every member of the five-year finalized window.",
    );
  }
  return observations as readonly TradeTrendObservation[];
}

function canonicalProvisionalObservation(
  inputs: TradeTrendV1Inputs,
): TradeTrendObservation | null {
  if (inputs.provisionalObservation === null) {
    return null;
  }
  if (inputs.provisionalObservation.year !== inputs.release.provisionalYear) {
    throw new TypeError(
      "Trade Trend provisional evidence must use the release provisional year.",
    );
  }
  return canonicalObservation(inputs.provisionalObservation);
}

function canonicalObservation(
  observation: TradeTrendObservation,
): TradeTrendObservation {
  if (observation.state !== "RECORDED_POSITIVE") {
    return { year: observation.year, state: observation.state };
  }
  const value = parsePositiveDecimal(
    observation.valueCurrentUsd,
    "Trade Trend recorded value",
  );
  return {
    year: observation.year,
    state: "RECORDED_POSITIVE",
    valueCurrentUsd: formatFixed(value),
  };
}

function summaryFor(
  observations: readonly TradeTrendObservation[],
): TradeTrendSummary {
  const recorded = observations.filter(
    (
      observation,
    ): observation is Extract<
      TradeTrendObservation,
      { state: "RECORDED_POSITIVE" }
    > => observation.state === "RECORDED_POSITIVE",
  );
  if (recorded.length === 0) {
    return {
      state: "UNAVAILABLE",
      reason: "NO_RECORDED_POSITIVE_OBSERVATIONS",
    };
  }
  if (recorded.length === 1) {
    return {
      state: "UNAVAILABLE",
      reason: "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION",
    };
  }

  const first = recorded[0]!;
  const last = recorded.at(-1)!;
  const firstValue = parsePositiveDecimal(
    first.valueCurrentUsd,
    "Trade Trend first recorded value",
  );
  const lastValue = parsePositiveDecimal(
    last.valueCurrentUsd,
    "Trade Trend last recorded value",
  );
  const spanYears = last.year - first.year;
  if (spanYears < 1) {
    throw new TypeError(
      "Trade Trend recorded-positive endpoints must have a positive year span.",
    );
  }

  return {
    state: "AVAILABLE",
    firstRecordedPositive: {
      year: first.year,
      valueCurrentUsd: first.valueCurrentUsd,
    },
    lastRecordedPositive: {
      year: last.year,
      valueCurrentUsd: last.valueCurrentUsd,
    },
    spanYears,
    absoluteChangeCurrentUsd: formatFixed(subtract(lastValue, firstValue)),
    percentageChangePercent: formatPercentage(
      divide(
        subtract(lastValue, firstValue),
        firstValue,
        PERCENTAGE_DIGITS,
      ),
    ),
    cagrPercent: formatCagr(lastValue, firstValue, spanYears),
  };
}

function subtract(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalizeFixed({
    units:
      left.units * tenTo(scale - left.scale) -
      right.units * tenTo(scale - right.scale),
    scale,
  });
}

function divide(
  left: FixedDecimal,
  right: FixedDecimal,
  digits: number,
): FixedDecimal {
  const numerator = left.units * tenTo(right.scale + digits);
  const denominator = right.units * tenTo(left.scale);
  return { units: divideHalfUp(numerator, denominator), scale: digits };
}

function formatPercentage(changeRatio: FixedDecimal): string {
  return formatFixedScale({
    units: changeRatio.units * 100n,
    scale: changeRatio.scale,
  }, PERCENTAGE_DIGITS);
}

function formatCagr(
  last: FixedDecimal,
  first: FixedDecimal,
  spanYears: number,
): string {
  const factor = 100n * tenTo(PERCENTAGE_DIGITS);
  let lower = -factor;
  let upper = 0n;
  if (ratioAtLeast(last, first, factor, 0n, spanYears)) {
    upper = factor;
    while (ratioAtLeast(last, first, factor, upper, spanYears)) {
      lower = upper;
      upper *= 2n;
    }
  }

  while (upper - lower > 1n) {
    const middle = lower + (upper - lower) / 2n;
    if (ratioAtLeast(last, first, factor, middle, spanYears)) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  const rounded =
    ratioAtLeastHalf(last, first, factor, lower, spanYears)
      ? lower + 1n
      : lower;
  return formatFixedScale(
    { units: rounded, scale: PERCENTAGE_DIGITS },
    PERCENTAGE_DIGITS,
  );
}

function ratioAtLeast(
  last: FixedDecimal,
  first: FixedDecimal,
  factor: bigint,
  percentageUnits: bigint,
  spanYears: number,
): boolean {
  const thresholdNumerator = factor + percentageUnits;
  if (thresholdNumerator <= 0n) {
    return true;
  }
  return (
    ratioNumerator(last, first) * power(factor, spanYears) >=
    ratioDenominator(last, first) * power(thresholdNumerator, spanYears)
  );
}

function ratioAtLeastHalf(
  last: FixedDecimal,
  first: FixedDecimal,
  factor: bigint,
  lowerPercentageUnits: bigint,
  spanYears: number,
): boolean {
  const thresholdNumerator = 2n * (factor + lowerPercentageUnits) + 1n;
  const thresholdDenominator = 2n * factor;
  return (
    ratioNumerator(last, first) * power(thresholdDenominator, spanYears) >=
    ratioDenominator(last, first) *
      power(thresholdNumerator, spanYears)
  );
}

function ratioNumerator(last: FixedDecimal, first: FixedDecimal): bigint {
  return last.units * tenTo(first.scale);
}

function ratioDenominator(last: FixedDecimal, first: FixedDecimal): bigint {
  return first.units * tenTo(last.scale);
}

function power(base: bigint, exponent: number): bigint {
  let result = 1n;
  let current = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) {
      result *= current;
    }
    current *= current;
    remaining = Math.floor(remaining / 2);
  }
  return result;
}
