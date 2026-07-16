// Public result contract for the `opportunity-discovery-v1` Analysis Recipe.
//
// The recipe is an exporter-scoped, cross-product re-normalization defined by
// docs/research/2026-07-16-cross-product-market-opportunity-recipe.md. Every
// term here is public evidence for further investigation and never a
// prediction of sales, profit, market access, company fit, or commercial
// success. No storage, SQL, table, or column vocabulary appears in this
// contract.

export const OPPORTUNITY_DISCOVERY_INVESTIGATION_PRIORITY_FORMULA =
  "round_half_up(0.55*(0.65*market_size_pct+0.35*market_growth_pct)+0.45*(0.60*exporter_product_presence_pct+0.40*recorded_foothold_pct))";

export const OPPORTUNITY_DISCOVERY_DISCLAIMER =
  "Market Investigation Candidates are public BACI trade evidence for further investigation. They are not forecasts, sales or profit estimates, success probabilities, or claims about market access, tariffs, logistics, buyers, company capability, or product-market fit. Validate before treating any candidate as an opportunity.";

export type OpportunityType =
  | "UNVALIDATED_MARKET_GAP"
  | "EXPANSION_EVIDENCE"
  | "GENERAL_INVESTIGATION_EVIDENCE";

export type OpportunityComponentState = "COMPUTED" | "NEUTRAL";

export type MarketGrowthNeutralReasonCode =
  | "TOO_FEW_OBSERVED_YEARS"
  | "SMALL_MARKET_BASE";

export type OpportunityConfidenceDeductionCode =
  | "MISSING_FINALIZED_MARKET_YEARS"
  | "MISSING_CUTOFF_YEAR_MARKET_EVIDENCE"
  | "NEUTRAL_MARKET_GROWTH"
  | "NO_EXPORTER_PRODUCT_HISTORY"
  | "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY"
  | "LOW_ALTERNATE_WINDOW_STABILITY"
  | "MATERIAL_RELEASE_REVISION"
  | "IDENTITY_PROXY";

export type OpportunityEvidenceFlag =
  | "NO_RECORDED_BILATERAL_FLOW"
  | "NO_RECORDED_PRODUCT_EXPORT"
  | "EXTREME_NOMINAL_GROWTH"
  | "IDENTITY_PROXY";

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

// A normalized component percentile. `unrounded` retains six decimals (the
// value that feeds the axis/priority formulas); `basisPoints` is
// round_half_up(unrounded*100) for compact filtering; `display` is
// round_half_up(unrounded) for the public integer. Rounded values never feed
// another formula.
export type OpportunityComponent = {
  state: OpportunityComponentState;
  rawValue: string | null;
  percentileUnrounded: string;
  percentileBasisPoints: number;
  percentileDisplay: number;
  neutralReasonCodes?: readonly MarketGrowthNeutralReasonCode[];
  evidenceTag?: "NO_RECORDED_PRODUCT_EXPORT" | "NO_RECORDED_POSITIVE_FLOW";
};

export type OpportunityAxis = {
  rawUnrounded: string;
  display: number;
};

export type OpportunityConfidenceDeduction = {
  code: OpportunityConfidenceDeductionCode;
  points: number;
};

export type OpportunityConfidence = {
  score: number;
  label: "HIGH" | "MEDIUM" | "LOW";
  deductions: readonly OpportunityConfidenceDeduction[];
  sparseEvidenceCapApplied: boolean;
};

export type AlternateWindowStability = {
  window: { start: number; end: number };
  state:
    | "NOT_FLAGGED"
    | "LOW_ALTERNATE_WINDOW_STABILITY"
    | "COHORT_ENTRY"
    | "COHORT_EXIT";
  priorityDelta: string | null;
};

export type OpportunityReleaseRevision = {
  state: "NOT_COMPARED" | "NOT_FLAGGED" | "MATERIAL_RELEASE_REVISION";
  priorityDelta: string | null;
  rankPercentileDelta: string | null;
  cohortTransition: "COMMON" | "COHORT_ENTRY" | "COHORT_EXIT" | null;
};

export type MarketInvestigationCandidate = {
  product: ProductIdentity;
  market: EconomyIdentity;
  investigationPriority: OpportunityAxis;
  marketAttractiveness: OpportunityAxis;
  exporterFit: OpportunityAxis;
  components: {
    marketSize: OpportunityComponent;
    marketGrowth: OpportunityComponent;
    exporterProductPresence: OpportunityComponent;
    recordedFoothold: OpportunityComponent;
  };
  opportunityType: OpportunityType;
  opportunityTypeCopy: string;
  bilateralFlowState: "RECORDED" | "NO_RECORDED_POSITIVE_FLOW";
  bilateralWording: string | null;
  observedMarketYears: readonly number[];
  missingMarketYears: readonly number[];
  confidence: OpportunityConfidence;
  stability: {
    threeYear: AlternateWindowStability;
    tenYear: AlternateWindowStability;
  };
  releaseRevision: OpportunityReleaseRevision;
  evidenceFlags: readonly OpportunityEvidenceFlag[];
  competitionRank: number;
  competitionRankTieSize: number;
  // Canonical link that carries analytical identity into the existing
  // Candidate Market drill-down for this exporter/product. It never leaks
  // account identity and never mutates a pin.
  candidateMarketDrillDown: {
    recipe: "candidate-market-v1";
    exporterCode: string;
    product: ProductIdentity;
    focusMarketCode: string;
  };
};

export type OpportunityProvenance = {
  baciRelease: string;
  sourceUpdateDate: string;
  hsRevision: "HS12";
  finalizedCutoffYear: number;
  scoreWindow: { start: number; end: number };
  provisionalYear: number;
  recipeVersion: "opportunity-discovery-v1";
  resultSchemaVersion: "market-investigation-result-v1";
  artifactBuildId: string;
  artifactSchemaVersion: string;
  artifactSha256: string;
  valueUnit: "CURRENT_USD";
};

export type OpportunityNonClaims = readonly string[];

export type MarketInvestigationPage = {
  schemaVersion: "market-investigation-result-v1";
  analysisBuildId: string;
  exporter: EconomyIdentity;
  provenance: OpportunityProvenance;
  cohortSize: number;
  projection: {
    // `null` is the canonical all-product feed; otherwise the sorted,
    // de-duplicated confirmed HS12 product codes this page is projected to.
    productCodes: readonly string[] | null;
  };
  page: {
    limit: number;
    requestedCursor: string | null;
    nextCursor: string | null;
    returnedCount: number;
  };
  candidates: readonly MarketInvestigationCandidate[];
  nonClaims: OpportunityNonClaims;
  discoveryDisclaimer: string;
};

// Internal recipe input resolved by the platform from the public request.
export type OpportunityDiscoveryV1RecipeInput = {
  analysisBuildId: string;
  exportEconomyCode: string;
  limit: number;
  cursor: string | null;
  productCodes: readonly string[] | null;
};
