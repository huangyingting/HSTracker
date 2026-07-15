import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "TradeExplorerAnalysisError";

// Every code below maps to exactly one AnalysisOutcome<"trade-explorer-v1">
// state in trade-analytics-platform.ts. Structural/shape/vocabulary
// violations are INVALID_ANALYSIS_QUERY-family codes (state "invalid-input");
// exceeding a declared cardinality budget is a distinct BUDGET code (state
// "budget") rather than an invalid-input code, so "invalid combination" and
// "budget excess" remain distinct typed outcomes per issue #46 acceptance
// criteria.
export type TradeExplorerAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNSUPPORTED_SHAPE"
  | "DIMENSION_MISMATCH"
  | "UNSUPPORTED_MEASURE"
  | "UNSUPPORTED_SORT_KEY"
  | "YEAR_FILTER_INVALID"
  | "YEAR_OUT_OF_FINALIZED_WINDOW"
  | "FIXED_DIMENSION_CARDINALITY_INVALID"
  | "GROUPED_DIMENSION_EMPTY"
  | "UNKNOWN_EXPORT_ECONOMY"
  | "UNKNOWN_IMPORT_ECONOMY"
  | "UNKNOWN_HS_PRODUCT"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE"
  | "NO_COMPATIBLE_DATASET_PACKAGE"
  | "INPUT_CARDINALITY_BUDGET_EXCEEDED"
  | "RESULT_ROWS_BUDGET_EXCEEDED"
  | "RESULT_BYTES_BUDGET_EXCEEDED"
  | "SCAN_BUDGET_EXCEEDED";

export class TradeExplorerAnalysisError extends Error {
  constructor(
    readonly code: TradeExplorerAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 413 | 503,
    message: string,
    readonly publicMessage: string,
    // Carries the exact violating value (a shape name, dimension name, or
    // economy/product code) for codes whose AnalysisOutcome union member
    // must report it (see expectedTradeExplorerFailure in
    // trade-analytics-platform.ts). Codes that need no such value (e.g.
    // INVALID_ANALYSIS_QUERY) leave this null.
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "TradeExplorerAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isTradeExplorerAnalysisError(
  value: unknown,
): value is TradeExplorerAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

function invalid(
  code: Exclude<
    TradeExplorerAnalysisErrorCode,
    | "ANALYSIS_BUILD_RETIRED"
    | "ANALYSIS_UNAVAILABLE"
    | "NO_COMPATIBLE_DATASET_PACKAGE"
    | "INPUT_CARDINALITY_BUDGET_EXCEEDED"
    | "RESULT_ROWS_BUDGET_EXCEEDED"
    | "RESULT_BYTES_BUDGET_EXCEEDED"
    | "SCAN_BUDGET_EXCEEDED"
    | "UNKNOWN_EXPORT_ECONOMY"
    | "UNKNOWN_IMPORT_ECONOMY"
    | "UNKNOWN_HS_PRODUCT"
  >,
  message: string,
  publicMessage: string,
  detail: string | null = null,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(code, 400, message, publicMessage, detail);
}

export function invalidTradeExplorerQuery(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "INVALID_ANALYSIS_QUERY",
    message,
    "The Trade Explorer query is invalid.",
  );
}

export function unsupportedTradeExplorerShape(
  shape: string,
): TradeExplorerAnalysisError {
  return invalid(
    "UNSUPPORTED_SHAPE",
    `Shape ${shape} is not an allowlisted Trade Explorer shape.`,
    "Choose one of the allowlisted Trade Explorer shapes.",
    shape,
  );
}

export function tradeExplorerDimensionMismatch(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "DIMENSION_MISMATCH",
    message,
    "The requested dimensions do not match the chosen shape. Request exactly the shape's own grouped dimension.",
  );
}

export function unsupportedTradeExplorerMeasure(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "UNSUPPORTED_MEASURE",
    message,
    "Choose between one and two approved measures: TRADE_VALUE_USD, RECORDED_FLOW_COUNT.",
  );
}

export function unsupportedTradeExplorerSortKey(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "UNSUPPORTED_SORT_KEY",
    message,
    "Sort by the requested grouped dimension or by one of the requested measures.",
  );
}

export function tradeExplorerYearFilterInvalid(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "YEAR_FILTER_INVALID",
    message,
    "Narrow the year filter to a valid list or range within the finalized window.",
  );
}

export function tradeExplorerYearOutOfFinalizedWindow(
  message: string,
): TradeExplorerAnalysisError {
  return invalid(
    "YEAR_OUT_OF_FINALIZED_WINDOW",
    message,
    "Choose only finalized years; Provisional Year evidence is excluded from Trade Explorer.",
  );
}

export function tradeExplorerFixedDimensionCardinalityInvalid(
  dimension: string,
): TradeExplorerAnalysisError {
  return invalid(
    "FIXED_DIMENSION_CARDINALITY_INVALID",
    `Fixed dimension ${dimension} must resolve to exactly one code.`,
    `Provide exactly one code for the fixed ${dimension} dimension.`,
    dimension,
  );
}

export function tradeExplorerGroupedDimensionEmpty(
  dimension: string,
): TradeExplorerAnalysisError {
  return invalid(
    "GROUPED_DIMENSION_EMPTY",
    `Grouped dimension ${dimension} requires at least one cohort code.`,
    `Provide at least one cohort code for the grouped ${dimension} dimension.`,
    dimension,
  );
}

export function unknownTradeExplorerExportEconomy(
  code: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "UNKNOWN_EXPORT_ECONOMY",
    404,
    `Export economy ${code} is not available in this analysis build.`,
    "The requested export economy is not available.",
    code,
  );
}

export function unknownTradeExplorerImportEconomy(
  code: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "UNKNOWN_IMPORT_ECONOMY",
    404,
    `Import economy ${code} is not available in this analysis build.`,
    "The requested import economy is not available.",
    code,
  );
}

export function unknownTradeExplorerHsProduct(
  code: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "UNKNOWN_HS_PRODUCT",
    404,
    `HS12 product ${code} is not available in this analysis build.`,
    "The requested HS12 product is not available.",
    code,
  );
}

export function retiredTradeExplorerAnalysisBuild(
  id: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableTradeExplorerAnalysisBuild(
  id: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Trade Explorer analysis is temporarily unavailable.",
  );
}

export function incompatibleTradeExplorerDatasetPackage(
  reason:
    | "MISSING_REQUIRED_CAPABILITY"
    | "CAPABILITY_VERSION_MISMATCH"
    | "PACKAGE_IDENTITY_MISMATCH",
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "NO_COMPATIBLE_DATASET_PACKAGE",
    503,
    `The Trade Explorer Dataset Package is incompatible: ${reason}.`,
    "Trade Explorer is not available for this analysis build because its Dataset Package is incompatible. Use a currently supported analysis build.",
    reason,
  );
}

export function tradeExplorerInputCardinalityBudgetExceeded(
  message: string,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "INPUT_CARDINALITY_BUDGET_EXCEEDED",
    413,
    message,
    "Narrow the requested years or filter codes; this query exceeds its input-size budget.",
  );
}

export function tradeExplorerResultRowsBudgetExceeded(
  rowCount: number,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "RESULT_ROWS_BUDGET_EXCEEDED",
    413,
    `Trade Explorer evidence declared ${rowCount} rows, exceeding its complete-result budget.`,
    "The complete Trade Explorer result exceeds its serving budget.",
  );
}

export function tradeExplorerResultBytesBudgetExceeded(
  bytes: number,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "RESULT_BYTES_BUDGET_EXCEEDED",
    413,
    `Trade Explorer result serialized to ${bytes} bytes, exceeding its serving budget.`,
    "The complete Trade Explorer result exceeds its serving budget.",
  );
}

export function tradeExplorerScanBudgetExceeded(
  scanRows: number,
): TradeExplorerAnalysisError {
  return new TradeExplorerAnalysisError(
    "SCAN_BUDGET_EXCEEDED",
    413,
    `Trade Explorer evidence required scanning ${scanRows} rows, exceeding its scan budget.`,
    "This Trade Explorer query exceeds its scan budget. Narrow the request.",
  );
}
