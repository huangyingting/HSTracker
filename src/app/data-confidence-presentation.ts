import type { TradeAnalysisLocale } from "./trade-analysis-context";

export function localizedDataConfidence(
  label: "HIGH" | "MEDIUM" | "LOW",
  locale: TradeAnalysisLocale,
): string {
  if (locale === "en") {
    return label;
  }
  return label === "HIGH" ? "高" : label === "MEDIUM" ? "中" : "低";
}
