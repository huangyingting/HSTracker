import {
  invalidOpportunityQuery,
  retiredOpportunityAnalysisBuild,
  unavailableOpportunityAnalysisBuild,
  unknownExportEconomy,
  unknownOpportunityProduct,
} from "../opportunity-discovery/errors";
import type { OpportunityDetailEvidence } from "../../evidence/opportunity-evidence-source";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  OpportunityDetailV1AnalysisRequest,
  TradeAnalyticsPlatform,
} from "./trade-analytics-platform";

// Reconstructs one Market Investigation Candidate's detail evidence by running
// the opportunity-detail-v1 recipe through the platform and mapping its typed
// outcome onto the public detail payload or a typed OpportunityDiscovery error.
// It never exposes storage, reconstruction, or DuckDB vocabulary.
export async function executeOpportunityDetailV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<OpportunityDetailV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<OpportunityDetailEvidence> {
  const outcome = await platform.execute(
    {
      recipe: "opportunity-detail-v1",
      ...request,
    },
    options,
  );

  switch (outcome.state) {
    case "success":
      return outcome.payload;
    case "invalid-input": {
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidOpportunityQuery("The analysis query is invalid.");
        case "UNKNOWN_EXPORT_ECONOMY":
          throw unknownExportEconomy(outcome.error.exportEconomyCode);
        case "UNKNOWN_HS_PRODUCT":
          throw unknownOpportunityProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Opportunity Detail input error: ${String(unreachable)}`,
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
    case "empty":
      throw new TypeError(
        "Opportunity Detail v1 cannot produce an empty outcome.",
      );
    default: {
      const unreachable: never = outcome;
      throw new TypeError(
        `Unsupported Opportunity Detail outcome: ${String(unreachable)}`,
      );
    }
  }
}
