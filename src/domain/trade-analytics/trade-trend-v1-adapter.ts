import {
  invalidTradeTrendQuery,
  retiredTradeTrendAnalysisBuild,
  unavailableTradeTrendAnalysisBuild,
  unknownImporter,
  unknownTradeTrendProduct,
} from "../trade-trend/errors";
import type { TradeTrendResult } from "../trade-trend/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  AnalysisIdentity,
  DatasetPackageIdentity,
  TradeAnalyticsPlatform,
  TradeTrendV1AnalysisRequest,
} from "./trade-analytics-platform";

export type TradeTrendV1Payload = TradeTrendResult &
  Readonly<{
    analysisIdentity: AnalysisIdentity;
    datasetPackageIdentity: DatasetPackageIdentity;
  }>;

export async function executeTradeTrendV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<TradeTrendV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<TradeTrendV1Payload> {
  const outcome = await platform.execute(
    {
      recipe: "trade-trend-v1",
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
          throw invalidTradeTrendQuery("The analysis query is invalid.");
        case "UNKNOWN_IMPORTER":
          throw unknownImporter(outcome.error.importerCode);
        case "UNKNOWN_PRODUCT":
          throw unknownTradeTrendProduct(outcome.error.productCode);
      }
      throw new TypeError(
        `Unsupported Trade Trend input error: ${String(outcome.error)}`,
      );
    case "retired":
      throw retiredTradeTrendAnalysisBuild(outcome.error.analysisBuildId);
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Trade Trend",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Trade Trend",
      );
    case "budget":
      throw new AnalysisBudgetExceededError(outcome.error.budget, "Trade Trend");
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableTradeTrendAnalysisBuild(request.analysisBuildId);
    case "empty":
      throw new TypeError("Trade Trend v1 cannot produce an empty outcome.");
    default:
      throw new TypeError(
        `Unsupported Trade Trend outcome: ${String(outcome)}`,
      );
  }
}
