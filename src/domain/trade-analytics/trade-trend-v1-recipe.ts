import type { TradeEvidenceLoadOptions, TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import { unavailableTradeTrendAnalysisBuild } from "../trade-trend/errors";
import {
  computeTradeTrendV1,
} from "../trade-trend/trade-trend-v1";
import type {
  TradeTrendResult,
  TradeTrendV1RecipeInput,
} from "../trade-trend/result";

type TradeTrendV1RecipeExecution = (
  query: TradeTrendV1RecipeInput,
  options?: TradeEvidenceLoadOptions,
) => Promise<TradeTrendResult>;

export function createTradeTrendV1RecipeExecution(
  evidenceSource: TradeEvidenceSource,
): TradeTrendV1RecipeExecution {
  return async (query, options) => {
    options?.signal?.throwIfAborted();
    const loadInputs = evidenceSource.loadTradeTrendV1Inputs;
    if (loadInputs === undefined) {
      throw unavailableTradeTrendAnalysisBuild(query.analysisBuildId);
    }
    const inputs = await loadInputs.call(evidenceSource, query, options);
    options?.signal?.throwIfAborted();
    return computeTradeTrendV1(inputs);
  };
}
