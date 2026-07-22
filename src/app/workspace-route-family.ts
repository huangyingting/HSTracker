import type { WorkspaceRouteFamily } from "../domain/workspace-route-family";
import type { TradeAnalysisContext } from "./trade-analysis-context";

export function workspaceRouteFamily(
  context: TradeAnalysisContext,
): WorkspaceRouteFamily {
  if (context.recipe === "trade-trend") {
    return "advanced-trade-trend";
  }
  if (context.recipe === "supplier-competition") {
    return "advanced-supplier-competition";
  }
  if (context.recipe === "trade-explorer") {
    return "advanced-trade-explorer";
  }
  if (
    context.focusedMarketCode !== null &&
    (context.recipe === "candidate-market" ||
      context.focusProductCode != null)
  ) {
    return "primary-market-analysis";
  }
  if (
    (context.recipe === "candidate-market" && context.productCode !== null) ||
    (context.recipe === "opportunity-discovery" &&
      context.pin !== null &&
      context.exportEconomyCode !== null)
  ) {
    return "primary-opportunities";
  }
  return "primary-scope";
}
