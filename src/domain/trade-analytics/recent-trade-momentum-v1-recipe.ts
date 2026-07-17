import {
  computeRecentTradeMomentumV1,
  type RecentTradeMomentumOutcome,
} from "../recent-trade-momentum/recent-trade-momentum-v1";
import type {
  RecentTradeMomentumEvidenceSource,
  RecentTradeMomentumV1RecipeInput,
} from "../../evidence/recent-trade-momentum-evidence-source";
import type { AnalysisExecutionOptions } from "./trade-analytics-platform";

export function createRecentTradeMomentumV1RecipeExecution(
  source: RecentTradeMomentumEvidenceSource,
): (
  request: RecentTradeMomentumV1RecipeInput,
  options?: AnalysisExecutionOptions,
) => Promise<RecentTradeMomentumOutcome> {
  return async (request, options) => {
    const input = await source.loadRecentTradeMomentumV1Input(request, {
      signal: options?.signal,
    });
    options?.signal?.throwIfAborted();
    return computeRecentTradeMomentumV1(input);
  };
}
