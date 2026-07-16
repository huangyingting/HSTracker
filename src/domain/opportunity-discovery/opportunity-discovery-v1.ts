import type {
  OpportunityDiscoveryV1CohortInputs,
  OpportunityMarketEvidence,
  OpportunityProductEvidence,
} from "../../evidence/opportunity-evidence-source";
import type {
  AlternateWindowStability,
  EconomyIdentity,
  MarketInvestigationCandidate,
  OpportunityConfidence,
  OpportunityConfidenceDeduction,
  OpportunityConfidenceDeductionCode,
  OpportunityEvidenceFlag,
  OpportunityProvenance,
  OpportunityReleaseRevision,
  OpportunityType,
  ProductIdentity,
} from "./result";

const IDENTITY_PROXY_ECONOMY_CODE = "490";

const SIZE_WEIGHT = 0.65;
const GROWTH_WEIGHT = 0.35;
const PRESENCE_WEIGHT = 0.6;
const FOOTHOLD_WEIGHT = 0.4;
const ATTRACTIVENESS_WEIGHT = 0.55;
const FIT_WEIGHT = 0.45;

const OPPORTUNITY_TYPE_COPY: Record<OpportunityType, string> = {
  UNVALIDATED_MARKET_GAP:
    "Large, attractive market with little or no recorded flow from this exporter — investigate why.",
  EXPANSION_EVIDENCE:
    "Recorded flow already exists in an attractive market where this exporter shows relative strength.",
  GENERAL_INVESTIGATION_EVIDENCE:
    "General investigation candidate ranked within this exporter's cross-product cohort.",
};

// The complete, canonically ordered cohort for one export economy. A candidate
// index serves keyset pages from this; it is the shared reference between the
// fixture adapter and any production adapter.
export type OpportunityCohort = {
  analysisBuildId: string;
  exporter: EconomyIdentity;
  provenance: OpportunityProvenance;
  candidates: readonly MarketInvestigationCandidate[];
};

type ProductAggregate = {
  product: ProductIdentity;
  worldTotalByYear: Map<number, number>;
  exporterTotalByYear: Map<number, number>;
  discontinuityYears: readonly number[];
};

type RowEvidence = {
  rowKey: string;
  product: ProductIdentity;
  market: EconomyIdentity;
  yearValues: Map<number, { worldKusd: number; bilateralKusd: number | null }>;
};

type WindowRow = {
  rowKey: string;
  product: ProductIdentity;
  market: EconomyIdentity;
  observedYears: number[];
  sizeKusd: number;
  growth: number | null;
  growthReasons: ("TOO_FEW_OBSERVED_YEARS" | "SMALL_MARKET_BASE")[];
  presence: number;
  presenceNoExport: boolean;
  foothold: number;
  bilateralFlowState: "RECORDED" | "NO_RECORDED_POSITIVE_FLOW";
  discontinuityYears: readonly number[];
  sizePct: number;
  growthPct: number;
  presencePct: number;
  footholdPct: number;
  attractivenessRaw: number;
  fitRaw: number;
  priorityRaw: number;
};

type RankedRow = WindowRow & {
  priorityDisplay: number;
  attractivenessDisplay: number;
  fitDisplay: number;
  competitionRank: number;
  competitionRankTieSize: number;
  rankPercentile: number;
};

export function computeOpportunityCohort(
  inputs: OpportunityDiscoveryV1CohortInputs,
): OpportunityCohort {
  const cutoffYear = inputs.release.finalizedCutoffYear;
  const scoreWindow = { start: cutoffYear - 4, end: cutoffYear };
  const threeYearWindow = { start: cutoffYear - 2, end: cutoffYear };
  const tenYearWindow = { start: cutoffYear - 9, end: cutoffYear };

  const productsByCode = buildProductAggregates(inputs.products);
  const rows = buildRows(inputs.markets, inputs.exporter, productsByCode);

  const primaryRows = computeWindowRows(rows, productsByCode, scoreWindow);
  const rankedPrimary = rankRows(primaryRows);

  const threeYearPriority = priorityByRowKey(
    computeWindowRows(rows, productsByCode, threeYearWindow),
  );
  const tenYearPriority = priorityByRowKey(
    computeWindowRows(rows, productsByCode, tenYearWindow),
  );
  const previousReleaseRows = buildPreviousReleaseRanking(inputs.previousRelease);

  const candidates = rankedPrimary.map((row) =>
    toCandidate({
      row,
      exporter: inputs.exporter,
      scoreWindow,
      threeYearWindow,
      tenYearWindow,
      threeYearPriority,
      tenYearPriority,
      previousReleaseRows,
    }),
  );

  return {
    analysisBuildId: inputs.analysisBuildId,
    exporter: inputs.exporter,
    provenance: {
      baciRelease: inputs.release.baciRelease,
      sourceUpdateDate: inputs.release.sourceUpdateDate,
      hsRevision: inputs.release.hsRevision,
      finalizedCutoffYear: cutoffYear,
      scoreWindow,
      provisionalYear: inputs.release.provisionalYear,
      recipeVersion: "opportunity-discovery-v1",
      resultSchemaVersion: "market-investigation-result-v1",
      artifactBuildId: inputs.artifact.buildId,
      artifactSchemaVersion: inputs.artifact.schemaVersion,
      artifactSha256: inputs.artifact.sha256,
      valueUnit: "CURRENT_USD",
    },
    candidates,
  };
}

function buildProductAggregates(
  products: readonly OpportunityProductEvidence[],
): Map<string, ProductAggregate> {
  const byCode = new Map<string, ProductAggregate>();
  for (const entry of products) {
    const worldTotalByYear = new Map<number, number>();
    for (const total of entry.worldYearTotals) {
      worldTotalByYear.set(
        total.year,
        parsePositiveDecimal(total.worldValueKusd, "worldYearTotals.worldValueKusd"),
      );
    }
    const exporterTotalByYear = new Map<number, number>();
    for (const total of entry.exporterExportTotals) {
      exporterTotalByYear.set(
        total.year,
        parsePositiveDecimal(total.valueKusd, "exporterExportTotals.valueKusd"),
      );
    }
    byCode.set(entry.product.code, {
      product: entry.product,
      worldTotalByYear,
      exporterTotalByYear,
      discontinuityYears: findDiscontinuityYears(entry.worldYearTotals),
    });
  }
  return byCode;
}

function buildRows(
  markets: readonly OpportunityMarketEvidence[],
  exporter: EconomyIdentity,
  productsByCode: Map<string, ProductAggregate>,
): RowEvidence[] {
  const rows: RowEvidence[] = [];
  for (const market of markets) {
    if (!productsByCode.has(market.product.code)) {
      continue;
    }
    // Eligibility: an economy is never its own foreign market.
    if (market.market.code === exporter.code) {
      continue;
    }
    const yearValues = new Map<
      number,
      { worldKusd: number; bilateralKusd: number | null }
    >();
    for (const row of market.marketYears) {
      const worldKusd = parsePositiveDecimal(row.worldValueKusd, "worldValueKusd");
      const bilateralKusd =
        row.bilateralValueKusd === null
          ? null
          : parsePositiveDecimal(row.bilateralValueKusd, "bilateralValueKusd");
      yearValues.set(row.year, { worldKusd, bilateralKusd });
    }
    rows.push({
      rowKey: `${market.product.code}|${market.market.code}`,
      product: market.product,
      market: market.market,
      yearValues,
    });
  }
  return rows;
}

function computeWindowRows(
  rows: readonly RowEvidence[],
  productsByCode: Map<string, ProductAggregate>,
  window: { start: number; end: number },
): WindowRow[] {
  const windowRows: Omit<
    WindowRow,
    | "sizePct"
    | "growthPct"
    | "presencePct"
    | "footholdPct"
    | "attractivenessRaw"
    | "fitRaw"
    | "priorityRaw"
  >[] = [];

  for (const row of rows) {
    const observedYears: number[] = [];
    const worldValues: number[] = [];
    let sumWorld = 0;
    let sumBilateral = 0;
    for (let year = window.start; year <= window.end; year += 1) {
      const value = row.yearValues.get(year);
      if (value === undefined) {
        continue;
      }
      observedYears.push(year);
      worldValues.push(value.worldKusd);
      sumWorld += value.worldKusd;
      sumBilateral += value.bilateralKusd ?? 0;
    }
    // Eligibility: at least one observed market year inside the window.
    if (observedYears.length === 0) {
      continue;
    }

    const aggregate = productsByCode.get(row.product.code)!;
    const sizeKusd = mean(worldValues);

    const growthReasons: WindowRow["growthReasons"] = [];
    if (observedYears.length < 3) {
      growthReasons.push("TOO_FEW_OBSERVED_YEARS");
    }
    if (sizeKusd < 500) {
      growthReasons.push("SMALL_MARKET_BASE");
    }
    const growth =
      growthReasons.length === 0
        ? calculateLogLinearGrowth(observedYears, worldValues)
        : null;

    let sumExporter = 0;
    let sumWorldProduct = 0;
    for (let year = window.start; year <= window.end; year += 1) {
      sumExporter += aggregate.exporterTotalByYear.get(year) ?? 0;
      sumWorldProduct += aggregate.worldTotalByYear.get(year) ?? 0;
    }
    const presence =
      sumWorldProduct > 0 ? clamp(sumExporter / sumWorldProduct, 0, 1) : 0;

    const foothold = sumWorld > 0 ? clamp(sumBilateral / sumWorld, 0, 1) : 0;

    windowRows.push({
      rowKey: row.rowKey,
      product: row.product,
      market: row.market,
      observedYears,
      sizeKusd,
      growth,
      growthReasons,
      presence,
      presenceNoExport: sumExporter === 0,
      foothold,
      bilateralFlowState:
        sumBilateral > 0 ? "RECORDED" : "NO_RECORDED_POSITIVE_FLOW",
      discontinuityYears: aggregate.discontinuityYears,
    });
  }

  const sizePct = midrankPercentiles(windowRows.map((row) => row.sizeKusd));
  const growthPct = midrankPercentiles(windowRows.map((row) => row.growth));
  const presencePct = midrankPercentiles(windowRows.map((row) => row.presence));
  const footholdPct = midrankPercentiles(windowRows.map((row) => row.foothold));

  return windowRows.map((row, index) => {
    const attractivenessRaw =
      SIZE_WEIGHT * sizePct[index]! + GROWTH_WEIGHT * growthPct[index]!;
    const fitRaw =
      PRESENCE_WEIGHT * presencePct[index]! +
      FOOTHOLD_WEIGHT * footholdPct[index]!;
    const priorityRaw =
      ATTRACTIVENESS_WEIGHT * attractivenessRaw + FIT_WEIGHT * fitRaw;
    return {
      ...row,
      sizePct: sizePct[index]!,
      growthPct: growthPct[index]!,
      presencePct: presencePct[index]!,
      footholdPct: footholdPct[index]!,
      attractivenessRaw,
      fitRaw,
      priorityRaw,
    };
  });
}

function rankRows(windowRows: WindowRow[]): RankedRow[] {
  const ranked: RankedRow[] = windowRows.map((row) => ({
    ...row,
    priorityDisplay: roundHalfUp(row.priorityRaw),
    attractivenessDisplay: roundHalfUp(row.attractivenessRaw),
    fitDisplay: roundHalfUp(row.fitRaw),
    competitionRank: 0,
    competitionRankTieSize: 0,
    rankPercentile: 0,
  }));

  ranked.sort(compareCanonical);

  let groupStart = 0;
  while (groupStart < ranked.length) {
    let groupEnd = groupStart + 1;
    while (
      groupEnd < ranked.length &&
      ranked[groupEnd]!.priorityDisplay === ranked[groupStart]!.priorityDisplay
    ) {
      groupEnd += 1;
    }
    const rank = groupStart + 1;
    const tieSize = groupEnd - groupStart;
    const averagePosition = (rank + groupEnd) / 2;
    const rankPercentile =
      ranked.length === 1
        ? 50
        : (100 * (ranked.length - averagePosition)) / (ranked.length - 1);
    for (let index = groupStart; index < groupEnd; index += 1) {
      ranked[index]!.competitionRank = rank;
      ranked[index]!.competitionRankTieSize = tieSize;
      ranked[index]!.rankPercentile = rankPercentile;
    }
    groupStart = groupEnd;
  }
  return ranked;
}

function compareCanonical(left: RankedRow, right: RankedRow): number {
  return (
    right.priorityDisplay - left.priorityDisplay ||
    right.attractivenessDisplay - left.attractivenessDisplay ||
    right.fitDisplay - left.fitDisplay ||
    left.product.code.localeCompare(right.product.code) ||
    Number(left.market.code) - Number(right.market.code)
  );
}

function priorityByRowKey(windowRows: WindowRow[]): Map<string, number> {
  return new Map(windowRows.map((row) => [row.rowKey, row.priorityRaw]));
}

function buildPreviousReleaseRanking(
  previousRelease: OpportunityDiscoveryV1CohortInputs["previousRelease"],
): Map<string, { priorityRaw: number; rankPercentile: number }> | null {
  if (previousRelease === undefined || previousRelease === null) {
    return null;
  }
  const productsByCode = buildProductAggregates(previousRelease.products);
  const rows = buildRowsForComparison(previousRelease.markets, productsByCode);
  const window = {
    start: previousRelease.finalizedCutoffYear - 4,
    end: previousRelease.finalizedCutoffYear,
  };
  const ranked = rankRows(computeWindowRows(rows, productsByCode, window));
  return new Map(
    ranked.map((row) => [
      row.rowKey,
      { priorityRaw: row.priorityRaw, rankPercentile: row.rankPercentile },
    ]),
  );
}

function buildRowsForComparison(
  markets: readonly OpportunityMarketEvidence[],
  productsByCode: Map<string, ProductAggregate>,
): RowEvidence[] {
  const rows: RowEvidence[] = [];
  for (const market of markets) {
    if (!productsByCode.has(market.product.code)) {
      continue;
    }
    const yearValues = new Map<
      number,
      { worldKusd: number; bilateralKusd: number | null }
    >();
    for (const row of market.marketYears) {
      const worldKusd = parsePositiveDecimal(row.worldValueKusd, "worldValueKusd");
      const bilateralKusd =
        row.bilateralValueKusd === null
          ? null
          : parsePositiveDecimal(row.bilateralValueKusd, "bilateralValueKusd");
      yearValues.set(row.year, { worldKusd, bilateralKusd });
    }
    rows.push({
      rowKey: `${market.product.code}|${market.market.code}`,
      product: market.product,
      market: market.market,
      yearValues,
    });
  }
  return rows;
}

function toCandidate({
  row,
  exporter,
  scoreWindow,
  threeYearWindow,
  tenYearWindow,
  threeYearPriority,
  tenYearPriority,
  previousReleaseRows,
}: {
  row: RankedRow;
  exporter: EconomyIdentity;
  scoreWindow: { start: number; end: number };
  threeYearWindow: { start: number; end: number };
  tenYearWindow: { start: number; end: number };
  threeYearPriority: Map<string, number>;
  tenYearPriority: Map<string, number>;
  previousReleaseRows: Map<
    string,
    { priorityRaw: number; rankPercentile: number }
  > | null;
}): MarketInvestigationCandidate {
  const missingMarketYears: number[] = [];
  for (let year = scoreWindow.start; year <= scoreWindow.end; year += 1) {
    if (!row.observedYears.includes(year)) {
      missingMarketYears.push(year);
    }
  }

  const threeYear = alternateStability(
    row,
    threeYearWindow,
    threeYearPriority,
  );
  const tenYear = alternateStability(row, tenYearWindow, tenYearPriority);
  const releaseRevision = buildReleaseRevision(row, previousReleaseRows);

  const isIdentityProxy = row.market.code === IDENTITY_PROXY_ECONOMY_CODE;
  const confidence = computeConfidence({
    missingMarketYears,
    observedYears: row.observedYears,
    cutoffYear: scoreWindow.end,
    growthNeutral: row.growth === null,
    presenceNoExport: row.presenceNoExport,
    discontinuity: row.discontinuityYears.length > 0,
    lowStability:
      threeYear.state === "LOW_ALTERNATE_WINDOW_STABILITY" ||
      tenYear.state === "LOW_ALTERNATE_WINDOW_STABILITY",
    materialRevision: releaseRevision.state === "MATERIAL_RELEASE_REVISION",
    identityProxy: isIdentityProxy,
  });

  const opportunityType = classifyOpportunity(row);
  const evidenceFlags = buildEvidenceFlags(row, isIdentityProxy);

  return {
    product: row.product,
    market: row.market,
    investigationPriority: {
      rawUnrounded: formatFixed(row.priorityRaw, 6),
      display: row.priorityDisplay,
    },
    marketAttractiveness: {
      rawUnrounded: formatFixed(row.attractivenessRaw, 6),
      display: row.attractivenessDisplay,
    },
    exporterFit: {
      rawUnrounded: formatFixed(row.fitRaw, 6),
      display: row.fitDisplay,
    },
    components: {
      marketSize: {
        state: "COMPUTED",
        rawValue: formatDecimal(row.sizeKusd * 1000),
        percentileUnrounded: formatFixed(row.sizePct, 6),
        percentileBasisPoints: roundHalfUp(row.sizePct * 100),
        percentileDisplay: roundHalfUp(row.sizePct),
      },
      marketGrowth: {
        state: row.growth === null ? "NEUTRAL" : "COMPUTED",
        rawValue: row.growth === null ? null : formatFixed(row.growth, 6),
        percentileUnrounded: formatFixed(row.growthPct, 6),
        percentileBasisPoints: roundHalfUp(row.growthPct * 100),
        percentileDisplay: roundHalfUp(row.growthPct),
        ...(row.growth === null
          ? { neutralReasonCodes: row.growthReasons }
          : {}),
      },
      exporterProductPresence: {
        state: "COMPUTED",
        rawValue: formatFixed(row.presence, 6),
        percentileUnrounded: formatFixed(row.presencePct, 6),
        percentileBasisPoints: roundHalfUp(row.presencePct * 100),
        percentileDisplay: roundHalfUp(row.presencePct),
        ...(row.presenceNoExport
          ? { evidenceTag: "NO_RECORDED_PRODUCT_EXPORT" as const }
          : {}),
      },
      recordedFoothold: {
        state: "COMPUTED",
        rawValue: formatFixed(row.foothold, 6),
        percentileUnrounded: formatFixed(row.footholdPct, 6),
        percentileBasisPoints: roundHalfUp(row.footholdPct * 100),
        percentileDisplay: roundHalfUp(row.footholdPct),
        ...(row.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
          ? { evidenceTag: "NO_RECORDED_POSITIVE_FLOW" as const }
          : {}),
      },
    },
    opportunityType,
    opportunityTypeCopy: OPPORTUNITY_TYPE_COPY[opportunityType],
    bilateralFlowState: row.bilateralFlowState,
    bilateralWording:
      row.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
        ? "No recorded bilateral flow from this exporter in the five-year score window"
        : null,
    observedMarketYears: row.observedYears,
    missingMarketYears,
    confidence,
    stability: { threeYear, tenYear },
    releaseRevision,
    evidenceFlags,
    competitionRank: row.competitionRank,
    competitionRankTieSize: row.competitionRankTieSize,
    candidateMarketDrillDown: {
      recipe: "candidate-market-v1",
      exporterCode: exporter.code,
      product: row.product,
      focusMarketCode: row.market.code,
    },
  };
}

function alternateStability(
  row: RankedRow,
  window: { start: number; end: number },
  priorityByKey: Map<string, number>,
): AlternateWindowStability {
  const alternate = priorityByKey.get(row.rowKey);
  if (alternate === undefined) {
    return { window, state: "COHORT_EXIT", priorityDelta: null };
  }
  const delta = Math.abs(row.priorityRaw - alternate);
  return {
    window,
    state:
      delta >= 15 ? "LOW_ALTERNATE_WINDOW_STABILITY" : "NOT_FLAGGED",
    priorityDelta: formatFixed(delta, 6),
  };
}

function buildReleaseRevision(
  row: RankedRow,
  previousReleaseRows: Map<
    string,
    { priorityRaw: number; rankPercentile: number }
  > | null,
): OpportunityReleaseRevision {
  if (previousReleaseRows === null) {
    return {
      state: "NOT_COMPARED",
      priorityDelta: null,
      rankPercentileDelta: null,
      cohortTransition: null,
    };
  }
  const previous = previousReleaseRows.get(row.rowKey);
  if (previous === undefined) {
    return {
      state: "NOT_FLAGGED",
      priorityDelta: null,
      rankPercentileDelta: null,
      cohortTransition: "COHORT_ENTRY",
    };
  }
  const priorityDelta = Math.abs(row.priorityRaw - previous.priorityRaw);
  const rankPercentileDelta = Math.abs(
    row.rankPercentile - previous.rankPercentile,
  );
  return {
    state:
      priorityDelta >= 10 || rankPercentileDelta >= 15
        ? "MATERIAL_RELEASE_REVISION"
        : "NOT_FLAGGED",
    priorityDelta: formatFixed(priorityDelta, 6),
    rankPercentileDelta: formatFixed(rankPercentileDelta, 6),
    cohortTransition: "COMMON",
  };
}

function classifyOpportunity(row: RankedRow): OpportunityType {
  if (
    row.attractivenessRaw >= 70 &&
    (row.footholdPct <= 20 ||
      row.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW")
  ) {
    return "UNVALIDATED_MARKET_GAP";
  }
  if (
    row.bilateralFlowState === "RECORDED" &&
    row.attractivenessRaw >= 60 &&
    row.fitRaw >= 60
  ) {
    return "EXPANSION_EVIDENCE";
  }
  return "GENERAL_INVESTIGATION_EVIDENCE";
}

function buildEvidenceFlags(
  row: RankedRow,
  isIdentityProxy: boolean,
): OpportunityEvidenceFlag[] {
  const flags: OpportunityEvidenceFlag[] = [];
  if (row.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW") {
    flags.push("NO_RECORDED_BILATERAL_FLOW");
  }
  if (row.presenceNoExport) {
    flags.push("NO_RECORDED_PRODUCT_EXPORT");
  }
  if (row.growth !== null && Math.abs(row.growth) > 0.75) {
    flags.push("EXTREME_NOMINAL_GROWTH");
  }
  if (isIdentityProxy) {
    flags.push("IDENTITY_PROXY");
  }
  return flags;
}

function computeConfidence({
  missingMarketYears,
  observedYears,
  cutoffYear,
  growthNeutral,
  presenceNoExport,
  discontinuity,
  lowStability,
  materialRevision,
  identityProxy,
}: {
  missingMarketYears: readonly number[];
  observedYears: readonly number[];
  cutoffYear: number;
  growthNeutral: boolean;
  presenceNoExport: boolean;
  discontinuity: boolean;
  lowStability: boolean;
  materialRevision: boolean;
  identityProxy: boolean;
}): OpportunityConfidence {
  const deductions: OpportunityConfidenceDeduction[] = [];
  addDeduction(
    deductions,
    "MISSING_FINALIZED_MARKET_YEARS",
    Math.min(40, missingMarketYears.length * 10),
  );
  addDeduction(
    deductions,
    "MISSING_CUTOFF_YEAR_MARKET_EVIDENCE",
    observedYears.includes(cutoffYear) ? 0 : 15,
  );
  addDeduction(deductions, "NEUTRAL_MARKET_GROWTH", growthNeutral ? 10 : 0);
  addDeduction(
    deductions,
    "NO_EXPORTER_PRODUCT_HISTORY",
    presenceNoExport ? 20 : 0,
  );
  addDeduction(
    deductions,
    "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
    discontinuity ? 15 : 0,
  );
  addDeduction(
    deductions,
    "LOW_ALTERNATE_WINDOW_STABILITY",
    lowStability ? 10 : 0,
  );
  addDeduction(
    deductions,
    "MATERIAL_RELEASE_REVISION",
    materialRevision ? 10 : 0,
  );
  addDeduction(deductions, "IDENTITY_PROXY", identityProxy ? 10 : 0);

  const afterDeductions = Math.max(
    0,
    100 - deductions.reduce((total, deduction) => total + deduction.points, 0),
  );
  const cappedScore =
    observedYears.length <= 2 ? Math.min(afterDeductions, 40) : afterDeductions;

  return {
    score: cappedScore,
    label: cappedScore >= 80 ? "HIGH" : cappedScore >= 50 ? "MEDIUM" : "LOW",
    deductions,
    sparseEvidenceCapApplied: cappedScore < afterDeductions,
  };
}

function addDeduction(
  deductions: OpportunityConfidenceDeduction[],
  code: OpportunityConfidenceDeductionCode,
  points: number,
): void {
  if (points > 0) {
    deductions.push({ code, points });
  }
}

// --- Numeric helpers (mirrors src/domain/candidate-market/cms-v1.ts so both
// recipes round, rank, and parse identically). ---

function midrankPercentiles(values: readonly (number | null)[]): number[] {
  const pool = values
    .map((value, index) => ({ value, index }))
    .filter(
      (entry): entry is { value: number; index: number } =>
        entry.value !== null,
    )
    .sort((left, right) => left.value - right.value);

  const result = new Array<number>(values.length).fill(50);
  const size = pool.length;
  let index = 0;
  while (index < size) {
    let groupEnd = index + 1;
    while (
      groupEnd < size &&
      nearlyEqual(pool[groupEnd]!.value, pool[index]!.value)
    ) {
      groupEnd += 1;
    }
    const averageRank = (index + 1 + groupEnd) / 2;
    const percentile = (100 * (averageRank - 0.5)) / size;
    for (let tied = index; tied < groupEnd; tied += 1) {
      result[pool[tied]!.index] = percentile;
    }
    index = groupEnd;
  }
  return result;
}

function calculateLogLinearGrowth(
  years: readonly number[],
  values: readonly number[],
): number {
  const meanYear = mean(years);
  const logValues = values.map((value) => Math.log(value));
  const meanLogValue = mean(logValues);
  const numerator = years.reduce(
    (total, year, index) =>
      total + (year - meanYear) * (logValues[index]! - meanLogValue),
    0,
  );
  const denominator = years.reduce(
    (total, year) => total + (year - meanYear) ** 2,
    0,
  );
  return Math.exp(numerator / denominator) - 1;
}

function findDiscontinuityYears(
  totals: readonly { year: number; worldValueKusd: string }[],
): number[] {
  const sorted = [...totals].sort((left, right) => left.year - right.year);
  if (sorted.length < 2) {
    return [];
  }
  const changes = sorted.slice(1).map((entry, index) => {
    const previous = sorted[index]!;
    const currentValue = parsePositiveDecimal(
      entry.worldValueKusd,
      "worldYearTotals.worldValueKusd",
    );
    const previousValue = parsePositiveDecimal(
      previous.worldValueKusd,
      "worldYearTotals.worldValueKusd",
    );
    return { year: entry.year, value: Math.log(currentValue / previousValue) };
  });
  const center = median(changes.map(({ value }) => value));
  const mad = median(changes.map(({ value }) => Math.abs(value - center)));
  const threshold = Math.max(4 * mad, Math.log(3));
  return changes
    .filter(({ value }) => Math.abs(value - center) > threshold)
    .map(({ year }) => year);
}

function parsePositiveDecimal(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error(`${field} must be a nonnegative decimal string.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} is outside the supported numeric range.`);
  }
  if (parsed === 0) {
    throw new Error(`${field} must be positive.`);
  }
  return parsed;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
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
