export const TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT =
  "hs-tracker:trade-analysis-context-changed";

/**
 * Notifies shell-level URL readers after the caller has already synchronized
 * the active workspace. This does not replay workspace restoration.
 */
export function announceTradeAnalysisContextChange(): void {
  window.dispatchEvent(new Event(TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT));
}

/**
 * Replays full workspace restoration after a semantic in-app transition,
 * regardless of whether the caller used pushState or replaceState.
 */
export function announceTradeAnalysisNavigation(): void {
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state }),
  );
}
