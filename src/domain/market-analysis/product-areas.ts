// The stable Market Analysis product-area vocabulary and its exact display
// order (spec: docs/spec/export-market-analysis-workspace.md §2.1 and
// docs/spec/export-market-analysis-workspace-ui-design.md §2.1/§9.2). Product
// and presentation code shares this one ordered tuple instead of each
// re-declaring the order, so the areas can never silently drift apart or
// collapse into a generic per-question card list.
export const MARKET_ANALYSIS_PRODUCT_AREAS = Object.freeze([
  "snapshot",
  "demand",
  "exporterPosition",
  "supplierLandscape",
  "evidenceQuality",
  "recentMomentum",
  "exploreFurther",
  "validationPlan",
] as const);

export type MarketAnalysisProductArea =
  (typeof MARKET_ANALYSIS_PRODUCT_AREAS)[number];
