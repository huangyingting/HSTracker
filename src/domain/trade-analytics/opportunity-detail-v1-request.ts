import { invalidOpportunityQuery } from "../opportunity-discovery/errors";
import type { OpportunityDetailV1AnalysisRequest } from "./trade-analytics-platform";

// Enforces the closed Opportunity Detail request format before the platform
// binds a build: a well-formed analysisBuildId, BACI export/market economy
// codes, and a six-digit HS12 product code. Anything malformed collapses onto
// the public INVALID_ANALYSIS_QUERY, so callers cannot probe internal shape.
export function validateOpportunityDetailV1Request(
  request: OpportunityDetailV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidOpportunityQuery("analysisBuildId is malformed.");
  }
  if (!/^[0-9]{1,3}$/.test(request.exportEconomyCode)) {
    throw invalidOpportunityQuery(
      "exportEconomyCode must be a BACI economy code.",
    );
  }
  if (!/^[0-9]{6}$/.test(request.productCode)) {
    throw invalidOpportunityQuery("productCode must be a six-digit HS12 code.");
  }
  if (!/^[0-9]{1,3}$/.test(request.marketCode)) {
    throw invalidOpportunityQuery("marketCode must be a BACI economy code.");
  }
}
