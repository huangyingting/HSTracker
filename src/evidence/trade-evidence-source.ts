import type {
  CandidateMarketAnalysisQuery,
  EconomyIdentity,
  ProductIdentity,
} from "../domain/candidate-market/result";

export type SelectedExporterEvidence =
  | {
      state: "RECORDED";
      valueKusd: string;
    }
  | {
      state: "NO_RECORDED_POSITIVE_FLOW";
    };

export type MarketYearEvidence = {
  year: number;
  candidateMarket: EconomyIdentity;
  worldValueKusd: string;
  selectedExporter: SelectedExporterEvidence;
  alternativeSupplierShares: readonly string[];
  sourceFlowCount: number;
  quantityPresentCount: number;
};

export type CmsV1Inputs = {
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  artifact: {
    buildId: string;
    schemaVersion: string;
    sha256: string;
  };
  release: {
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: {
      start: number;
      end: number;
    };
    finalizedCutoffYear: number;
    provisionalYear: number;
  };
  exporter: EconomyIdentity;
  product: ProductIdentity;
  marketYears: readonly MarketYearEvidence[];
  provisionalMarketYears: readonly MarketYearEvidence[];
  productYearTotals: readonly {
    year: number;
    worldValueKusd: string;
  }[];
};

export interface TradeEvidenceSource {
  loadCmsV1Inputs(
    query: CandidateMarketAnalysisQuery,
  ): Promise<CmsV1Inputs>;
}
