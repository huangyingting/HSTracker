// The five stable Validation Plan work categories in the fixed order
// docs/spec/export-market-analysis-workspace-ui-design.md §10.8 requires,
// and the candidate-extension/intentional-exclusion disposition each one
// carries (spec: docs/spec/export-market-analysis-workspace.md §2.5 and
// §10.2–§10.7). This is closed structural data only: category identity and
// disposition, nothing else. There is deliberately no source seam, Module,
// route, Adapter, credential field, or placeholder request here -- bilingual
// display copy, required-evidence text, and the non-automated next step
// live in ./copy so this module never grows an executable evidence handler.
export type ValidationPlanDisposition =
  | "CANDIDATE_EXTENSION"
  | "INTENTIONAL_EXCLUSION";

export type ValidationPlanCategoryId =
  | "QUANTITY_AND_CUSTOMS_UNIT_VALUE"
  | "MARKET_ACCESS_AND_REGULATION"
  | "LOGISTICS_AND_LANDED_COST"
  | "COMPANIES_AND_COMMERCIAL_RELATIONSHIPS"
  | "COMPANY_ECONOMICS_RISK_AND_FORECASTING";

export type ValidationPlanCategory = Readonly<{
  id: ValidationPlanCategoryId;
  disposition: ValidationPlanDisposition;
}>;

export const MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES: readonly ValidationPlanCategory[] =
  Object.freeze([
    Object.freeze({
      id: "QUANTITY_AND_CUSTOMS_UNIT_VALUE",
      disposition: "CANDIDATE_EXTENSION",
    }),
    Object.freeze({
      id: "MARKET_ACCESS_AND_REGULATION",
      disposition: "CANDIDATE_EXTENSION",
    }),
    Object.freeze({
      id: "LOGISTICS_AND_LANDED_COST",
      disposition: "CANDIDATE_EXTENSION",
    }),
    Object.freeze({
      id: "COMPANIES_AND_COMMERCIAL_RELATIONSHIPS",
      disposition: "CANDIDATE_EXTENSION",
    }),
    Object.freeze({
      id: "COMPANY_ECONOMICS_RISK_AND_FORECASTING",
      disposition: "INTENTIONAL_EXCLUSION",
    }),
  ]);
