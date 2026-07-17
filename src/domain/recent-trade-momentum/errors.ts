import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "RecentTradeMomentumAnalysisError";

export type RecentTradeMomentumAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNKNOWN_REPORTER"
  | "UNKNOWN_PRODUCT"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE";

export class RecentTradeMomentumAnalysisError extends Error {
  constructor(
    readonly code: RecentTradeMomentumAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "RecentTradeMomentumAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isRecentTradeMomentumAnalysisError(
  value: unknown,
): value is RecentTradeMomentumAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidRecentTradeMomentumQuery(
  message: string,
): RecentTradeMomentumAnalysisError {
  return new RecentTradeMomentumAnalysisError(
    "INVALID_ANALYSIS_QUERY",
    400,
    message,
    "The analysis query is invalid.",
  );
}

export function unknownRecentTradeMomentumReporter(
  code: string,
): RecentTradeMomentumAnalysisError {
  return new RecentTradeMomentumAnalysisError(
    "UNKNOWN_REPORTER",
    404,
    `Reporting market ${code} is not available in this monthly package.`,
    "The requested reporting market is not available.",
  );
}

export function unknownRecentTradeMomentumProduct(
  code: string,
): RecentTradeMomentumAnalysisError {
  return new RecentTradeMomentumAnalysisError(
    "UNKNOWN_PRODUCT",
    404,
    `HS12 product ${code} is not available in this monthly package.`,
    "The requested HS12 product is not available.",
  );
}

export function retiredRecentTradeMomentumAnalysisBuild(
  id: string,
): RecentTradeMomentumAnalysisError {
  return new RecentTradeMomentumAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableRecentTradeMomentumAnalysisBuild(
  id: string,
): RecentTradeMomentumAnalysisError {
  return new RecentTradeMomentumAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Recent Trade Momentum analysis is temporarily unavailable.",
  );
}
