import type {
  RecentTradeMomentumV1Input,
} from "../domain/recent-trade-momentum/recent-trade-momentum-v1";

export type RecentTradeMomentumV1RecipeInput = Readonly<{
  analysisBuildId: string;
  reporterCode: string;
  productCode: string;
}>;

export type RecentTradeMomentumEvidenceLoadOptions = Readonly<{
  signal?: AbortSignal;
}>;

export interface RecentTradeMomentumEvidenceSource {
  loadRecentTradeMomentumV1Input(
    query: RecentTradeMomentumV1RecipeInput,
    options?: RecentTradeMomentumEvidenceLoadOptions,
  ): Promise<RecentTradeMomentumV1Input>;
}
