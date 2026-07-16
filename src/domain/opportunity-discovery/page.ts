import {
  encodeOpportunityCursor,
  decodeOpportunityCursor,
  productFilterDigest,
  type OpportunityOrderKey,
} from "./cursor";
import { invalidOpportunityCursor } from "./errors";
import type { OpportunityCohort } from "./opportunity-discovery-v1";
import {
  OPPORTUNITY_DISCOVERY_DISCLAIMER,
  type MarketInvestigationCandidate,
  type MarketInvestigationPage,
} from "./result";

export const OPPORTUNITY_NON_CLAIMS: readonly string[] = [
  "Candidates are ranked from public BACI trade evidence, not forecasts or success probabilities.",
  "A high Investigation Priority is a starting point for research, not a recommendation to enter a market.",
  "Market Attractiveness reflects recorded world imports; it says nothing about tariffs, non-tariff barriers, logistics, or buyers.",
  "Exporter Fit reflects this exporter's recorded world export share and recorded bilateral flow; it is not a measure of company capability or product-market fit.",
  "Percentiles are relative to this exporter's fixed cross-product cohort only and are not comparable across exporters.",
];

type PageRequest = {
  limit: number;
  cursor: string | null;
  productCodes: readonly string[] | null;
};

export function pageOpportunityCohort(
  cohort: OpportunityCohort,
  request: PageRequest,
  analysisIdentity: string,
): MarketInvestigationPage {
  const digest = productFilterDigest(request.productCodes);
  const projected = projectCandidates(cohort.candidates, request.productCodes);

  const startIndex = resolveStartIndex(
    projected,
    request.cursor,
    analysisIdentity,
    digest,
  );
  const window = projected.slice(startIndex, startIndex + request.limit);
  const hasMore = startIndex + request.limit < projected.length;
  const lastRow = window[window.length - 1];
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeOpportunityCursor({
          analysisIdentity,
          productFilterDigest: digest,
          lastKey: orderKeyOf(lastRow),
        })
      : null;

  return {
    schemaVersion: "market-investigation-result-v1",
    analysisBuildId: cohort.analysisBuildId,
    exporter: cohort.exporter,
    provenance: cohort.provenance,
    cohortSize: cohort.candidates.length,
    projection: {
      productCodes: request.productCodes,
    },
    page: {
      limit: request.limit,
      requestedCursor: request.cursor,
      nextCursor,
      returnedCount: window.length,
    },
    candidates: window,
    nonClaims: OPPORTUNITY_NON_CLAIMS,
    discoveryDisclaimer: OPPORTUNITY_DISCOVERY_DISCLAIMER,
  };
}

function projectCandidates(
  candidates: readonly MarketInvestigationCandidate[],
  productCodes: readonly string[] | null,
): readonly MarketInvestigationCandidate[] {
  if (productCodes === null) {
    return candidates;
  }
  const allowed = new Set(productCodes);
  return candidates.filter((candidate) => allowed.has(candidate.product.code));
}

function resolveStartIndex(
  candidates: readonly MarketInvestigationCandidate[],
  cursor: string | null,
  analysisIdentity: string,
  digest: string,
): number {
  if (cursor === null) {
    return 0;
  }
  const payload = decodeOpportunityCursor(cursor);
  if (
    payload.analysisIdentity !== analysisIdentity ||
    payload.productFilterDigest !== digest
  ) {
    throw invalidOpportunityCursor(
      "Cursor was minted for a different analytical feed.",
    );
  }
  const index = candidates.findIndex(
    (candidate) => compareToKey(candidate, payload.lastKey) > 0,
  );
  return index === -1 ? candidates.length : index;
}

function orderKeyOf(
  candidate: MarketInvestigationCandidate,
): OpportunityOrderKey {
  return {
    priorityDisplay: candidate.investigationPriority.display,
    attractivenessDisplay: candidate.marketAttractiveness.display,
    exporterFitDisplay: candidate.exporterFit.display,
    productCode: candidate.product.code,
    importerCode: candidate.market.code,
  };
}

// Positive when `candidate` sorts strictly after `key` under the canonical
// order (priority display DESC, attractiveness display DESC, exporter fit
// display DESC, HS12 code ASC, importer numeric code ASC).
function compareToKey(
  candidate: MarketInvestigationCandidate,
  key: OpportunityOrderKey,
): number {
  return (
    key.priorityDisplay - candidate.investigationPriority.display ||
    key.attractivenessDisplay - candidate.marketAttractiveness.display ||
    key.exporterFitDisplay - candidate.exporterFit.display ||
    candidate.product.code.localeCompare(key.productCode) ||
    Number(candidate.market.code) - Number(key.importerCode)
  );
}
