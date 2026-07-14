import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "TradeTrendAnalysisError";

export type TradeTrendAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNKNOWN_IMPORTER"
  | "UNKNOWN_PRODUCT"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE";

export class TradeTrendAnalysisError extends Error {
  constructor(
    readonly code: TradeTrendAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "TradeTrendAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isTradeTrendAnalysisError(
  value: unknown,
): value is TradeTrendAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidTradeTrendQuery(message: string): TradeTrendAnalysisError {
  return new TradeTrendAnalysisError(
    "INVALID_ANALYSIS_QUERY",
    400,
    message,
    "The analysis query is invalid.",
  );
}

export function unknownImporter(code: string): TradeTrendAnalysisError {
  return new TradeTrendAnalysisError(
    "UNKNOWN_IMPORTER",
    404,
    `Importer ${code} is not available in this analysis build.`,
    "The requested importing economy is not available.",
  );
}

export function unknownTradeTrendProduct(
  code: string,
): TradeTrendAnalysisError {
  return new TradeTrendAnalysisError(
    "UNKNOWN_PRODUCT",
    404,
    `HS12 product ${code} is not available in this analysis build.`,
    "The requested HS12 product is not available.",
  );
}

export function retiredTradeTrendAnalysisBuild(
  id: string,
): TradeTrendAnalysisError {
  return new TradeTrendAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableTradeTrendAnalysisBuild(
  id: string,
): TradeTrendAnalysisError {
  return new TradeTrendAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Trade Trend analysis is temporarily unavailable.",
  );
}
