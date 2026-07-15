import type {
  EconomyIdentity,
  ProductIdentity,
} from "../candidate-market/result";

// Trade Explorer v1 is a closed recipe module, not an open query builder:
// callers choose one of a small allowlist of business "shapes" (see
// TRADE_EXPLORER_SHAPES in ./shapes) instead of freely combining tables,
// columns, joins, or expressions. Every dimension named here is public
// semantic vocabulary -- never a storage table or column name.
export type TradeExplorerDimension =
  | "YEAR"
  | "EXPORT_ECONOMY"
  | "IMPORT_ECONOMY"
  | "HS_PRODUCT";

export type TradeExplorerMeasure = "TRADE_VALUE_USD" | "RECORDED_FLOW_COUNT";

// The canonical (dedup + fixed) measure order every normalized query and
// result uses, so caller-supplied measure order never changes Analysis
// Identity or column order.
export const TRADE_EXPLORER_MEASURE_ORDER: readonly TradeExplorerMeasure[] = [
  "TRADE_VALUE_USD",
  "RECORDED_FLOW_COUNT",
];

// Each shape fixes exactly one grouped ("row") dimension and every other
// dimension to a single value. This is what keeps Trade Explorer v1 a
// bounded, enumerable recipe: a request never leaves a dimension
// unconstrained. A future bounded 2D shape (year x one business dimension)
// is deliberately deferred -- see docs/adr or CONTEXT.md Trade Explorer
// entry -- so TRADE_EXPLORER_SHAPES stays a closed set of four v1 members.
export type TradeExplorerShape =
  | "finalized-trend-v1"
  | "importing-markets-v1"
  | "supplying-economies-v1"
  | "product-mix-v1";

export const TRADE_EXPLORER_MAX_YEARS = 5;
export const TRADE_EXPLORER_MAX_FILTER_CODES = 25;
// Defensive ceilings enforced by computeTradeExplorerV1 itself against the
// evidence it is given, independent of (and always looser than) the
// request-level caps above. They exist so a defective evidence adapter
// cannot smuggle an oversized result past the normalized-request budget
// checks; see trade-explorer-v1.ts assertRowBudget/assertResultByteBudget.
export const TRADE_EXPLORER_MAX_RESULT_ROWS = 250;
export const TRADE_EXPLORER_MAX_RESULT_BYTES = 1024 * 1024;
// The deterministic fixture/acceptance scan-row ceiling: the count of
// evidence cells computeTradeExplorerV1 must inspect to answer one query
// (bounded by TRADE_EXPLORER_MAX_RESULT_ROWS since v1 has exactly one
// grouped dimension). Production DuckDB scan accounting is #47 work.
export const TRADE_EXPLORER_MAX_SCAN_ROWS = 250;

export type TradeExplorerSortKey = TradeExplorerDimension | TradeExplorerMeasure;

export type TradeExplorerSort = Readonly<{
  key: TradeExplorerSortKey;
  direction: "asc" | "desc";
}>;

// The request as callers of TradeAnalyticsPlatform.execute supply it:
// closed, semantic, and untrusted (it may originate from an HTTP body or
// query string). Every field is a public vocabulary term or a bounded list
// of typed codes -- never a table, column, path, object key, or SQL/query
// language fragment.
export type TradeExplorerYearFilter =
  | Readonly<{ mode: "list"; years: readonly number[] }>
  | Readonly<{ mode: "range"; start: number; end: number }>;

export type TradeExplorerV1Filters = Readonly<{
  year: TradeExplorerYearFilter;
  exportEconomy: readonly string[];
  importEconomy: readonly string[];
  hsProduct: readonly string[];
}>;

export type TradeExplorerV1RecipeInput = Readonly<{
  analysisBuildId: string;
  shape: TradeExplorerShape;
  dimensions: readonly TradeExplorerDimension[];
  measures: readonly TradeExplorerMeasure[];
  filters: TradeExplorerV1Filters;
  sort: TradeExplorerSort | null;
}>;

// The evidence-source-facing request: the platform normalizes the raw
// `TradeExplorerV1RecipeInput` above (see ../trade-explorer/normalize.ts)
// before any evidence source ever sees a query, so
// `TradeEvidenceSource.loadTradeExplorerV1Inputs` always receives the
// already-deterministic canonical form -- it never re-implements
// deduplication, ordering, or budget checks itself.
export type TradeExplorerV1EvidenceRequest = Readonly<{
  analysisBuildId: string;
  query: TradeExplorerV1NormalizedInputs;
}>;

// The deterministic, canonical form of one query: deduplicated/sorted code
// lists, ascending years, canonical measure order, and an explicit (never
// null) sort with deterministic tie-breakers. This is what participates in
// Analysis Identity -- caller list/tuple order never does.
export type TradeExplorerV1NormalizedInputs = Readonly<{
  shape: TradeExplorerShape;
  dimension: TradeExplorerDimension;
  measures: readonly TradeExplorerMeasure[];
  years: readonly number[];
  exportEconomy: readonly string[];
  importEconomy: readonly string[];
  hsProduct: readonly string[];
  sort: TradeExplorerSort;
}>;

export type TradeExplorerCellEvidence =
  | Readonly<{
      state: "RECORDED_POSITIVE";
      valueCurrentUsd: string;
      sourceFlowCount: number;
    }>
  | Readonly<{ state: "NO_RECORDED_POSITIVE_FLOW" }>
  | Readonly<{ state: "MISSING_OBSERVATION" }>;

export type TradeExplorerV1Inputs = Readonly<{
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  evidenceSha256: string;
  artifact: Readonly<{
    baciRelease: string;
    buildId: string;
    schemaVersion: string;
    sha256: string;
  }>;
  release: Readonly<{
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: Readonly<{ start: number; end: number }>;
    finalizedCutoffYear: number;
    provisionalYear: number;
  }>;
  query: TradeExplorerV1NormalizedInputs;
  exportEconomies: readonly EconomyIdentity[];
  importEconomies: readonly EconomyIdentity[];
  products: readonly ProductIdentity[];
  // false when the fixed-dimension combination (the export/import
  // economy + HS Product + -- for a fixed-YEAR shape -- year) is not part
  // of the evidence source's known universe at all, distinct from a known
  // combination whose individual cells are MISSING_OBSERVATION. `cells`
  // must be empty when this is false; computeTradeExplorerV1 then returns
  // a typed empty outcome (emptyReason "NO_ENUMERABLE_COHORT") rather than
  // synthesizing per-row missingness for a combination it never modeled.
  cohortEnumerable: boolean;
  // Exactly one cell per grouped-dimension value, positionally aligned to
  // query.years / query.exportEconomy / query.importEconomy / query.hsProduct
  // -- whichever list query.dimension names -- never a dictionary keyed by
  // caller-controlled codes.
  cells: readonly TradeExplorerCellEvidence[];
}>;

export type TradeExplorerDimensionValue =
  | Readonly<{ dimension: "YEAR"; year: number }>
  | Readonly<{ dimension: "EXPORT_ECONOMY"; economy: EconomyIdentity }>
  | Readonly<{ dimension: "IMPORT_ECONOMY"; economy: EconomyIdentity }>
  | Readonly<{ dimension: "HS_PRODUCT"; product: ProductIdentity }>;

export type TradeExplorerObservationState =
  | "RECORDED_POSITIVE"
  | "NO_RECORDED_POSITIVE_FLOW"
  | "MISSING_OBSERVATION";

export type TradeExplorerRow = Readonly<{
  dimensionValue: TradeExplorerDimensionValue;
  state: TradeExplorerObservationState;
  // Present (non-null) only when state === "RECORDED_POSITIVE" and
  // TRADE_VALUE_USD was a requested measure.
  tradeValueUsd: string | null;
  // Present (non-null) whenever state !== "MISSING_OBSERVATION" (a known
  // zero for NO_RECORDED_POSITIVE_FLOW) and RECORDED_FLOW_COUNT was a
  // requested measure.
  recordedFlowCount: number | null;
}>;

export type TradeExplorerTotalRow = Readonly<{
  tradeValueUsd: string | null;
  recordedFlowCount: number | null;
  includedRowCount: number;
  missingRowCount: number;
}>;

export type TradeExplorerQualityWarningCode =
  | "SPARSE_COHORT"
  | "INCOMPLETE_COHORT";

export type TradeExplorerBudgetMetadata = Readonly<{
  requested: Readonly<{
    maxYears: number;
    maxFilterCodesPerDimension: number;
    maxResultRows: number;
    maxResultBytes: number;
  }>;
  accepted: Readonly<{
    maxYears: number;
    maxFilterCodesPerDimension: number;
    maxResultRows: number;
    maxScanRows: number;
    maxResultBytes: number;
  }>;
  actual: Readonly<{
    scanRows: number;
    resultRows: number;
    // Byte length of the tabular content alone (columns + rows + total
    // row), measured before the surrounding envelope (identity,
    // provenance, this budget metadata itself) is assembled, so it is
    // never self-referential.
    resultBytes: number;
  }>;
}>;

export type TradeExplorerResult = Readonly<{
  schemaVersion: "trade-explorer-result-v1";
  analysisId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  query: TradeExplorerV1NormalizedInputs;
  provenance: Readonly<{
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: Readonly<{ start: number; end: number }>;
    finalizedWindow: Readonly<{ start: number; end: number }>;
    artifactBuildId: string;
    artifactSchemaVersion: string;
    artifactSha256: string;
    evidenceSha256: string;
    valueUnit: "CURRENT_USD";
  }>;
  columns: readonly (TradeExplorerDimension | TradeExplorerMeasure)[];
  rowCount: number;
  emptyReason: "NO_ENUMERABLE_COHORT" | null;
  rows: readonly TradeExplorerRow[];
  totalRow: TradeExplorerTotalRow | null;
  qualityWarnings: readonly TradeExplorerQualityWarningCode[];
  budget: TradeExplorerBudgetMetadata;
  discoveryDisclaimer: string;
}>;
