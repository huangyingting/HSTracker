import type {
  CandidateMarketV1RecipeInput,
  EconomyIdentity,
  ProductIdentity,
} from "../domain/candidate-market/result";
import type {
  SupplierCompetitionV1Inputs,
  SupplierCompetitionV1RecipeInput,
} from "../domain/supplier-competition/result";
import type {
  TradeTrendV1Inputs,
  TradeTrendV1RecipeInput,
} from "../domain/trade-trend/result";

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
  alternativeSuppliers: {
    count: number;
    valueKusd: string;
    valueSquareSumKusdSquared: string;
  };
  sourceFlowCount: number;
  quantityPresentCount: number;
};

export type CmsV1Inputs = {
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
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

export type TradeEvidenceLoadOptions = Readonly<{
  signal?: AbortSignal;
}>;

export interface TradeEvidenceSource {
  loadCmsV1Inputs(
    query: CandidateMarketV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<CmsV1Inputs>;
  loadTradeTrendV1Inputs?(
    query: TradeTrendV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<TradeTrendV1Inputs>;
  loadSupplierCompetitionV1Inputs?(
    query: SupplierCompetitionV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<SupplierCompetitionV1Inputs>;
}
