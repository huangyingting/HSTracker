export const TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT =
  "hs-tracker:trade-analysis-context-changed";

export function announceTradeAnalysisContextChange(): void {
  window.dispatchEvent(new Event(TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT));
}
