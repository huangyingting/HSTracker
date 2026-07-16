import { invalidOpportunityQuery } from "../opportunity-discovery/errors";
import type { OpportunityDiscoveryV1RecipeInput } from "../opportunity-discovery/result";
import type { OpportunityDiscoveryV1AnalysisRequest } from "./trade-analytics-platform";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

export function validateOpportunityDiscoveryV1Request(
  request: OpportunityDiscoveryV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidOpportunityQuery("analysisBuildId is malformed.");
  }
  if (!/^[0-9]{1,3}$/.test(request.exportEconomyCode)) {
    throw invalidOpportunityQuery(
      "exportEconomyCode must be a BACI economy code.",
    );
  }
  const limit = request.page?.limit;
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw invalidOpportunityQuery(
        `page.limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
      );
    }
  }
  if (request.page?.cursor !== undefined && request.page.cursor !== null) {
    if (typeof request.page.cursor !== "string" || request.page.cursor.length === 0) {
      throw invalidOpportunityQuery("page.cursor must be a non-empty string.");
    }
  }
  if (request.productFilter !== undefined) {
    if (request.productFilter.hsRevision !== "HS12") {
      throw invalidOpportunityQuery("productFilter.hsRevision must be HS12.");
    }
    if (
      !Array.isArray(request.productFilter.codes) ||
      request.productFilter.codes.length === 0
    ) {
      throw invalidOpportunityQuery(
        "productFilter.codes must be a non-empty array.",
      );
    }
    for (const code of request.productFilter.codes) {
      if (!/^[0-9]{6}$/.test(code)) {
        throw invalidOpportunityQuery(
          "productFilter.codes must contain six-digit HS12 codes.",
        );
      }
    }
  }
}

// Normalizes representation inputs (paging, product projection) into the
// recipe input. The product projection is sorted and de-duplicated so a
// caller cannot change the projected feed by reordering or repeating codes;
// paging and projection never participate in Analysis Identity.
export function normalizeOpportunityDiscoveryV1Request(
  request: OpportunityDiscoveryV1AnalysisRequest,
): OpportunityDiscoveryV1RecipeInput {
  const productCodes =
    request.productFilter === undefined
      ? null
      : [...new Set(request.productFilter.codes)].sort((left, right) =>
          left.localeCompare(right),
        );
  return {
    analysisBuildId: request.analysisBuildId,
    exportEconomyCode: request.exportEconomyCode,
    limit: request.page?.limit ?? DEFAULT_PAGE_LIMIT,
    cursor: request.page?.cursor ?? null,
    productCodes,
  };
}
