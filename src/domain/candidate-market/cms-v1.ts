import type {
  CandidateMarket,
  CandidateMarketResult,
  CaveatCode,
  ConfidenceDeduction,
  ConfidenceDeductionCode,
  EconomyIdentity,
  GrowthReasonCode,
  StabilityEvidence,
} from "./result";
import type {
  CmsV1Inputs,
  MarketYearEvidence,
} from "../../evidence/trade-evidence-source";

const WEIGHTS = {
  marketSize: 30,
  marketGrowth: 25,
  recordedFoothold: 25,
  supplierDiversity: 20,
} as const;

const IDENTITY_PROXY_ECONOMY_CODE = "490";

const DISCOVERY_DISCLAIMER =
  "Candidate Market evidence is a discovery aid for further investigation, not a recommendation or prediction of commercial success.";

type RawCandidate = {
  economy: EconomyIdentity;
  rows: readonly MarketYearEvidence[];
  observedYears: readonly number[];
  sizeKusd: number;
  growth: number | null;
  growthReasonCodes: readonly GrowthReasonCode[];
  foothold: number;
  bilateralFlowState: "RECORDED" | "NO_RECORDED_POSITIVE_FLOW";
  diversity: number | null;
  diversityYears: readonly number[];
  quantityCoverage: number | null;
  percentiles: {
    size: number;
    growth: number;
    foothold: number;
    diversity: number;
  };
  score: number;
  rank: number;
  rankTieSize: number;
  rankPercentile: number;
};

type WindowResult = {
  candidates: readonly RawCandidate[];
  ranksByCode: ReadonlyMap<string, number>;
};

export function computeCmsV1(inputs: CmsV1Inputs): CandidateMarketResult {
  const cutoffYear = inputs.release.finalizedCutoffYear;
  const primaryWindow = { start: cutoffYear - 4, end: cutoffYear };
  const threeYearWindow = { start: cutoffYear - 2, end: cutoffYear };
  const tenYearWindow = { start: cutoffYear - 9, end: cutoffYear };

  const primary = computeWindow(inputs.marketYears, primaryWindow);
  const threeYear = computeWindow(inputs.marketYears, threeYearWindow);
  const tenYear = computeWindow(inputs.marketYears, tenYearWindow);
  const stability = {
    threeYear: compareWindowRanks(primary, threeYear, threeYearWindow),
    tenYear: compareWindowRanks(primary, tenYear, tenYearWindow),
  };
  const discontinuityYears = findDiscontinuityYears(inputs.productYearTotals);
  const exporterHasHistory = primary.candidates.some(
    (candidate) => candidate.bilateralFlowState === "RECORDED",
  );
  const dominantCandidateCode = findDominantCandidate(primary.candidates);

  const candidates = primary.candidates.map((candidate) =>
    toPublicCandidate({
      candidate,
      inputs,
      primaryWindow,
      stability,
      discontinuityYears,
      exporterHasHistory,
      dominantCandidateCode,
      cohortSize: primary.candidates.length,
    }),
  );

  return {
    schemaVersion: "candidate-market-result-v1",
    analysisId: `analysis:${inputs.analysisBuildId}:${inputs.exporter.code}:${inputs.product.code}`,
    analysisBuildId: inputs.analysisBuildId,
    analysisReleaseCatalogSha256: inputs.analysisReleaseCatalogSha256,
    query: {
      exporter: inputs.exporter,
      product: inputs.product,
    },
    provenance: {
      baciRelease: inputs.release.baciRelease,
      sourceUpdateDate: inputs.release.sourceUpdateDate,
      hsRevision: inputs.release.hsRevision,
      ingestedYears: inputs.release.ingestedYears,
      finalizedCutoffYear: cutoffYear,
      scoreWindow: primaryWindow,
      provisionalYear: inputs.release.provisionalYear,
      scoreVersion: "cms-v1",
      artifactBuildId: inputs.artifact.buildId,
      artifactSchemaVersion: inputs.artifact.schemaVersion,
      artifactSha256: inputs.artifact.sha256,
      valueUnit: "CURRENT_USD",
    },
    weights: WEIGHTS,
    cohortSize: candidates.length,
    emptyReason:
      candidates.length === 0
        ? "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW"
        : null,
    stability,
    productSeriesDiscontinuityYears: discontinuityYears,
    candidates,
    discoveryDisclaimer: DISCOVERY_DISCLAIMER,
  };
}

function computeWindow(
  rows: readonly MarketYearEvidence[],
  window: { start: number; end: number },
): WindowResult {
  const groupedRows = new Map<string, MarketYearEvidence[]>();

  for (const row of rows) {
    if (row.year < window.start || row.year > window.end) {
      continue;
    }

    const candidateRows = groupedRows.get(row.candidateMarket.code) ?? [];
    candidateRows.push(row);
    groupedRows.set(row.candidateMarket.code, candidateRows);
  }

  const candidates = [...groupedRows.values()].map((candidateRows) =>
    computeRawCandidate(candidateRows),
  );

  applyPercentiles(candidates, "sizeKusd", "size");
  applyPercentiles(candidates, "growth", "growth");
  applyPercentiles(candidates, "foothold", "foothold");
  applyPercentiles(candidates, "diversity", "diversity");

  for (const candidate of candidates) {
    const rawScore =
      (WEIGHTS.marketSize * candidate.percentiles.size +
        WEIGHTS.marketGrowth * candidate.percentiles.growth +
        WEIGHTS.recordedFoothold * candidate.percentiles.foothold +
        WEIGHTS.supplierDiversity * candidate.percentiles.diversity) /
      100;
    candidate.score = roundHalfUp(rawScore);
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      Number(left.economy.code) - Number(right.economy.code),
  );
  assignRanks(candidates);

  return {
    candidates,
    ranksByCode: new Map(
      candidates.map((candidate) => [candidate.economy.code, candidate.rank]),
    ),
  };
}

function computeRawCandidate(rows: readonly MarketYearEvidence[]): RawCandidate {
  const sortedRows = [...rows].sort((left, right) => left.year - right.year);
  const values = sortedRows.map((row) =>
    parsePositiveDecimal(row.worldValueKusd, "worldValueKusd"),
  );
  const sizeKusd = mean(values);
  const observedYears = sortedRows.map((row) => row.year);
  const growthReasonCodes: GrowthReasonCode[] = [];

  if (sortedRows.length < 3) {
    growthReasonCodes.push("INSUFFICIENT_OBSERVED_YEARS");
  }
  if (sizeKusd < 500) {
    growthReasonCodes.push("BELOW_MATERIALITY_THRESHOLD");
  }

  const growth =
    growthReasonCodes.length === 0
      ? calculateLogLinearGrowth(sortedRows)
      : null;
  const recordedValueKusd = sortedRows.reduce(
    (total, row, index) => {
      if (row.selectedExporter.state !== "RECORDED") {
        return total;
      }

      const recordedValue = parsePositiveDecimal(
        row.selectedExporter.valueKusd,
        "selectedExporter.valueKusd",
      );
      return (
        total +
        validateRecordedValue(
          recordedValue,
          values[index]!,
          "selectedExporter.valueKusd",
          "worldValueKusd",
        )
      );
    },
    0,
  );
  const worldValueKusd = values.reduce((total, value) => total + value, 0);
  const diversityByYear = sortedRows.flatMap((row) => {
    const diversity = calculateAnnualDiversity(
      row.alternativeSupplierShares,
    );
    return diversity === null ? [] : [{ year: row.year, diversity }];
  });
  const sourceFlowCount = sortedRows.reduce(
    (total, row) => total + row.sourceFlowCount,
    0,
  );
  const quantityPresentCount = sortedRows.reduce(
    (total, row) => total + row.quantityPresentCount,
    0,
  );

  return {
    economy: sortedRows[0]!.candidateMarket,
    rows: sortedRows,
    observedYears,
    sizeKusd,
    growth,
    growthReasonCodes,
    foothold: clamp(recordedValueKusd / worldValueKusd, 0, 1),
    bilateralFlowState:
      recordedValueKusd > 0 ? "RECORDED" : "NO_RECORDED_POSITIVE_FLOW",
    diversity:
      diversityByYear.length === 0
        ? null
        : mean(diversityByYear.map(({ diversity }) => diversity)),
    diversityYears: diversityByYear.map(({ year }) => year),
    quantityCoverage:
      sourceFlowCount === 0 ? null : quantityPresentCount / sourceFlowCount,
    percentiles: {
      size: 0,
      growth: 0,
      foothold: 0,
      diversity: 0,
    },
    score: 0,
    rank: 0,
    rankTieSize: 0,
    rankPercentile: 0,
  };
}

function applyPercentiles(
  candidates: RawCandidate[],
  rawKey: "sizeKusd" | "growth" | "foothold" | "diversity",
  percentileKey: keyof RawCandidate["percentiles"],
) {
  const computed = candidates
    .flatMap((candidate) => {
      const value = candidate[rawKey];
      return value === null ? [] : [{ candidate, value }];
    })
    .sort(
      (left, right) =>
        left.value - right.value ||
        Number(left.candidate.economy.code) -
          Number(right.candidate.economy.code),
    );

  let index = 0;
  while (index < computed.length) {
    let groupEnd = index + 1;
    while (
      groupEnd < computed.length &&
      nearlyEqual(computed[groupEnd]!.value, computed[index]!.value)
    ) {
      groupEnd += 1;
    }

    const averageRank = (index + 1 + groupEnd) / 2;
    const percentile =
      (100 * (averageRank - 0.5)) / computed.length;

    for (let tiedIndex = index; tiedIndex < groupEnd; tiedIndex += 1) {
      computed[tiedIndex]!.candidate.percentiles[percentileKey] = percentile;
    }
    index = groupEnd;
  }

  for (const candidate of candidates) {
    if (candidate[rawKey] === null) {
      candidate.percentiles[percentileKey] = 50;
    }
  }
}

function assignRanks(candidates: RawCandidate[]) {
  let currentRank = 0;
  let previousScore: number | null = null;

  for (const [index, candidate] of candidates.entries()) {
    if (candidate.score !== previousScore) {
      currentRank = index + 1;
      previousScore = candidate.score;
    }
    candidate.rank = currentRank;
  }

  for (const candidate of candidates) {
    const tiedPositions = candidates
      .map((other, index) => ({ other, position: index + 1 }))
      .filter(({ other }) => other.score === candidate.score)
      .map(({ position }) => position);
    candidate.rankTieSize = tiedPositions.length;
    candidate.rankPercentile =
      candidates.length === 1
        ? 50
        : (100 *
            (candidates.length - mean(tiedPositions))) /
          (candidates.length - 1);
  }
}

function compareWindowRanks(
  primary: WindowResult,
  alternate: WindowResult,
  window: { start: number; end: number },
): StabilityEvidence {
  const commonCodes = [...primary.ranksByCode.keys()]
    .filter((code) => alternate.ranksByCode.has(code))
    .sort((left, right) => Number(left) - Number(right));

  if (commonCodes.length < 10) {
    return {
      window,
      commonCandidateCount: commonCodes.length,
      state: "NOT_ESTIMATED_SMALL_COMMON_COHORT",
      rankCorrelation: null,
    };
  }

  const primaryRanks = commonCodes.map(
    (code) => primary.ranksByCode.get(code)!,
  );
  const alternateRanks = commonCodes.map(
    (code) => alternate.ranksByCode.get(code)!,
  );
  const correlation = pearsonCorrelation(primaryRanks, alternateRanks);

  return {
    window,
    commonCandidateCount: commonCodes.length,
    state:
      correlation < 0.7 && !nearlyEqual(correlation, 0.7)
        ? "LOW"
        : "NOT_FLAGGED",
    rankCorrelation: formatFixed(correlation, 6),
  };
}

function toPublicCandidate({
  candidate,
  inputs,
  primaryWindow,
  stability,
  discontinuityYears,
  exporterHasHistory,
  dominantCandidateCode,
  cohortSize,
}: {
  candidate: RawCandidate;
  inputs: CmsV1Inputs;
  primaryWindow: { start: number; end: number };
  stability: CandidateMarketResult["stability"];
  discontinuityYears: readonly number[];
  exporterHasHistory: boolean;
  dominantCandidateCode: string | null;
  cohortSize: number;
}): CandidateMarket {
  const missingScoreYears = yearsBetween(
    primaryWindow.start,
    primaryWindow.end,
  ).filter((year) => !candidate.observedYears.includes(year));
  const confidence = calculateConfidence({
    candidate,
    missingScoreYears,
    cutoffYear: primaryWindow.end,
    discontinuityYears,
    stability,
    exporterHasHistory,
    cohortSize,
  });
  const caveatCodes = buildCaveatCodes({
    candidate,
    stability,
    discontinuityYears,
    dominantCandidateCode,
  });
  const provisional = inputs.provisionalMarketYears.find(
    (row) =>
      row.candidateMarket.code === candidate.economy.code &&
      row.year === inputs.release.provisionalYear,
  );

  return {
    economy: candidate.economy,
    score: candidate.score,
    rank: candidate.rank,
    rankTieSize: candidate.rankTieSize,
    rankPercentile: formatFixed(candidate.rankPercentile, 3),
    observedScoreYears: candidate.observedYears,
    missingScoreYears,
    latestFinalizedObservedYear:
      candidate.observedYears[candidate.observedYears.length - 1]!,
    components: {
      marketSize: {
        state: "COMPUTED",
        meanCurrentUsd: formatDecimal(candidate.sizeKusd * 1000),
        percentile: roundHalfUp(candidate.percentiles.size),
        yearsUsed: candidate.observedYears,
      },
      marketGrowth: {
        state: candidate.growth === null ? "NEUTRAL" : "COMPUTED",
        annualRate:
          candidate.growth === null ? null : formatFixed(candidate.growth, 6),
        percentile: roundHalfUp(candidate.percentiles.growth),
        yearsUsed: candidate.growth === null ? [] : candidate.observedYears,
        reasonCodes: candidate.growthReasonCodes,
      },
      recordedFoothold: {
        state: "COMPUTED",
        share: formatFixed(candidate.foothold, 6),
        percentile: roundHalfUp(candidate.percentiles.foothold),
        bilateralFlowState: candidate.bilateralFlowState,
        wording:
          candidate.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
            ? "No recorded bilateral flow in the score window"
            : null,
      },
      supplierDiversity: {
        state: candidate.diversity === null ? "NEUTRAL" : "COMPUTED",
        index:
          candidate.diversity === null
            ? null
            : formatFixed(candidate.diversity, 6),
        percentile: roundHalfUp(candidate.percentiles.diversity),
        yearsUsed: candidate.diversityYears,
        reasonCode:
          candidate.diversity === null
            ? "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR"
            : null,
      },
    },
    confidence,
    quantityCoverageRate:
      candidate.quantityCoverage === null
        ? null
        : formatFixed(candidate.quantityCoverage, 6),
    provisionalEvidence: buildProvisionalEvidence(
      provisional,
      inputs.release.provisionalYear,
    ),
    caveatCodes,
  };
}

function calculateConfidence({
  candidate,
  missingScoreYears,
  cutoffYear,
  discontinuityYears,
  stability,
  exporterHasHistory,
  cohortSize,
}: {
  candidate: RawCandidate;
  missingScoreYears: readonly number[];
  cutoffYear: number;
  discontinuityYears: readonly number[];
  stability: CandidateMarketResult["stability"];
  exporterHasHistory: boolean;
  cohortSize: number;
}): CandidateMarket["confidence"] {
  const deductions: ConfidenceDeduction[] = [];
  addDeduction(
    deductions,
    "MISSING_SCORE_WINDOW_YEARS",
    Math.min(40, missingScoreYears.length * 10),
  );
  addDeduction(
    deductions,
    "MISSING_CUTOFF_YEAR_EVIDENCE",
    candidate.observedYears.includes(cutoffYear) ? 0 : 15,
  );
  addDeduction(
    deductions,
    "SMALL_BASE",
    candidate.sizeKusd < 500 ? 15 : 0,
  );
  addDeduction(
    deductions,
    "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
    candidate.diversity === null ? 10 : 0,
  );
  addDeduction(
    deductions,
    "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
    discontinuityYears.length > 0 ? 15 : 0,
  );
  addDeduction(
    deductions,
    "LOW_WINDOW_STABILITY",
    stability.threeYear.state === "LOW" ||
      stability.tenYear.state === "LOW"
      ? 10
      : 0,
  );
  addDeduction(
    deductions,
    "SMALL_CANDIDATE_COHORT",
    cohortSize < 10 ? 10 : 0,
  );
  addDeduction(
    deductions,
    "NO_EXPORTER_PRODUCT_HISTORY",
    exporterHasHistory ? 0 : 10,
  );
  addDeduction(
    deductions,
    "IDENTITY_PROXY",
    candidate.economy.code === IDENTITY_PROXY_ECONOMY_CODE ? 10 : 0,
  );

  const afterDeductions = Math.max(
    0,
    100 - deductions.reduce((total, deduction) => total + deduction.points, 0),
  );
  const cappedScore =
    candidate.observedYears.length <= 2
      ? Math.min(afterDeductions, 40)
      : afterDeductions;

  return {
    score: cappedScore,
    label:
      cappedScore >= 80 ? "HIGH" : cappedScore >= 50 ? "MEDIUM" : "LOW",
    deductions,
    sparseEvidenceCapApplied: cappedScore < afterDeductions,
  };
}

function addDeduction(
  deductions: ConfidenceDeduction[],
  code: ConfidenceDeductionCode,
  points: number,
) {
  if (points > 0) {
    deductions.push({ code, points });
  }
}

function buildCaveatCodes({
  candidate,
  stability,
  discontinuityYears,
  dominantCandidateCode,
}: {
  candidate: RawCandidate;
  stability: CandidateMarketResult["stability"];
  discontinuityYears: readonly number[];
  dominantCandidateCode: string | null;
}): CaveatCode[] {
  const caveats: CaveatCode[] = [];
  if (candidate.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW") {
    caveats.push("NO_RECORDED_POSITIVE_FLOW");
  }
  if (candidate.economy.code === IDENTITY_PROXY_ECONOMY_CODE) {
    caveats.push("IDENTITY_PROXY");
  }
  if (candidate.growth !== null && Math.abs(candidate.growth) > 0.75) {
    caveats.push("EXTREME_NOMINAL_GROWTH");
  }
  if (candidate.economy.code === dominantCandidateCode) {
    caveats.push("DOMINANT_SIZE_OUTLIER");
  }
  if (discontinuityYears.length > 0) {
    caveats.push("POSSIBLE_PRODUCT_SERIES_DISCONTINUITY");
  }
  if (
    stability.threeYear.state === "LOW" ||
    stability.tenYear.state === "LOW"
  ) {
    caveats.push("LOW_WINDOW_STABILITY");
  } else if (
    stability.threeYear.state === "NOT_ESTIMATED_SMALL_COMMON_COHORT" ||
    stability.tenYear.state === "NOT_ESTIMATED_SMALL_COMMON_COHORT"
  ) {
    caveats.push("STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT");
  }
  return caveats;
}

function buildProvisionalEvidence(
  row: MarketYearEvidence | undefined,
  provisionalYear: number,
): CandidateMarket["provisionalEvidence"] {
  if (row === undefined) {
    return {
      year: provisionalYear,
      marketState: "NO_RECORDED_POSITIVE_FLOW",
      marketImportCurrentUsd: null,
      bilateralState: "NOT_APPLICABLE",
      bilateralCurrentUsd: null,
      recordedBilateralShare: null,
      quantityCoverageRate: null,
    };
  }

  const marketValueKusd = parsePositiveDecimal(
    row.worldValueKusd,
    "provisional.worldValueKusd",
  );
  const bilateralValueKusd =
    row.selectedExporter.state === "RECORDED"
      ? validateRecordedValue(
          parsePositiveDecimal(
            row.selectedExporter.valueKusd,
            "provisional.selectedExporter.valueKusd",
          ),
          marketValueKusd,
          "provisional.selectedExporter.valueKusd",
          "provisional.worldValueKusd",
        )
      : null;

  return {
    year: provisionalYear,
    marketState: "RECORDED",
    marketImportCurrentUsd: formatDecimal(marketValueKusd * 1000),
    bilateralState:
      bilateralValueKusd === null
        ? "NO_RECORDED_POSITIVE_FLOW"
        : "RECORDED",
    bilateralCurrentUsd:
      bilateralValueKusd === null
        ? null
        : formatDecimal(bilateralValueKusd * 1000),
    recordedBilateralShare:
      bilateralValueKusd === null
        ? null
        : formatFixed(bilateralValueKusd / marketValueKusd, 6),
    quantityCoverageRate:
      row.sourceFlowCount === 0
        ? null
        : formatFixed(row.quantityPresentCount / row.sourceFlowCount, 6),
  };
}

function findDominantCandidate(
  candidates: readonly RawCandidate[],
): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const totalSize = candidates.reduce(
    (total, candidate) => total + candidate.sizeKusd,
    0,
  );
  const largest = [...candidates].sort(
    (left, right) => right.sizeKusd - left.sizeKusd,
  )[0]!;

  return largest.sizeKusd / totalSize > 0.5
    ? largest.economy.code
    : null;
}

function findDiscontinuityYears(
  totals: CmsV1Inputs["productYearTotals"],
): number[] {
  const sortedTotals = [...totals].sort((left, right) => left.year - right.year);
  if (sortedTotals.length < 2) {
    return [];
  }

  const changes = sortedTotals.slice(1).map((entry, index) => {
    const previous = sortedTotals[index]!;
    if (entry.year !== previous.year + 1) {
      throw new Error("Product-year totals must be contiguous.");
    }
    const currentValue = parsePositiveDecimal(
      entry.worldValueKusd,
      "productYearTotals.worldValueKusd",
    );
    const previousValue = parsePositiveDecimal(
      previous.worldValueKusd,
      "productYearTotals.worldValueKusd",
    );
    return {
      year: entry.year,
      value: Math.log(currentValue / previousValue),
    };
  });
  const center = median(changes.map(({ value }) => value));
  const mad = median(
    changes.map(({ value }) => Math.abs(value - center)),
  );
  const threshold = Math.max(4 * mad, Math.log(3));

  return changes
    .filter(({ value }) => Math.abs(value - center) > threshold)
    .map(({ year }) => year);
}

function calculateLogLinearGrowth(
  rows: readonly MarketYearEvidence[],
): number {
  const meanYear = mean(rows.map(({ year }) => year));
  const logValues = rows.map((row) =>
    Math.log(parsePositiveDecimal(row.worldValueKusd, "worldValueKusd")),
  );
  const meanLogValue = mean(logValues);
  const numerator = rows.reduce(
    (total, row, index) =>
      total + (row.year - meanYear) * (logValues[index]! - meanLogValue),
    0,
  );
  const denominator = rows.reduce(
    (total, row) => total + (row.year - meanYear) ** 2,
    0,
  );

  return Math.exp(numerator / denominator) - 1;
}

function calculateAnnualDiversity(
  rawShares: readonly string[],
): number | null {
  if (rawShares.length === 0) {
    return null;
  }
  if (rawShares.length === 1) {
    return 0;
  }

  const shares = rawShares.map((share) =>
    parsePositiveDecimal(share, "alternativeSupplierShares"),
  );
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (!nearlyEqual(total, 1)) {
    throw new Error("Alternative supplier shares must sum to one.");
  }

  const supplierCount = shares.length;
  const normalizedHhi =
    (shares.reduce((sum, share) => sum + share ** 2, 0) -
      1 / supplierCount) /
    (1 - 1 / supplierCount);
  return 1 - normalizedHhi;
}

function pearsonCorrelation(
  left: readonly number[],
  right: readonly number[],
): number {
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce(
    (total, value, index) =>
      total + (value - leftMean) * (right[index]! - rightMean),
    0,
  );
  const leftMagnitude = Math.sqrt(
    left.reduce((total, value) => total + (value - leftMean) ** 2, 0),
  );
  const rightMagnitude = Math.sqrt(
    right.reduce((total, value) => total + (value - rightMean) ** 2, 0),
  );

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 1;
  }
  return numerator / (leftMagnitude * rightMagnitude);
}

function parsePositiveDecimal(value: string, field: string): number {
  const parsed = parseNonnegativeDecimal(value, field);
  if (parsed === 0) {
    throw new Error(`${field} must be positive.`);
  }
  return parsed;
}

function validateRecordedValue(
  value: number,
  worldValue: number,
  field: string,
  worldField: string,
): number {
  if (value > worldValue && !nearlyEqual(value, worldValue)) {
    throw new Error(`${field} cannot exceed ${worldField}.`);
  }
  return Math.min(value, worldValue);
}

function parseNonnegativeDecimal(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error(`${field} must be a nonnegative decimal string.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} is outside the supported numeric range.`);
  }
  return parsed;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function yearsBetween(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + Number.EPSILON);
}

function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

function formatDecimal(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
