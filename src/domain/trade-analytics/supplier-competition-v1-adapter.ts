import {
  invalidSupplierCompetitionQuery,
  retiredSupplierCompetitionAnalysisBuild,
  unavailableSupplierCompetitionAnalysisBuild,
  unknownSupplierCompetitionImporter,
  unknownSupplierCompetitionProduct,
} from "../supplier-competition/errors";
import type { SupplierCompetitionResult } from "../supplier-competition/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  AnalysisIdentity,
  DatasetPackageIdentity,
  SupplierCompetitionV1AnalysisRequest,
  TradeAnalyticsPlatform,
} from "./trade-analytics-platform";

export type SupplierCompetitionV1Payload = SupplierCompetitionResult &
  Readonly<{
    analysisIdentity: AnalysisIdentity;
    datasetPackageIdentity: DatasetPackageIdentity;
  }>;

export async function executeSupplierCompetitionV1(
  platform: TradeAnalyticsPlatform,
  request: Omit<SupplierCompetitionV1AnalysisRequest, "recipe">,
  options?: AnalysisExecutionOptions,
): Promise<SupplierCompetitionV1Payload> {
  const outcome = await platform.execute(
    {
      recipe: "supplier-competition-v1",
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
          throw invalidSupplierCompetitionQuery(
            "The analysis query is invalid.",
          );
        case "UNKNOWN_IMPORTER":
          throw unknownSupplierCompetitionImporter(
            outcome.error.importerCode,
          );
        case "UNKNOWN_PRODUCT":
          throw unknownSupplierCompetitionProduct(outcome.error.productCode);
      }
      throw new TypeError(
        `Unsupported Supplier Competition input error: ${String(outcome.error)}`,
      );
    case "retired":
      throw retiredSupplierCompetitionAnalysisBuild(
        outcome.error.analysisBuildId,
      );
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Supplier Competition",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Supplier Competition",
      );
    case "budget":
      throw new AnalysisBudgetExceededError(
        outcome.error.budget,
        "Supplier Competition",
      );
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableSupplierCompetitionAnalysisBuild(
        request.analysisBuildId,
      );
    default:
      throw new TypeError(
        `Unsupported Supplier Competition outcome: ${String(outcome)}`,
      );
  }
}
