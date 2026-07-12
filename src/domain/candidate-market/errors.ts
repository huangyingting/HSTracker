import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "CandidateMarketAnalysisError";

export type CandidateMarketAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNKNOWN_EXPORTER"
  | "UNKNOWN_PRODUCT"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE";

export class CandidateMarketAnalysisError extends Error {
  constructor(
    readonly code: CandidateMarketAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "CandidateMarketAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isCandidateMarketAnalysisError(
  value: unknown,
): value is CandidateMarketAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidAnalysisQuery(message: string) {
  return new CandidateMarketAnalysisError(
    "INVALID_ANALYSIS_QUERY",
    400,
    message,
    "The analysis query is invalid.",
  );
}

export function unknownExporter(code: string) {
  return new CandidateMarketAnalysisError(
    "UNKNOWN_EXPORTER",
    404,
    `Exporter ${code} is not available in this analysis build.`,
    "The requested exporter is not available.",
  );
}

export function unknownProduct(code: string) {
  return new CandidateMarketAnalysisError(
    "UNKNOWN_PRODUCT",
    404,
    `HS12 product ${code} is not available in this analysis build.`,
    "The requested HS12 product is not available.",
  );
}

export function retiredAnalysisBuild(id: string) {
  return new CandidateMarketAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableAnalysisBuild(id: string) {
  return new CandidateMarketAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Candidate Market analysis is temporarily unavailable.",
  );
}
