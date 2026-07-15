import { normalizeTradeExplorerV1Request } from "../trade-explorer/normalize";
import type { TradeExplorerV1NormalizedInputs } from "../trade-explorer/result";
import type { TradeExplorerV1AnalysisRequest } from "./trade-analytics-platform";

/**
 * Validates and normalizes one `TradeExplorerV1AnalysisRequest` against
 * `finalizedWindow` (derived from the Dataset Package the platform has
 * already resolved for this analysisBuildId), returning the deterministic
 * canonical query. Throws a `TradeExplorerAnalysisError` for every
 * violation -- never a generic exception -- so `trade-analytics-platform.ts`
 * can map it to a distinct typed Analysis Outcome.
 */
export function validateTradeExplorerV1Request(
  request: TradeExplorerV1AnalysisRequest,
  finalizedWindow: Readonly<{ start: number; end: number }>,
): TradeExplorerV1NormalizedInputs {
  return normalizeTradeExplorerV1Request(request, finalizedWindow);
}
