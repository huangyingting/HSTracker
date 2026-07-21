import type {
  CandidateMarket,
  CandidateMarketResult,
  EconomyIdentity,
  ProductIdentity,
} from "../candidate-market/result";
import type {
  SupplierCompetitionConcentration,
  SupplierCompetitionResult,
  SupplierCompetitionShare,
} from "../supplier-competition/result";
import type {
  AnalysisIdentity,
} from "../trade-analytics/trade-analytics-platform";
import type { DatasetPackageIdentity } from "../trade-analytics/dataset-package";
import type {
  TradeTrendObservation,
  TradeTrendResult,
  TradeTrendSummary,
} from "../trade-trend/result";

import type { MarketAnalysisEvidenceStateKey } from "./copy";

// The product-shaped Market Analysis request/result contract
// (spec: docs/spec/export-market-analysis-workspace.md §5.2-§5.3, locked by
// Slice 1 of GitHub Epic #64). `MarketAnalysisV1` is a product composition
// over existing typed Analysis Outcomes, not a new Analysis Outcome and not
// a question-answer record: it adds no score, aggregate confidence,
// probability, recommendation, generated timestamp, or composite Analysis
// Identity of its own. Every exact projection below reuses the constituent
// recipes' own typed result shapes instead of copying formulas or
// introducing an arbitrary evidence map.

export type MarketAnalysisRequest = Readonly<{
  analysisBuildId: string;
  exportEconomyCode: string;
  productCode: string;
  marketCode: string;
}>;

export type MarketAnalysisAnnualContext = Readonly<{
  baciRelease: string;
  hsRevision: "HS12";
  finalizedWindow: Readonly<{ start: number; end: number }>;
  provisionalYear: number;
  valueUnit: "CURRENT_USD";
}>;

export type MarketAnalysisConstituentAnalysis = Readonly<{
  recipe:
    | "candidate-market-v1"
    | "trade-trend-v1"
    | "supplier-competition-v1";
  analysisIdentity: AnalysisIdentity;
  datasetPackageIdentity: DatasetPackageIdentity;
}>;

export type MarketOpportunityEvidence = Readonly<{
  candidate: CandidateMarket;
  cohortSize: CandidateMarketResult["cohortSize"];
  weights: CandidateMarketResult["weights"];
}>;

export type MarketDemandEvidence = Readonly<{
  finalizedObservations: TradeTrendResult["finalizedObservations"];
  summary: TradeTrendResult["summary"];
  provisionalObservation: TradeTrendResult["provisionalObservation"];
}>;

export type ExporterPositionEvidence = Readonly<{
  scoreWindowFoothold: CandidateMarket["components"]["recordedFoothold"];
  pooledSupplier: SupplierCompetitionShare | null;
  provisionalBilateral: CandidateMarket["provisionalEvidence"];
}>;

export type SupplierLandscapeEvidence = Readonly<{
  cohortBudget: SupplierCompetitionResult["cohortBudget"];
  cohortSize: SupplierCompetitionResult["cohortSize"];
  emptyReason: SupplierCompetitionResult["emptyReason"];
  finalizedPooledValueCurrentUsd: SupplierCompetitionResult["finalizedPooledValueCurrentUsd"];
  supplierShares: SupplierCompetitionResult["supplierShares"];
  concentration: SupplierCompetitionResult["concentration"];
  qualityWarnings: SupplierCompetitionResult["qualityWarnings"];
  provisionalMarketState: SupplierCompetitionResult["provisionalMarketState"];
  provisionalSupplierShares: SupplierCompetitionResult["provisionalSupplierShares"];
}>;

export type MarketEvidenceQuality = Readonly<{
  confidence: CandidateMarket["confidence"];
  observedFinalizedYears: CandidateMarket["observedScoreYears"];
  missingFinalizedYears: CandidateMarket["missingScoreYears"];
  quantityCoverageRate: CandidateMarket["quantityCoverageRate"];
  caveatCodes: CandidateMarket["caveatCodes"];
  stability: CandidateMarketResult["stability"];
  productSeriesDiscontinuityYears: CandidateMarketResult["productSeriesDiscontinuityYears"];
  releaseRevision: CandidateMarket["releaseRevision"];
  releaseRevisionSummary: CandidateMarketResult["releaseRevisionSummary"];
  sourceUpdateDate: CandidateMarketResult["provenance"]["sourceUpdateDate"];
}>;

export type MarketAnalysisV1 = Readonly<{
  schemaVersion: "market-analysis-v1";
  context: Readonly<{
    analysisBuildId: string;
    exporter: EconomyIdentity;
    product: ProductIdentity;
    market: EconomyIdentity;
  }>;
  annualContext: MarketAnalysisAnnualContext;
  constituentAnalyses: readonly MarketAnalysisConstituentAnalysis[];
  opportunity: MarketOpportunityEvidence;
  demand: MarketDemandEvidence;
  exporterPosition: ExporterPositionEvidence;
  supplierLandscape: SupplierLandscapeEvidence;
  evidenceQuality: MarketEvidenceQuality;
  discoveryDisclaimer: string;
}>;

// Product areas consume the constituent recipes' own discriminated evidence
// states directly (spec §5.6) instead of flattening them through a second
// generic ANSWERED/NOT_PROVIDED state machine. These three small, exhaustive
// mappings are the entire "semantics" layer Slice 1 owns: each one narrows
// one already-typed discriminated union onto the shared evidence-state copy
// vocabulary in ./copy, and stays exhaustive at compile time because there is
// no default case to silently swallow a new state.

export function marketAnalysisDemandObservationState(
  observation: TradeTrendObservation,
): MarketAnalysisEvidenceStateKey {
  switch (observation.state) {
    case "RECORDED_POSITIVE":
      return "recordedPositive";
    case "NO_RECORDED_POSITIVE_FLOW":
      return "noRecordedPositiveFlow";
    case "MISSING_OBSERVATION":
      return "missingObservation";
  }
}

export function marketAnalysisDemandSummaryState(
  summary: TradeTrendSummary,
): MarketAnalysisEvidenceStateKey {
  switch (summary.state) {
    case "AVAILABLE":
      return "recordedPositive";
    case "UNAVAILABLE":
      return "summaryUnavailable";
  }
}

export function marketAnalysisSupplierConcentrationState(
  concentration: SupplierCompetitionConcentration,
): MarketAnalysisEvidenceStateKey {
  switch (concentration.state) {
    case "COMPUTED":
      return "recordedPositive";
    case "UNAVAILABLE":
      return "summaryUnavailable";
  }
}
