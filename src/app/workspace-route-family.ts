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

  let hasOpportunityScope: boolean;
  let hasFocusedMarket: boolean;
  if (context.recipe === "candidate-market") {
    hasOpportunityScope =
      context.exporterCode !== null && context.productCode !== null;
    hasFocusedMarket = context.focusedMarketCode !== null;
  } else {
    hasOpportunityScope = context.exportEconomyCode !== null;
    hasFocusedMarket =
      context.focusProductCode !== null &&
      context.focusedMarketCode !== null;
  }

  if (!hasOpportunityScope) {
    return "primary-scope";
  }
  return hasFocusedMarket
    ? "primary-market-analysis"
    : "primary-opportunities";
}
