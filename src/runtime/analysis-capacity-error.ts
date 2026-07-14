import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../errors/cross-bundle-error";

const ERROR_BRAND = "AnalysisCapacityExceededError";

export type AnalysisCapacityReason =
  | "queue-full"
  | "queue-timeout"
  | "execution-timeout";

export class AnalysisCapacityExceededError extends Error {
  readonly code = "ANALYSIS_CAPACITY_EXCEEDED";
  readonly status = 503;
  readonly publicMessage =
    "Candidate Market analysis is temporarily at capacity.";

  constructor(
    readonly reason: AnalysisCapacityReason,
    readonly retryAfterSeconds = 2,
  ) {
    super(`Candidate Market analysis capacity exceeded: ${reason}.`);
    this.name = "AnalysisCapacityExceededError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isAnalysisCapacityExceededError(
  value: unknown,
): value is AnalysisCapacityExceededError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}
