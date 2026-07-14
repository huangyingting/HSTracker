import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../errors/cross-bundle-error";

const ERROR_BRAND = "AnalysisRateLimitedError";

export class AnalysisRateLimitedError extends Error {
  readonly code = "ANALYSIS_RATE_LIMITED";
  readonly status = 429;
  readonly publicMessage =
    "Candidate Market requests are temporarily limited. Please retry shortly.";

  constructor(readonly retryAfterSeconds: number) {
    super("Candidate Market request rate limit exceeded.");
    this.name = "AnalysisRateLimitedError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isAnalysisRateLimitedError(
  value: unknown,
): value is AnalysisRateLimitedError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}
