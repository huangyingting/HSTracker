import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "OpportunityDiscoveryAnalysisError";

export type OpportunityDiscoveryAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNKNOWN_EXPORT_ECONOMY"
  | "UNKNOWN_HS_PRODUCT"
  | "INVALID_CURSOR"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE";

export class OpportunityDiscoveryAnalysisError extends Error {
  constructor(
    readonly code: OpportunityDiscoveryAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 503,
    message: string,
    readonly publicMessage: string,
    // The offending economy or product code, when the failure is about one
    // specific input (UNKNOWN_EXPORT_ECONOMY / UNKNOWN_HS_PRODUCT).
    readonly subject?: string,
  ) {
    super(message);
    this.name = "OpportunityDiscoveryAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isOpportunityDiscoveryAnalysisError(
  value: unknown,
): value is OpportunityDiscoveryAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidOpportunityQuery(
  message: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "INVALID_ANALYSIS_QUERY",
    400,
    message,
    "The analysis query is invalid.",
  );
}

export function unknownExportEconomy(
  code: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "UNKNOWN_EXPORT_ECONOMY",
    404,
    `Export economy ${code} is not available in this analysis build.`,
    "The requested exporting economy is not available.",
    code,
  );
}

export function unknownOpportunityProduct(
  code: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "UNKNOWN_HS_PRODUCT",
    404,
    `HS12 product ${code} is not available in this analysis build.`,
    "A requested HS12 product is not available.",
    code,
  );
}

export function invalidOpportunityCursor(
  message: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "INVALID_CURSOR",
    400,
    message,
    "The pagination cursor is invalid for this feed.",
  );
}

export function retiredOpportunityAnalysisBuild(
  id: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableOpportunityAnalysisBuild(
  id: string,
): OpportunityDiscoveryAnalysisError {
  return new OpportunityDiscoveryAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Opportunity discovery analysis is temporarily unavailable.",
  );
}
