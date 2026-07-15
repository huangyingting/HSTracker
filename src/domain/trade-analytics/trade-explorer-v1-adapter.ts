import {
  incompatibleTradeExplorerDatasetPackage,
  invalidTradeExplorerQuery,
  retiredTradeExplorerAnalysisBuild,
  tradeExplorerDimensionMismatch,
  tradeExplorerFixedDimensionCardinalityInvalid,
  tradeExplorerGroupedDimensionEmpty,
  tradeExplorerYearFilterInvalid,
  tradeExplorerYearOutOfFinalizedWindow,
  unavailableTradeExplorerAnalysisBuild,
  unknownTradeExplorerExportEconomy,
  unknownTradeExplorerHsProduct,
  unknownTradeExplorerImportEconomy,
  unsupportedTradeExplorerMeasure,
  unsupportedTradeExplorerShape,
  unsupportedTradeExplorerSortKey,
} from "../trade-explorer/errors";
import type { TradeExplorerResult } from "../trade-explorer/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  AnalysisIdentity,
  DatasetPackageIdentity,
  TradeAnalyticsPlatform,
  TradeExplorerV1AnalysisRequest,
} from "./trade-analytics-platform";

export type TradeExplorerV1Payload = TradeExplorerResult &
  Readonly<{
    analysisIdentity: AnalysisIdentity;
    datasetPackageIdentity: DatasetPackageIdentity;
  }>;

export async function executeTradeExplorerV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<TradeExplorerV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<TradeExplorerV1Payload> {
  const outcome = await platform.execute(
    {
      recipe: "trade-explorer-v1",
      ...request,
    },
    options,
  );

  switch (outcome.state) {
    case "success":
    case "empty":
      return {
        ...outcome.payload,
        analysisIdentity: outcome.analysisIdentity,
        datasetPackageIdentity: outcome.datasetPackageIdentity,
      };
    case "invalid-input":
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          return throwInvalid(invalidTradeExplorerQuery("The analysis query is invalid."));
        case "UNSUPPORTED_SHAPE":
          return throwInvalid(unsupportedTradeExplorerShape(outcome.error.shape));
        case "DIMENSION_MISMATCH":
          return throwInvalid(tradeExplorerDimensionMismatch("The requested dimensions do not match the chosen shape."));
        case "UNSUPPORTED_MEASURE":
          return throwInvalid(unsupportedTradeExplorerMeasure("An unsupported measure was requested."));
        case "UNSUPPORTED_SORT_KEY":
          return throwInvalid(unsupportedTradeExplorerSortKey("An unsupported sort key was requested."));
        case "YEAR_FILTER_INVALID":
          return throwInvalid(tradeExplorerYearFilterInvalid("The year filter is invalid for this shape."));
        case "YEAR_OUT_OF_FINALIZED_WINDOW":
          return throwInvalid(tradeExplorerYearOutOfFinalizedWindow("The requested year is outside the finalized window."));
        case "FIXED_DIMENSION_CARDINALITY_INVALID":
          return throwInvalid(tradeExplorerFixedDimensionCardinalityInvalid(outcome.error.dimension));
        case "GROUPED_DIMENSION_EMPTY":
          return throwInvalid(tradeExplorerGroupedDimensionEmpty(outcome.error.dimension));
        case "UNKNOWN_EXPORT_ECONOMY":
          return throwInvalid(unknownTradeExplorerExportEconomy(outcome.error.economyCode));
        case "UNKNOWN_IMPORT_ECONOMY":
          return throwInvalid(unknownTradeExplorerImportEconomy(outcome.error.economyCode));
        case "UNKNOWN_HS_PRODUCT":
          return throwInvalid(unknownTradeExplorerHsProduct(outcome.error.productCode));
      }
      throw new TypeError(
        `Unsupported Trade Explorer input error: ${String(outcome.error)}`,
      );
    case "retired":
      throw retiredTradeExplorerAnalysisBuild(outcome.error.analysisBuildId);
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Trade Explorer",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Trade Explorer",
      );
    case "budget":
      throw new AnalysisBudgetExceededError(outcome.error.budget, "Trade Explorer");
    case "incompatible-package":
      throw incompatibleTradeExplorerDatasetPackage(outcome.error.reason);
    case "temporary-unavailability":
      throw unavailableTradeExplorerAnalysisBuild(request.analysisBuildId);
    default:
      throw new TypeError(
        `Unsupported Trade Explorer outcome: ${String(outcome)}`,
      );
  }
}

function throwInvalid(error: Error): never {
  throw error;
}
