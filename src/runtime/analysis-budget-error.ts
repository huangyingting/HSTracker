import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../errors/cross-bundle-error";
import type { AnalysisOutcome } from "../domain/trade-analytics/trade-analytics-platform";

const ERROR_BRAND = "AnalysisBudgetExceededError";

export class AnalysisBudgetExceededError extends Error {
  readonly code = "ANALYSIS_BUDGET_EXCEEDED";
  readonly status = 413;
  readonly publicMessage: string;

  constructor(
    readonly budget: Extract<
      Extract<AnalysisOutcome<"candidate-market-v1">, { state: "budget" }>["error"]["budget"],
      string
    >,
    analysisName = "Candidate Market",
  ) {
    super(`${analysisName} analysis exceeded its ${budget} budget.`);
    this.publicMessage = `The complete ${analysisName} result exceeds its serving budget.`;
    this.name = "AnalysisBudgetExceededError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isAnalysisBudgetExceededError(
  value: unknown,
): value is AnalysisBudgetExceededError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}
