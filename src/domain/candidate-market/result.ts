import type {
  CandidateReleaseRevision,
  ReleaseRevisionComparisonIdentity,
} from "../release/release-revision";

export const CANDIDATE_MARKET_SCORE_FORMULA =
  "round_half_up(0.30*market_size_percentile+0.25*market_growth_percentile+0.25*recorded_foothold_percentile+0.20*supplier_diversity_percentile)";

export type CandidateMarketAnalysisQuery = {
  analysisBuildId: string;
  exporterCode: string;
  productCode: string;
};

export type EconomyIdentity = {
  code: string;
  name: string;
  iso3: string | null;
  identityNote: string | null;
};

export type ProductIdentity = {
  hsRevision: "HS12";
  code: string;
  descriptionEn: string;
};

export type ConfidenceDeductionCode =
  | "MISSING_SCORE_WINDOW_YEARS"
  | "MISSING_CUTOFF_YEAR_EVIDENCE"
  | "SMALL_BASE"
  | "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE"
  | "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY"
  | "LOW_WINDOW_STABILITY"
  | "SMALL_CANDIDATE_COHORT"
  | "NO_EXPORTER_PRODUCT_HISTORY"
  | "IDENTITY_PROXY";

export type ConfidenceDeduction = {
  code: ConfidenceDeductionCode;
  points: number;
};

export type GrowthReasonCode =
  | "INSUFFICIENT_OBSERVED_YEARS"
  | "BELOW_MATERIALITY_THRESHOLD";

export type CaveatCode =
  | "NO_RECORDED_POSITIVE_FLOW"
  | "IDENTITY_PROXY"
  | "EXTREME_NOMINAL_GROWTH"
  | "DOMINANT_SIZE_OUTLIER"
  | "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY"
  | "LOW_WINDOW_STABILITY"
  | "STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT";

export type StabilityEvidence = {
  window: {
    start: number;
    end: number;
  };
  commonCandidateCount: number;
  state: "NOT_FLAGGED" | "LOW" | "NOT_ESTIMATED_SMALL_COMMON_COHORT";
  rankCorrelation: string | null;
};

export type CandidateMarket = {
  economy: EconomyIdentity;
  score: number;
  rank: number;
  rankTieSize: number;
  rankPercentile: string;
  observedScoreYears: readonly number[];
  missingScoreYears: readonly number[];
  latestFinalizedObservedYear: number;
  components: {
    marketSize: {
      state: "COMPUTED";
      meanCurrentUsd: string;
      percentile: number;
      yearsUsed: readonly number[];
    };
    marketGrowth: {
      state: "COMPUTED" | "NEUTRAL";
      annualRate: string | null;
      percentile: number;
      yearsUsed: readonly number[];
      reasonCodes: readonly GrowthReasonCode[];
    };
    recordedFoothold: {
      state: "COMPUTED";
      share: string;
      percentile: number;
      bilateralFlowState: "RECORDED" | "NO_RECORDED_POSITIVE_FLOW";
      wording: string | null;
    };
    supplierDiversity: {
      state: "COMPUTED" | "NEUTRAL";
      index: string | null;
      percentile: number;
      yearsUsed: readonly number[];
      reasonCode: "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR" | null;
    };
  };
  confidence: {
    score: number;
    label: "HIGH" | "MEDIUM" | "LOW";
    deductions: readonly ConfidenceDeduction[];
    sparseEvidenceCapApplied: boolean;
  };
  quantityCoverageRate: string | null;
  provisionalEvidence: {
    year: number;
    marketState: "RECORDED" | "NO_RECORDED_POSITIVE_FLOW";
    marketImportCurrentUsd: string | null;
    bilateralState:
      | "RECORDED"
      | "NO_RECORDED_POSITIVE_FLOW"
      | "NOT_APPLICABLE";
    bilateralCurrentUsd: string | null;
    recordedBilateralShare: string | null;
    quantityCoverageRate: string | null;
  };
  caveatCodes: readonly CaveatCode[];
  releaseRevision: CandidateReleaseRevision;
};

export type CandidateMarketResult = {
  schemaVersion: "candidate-market-result-v1";
  analysisId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  query: {
    exporter: EconomyIdentity;
    product: ProductIdentity;
  };
  provenance: {
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: {
      start: number;
      end: number;
    };
    finalizedCutoffYear: number;
    scoreWindow: {
      start: number;
      end: number;
    };
    provisionalYear: number;
    scoreVersion: "cms-v1";
    artifactBuildId: string;
    artifactSchemaVersion: string;
    artifactSha256: string;
    valueUnit: "CURRENT_USD";
  };
  weights: {
    marketSize: 30;
    marketGrowth: 25;
    recordedFoothold: 25;
    supplierDiversity: 20;
  };
  cohortSize: number;
  emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW" | null;
  stability: {
    threeYear: StabilityEvidence;
    tenYear: StabilityEvidence;
  };
  productSeriesDiscontinuityYears: readonly number[];
  releaseRevisionSummary: ReleaseRevisionComparisonIdentity & {
    noLongerEligibleCount: number | null;
  };
  candidates: readonly CandidateMarket[];
  discoveryDisclaimer: string;
};
