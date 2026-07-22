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
] as const;

export const MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE = {
  id: "annual-result-invariance",
  title:
    "annual result bytes and presentation remain invariant across every Recent Momentum state",
} as const;

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
