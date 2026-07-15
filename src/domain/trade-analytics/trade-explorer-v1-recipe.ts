import type { TradeEvidenceLoadOptions, TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import { unavailableTradeExplorerAnalysisBuild } from "../trade-explorer/errors";
import { computeTradeExplorerV1 } from "../trade-explorer/trade-explorer-v1";
import type {
  TradeExplorerResult,
  TradeExplorerV1EvidenceRequest,
} from "../trade-explorer/result";

type TradeExplorerV1RecipeExecution = (
  request: TradeExplorerV1EvidenceRequest,
  options?: TradeEvidenceLoadOptions,
) => Promise<TradeExplorerResult>;

export function createTradeExplorerV1RecipeExecution(
  evidenceSource: TradeEvidenceSource,
): TradeExplorerV1RecipeExecution {
  return async (request, options) => {
    options?.signal?.throwIfAborted();
    const loadInputs = evidenceSource.loadTradeExplorerV1Inputs;
    if (loadInputs === undefined) {
      throw unavailableTradeExplorerAnalysisBuild(request.analysisBuildId);
    }
    const inputs = await loadInputs.call(evidenceSource, request, options);
    options?.signal?.throwIfAborted();
    return computeTradeExplorerV1(inputs);
  };
}
