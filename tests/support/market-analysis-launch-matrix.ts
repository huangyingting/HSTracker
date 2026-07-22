export const MARKET_ANALYSIS_ACCESSIBILITY_CASES = [
  {
    id: "tablet-reflow-keyboard-navigation",
    title:
      "Market Analysis reflows at the 768px tablet breakpoint and supports keyboard area navigation",
  },
  {
    id: "zoom-200-reflow",
    title:
      "Market Analysis preserves complete reflow at a 200 percent zoom-equivalent viewport",
  },
  {
    id: "reduced-motion",
    title: "Market Analysis honors reduced-motion preferences throughout navigation",
  },
  {
    id: "forced-colors-high-contrast",
    title:
      "Market Analysis remains legible and focus-visible in forced colors and high contrast",
  },
  {
    id: "touch-targets",
    title: "the collapsed area navigator remains touch-sized and operable",
  },
  {
    id: "locale-theme-viewport-matrix",
    title:
      "Market Analysis remains complete across both locales, both themes, and every launch viewport",
  },
] as const;

export const MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE = {
  id: "annual-result-invariance",
  title:
    "annual result bytes and presentation remain invariant across every Recent Momentum state",
} as const;

export const MARKET_ANALYSIS_ANNUAL_FAILURE_CASES = [
  {
    id: "annual-invariance-source-unavailable",
    title:
      "source unavailability is a bounded monthly state and leaves annual presentation and focus unchanged",
  },
  {
    id: "annual-invariance-temporary-failure",
    title:
      "temporary monthly failure retries locally while annual data and DOM stay byte-for-byte invariant",
  },
  {
    id: "annual-invariance-cancellation",
    title:
      "rapid market changes cannot paint a stale monthly response under the new annual heading",
  },
] as const;

export const MARKET_ANALYSIS_DURABLE_JOURNEY_CASES = [
  {
    id: "locale-parity",
    title:
      "both locales expose identical values, evidence states, and actions for Market Analysis",
  },
  {
    id: "mobile-journey",
    title:
      "the complete Market Analysis journey works at 390px and 320px without horizontal-only comprehension",
  },
  {
    id: "theme-persistence",
    title:
      "the workspace defaults to light and remembers a switch to dark across reload",
  },
  {
    id: "copy-reload-open",
    title:
      "copying, reloading, and opening a pinned Candidate Market link in another browser reproduce the same task and pin",
  },
  {
    id: "explicit-current-refresh",
    title:
      "a pinned Candidate Market link that no longer matches the current recommendation shows a typed retired state instead of executing under the old pin, and explicit refresh resolves a distinct current pin",
  },
  {
    id: "retained-link",
    title:
      "a pinned Candidate Market link that still names a retained predecessor executes its exact build rather than retiring or substituting current",
  },
  {
    id: "back-forward",
    title:
      "browser back/forward reproduce the exact task and locale carried by each canonical URL, not client memory",
  },
  {
    id: "opportunity-back",
    title:
      "a fixed-product opportunity opens Market Analysis explicitly and Back restores its action",
  },
  {
    id: "direct-link-fallback",
    title:
      "a direct Market Analysis link falls back to its fixed-product opportunities",
  },
  {
    id: "advanced-tools",
    title:
      "Explore Further links preserve market and product context, and Validation Plan shows all five categories with no placeholder",
  },
  {
    id: "canonical-link-compatibility",
    title:
      "the canonical-link compatibility fixture set preserves recipe, inputs, locale, and Current identity",
  },
  {
    id: "candidate-market-csv",
    title: "Candidate Markets downloads the complete bilingual 13-row CSV",
  },
  {
    id: "trade-trend-csv",
    title: "an analyst downloads the complete contextual Trade Trend CSV",
  },
  {
    id: "supplier-competition-csv",
    title:
      "an analyst downloads the complete contextual Supplier Competition CSV",
  },
  {
    id: "trade-explorer-csv",
    title: "an analyst downloads the complete bounded Trade Explorer CSV",
  },
] as const;

export const MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES = [
  {
    id: "analyst-needs-row-set",
    title: "has exactly 20 rows with unique AQ-01..AQ-20 identifiers",
  },
  {
    id: "analyst-needs-coverage",
    title: "is exactly 10 DIRECT, 5 BOUNDED, and 5 OUTSIDE",
  },
  {
    id: "analyst-needs-capabilities",
    title:
      "names only capabilities that exist in the product's Scope/Opportunities stages or its eight Market Analysis product areas",
  },
  {
    id: "analyst-needs-content",
    title:
      "gives every row a non-empty need statement and limitation/interpretation note",
  },
  {
    id: "analyst-needs-module-seam",
    title:
      "never lets AQ identifiers or this fixture leak into production source",
  },
  {
    id: "startup-smoke",
    title:
      "reaches readiness only after the composed Market Analysis startup smoke with exact release identities",
  },
  {
    id: "current-and-retired-replay",
    title:
      "serves current Market Analysis reproducibly and rejects retired replay through the paired release",
  },
  {
    id: "retained-replay",
    title:
      "replays retained Market Analysis from its own release while current remains independently reproducible",
  },
  {
    id: "rollback",
    title:
      "atomically rolls a distinct accepted release back to the task-first Market Analysis deployment",
  },
] as const;

export const RECENT_MOMENTUM_LAUNCH_STATES = [
  {
    label: "supported rising fast",
    coverageState: "SUPPORTED",
    signalState: "RISING_FAST",
    reasonCodes: [],
    growthRateDecimal: "0.250000000000",
    growthPercentDisplay: "+25.0",
    expectedCopy: "Rising fast",
  },
  {
    label: "supported rising",
    coverageState: "SUPPORTED",
    signalState: "RISING",
    reasonCodes: [],
    growthRateDecimal: "0.150000000000",
    growthPercentDisplay: "+15.0",
    expectedCopy: "Rising · +15.0%",
  },
  {
    label: "supported broadly stable",
    coverageState: "SUPPORTED",
    signalState: "BROADLY_STABLE",
    reasonCodes: [],
    growthRateDecimal: "0.050000000000",
    growthPercentDisplay: "+5.0",
    expectedCopy: "Broadly stable",
  },
  {
    label: "supported falling",
    coverageState: "SUPPORTED",
    signalState: "FALLING",
    reasonCodes: [],
    growthRateDecimal: "-0.150000000000",
    growthPercentDisplay: "-15.0",
    expectedCopy: "Falling · -15.0%",
  },
  {
    label: "supported falling fast",
    coverageState: "SUPPORTED",
    signalState: "FALLING_FAST",
    reasonCodes: [],
    growthRateDecimal: "-0.250000000000",
    growthPercentDisplay: "-25.0",
    expectedCopy: "Falling fast",
  },
  {
    label: "supported without a signal",
    coverageState: "SUPPORTED_NO_SIGNAL",
    signalState: null,
    reasonCodes: ["SMALL_BASE"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Supported coverage — no signal",
  },
  {
    label: "not observed",
    coverageState: "NOT_OBSERVED",
    signalState: null,
    reasonCodes: ["MISSING_COMPARISON_MONTH"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Not observed",
  },
  {
    label: "suppressed or reallocated",
    coverageState: "SUPPRESSED_OR_REALLOCATED",
    signalState: null,
    reasonCodes: ["SUPPRESSED_OR_REALLOCATED"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Suppressed or reallocated",
  },
  {
    label: "unsupported market",
    coverageState: "UNSUPPORTED_MARKET",
    signalState: null,
    reasonCodes: ["UNSUPPORTED_MARKET"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Unsupported market",
  },
  {
    label: "unsupported product mapping",
    coverageState: "UNSUPPORTED_PRODUCT_MAPPING",
    signalState: null,
    reasonCodes: ["UNSUPPORTED_PRODUCT_MAPPING"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Unsupported product mapping",
  },
  {
    label: "source unavailable",
    coverageState: "SOURCE_UNAVAILABLE",
    signalState: null,
    reasonCodes: ["SOURCE_UNAVAILABLE"],
    growthRateDecimal: null,
    growthPercentDisplay: null,
    expectedCopy: "Source unavailable",
  },
] as const;
