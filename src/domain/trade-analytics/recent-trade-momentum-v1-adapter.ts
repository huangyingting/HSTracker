import {
  invalidRecentTradeMomentumQuery,
  retiredRecentTradeMomentumAnalysisBuild,
  unavailableRecentTradeMomentumAnalysisBuild,
  unknownRecentTradeMomentumProduct,
  unknownRecentTradeMomentumReporter,
} from "../recent-trade-momentum/errors";
import type { RecentTradeMomentumOutcome } from "../recent-trade-momentum/recent-trade-momentum-v1";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  AnalysisIdentity,
  DatasetPackageIdentity,
  RecentTradeMomentumV1AnalysisRequest,
  TradeAnalyticsPlatform,
} from "./trade-analytics-platform";

export type RecentTradeMomentumV1Payload = RecentTradeMomentumOutcome &
  Readonly<{
    analysisIdentity: AnalysisIdentity;
    datasetPackageIdentity: DatasetPackageIdentity;
  }>;

export async function executeRecentTradeMomentumV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<RecentTradeMomentumV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<RecentTradeMomentumV1Payload> {
  const outcome = await platform.execute(
    {
      recipe: "recent-trade-momentum-v1",
      ...request,
    },
    options,
  );

  switch (outcome.state) {
    case "success":
      return {
        ...outcome.payload,
        analysisIdentity: outcome.analysisIdentity,
        datasetPackageIdentity: outcome.datasetPackageIdentity,
      };
    case "invalid-input":
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidRecentTradeMomentumQuery("The analysis query is invalid.");
        case "UNKNOWN_REPORTER":
          throw unknownRecentTradeMomentumReporter(outcome.error.reporterCode);
        case "UNKNOWN_PRODUCT":
          throw unknownRecentTradeMomentumProduct(outcome.error.productCode);
      }
      throw new TypeError(
        `Unsupported Recent Trade Momentum input error: ${String(outcome.error)}`,
      );
    case "retired":
      throw retiredRecentTradeMomentumAnalysisBuild(outcome.error.analysisBuildId);
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Recent Trade Momentum",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Recent Trade Momentum",
      );
    case "budget":
      throw new AnalysisBudgetExceededError(
        outcome.error.budget,
        "Recent Trade Momentum",
      );
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableRecentTradeMomentumAnalysisBuild(request.analysisBuildId);
    case "empty":
      throw new TypeError("Recent Trade Momentum v1 cannot produce an empty outcome.");
    default:
      throw new TypeError(
        `Unsupported Recent Trade Momentum outcome: ${String(outcome)}`,
      );
  }
}
