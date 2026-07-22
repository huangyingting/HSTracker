export const TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT =
  "hs-tracker:trade-analysis-context-changed";

export function announceTradeAnalysisContextChange(): void {
  window.dispatchEvent(new Event(TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT));
}

/**
 * Replays full workspace restoration after an explicit in-app navigation.
 * Canonical URL rewrites use the context-changed event above so they do not
 * restart the active workspace's requests.
 */
export function announceTradeAnalysisNavigation(): void {
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state }),
  );
}
