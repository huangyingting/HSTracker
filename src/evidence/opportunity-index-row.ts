// The Opportunity Index row parity seam.
//
// This module is the single source of truth for how one public
// `MarketInvestigationCandidate` is projected into the persisted Opportunity
// Index grain and reconstructed byte-for-byte back out again. The offline build
// (`scripts/release/opportunity-index.ts`) uses `candidateToIndexRow` to write
// rows; the production adapter (`DuckDbOpportunityCandidateIndex`) uses
// `indexRowToCandidate` to serve them. Keeping both directions here guarantees
// the round trip stays lossless as the recipe evolves.
//
// Per the architecture decision recorded for issue #52, the index persists the
// full rich feed grain (every non-derivable candidate field) so serving is a
// pure index read. Only truly derivable data is reconstructed rather than
// stored: public copy, wording, confidence labels/deductions, component states,
// bilateral state, evidence tags, the competition tie size (a SQL window), the
// drill-down link, and the release-revision constant for a first release.
// Economy/product labels are still joined from the compatible dimensions and
// never duplicated into the index.

import {
  NO_RECORDED_BILATERAL_FLOW_WORDING,
  OPPORTUNITY_TYPE_COPY,
} from "../domain/opportunity-discovery/opportunity-discovery-v1";
import type {
  AlternateWindowStability,
  EconomyIdentity,
  MarketGrowthNeutralReasonCode,
  MarketInvestigationCandidate,
  OpportunityComponent,
  OpportunityConfidence,
  OpportunityConfidenceDeduction,
  OpportunityConfidenceDeductionCode,
  OpportunityEvidenceFlag,
  OpportunityType,
  ProductIdentity,
} from "../domain/opportunity-discovery/result";

// --- Stable enum / bit orderings. These orderings are part of the index
// identity: the numeric code in `opportunity_type`, the bit positions in the
// two flag bitsets, the growth neutral-reason bits, and the stability-state
// codes are the array indexes below and are also published in the index
// dictionary tables. They mirror the public result contract (result.ts) and the
// order in which `opportunity-discovery-v1` emits each value, so they must never
// be reordered. ---

export const OPPORTUNITY_TYPE_ORDER: readonly OpportunityType[] = [
  "UNVALIDATED_MARKET_GAP",
  "EXPANSION_EVIDENCE",
  "GENERAL_INVESTIGATION_EVIDENCE",
];

export const CONFIDENCE_FLAG_ORDER: readonly OpportunityConfidenceDeductionCode[] =
  [
    "MISSING_FINALIZED_MARKET_YEARS",
    "MISSING_CUTOFF_YEAR_MARKET_EVIDENCE",
    "NEUTRAL_MARKET_GROWTH",
    "NO_EXPORTER_PRODUCT_HISTORY",
    "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
    "LOW_ALTERNATE_WINDOW_STABILITY",
    "MATERIAL_RELEASE_REVISION",
    "IDENTITY_PROXY",
  ];

export const EVIDENCE_FLAG_ORDER: readonly OpportunityEvidenceFlag[] = [
  "NO_RECORDED_BILATERAL_FLOW",
  "NO_RECORDED_PRODUCT_EXPORT",
  "EXTREME_NOMINAL_GROWTH",
  "IDENTITY_PROXY",
];

export const GROWTH_NEUTRAL_REASON_ORDER: readonly MarketGrowthNeutralReasonCode[] =
  ["TOO_FEW_OBSERVED_YEARS", "SMALL_MARKET_BASE"];

export const STABILITY_STATE_ORDER: readonly AlternateWindowStability["state"][] =
  ["NOT_FLAGGED", "LOW_ALTERNATE_WINDOW_STABILITY", "COHORT_ENTRY", "COHORT_EXIT"];

// Fixed section 6.2 deduction points. MISSING_FINALIZED_MARKET_YEARS is the one
// variable deduction (min(40, missing_years*10)); every other code contributes a
// constant when its confidence-flag bit is set.
const CONFIDENCE_DEDUCTION_FIXED_POINTS: Partial<
  Record<OpportunityConfidenceDeductionCode, number>
> = {
  MISSING_CUTOFF_YEAR_MARKET_EVIDENCE: 15,
  NEUTRAL_MARKET_GROWTH: 10,
  NO_EXPORTER_PRODUCT_HISTORY: 20,
  POSSIBLE_PRODUCT_SERIES_DISCONTINUITY: 15,
  LOW_ALTERNATE_WINDOW_STABILITY: 10,
  MATERIAL_RELEASE_REVISION: 10,
  IDENTITY_PROXY: 10,
};

const OPPORTUNITY_TYPE_CODE = new Map<OpportunityType, number>(
  OPPORTUNITY_TYPE_ORDER.map((type, index) => [type, index]),
);
const CONFIDENCE_FLAG_BIT = new Map<OpportunityConfidenceDeductionCode, number>(
  CONFIDENCE_FLAG_ORDER.map((code, index) => [code, index]),
);
const EVIDENCE_FLAG_BIT = new Map<OpportunityEvidenceFlag, number>(
  EVIDENCE_FLAG_ORDER.map((flag, index) => [flag, index]),
);
const GROWTH_NEUTRAL_REASON_BIT = new Map<MarketGrowthNeutralReasonCode, number>(
  GROWTH_NEUTRAL_REASON_ORDER.map((code, index) => [code, index]),
);
const STABILITY_STATE_CODE = new Map<AlternateWindowStability["state"], number>(
  STABILITY_STATE_ORDER.map((state, index) => [state, index]),
);

export class OpportunityIndexRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityIndexRowError";
  }
}

// The complete persisted grain, one row per eligible
// (exporter, product, importer) tuple. Field order matches
// data/schemas/opportunity-index-v1.sql and the appender in the build module;
// changing one requires changing all three.
export type OpportunityIndexRow = {
  exporterCode: number;
  productId: number;
  importerCode: number;
  priorityDisplay: number;
  attractivenessDisplay: number;
  exporterFitDisplay: number;
  marketSizePercentileBp: number;
  marketGrowthPercentileBp: number;
  productPresencePercentileBp: number;
  footholdPercentileBp: number;
  competitionRank: number;
  opportunityType: number;
  confidenceScore: number;
  confidenceFlags: number;
  evidenceFlags: number;
  // Rich grain (issue #52).
  priorityRawMicros: number;
  attractivenessRawMicros: number;
  exporterFitRawMicros: number;
  marketSizePercentileMicros: number;
  marketGrowthPercentileMicros: number;
  productPresencePercentileMicros: number;
  footholdPercentileMicros: number;
  marketSizePercentileDisplay: number;
  marketGrowthPercentileDisplay: number;
  productPresencePercentileDisplay: number;
  footholdPercentileDisplay: number;
  marketSizeRawValue: string;
  // `null` iff market growth is NEUTRAL (no computable growth for the window).
  marketGrowthRawValueMicros: bigint | null;
  productPresenceRawValueMicros: number;
  footholdRawValueMicros: number;
  observedYearsMask: number;
  growthNeutralReasons: number;
  stabilityThreeYearState: number;
  stabilityTenYearState: number;
  // `null` iff the corresponding stability state is COHORT_EXIT.
  stabilityThreeYearDeltaMicros: number | null;
  stabilityTenYearDeltaMicros: number | null;
};

type WindowBounds = { start: number; end: number };

// --- Six-decimal fixed-point codecs. Every rawUnrounded/percentileUnrounded
// value in the public contract is `value.toFixed(6)`, so it always carries
// exactly six fraction digits. We store the scaled integer parsed directly from
// that string (never re-rounding a float) and rebuild the identical string, so
// the round trip is exact regardless of magnitude or sign. ---

const FIXED6_PATTERN = /^(-?)(\d+)\.(\d{6})$/;

export function fixed6ToBigMicros(value: string): bigint {
  const match = FIXED6_PATTERN.exec(value);
  if (match === null) {
    throw new OpportunityIndexRowError(
      `Value ${JSON.stringify(value)} is not a six-decimal fixed string.`,
    );
  }
  const magnitude = BigInt(`${match[2]}${match[3]}`);
  return match[1] === "-" ? -magnitude : magnitude;
}

export function bigMicrosToFixed6(micros: bigint): string {
  const negative = micros < 0n;
  const magnitude = negative ? -micros : micros;
  const whole = magnitude / 1_000_000n;
  const fraction = (magnitude % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

// Convenience wrappers for the bounded, non-negative values (axis raws,
// percentiles, [0,1] indicators, stability deltas) that always fit in a JS
// safe integer. Storing them as UINTEGER keeps the index compact.
function fixed6ToMicros(value: string): number {
  return Number(fixed6ToBigMicros(value));
}

function microsToFixed6(micros: number): string {
  return bigMicrosToFixed6(BigInt(micros));
}

function observedYearsToMask(
  observedMarketYears: readonly number[],
  scoreWindow: WindowBounds,
): number {
  let mask = 0;
  for (const year of observedMarketYears) {
    const offset = year - scoreWindow.start;
    if (offset < 0 || offset > scoreWindow.end - scoreWindow.start) {
      throw new OpportunityIndexRowError(
        `Observed year ${year} is outside the score window.`,
      );
    }
    mask |= 1 << offset;
  }
  return mask;
}

function maskToObservedYears(
  mask: number,
  scoreWindow: WindowBounds,
): number[] {
  const years: number[] = [];
  for (let year = scoreWindow.start; year <= scoreWindow.end; year += 1) {
    if ((mask & (1 << (year - scoreWindow.start))) !== 0) {
      years.push(year);
    }
  }
  return years;
}

function maskToMissingYears(mask: number, scoreWindow: WindowBounds): number[] {
  const years: number[] = [];
  for (let year = scoreWindow.start; year <= scoreWindow.end; year += 1) {
    if ((mask & (1 << (year - scoreWindow.start))) === 0) {
      years.push(year);
    }
  }
  return years;
}

function bitsFromCodes<T>(codes: readonly T[], bitOf: Map<T, number>): number {
  let bits = 0;
  for (const code of codes) {
    const bit = bitOf.get(code);
    if (bit === undefined) {
      throw new OpportunityIndexRowError(
        `No stable bit assignment for ${String(code)}.`,
      );
    }
    bits |= 1 << bit;
  }
  return bits;
}

function requireCode<T>(map: Map<T, number>, key: T): number {
  const code = map.get(key);
  if (code === undefined) {
    throw new OpportunityIndexRowError(
      `No stable code assignment for ${String(key)}.`,
    );
  }
  return code;
}

// --- Forward projection: candidate -> persisted row. ---

export function candidateToIndexRow(
  candidate: MarketInvestigationCandidate,
  exporterCode: number,
  productId: number,
  scoreWindow: WindowBounds,
): OpportunityIndexRow {
  const { marketSize, marketGrowth, exporterProductPresence, recordedFoothold } =
    candidate.components;

  const marketGrowthRawValueMicros =
    marketGrowth.rawValue === null
      ? null
      : fixed6ToBigMicros(marketGrowth.rawValue);
  if (marketGrowth.rawValue === null && marketGrowth.state !== "NEUTRAL") {
    throw new OpportunityIndexRowError(
      "Market growth without a raw value must be NEUTRAL.",
    );
  }

  return {
    exporterCode,
    productId,
    importerCode: Number(candidate.market.code),
    priorityDisplay: candidate.investigationPriority.display,
    attractivenessDisplay: candidate.marketAttractiveness.display,
    exporterFitDisplay: candidate.exporterFit.display,
    marketSizePercentileBp: marketSize.percentileBasisPoints,
    marketGrowthPercentileBp: marketGrowth.percentileBasisPoints,
    productPresencePercentileBp: exporterProductPresence.percentileBasisPoints,
    footholdPercentileBp: recordedFoothold.percentileBasisPoints,
    competitionRank: candidate.competitionRank,
    opportunityType: requireCode(OPPORTUNITY_TYPE_CODE, candidate.opportunityType),
    confidenceScore: candidate.confidence.score,
    confidenceFlags: bitsFromCodes(
      candidate.confidence.deductions.map((deduction) => deduction.code),
      CONFIDENCE_FLAG_BIT,
    ),
    evidenceFlags: bitsFromCodes(candidate.evidenceFlags, EVIDENCE_FLAG_BIT),
    priorityRawMicros: fixed6ToMicros(candidate.investigationPriority.rawUnrounded),
    attractivenessRawMicros: fixed6ToMicros(
      candidate.marketAttractiveness.rawUnrounded,
    ),
    exporterFitRawMicros: fixed6ToMicros(candidate.exporterFit.rawUnrounded),
    marketSizePercentileMicros: fixed6ToMicros(marketSize.percentileUnrounded),
    marketGrowthPercentileMicros: fixed6ToMicros(
      marketGrowth.percentileUnrounded,
    ),
    productPresencePercentileMicros: fixed6ToMicros(
      exporterProductPresence.percentileUnrounded,
    ),
    footholdPercentileMicros: fixed6ToMicros(recordedFoothold.percentileUnrounded),
    marketSizePercentileDisplay: marketSize.percentileDisplay,
    marketGrowthPercentileDisplay: marketGrowth.percentileDisplay,
    productPresencePercentileDisplay: exporterProductPresence.percentileDisplay,
    footholdPercentileDisplay: recordedFoothold.percentileDisplay,
    marketSizeRawValue: requireRawValue(marketSize, "marketSize"),
    marketGrowthRawValueMicros,
    productPresenceRawValueMicros: fixed6ToMicros(
      requireRawValue(exporterProductPresence, "exporterProductPresence"),
    ),
    footholdRawValueMicros: fixed6ToMicros(
      requireRawValue(recordedFoothold, "recordedFoothold"),
    ),
    observedYearsMask: observedYearsToMask(
      candidate.observedMarketYears,
      scoreWindow,
    ),
    growthNeutralReasons:
      marketGrowth.neutralReasonCodes === undefined
        ? 0
        : bitsFromCodes(marketGrowth.neutralReasonCodes, GROWTH_NEUTRAL_REASON_BIT),
    stabilityThreeYearState: requireCode(
      STABILITY_STATE_CODE,
      candidate.stability.threeYear.state,
    ),
    stabilityTenYearState: requireCode(
      STABILITY_STATE_CODE,
      candidate.stability.tenYear.state,
    ),
    stabilityThreeYearDeltaMicros: stabilityDeltaMicros(
      candidate.stability.threeYear,
    ),
    stabilityTenYearDeltaMicros: stabilityDeltaMicros(candidate.stability.tenYear),
  };
}

function requireRawValue(
  component: OpportunityComponent,
  name: string,
): string {
  if (component.rawValue === null) {
    throw new OpportunityIndexRowError(
      `Component ${name} must carry a raw value.`,
    );
  }
  return component.rawValue;
}

function stabilityDeltaMicros(stability: AlternateWindowStability): number | null {
  return stability.priorityDelta === null
    ? null
    : fixed6ToMicros(stability.priorityDelta);
}

// --- Reverse reconstruction: persisted row -> candidate. `product`/`market`
// are the labels joined from the compatible dimensions; `competitionRankTieSize`
// is the SQL window count over (exporter, competition_rank); `scoreWindow` and
// `hasPreviousRelease` come from the verified index manifest. ---

export function indexRowToCandidate(
  row: OpportunityIndexRow,
  context: {
    product: ProductIdentity;
    market: EconomyIdentity;
    exporterCode: string;
    competitionRankTieSize: number;
    scoreWindow: WindowBounds;
    hasPreviousRelease: boolean;
  },
): MarketInvestigationCandidate {
  if (context.hasPreviousRelease) {
    throw new OpportunityIndexRowError(
      "Reconstruction from a release-compared index is not supported; the index must persist release-revision fields first.",
    );
  }

  const cutoffYear = context.scoreWindow.end;
  const observedMarketYears = maskToObservedYears(
    row.observedYearsMask,
    context.scoreWindow,
  );
  const missingMarketYears = maskToMissingYears(
    row.observedYearsMask,
    context.scoreWindow,
  );
  const evidenceFlags = decodeFlags(row.evidenceFlags, EVIDENCE_FLAG_ORDER);
  const bilateralFlowState = evidenceFlags.includes("NO_RECORDED_BILATERAL_FLOW")
    ? "NO_RECORDED_POSITIVE_FLOW"
    : "RECORDED";
  const opportunityType = OPPORTUNITY_TYPE_ORDER[row.opportunityType];
  if (opportunityType === undefined) {
    throw new OpportunityIndexRowError(
      `Unknown opportunity type code ${row.opportunityType}.`,
    );
  }

  return {
    product: context.product,
    market: context.market,
    investigationPriority: {
      rawUnrounded: microsToFixed6(row.priorityRawMicros),
      display: row.priorityDisplay,
    },
    marketAttractiveness: {
      rawUnrounded: microsToFixed6(row.attractivenessRawMicros),
      display: row.attractivenessDisplay,
    },
    exporterFit: {
      rawUnrounded: microsToFixed6(row.exporterFitRawMicros),
      display: row.exporterFitDisplay,
    },
    components: {
      marketSize: {
        state: "COMPUTED",
        rawValue: row.marketSizeRawValue,
        percentileUnrounded: microsToFixed6(row.marketSizePercentileMicros),
        percentileBasisPoints: row.marketSizePercentileBp,
        percentileDisplay: row.marketSizePercentileDisplay,
      },
      marketGrowth: {
        state: row.marketGrowthRawValueMicros === null ? "NEUTRAL" : "COMPUTED",
        rawValue:
          row.marketGrowthRawValueMicros === null
            ? null
            : bigMicrosToFixed6(row.marketGrowthRawValueMicros),
        percentileUnrounded: microsToFixed6(row.marketGrowthPercentileMicros),
        percentileBasisPoints: row.marketGrowthPercentileBp,
        percentileDisplay: row.marketGrowthPercentileDisplay,
        ...(row.marketGrowthRawValueMicros === null
          ? {
              neutralReasonCodes: decodeFlags(
                row.growthNeutralReasons,
                GROWTH_NEUTRAL_REASON_ORDER,
              ),
            }
          : {}),
      },
      exporterProductPresence: {
        state: "COMPUTED",
        rawValue: microsToFixed6(row.productPresenceRawValueMicros),
        percentileUnrounded: microsToFixed6(row.productPresencePercentileMicros),
        percentileBasisPoints: row.productPresencePercentileBp,
        percentileDisplay: row.productPresencePercentileDisplay,
        ...(evidenceFlags.includes("NO_RECORDED_PRODUCT_EXPORT")
          ? { evidenceTag: "NO_RECORDED_PRODUCT_EXPORT" as const }
          : {}),
      },
      recordedFoothold: {
        state: "COMPUTED",
        rawValue: microsToFixed6(row.footholdRawValueMicros),
        percentileUnrounded: microsToFixed6(row.footholdPercentileMicros),
        percentileBasisPoints: row.footholdPercentileBp,
        percentileDisplay: row.footholdPercentileDisplay,
        ...(bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
          ? { evidenceTag: "NO_RECORDED_POSITIVE_FLOW" as const }
          : {}),
      },
    },
    opportunityType,
    opportunityTypeCopy: OPPORTUNITY_TYPE_COPY[opportunityType],
    bilateralFlowState,
    bilateralWording:
      bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
        ? NO_RECORDED_BILATERAL_FLOW_WORDING
        : null,
    observedMarketYears,
    missingMarketYears,
    confidence: reconstructConfidence(
      row.confidenceFlags,
      row.confidenceScore,
      missingMarketYears.length,
    ),
    stability: {
      threeYear: reconstructStability(
        row.stabilityThreeYearState,
        row.stabilityThreeYearDeltaMicros,
        { start: cutoffYear - 2, end: cutoffYear },
      ),
      tenYear: reconstructStability(
        row.stabilityTenYearState,
        row.stabilityTenYearDeltaMicros,
        { start: cutoffYear - 9, end: cutoffYear },
      ),
    },
    releaseRevision: {
      state: "NOT_COMPARED",
      priorityDelta: null,
      rankPercentileDelta: null,
      cohortTransition: null,
    },
    evidenceFlags,
    competitionRank: row.competitionRank,
    competitionRankTieSize: context.competitionRankTieSize,
    candidateMarketDrillDown: {
      recipe: "candidate-market-v1",
      exporterCode: context.exporterCode,
      product: context.product,
      focusMarketCode: context.market.code,
    },
  };
}

function decodeFlags<T>(bits: number, order: readonly T[]): T[] {
  const flags: T[] = [];
  order.forEach((flag, bit) => {
    if ((bits & (1 << bit)) !== 0) {
      flags.push(flag);
    }
  });
  return flags;
}

function reconstructConfidence(
  confidenceFlags: number,
  score: number,
  missingYearCount: number,
): OpportunityConfidence {
  const deductions: OpportunityConfidenceDeduction[] = [];
  CONFIDENCE_FLAG_ORDER.forEach((code, bit) => {
    if ((confidenceFlags & (1 << bit)) === 0) {
      return;
    }
    const points =
      code === "MISSING_FINALIZED_MARKET_YEARS"
        ? Math.min(40, missingYearCount * 10)
        : CONFIDENCE_DEDUCTION_FIXED_POINTS[code];
    if (points === undefined) {
      throw new OpportunityIndexRowError(
        `No deduction points defined for ${code}.`,
      );
    }
    deductions.push({ code, points });
  });
  const afterDeductions = Math.max(
    0,
    100 - deductions.reduce((total, deduction) => total + deduction.points, 0),
  );
  return {
    score,
    label: score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
    deductions,
    sparseEvidenceCapApplied: score < afterDeductions,
  };
}

function reconstructStability(
  stateCode: number,
  deltaMicros: number | null,
  window: WindowBounds,
): AlternateWindowStability {
  const state = STABILITY_STATE_ORDER[stateCode];
  if (state === undefined) {
    throw new OpportunityIndexRowError(
      `Unknown stability state code ${stateCode}.`,
    );
  }
  return {
    window,
    state,
    priorityDelta: deltaMicros === null ? null : microsToFixed6(deltaMicros),
  };
}

// --- Physical read path. The persisted `opportunity_candidate` columns, in the
// exact order of data/schemas/opportunity-index-v1.sql and OpportunityIndexRow.
// The production adapter and the build's round-trip tests both SELECT these in
// order and decode each cell tuple through decodeIndexRowCells, so the physical
// column contract lives in exactly one place. ---

export const OPPORTUNITY_INDEX_COLUMN_NAMES: readonly string[] = [
  "exporter_code",
  "product_id",
  "importer_code",
  "priority_display",
  "attractiveness_display",
  "exporter_fit_display",
  "market_size_percentile_bp",
  "market_growth_percentile_bp",
  "product_presence_percentile_bp",
  "foothold_percentile_bp",
  "competition_rank",
  "opportunity_type",
  "confidence_score",
  "confidence_flags",
  "evidence_flags",
  "priority_raw_micros",
  "attractiveness_raw_micros",
  "exporter_fit_raw_micros",
  "market_size_percentile_micros",
  "market_growth_percentile_micros",
  "product_presence_percentile_micros",
  "foothold_percentile_micros",
  "market_size_percentile_display",
  "market_growth_percentile_display",
  "product_presence_percentile_display",
  "foothold_percentile_display",
  "market_size_raw_value",
  "market_growth_raw_value_micros",
  "product_presence_raw_value_micros",
  "foothold_raw_value_micros",
  "observed_years_mask",
  "growth_neutral_reasons",
  "stability_three_year_state",
  "stability_ten_year_state",
  "stability_three_year_delta_micros",
  "stability_ten_year_delta_micros",
];

// Decode one physical row (cells in OPPORTUNITY_INDEX_COLUMN_NAMES order) into a
// typed OpportunityIndexRow, coercing every cell to the exact JS type
// candidateToIndexRow produces so a decoded row round-trips byte-for-byte.
export function decodeIndexRowCells(
  cells: readonly unknown[],
): OpportunityIndexRow {
  const num = (value: unknown): number => Number(value);
  const optNum = (value: unknown): number | null =>
    value === null ? null : Number(value);
  return {
    exporterCode: num(cells[0]),
    productId: num(cells[1]),
    importerCode: num(cells[2]),
    priorityDisplay: num(cells[3]),
    attractivenessDisplay: num(cells[4]),
    exporterFitDisplay: num(cells[5]),
    marketSizePercentileBp: num(cells[6]),
    marketGrowthPercentileBp: num(cells[7]),
    productPresencePercentileBp: num(cells[8]),
    footholdPercentileBp: num(cells[9]),
    competitionRank: num(cells[10]),
    opportunityType: num(cells[11]),
    confidenceScore: num(cells[12]),
    confidenceFlags: num(cells[13]),
    evidenceFlags: num(cells[14]),
    priorityRawMicros: num(cells[15]),
    attractivenessRawMicros: num(cells[16]),
    exporterFitRawMicros: num(cells[17]),
    marketSizePercentileMicros: num(cells[18]),
    marketGrowthPercentileMicros: num(cells[19]),
    productPresencePercentileMicros: num(cells[20]),
    footholdPercentileMicros: num(cells[21]),
    marketSizePercentileDisplay: num(cells[22]),
    marketGrowthPercentileDisplay: num(cells[23]),
    productPresencePercentileDisplay: num(cells[24]),
    footholdPercentileDisplay: num(cells[25]),
    marketSizeRawValue: String(cells[26]),
    marketGrowthRawValueMicros:
      cells[27] === null ? null : BigInt(cells[27] as bigint | number | string),
    productPresenceRawValueMicros: num(cells[28]),
    footholdRawValueMicros: num(cells[29]),
    observedYearsMask: num(cells[30]),
    growthNeutralReasons: num(cells[31]),
    stabilityThreeYearState: num(cells[32]),
    stabilityTenYearState: num(cells[33]),
    stabilityThreeYearDeltaMicros: optNum(cells[34]),
    stabilityTenYearDeltaMicros: optNum(cells[35]),
  };
}
