// The test/release-only analyst-needs traceability fixture mapping AQ-01
// through AQ-20 to product capabilities and coverage (spec:
// docs/spec/export-market-analysis-workspace.md §3.2, table transcribed
// verbatim). AQ identifiers are requirement and acceptance-test labels only
// (spec §2.3) -- this file must never be imported from `src/`, and no
// production result, presentation, navigation, or dispatch code may branch
// on an AQ identifier. See
// tests/integration/market-analysis-analyst-needs.test.ts and
// tests/integration/market-analysis-module-boundary.test.ts for the checks
// that keep this fixture out of production and keep its shape locked.

export type AnalystNeedCoverage = "DIRECT" | "BOUNDED" | "OUTSIDE";

export type AnalystNeedCapability =
  | "Scope"
  | "Opportunities"
  | "Market Snapshot"
  | "Demand"
  | "Exporter Position"
  | "Supplier Landscape"
  | "Evidence Quality"
  | "Recent Momentum"
  | "Explore Further"
  | "Validation Plan";

export const ANALYST_NEED_ACCEPTANCE_SCENARIOS = [
  {
    id: "scope-context",
    title:
      "the global Scope Bar precedes the journey and Change scope restores the mounted controls",
  },
  {
    id: "candidate-market-cohort",
    title:
      "an Export Market Analyst loads and scans the complete fixture ranking",
  },
  {
    id: "cross-product-opportunities",
    title:
      "all-product browse, product discovery, and known-product links reach the same canonical row values",
  },
  {
    id: "unvalidated-market-gap",
    title:
      "opportunity copy is honest and context survives filter, history, copied links, locale, and mobile",
  },
  {
    id: "market-snapshot",
    title:
      "Market Snapshot exposes deterministic interpretation, canonical score/rank, and the existing score audit view",
  },
  {
    id: "demand",
    title:
      "Demand shows the finalized trend, summary, equivalent table, and separately labelled Provisional evidence",
  },
  {
    id: "exporter-position",
    title:
      "Exporter Position distinguishes the score-window, pooled-supplier, and Provisional bilateral bases",
  },
  {
    id: "supplier-landscape",
    title:
      "Supplier Landscape shows the complete bounded cohort, exact HHI scale, and selected-exporter position",
  },
  {
    id: "evidence-quality-and-gaps",
    title:
      "evidence gaps at a low-confidence market remain distinguishable from Validation Plan gaps",
  },
  {
    id: "constituent-provenance",
    title:
      "each analytical product area exposes its own complete constituent provenance",
  },
  {
    id: "recent-trade-momentum-states",
    title:
      "annual result bytes and presentation remain invariant across every Recent Momentum state",
  },
  {
    id: "advanced-evidence-and-validation",
    title:
      "Explore Further links preserve market and product context, and Validation Plan shows all five categories with no placeholder",
  },
] as const;

export type AnalystNeedScenarioId =
  (typeof ANALYST_NEED_ACCEPTANCE_SCENARIOS)[number]["id"];

export type AnalystNeedTraceabilityRow = Readonly<{
  id: string;
  need: string;
  coverage: AnalystNeedCoverage;
  capabilities: readonly AnalystNeedCapability[];
  scenarioIds: readonly AnalystNeedScenarioId[];
  limitation: string;
}>;

export const ANALYST_NEEDS_TRACEABILITY: readonly AnalystNeedTraceabilityRow[] =
  Object.freeze([
    {
      id: "AQ-01",
      need: "Which HS code and revision correctly represent my product?",
      coverage: "BOUNDED",
      capabilities: ["Scope"],
      scenarioIds: ["scope-context"],
      limitation:
        "Deterministic HS12 search and explicit confirmation are supported; SKU classification and HS17/HS22 conversion are not.",
    },
    {
      id: "AQ-02",
      need: "Which economies import this HS Product, and how large is each market?",
      coverage: "DIRECT",
      capabilities: ["Opportunities", "Demand"],
      scenarioIds: ["candidate-market-cohort", "demand"],
      limitation:
        "Present the complete eligible Candidate Market cohort and mean recorded world imports over the score window.",
    },
    {
      id: "AQ-03",
      need: "Which markets are growing or declining, and what are the five-year rate and CAGR?",
      coverage: "DIRECT",
      capabilities: ["Opportunities", "Demand"],
      scenarioIds: ["demand"],
      limitation:
        "Clearly label nominal current-USD evidence; do not describe it as real demand growth.",
    },
    {
      id: "AQ-04",
      need: "For one export economy and HS Product, which Candidate Markets warrant investigation first?",
      coverage: "DIRECT",
      capabilities: ["Opportunities", "Market Snapshot"],
      scenarioIds: ["candidate-market-cohort", "market-snapshot"],
      limitation:
        "Present canonical rank, Candidate Market Score, components, and Data Confidence; do not call it a recommendation.",
    },
    {
      id: "AQ-05",
      need: "Across products, which product-market combinations warrant investigation first?",
      coverage: "DIRECT",
      capabilities: ["Opportunities"],
      scenarioIds: ["cross-product-opportunities"],
      limitation:
        "Present Investigation Priority and its Market Attractiveness and Exporter Fit axes.",
    },
    {
      id: "AQ-06",
      need: "Which attractive markets have weak or no recorded exporter foothold?",
      coverage: "DIRECT",
      capabilities: ["Opportunities", "Exporter Position"],
      scenarioIds: ["unvalidated-market-gap", "exporter-position"],
      limitation:
        "Present Unvalidated Market Gap as a hypothesis requiring commercial validation.",
    },
    {
      id: "AQ-07",
      need: "What recorded bilateral value and share does the selected export economy have in this market?",
      coverage: "DIRECT",
      capabilities: ["Exporter Position"],
      scenarioIds: ["exporter-position"],
      limitation:
        "Distinguish score-window share, pooled supplier value/share, and Provisional Year bilateral evidence.",
    },
    {
      id: "AQ-08",
      need: "Are recent imports accelerating, stable, or weakening?",
      coverage: "BOUNDED",
      capabilities: ["Recent Momentum"],
      scenarioIds: ["recent-trade-momentum-states"],
      limitation:
        "EU-27 reporting markets and exact reviewed product mappings only; signal is market import momentum, not exporter-specific demand.",
    },
    {
      id: "AQ-09",
      need: "Is apparent growth exposed to sparse years, small base, instability, exceptional shocks, or HS discontinuity?",
      coverage: "BOUNDED",
      capabilities: ["Evidence Quality"],
      scenarioIds: ["evidence-quality-and-gaps"],
      limitation:
        "Present deductions and flags; do not claim causal attribution or separate price, exchange-rate, and volume effects.",
    },
    {
      id: "AQ-10",
      need: "How current, complete, reproducible, and revision-sensitive is the evidence?",
      coverage: "DIRECT",
      capabilities: ["Evidence Quality"],
      scenarioIds: ["constituent-provenance"],
      limitation:
        "Present periods, missingness, freshness, Release Revision, identities, and quantity coverage.",
    },
    {
      id: "AQ-11",
      need: "Which supplying economies serve this market, and what are their shares?",
      coverage: "DIRECT",
      capabilities: ["Supplier Landscape"],
      scenarioIds: ["supplier-landscape"],
      limitation:
        "Present the complete bounded supplying-economy cohort and five-year pooled values/shares.",
    },
    {
      id: "AQ-12",
      need: "Is supply concentrated or diversified, and how dependent is the market on leading origins?",
      coverage: "DIRECT",
      capabilities: ["Supplier Landscape"],
      scenarioIds: ["supplier-landscape"],
      limitation:
        "Present HHI on the documented 0-10,000 scale together with supplier shares and warnings.",
    },
    {
      id: "AQ-13",
      need: "What is the selected export economy's position relative to other supplying economies?",
      coverage: "DIRECT",
      capabilities: ["Exporter Position", "Supplier Landscape"],
      scenarioIds: ["exporter-position", "supplier-landscape"],
      limitation:
        "Compare economy-level pooled value and share; never imply company or brand position.",
    },
    {
      id: "AQ-14",
      need: "Which competing economies are gaining or losing share over time?",
      coverage: "BOUNDED",
      capabilities: ["Explore Further"],
      scenarioIds: ["advanced-evidence-and-validation"],
      limitation:
        "Current product has no year-by-supplier share-change result. Repeated single-year queries are evidence gathering, not a product answer.",
    },
    {
      id: "AQ-15",
      need: "What are import quantity, customs unit value, price band, and the exporter's price position?",
      coverage: "OUTSIDE",
      capabilities: ["Validation Plan"],
      scenarioIds: ["advanced-evidence-and-validation"],
      limitation:
        "Quantity coverage exists, but quantity and unit value are not public measures. Customs unit value must never be labelled transaction price.",
    },
    {
      id: "AQ-16",
      need: "Which adjacent HS Products or product-mix shifts offer expansion evidence?",
      coverage: "BOUNDED",
      capabilities: ["Explore Further"],
      scenarioIds: [
        "cross-product-opportunities",
        "advanced-evidence-and-validation",
      ],
      limitation:
        "Current evidence is a fixed exporter-importer-year bilateral product mix; no HS hierarchy, whole-market growth view, or adjacency method exists.",
    },
    {
      id: "AQ-17",
      need: "What tariffs, preferences, trade remedies, non-tariff measures, certifications, and regulatory requirements apply?",
      coverage: "OUTSIDE",
      capabilities: ["Validation Plan"],
      scenarioIds: ["advanced-evidence-and-validation"],
      limitation:
        "Requires reviewed policy and regulatory sources plus explicit HS-revision mapping decisions.",
    },
    {
      id: "AQ-18",
      need: "What route, freight, insurance, transit-time, tax, and landed-cost economics apply?",
      coverage: "OUTSIDE",
      capabilities: ["Validation Plan"],
      scenarioIds: ["advanced-evidence-and-validation"],
      limitation:
        "Requires logistics sources and company-specific cost assumptions; public trade value is not a landed-cost model.",
    },
    {
      id: "AQ-19",
      need: "Which buyers, importers, distributors, or commercial relationships should be investigated?",
      coverage: "OUTSIDE",
      capabilities: ["Validation Plan"],
      scenarioIds: ["advanced-evidence-and-validation"],
      limitation:
        "Requires separately sourced and access-controlled Company Trade Context; BACI contains no company or shipment parties.",
    },
    {
      id: "AQ-20",
      need: "What sales, profit, success probability, or risk-adjusted entry recommendation should the business expect?",
      coverage: "OUTSIDE",
      capabilities: ["Validation Plan"],
      scenarioIds: [
        "evidence-quality-and-gaps",
        "advanced-evidence-and-validation",
      ],
      limitation:
        "Intentionally excluded without company capability, cost, channel, risk, calibration, and forecasting inputs.",
    },
  ]);
