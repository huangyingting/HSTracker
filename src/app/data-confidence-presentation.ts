import type { OpportunityConfidence } from "../domain/opportunity-discovery/result";
import type { TradeAnalysisLocale } from "./trade-analysis-context";

export function localizedDataConfidence(
  label: OpportunityConfidence["label"],
  locale: TradeAnalysisLocale,
): string {
  if (locale === "en") {
    return label;
  }
  return label === "HIGH" ? "高" : label === "MEDIUM" ? "中" : "低";
}
