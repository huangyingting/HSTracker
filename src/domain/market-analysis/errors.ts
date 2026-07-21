import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

// The one error the Market Analysis Module itself originates (spec
// docs/spec/export-market-analysis-workspace.md §5.4; issue #66). Every
// other expected failure reuses the constituent recipe's own typed error
// family (Candidate Market / Trade Trend / Supplier Competition) instead of
// introducing a parallel code -- this is the sole exception, because no
// constituent recipe has a code for "valid identities named a market absent
// from the complete Candidate Market cohort".
const ERROR_BRAND = "MarketAnalysisAnalysisError";

export type MarketAnalysisAnalysisErrorCode = "CANDIDATE_MARKET_NOT_FOUND";

export class MarketAnalysisAnalysisError extends Error {
  constructor(
    readonly code: MarketAnalysisAnalysisErrorCode,
    readonly status: 404,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "MarketAnalysisAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isMarketAnalysisAnalysisError(
  value: unknown,
): value is MarketAnalysisAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function candidateMarketNotFound(
  marketCode: string,
): MarketAnalysisAnalysisError {
  return new MarketAnalysisAnalysisError(
    "CANDIDATE_MARKET_NOT_FOUND",
    404,
    `Market ${marketCode} is absent from the complete Candidate Market cohort.`,
    "The requested market is not a Candidate Market for this export economy and product.",
  );
}
