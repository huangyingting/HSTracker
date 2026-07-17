import {
  invalidOpportunityCursor,
  invalidOpportunityQuery,
  retiredOpportunityAnalysisBuild,
  unavailableOpportunityAnalysisBuild,
  unknownExportEconomy,
  unknownOpportunityProduct,
} from "../opportunity-discovery/errors";
import type { MarketInvestigationPage } from "../opportunity-discovery/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  OpportunityDiscoveryV1AnalysisRequest,
  TradeAnalyticsPlatform,
} from "./trade-analytics-platform";

// Serves the ordered Market Investigation feed for one exporter by running the
// opportunity-discovery-v1 recipe through the platform and mapping its typed
// outcome onto the public page payload or a typed OpportunityDiscovery error.
// It never exposes storage, cursor-encoding, or DuckDB vocabulary.
export async function executeOpportunityDiscoveryV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<OpportunityDiscoveryV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<MarketInvestigationPage> {
  const outcome = await platform.execute(
    {
      recipe: "opportunity-discovery-v1",
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
          throw invalidOpportunityQuery("The analysis query is invalid.");
        case "INVALID_CURSOR":
          throw invalidOpportunityCursor(
            "The pagination cursor is invalid for this feed.",
          );
        case "UNKNOWN_EXPORT_ECONOMY":
          throw unknownExportEconomy(outcome.error.exportEconomyCode);
        case "UNKNOWN_HS_PRODUCT":
          throw unknownOpportunityProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Opportunity Discovery input error: ${String(unreachable)}`,
      );
    }
    case "retired":
      throw retiredOpportunityAnalysisBuild(outcome.error.analysisBuildId);
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(outcome.error.retryAfterSeconds);
    case "budget":
      throw new AnalysisBudgetExceededError(outcome.error.budget);
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableOpportunityAnalysisBuild(request.analysisBuildId);
    default: {
      const unreachable: never = outcome;
      throw new TypeError(
        `Unsupported Opportunity Discovery outcome: ${String(unreachable)}`,
      );
    }
  }
}
