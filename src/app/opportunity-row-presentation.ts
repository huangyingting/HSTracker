import type { MarketInvestigationCandidate } from "../domain/opportunity-discovery/result";
import type { TradeAnalysisLocale } from "./trade-analysis-context";

export function marketAnalysisActionLabel(
  candidate: MarketInvestigationCandidate,
  locale: TradeAnalysisLocale,
): string {
  return locale === "en"
    ? `Analyze this market: ${candidate.market.name}, HS12 ${candidate.product.code}`
    : `分析此市场：${candidate.market.name}，HS12 ${candidate.product.code}`;
}

export function opportunityTypeLabel(
  candidate: MarketInvestigationCandidate,
  locale: TradeAnalysisLocale,
): string {
  const labels =
    locale === "en"
      ? {
          marketGap: "Unvalidated Market Gap",
          expansion: "Expansion Evidence",
          general: "General Investigation Evidence",
        }
      : {
          marketGap: "未验证市场缺口",
          expansion: "扩张证据",
          general: "一般调查证据",
        };
  if (candidate.opportunityType === "UNVALIDATED_MARKET_GAP") {
    return labels.marketGap;
  }
  if (candidate.opportunityType === "EXPANSION_EVIDENCE") {
    return labels.expansion;
  }
  return labels.general;
}
