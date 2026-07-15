import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "SupplierCompetitionAnalysisError";

export type SupplierCompetitionAnalysisErrorCode =
  | "INVALID_ANALYSIS_QUERY"
  | "UNKNOWN_IMPORTER"
  | "UNKNOWN_PRODUCT"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE"
  | "SUPPLIER_COHORT_BUDGET_EXCEEDED";

export class SupplierCompetitionAnalysisError extends Error {
  constructor(
    readonly code: SupplierCompetitionAnalysisErrorCode,
    readonly status: 400 | 404 | 410 | 413 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "SupplierCompetitionAnalysisError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isSupplierCompetitionAnalysisError(
  value: unknown,
): value is SupplierCompetitionAnalysisError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidSupplierCompetitionQuery(
  message: string,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "INVALID_ANALYSIS_QUERY",
    400,
    message,
    "The analysis query is invalid.",
  );
}

export function unknownSupplierCompetitionImporter(
  code: string,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "UNKNOWN_IMPORTER",
    404,
    `Importer ${code} is not available in this analysis build.`,
    "The requested importing economy is not available.",
  );
}

export function unknownSupplierCompetitionProduct(
  code: string,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "UNKNOWN_PRODUCT",
    404,
    `HS12 product ${code} is not available in this analysis build.`,
    "The requested HS12 product is not available.",
  );
}

export function retiredSupplierCompetitionAnalysisBuild(
  id: string,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableSupplierCompetitionAnalysisBuild(
  id: string,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Analysis build ${id} is temporarily unavailable.`,
    "Supplier Competition analysis is temporarily unavailable.",
  );
}

export function supplierCohortBudgetExceeded(
  cohortSize: number,
): SupplierCompetitionAnalysisError {
  return new SupplierCompetitionAnalysisError(
    "SUPPLIER_COHORT_BUDGET_EXCEEDED",
    413,
    `Supplier Competition evidence declared ${cohortSize} supplier economies, exceeding its complete-cohort budget.`,
    "The complete Supplier Competition result exceeds its serving budget.",
  );
}
