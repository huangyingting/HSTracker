import type {
  EconomyIdentity,
  MarketInvestigationPage,
  OpportunityDiscoveryV1RecipeInput,
  ProductIdentity,
} from "../domain/opportunity-discovery/result";

// Raw, exporter-scoped evidence for the `opportunity-discovery-v1` recipe.
// This mirrors the BACI-derived shapes used by `CmsV1Inputs`: every monetary
// value is a decimal string in current USD thousands (kusd), missing
// observations are simply absent rows (never zero-filled), and identities are
// resolved economies/products. The recipe never receives storage, SQL,
// table, column, or path vocabulary through this seam.

export type OpportunityMarketYearEvidence = {
  year: number;
  // M[k,j,t]: world imports of product k by market j in year t.
  worldValueKusd: string;
  // B[e,k,j,t]: exporter e's recorded bilateral flow of product k to market j.
  // `null` means no recorded positive bilateral flow for that year.
  bilateralValueKusd: string | null;
};

export type OpportunityMarketEvidence = {
  product: ProductIdentity;
  market: EconomyIdentity;
  marketYears: readonly OpportunityMarketYearEvidence[];
};

export type OpportunityProductEvidence = {
  product: ProductIdentity;
  // G[k,t]: total world exports of product k in year t (presence denominator
  // and product-series discontinuity input).
  worldYearTotals: readonly { year: number; worldValueKusd: string }[];
  // X[e,k,t]: total exports of product k by exporter e in year t (presence
  // numerator). Absent years mean no recorded export.
  exporterExportTotals: readonly { year: number; valueKusd: string }[];
};

// A finalized-only recomputation basis from the previous BACI release, used to
// evidence Release Revision. Absence means the comparison is NOT_COMPARED.
export type OpportunityReleaseComparisonEvidence = {
  finalizedCutoffYear: number;
  products: readonly OpportunityProductEvidence[];
  markets: readonly OpportunityMarketEvidence[];
};

export type OpportunityDiscoveryV1CohortInputs = {
  analysisBuildId: string;
  artifact: {
    baciRelease: string;
    buildId: string;
    schemaVersion: string;
    sha256: string;
  };
  release: {
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: { start: number; end: number };
    finalizedCutoffYear: number;
    provisionalYear: number;
  };
  exporter: EconomyIdentity;
  products: readonly OpportunityProductEvidence[];
  markets: readonly OpportunityMarketEvidence[];
  previousRelease?: OpportunityReleaseComparisonEvidence | null;
};

export type OpportunityEvidenceLoadOptions = Readonly<{
  signal?: AbortSignal;
}>;

// Detail evidence for one Market Investigation Candidate. It intentionally
// carries only the analytical link into the existing Candidate Market
// drill-down (candidate-market-v1) plus the exact BACI year rows that back the
// candidate; it never returns account identity or storage shape.
export type OpportunityDetailEvidence = {
  analysisBuildId: string;
  exporter: EconomyIdentity;
  product: ProductIdentity;
  market: EconomyIdentity;
  candidateMarketDrillDown: {
    recipe: "candidate-market-v1";
    exporterCode: string;
    product: ProductIdentity;
    focusMarketCode: string;
  };
  scoreWindow: { start: number; end: number };
  marketYears: readonly OpportunityMarketYearEvidence[];
};

export type OpportunityDetailRequest = {
  analysisBuildId: string;
  exportEconomyCode: string;
  productCode: string;
  marketCode: string;
};

// The ordered, paginated Market Investigation feed for one exporter. A
// production adapter reads a precomputed ordered candidate index; the fixture
// adapter computes the same cohort offline. `analysisIdentity` is supplied by
// the platform so the adapter binds every emitted/validated cursor to the
// exact analytical feed.
export interface OpportunityCandidateIndex {
  page(
    query: OpportunityDiscoveryV1RecipeInput,
    analysisIdentity: string,
    options?: OpportunityEvidenceLoadOptions,
  ): Promise<MarketInvestigationPage>;
}

export interface OpportunityEvidenceSource {
  loadDetail(
    request: OpportunityDetailRequest,
    options?: OpportunityEvidenceLoadOptions,
  ): Promise<OpportunityDetailEvidence>;
}
