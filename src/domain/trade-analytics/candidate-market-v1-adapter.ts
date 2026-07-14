import {
  invalidAnalysisQuery,
  retiredAnalysisBuild,
  unavailableAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../candidate-market/errors";
import type {
  CandidateMarketAnalysisQuery,
  CandidateMarketResult,
} from "../candidate-market/result";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import type {
  AnalysisExecutionOptions,
  TradeAnalyticsPlatform,
} from "./trade-analytics-platform";

export async function executeCandidateMarketV1(
  platform: TradeAnalyticsPlatform,
  request: CandidateMarketAnalysisQuery,
  options?: AnalysisExecutionOptions,
): Promise<CandidateMarketResult> {
  const outcome = await platform.execute(
    {
      recipe: "candidate-market-v1",
      ...request,
    },
    options,
  );

  switch (outcome.state) {
    case "success":
    case "empty":
      return outcome.payload;
    case "invalid-input": {
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidAnalysisQuery("The analysis query is invalid.");
        case "UNKNOWN_EXPORTER":
          throw unknownExporter(outcome.error.exporterCode);
        case "UNKNOWN_PRODUCT":
          throw unknownProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Candidate Market input error: ${String(unreachable)}`,
      );
    }
    case "retired":
      throw retiredAnalysisBuild(outcome.error.analysisBuildId);
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
      );
    case "rate-limit":
      throw new AnalysisCapacityExceededError(
        "queue-full",
        outcome.error.retryAfterSeconds,
      );
    case "incompatible-package":
    case "budget":
    case "temporary-unavailability":
      throw unavailableAnalysisBuild(request.analysisBuildId);
    default: {
      const unreachable: never = outcome;
      throw new TypeError(
        `Unsupported Candidate Market outcome: ${String(unreachable)}`,
      );
    }
  }
}
