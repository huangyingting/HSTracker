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
  readonly publicMessage: string;

  constructor(
    readonly reason: AnalysisCapacityReason,
    readonly retryAfterSeconds = 2,
    analysisName = "Candidate Market",
  ) {
    super(`${analysisName} analysis capacity exceeded: ${reason}.`);
    this.publicMessage = `${analysisName} analysis is temporarily at capacity.`;
    this.name = "AnalysisCapacityExceededError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isAnalysisCapacityExceededError(
  value: unknown,
): value is AnalysisCapacityExceededError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}
