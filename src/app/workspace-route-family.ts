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
  if (context.recipe === "candidate-market") {
    if (
      context.exporterCode !== null &&
      context.productCode !== null &&
      context.focusedMarketCode !== null
    ) {
      return "primary-market-analysis";
    }
    return context.exporterCode !== null && context.productCode !== null
      ? "primary-opportunities"
      : "primary-scope";
  }
  if (
    context.exportEconomyCode !== null &&
    context.focusProductCode != null &&
    context.focusedMarketCode != null
  ) {
    return "primary-market-analysis";
  }
  return context.exportEconomyCode !== null
    ? "primary-opportunities"
    : "primary-scope";
}
