import type {
  EconomyIdentity,
  ProductIdentity,
} from "../candidate-market/result";

export const SUPPLIER_COMPETITION_FINALIZED_YEAR_COUNT = 5;

// The complete supplier-economy cohort is bounded by this explicit budget so
// the recipe fails typed (see supplierCohortBudgetExceeded in ./errors) when
// evidence claims more suppliers than this, rather than silently truncating
// the "complete" cohort the acceptance criteria promise.
export const SUPPLIER_COMPETITION_MAX_COHORT_SIZE = 250;

export type SupplierCompetitionV1RecipeInput = Readonly<{
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
}>;

export type SupplierAnnualObservation =
  | Readonly<{
      year: number;
      state: "RECORDED_POSITIVE";
      valueCurrentUsd: string;
    }>
  | Readonly<{
      year: number;
      state: "NO_RECORDED_POSITIVE_FLOW" | "MISSING_OBSERVATION";
    }>;

export type SupplierEconomyEvidence = Readonly<{
  economy: EconomyIdentity;
  // Must cover exactly the five finalized-window years, one observation
  // each, like Trade Trend's finalizedObservations.
  annualObservations: readonly SupplierAnnualObservation[];
  sourceFlowCount: number;
  quantityPresentCount: number;
}>;

export type ProvisionalSupplierEconomyEvidence = Readonly<{
  economy: EconomyIdentity;
  bilateral:
    | Readonly<{ state: "RECORDED_POSITIVE"; valueCurrentUsd: string }>
    | Readonly<{ state: "NO_RECORDED_POSITIVE_FLOW" }>;
}>;

export type SupplierCompetitionV1Inputs = Readonly<{
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  artifact: Readonly<{
    baciRelease: string;
    buildId: string;
    schemaVersion: string;
    sha256: string;
  }>;
  release: Readonly<{
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: Readonly<{ start: number; end: number }>;
    finalizedCutoffYear: number;
    provisionalYear: number;
  }>;
  importer: EconomyIdentity;
  product: ProductIdentity;
  suppliers: readonly SupplierEconomyEvidence[];
  // The importer/product total for the Provisional Year: RECORDED means
  // provisionalSuppliers is the complete bilateral snapshot for that year;
  // NO_RECORDED_POSITIVE_FLOW and MISSING_OBSERVATION both require an empty
  // provisionalSuppliers because no market total exists to allocate against.
  provisionalMarketState:
    | "RECORDED"
    | "NO_RECORDED_POSITIVE_FLOW"
    | "MISSING_OBSERVATION";
  provisionalSuppliers: readonly ProvisionalSupplierEconomyEvidence[];
}>;

export type SupplierCompetitionShare = Readonly<{
  economy: EconomyIdentity;
  pooledValueCurrentUsd: string;
  sharePercent: string;
  recordedYears: readonly number[];
  noRecordedFlowYears: readonly number[];
  missingYears: readonly number[];
  // null means UNKNOWN: no recorded source flows exist to measure quantity
  // presence against, distinct from a computed rate of exactly zero.
  quantityCoverageRate: string | null;
}>;

export type SupplierCompetitionConcentration =
  | Readonly<{
      state: "COMPUTED";
      herfindahlHirschmanIndex: string;
      scale: 10000;
    }>
  | Readonly<{
      state: "UNAVAILABLE";
      reason: "NO_POOLED_SUPPLIER_VALUE";
    }>;

export type SupplierCompetitionQualityWarningCode =
  | "SPARSE_FINALIZED_PERIODS"
  | "INCOMPLETE_SUPPLIER_STRUCTURE"
  | "CONCENTRATION_UNAVAILABLE";

export type ProvisionalSupplierShare = Readonly<{
  economy: EconomyIdentity;
  bilateralState:
    | "RECORDED_POSITIVE"
    | "NO_RECORDED_POSITIVE_FLOW"
    | "NOT_APPLICABLE";
  valueCurrentUsd: string | null;
}>;

export type SupplierCompetitionResult = Readonly<{
  schemaVersion: "supplier-competition-result-v1";
  analysisId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  query: Readonly<{
    importer: EconomyIdentity;
    product: ProductIdentity;
  }>;
  provenance: Readonly<{
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: Readonly<{ start: number; end: number }>;
    finalizedWindow: Readonly<{ start: number; end: number }>;
    provisionalYear: number;
    artifactBuildId: string;
    artifactSchemaVersion: string;
    artifactSha256: string;
    valueUnit: "CURRENT_USD";
  }>;
  cohortBudget: number;
  cohortSize: number;
  emptyReason: "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW" | null;
  finalizedPooledValueCurrentUsd: string;
  supplierShares: readonly SupplierCompetitionShare[];
  concentration: SupplierCompetitionConcentration;
  qualityWarnings: readonly SupplierCompetitionQualityWarningCode[];
  provisionalMarketState:
    | "RECORDED"
    | "NO_RECORDED_POSITIVE_FLOW"
    | "MISSING_OBSERVATION";
  provisionalSupplierShares: readonly ProvisionalSupplierShare[];
  discoveryDisclaimer: string;
}>;
