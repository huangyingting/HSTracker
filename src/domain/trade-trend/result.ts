import type {
  EconomyIdentity,
  ProductIdentity,
} from "../candidate-market/result";

export type TradeTrendV1RecipeInput = Readonly<{
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
}>;

export type TradeTrendObservation =
  | Readonly<{
      year: number;
      state: "RECORDED_POSITIVE";
      valueCurrentUsd: string;
    }>
  | Readonly<{
      year: number;
      state: "NO_RECORDED_POSITIVE_FLOW" | "MISSING_OBSERVATION";
    }>;

export type TradeTrendV1Inputs = Readonly<{
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
  finalizedObservations: readonly TradeTrendObservation[];
  provisionalObservation: TradeTrendObservation | null;
}>;

export type TradeTrendSummary =
  | Readonly<{
      state: "AVAILABLE";
      firstRecordedPositive: Readonly<{
        year: number;
        valueCurrentUsd: string;
      }>;
      lastRecordedPositive: Readonly<{
        year: number;
        valueCurrentUsd: string;
      }>;
      spanYears: number;
      absoluteChangeCurrentUsd: string;
      percentageChangePercent: string;
      cagrPercent: string;
    }>
  | Readonly<{
      state: "UNAVAILABLE";
      reason:
        | "NO_RECORDED_POSITIVE_OBSERVATIONS"
        | "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION";
    }>;

export type TradeTrendResult = Readonly<{
  schemaVersion: "trade-trend-result-v1";
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
  finalizedObservations: readonly TradeTrendObservation[];
  summary: TradeTrendSummary;
  provisionalObservation: TradeTrendObservation | null;
  discoveryDisclaimer: string;
}>;
