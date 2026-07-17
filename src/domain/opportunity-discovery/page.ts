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
  type EconomyIdentity,
  type MarketInvestigationCandidate,
  type MarketInvestigationPage,
  type OpportunityProvenance,
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

  const lastKey = decodeAndValidateCursor(
    request.cursor,
    analysisIdentity,
    digest,
  );
  const startIndex =
    lastKey === null ? 0 : resolveStartIndexFromKey(projected, lastKey);
  const window = projected.slice(startIndex, startIndex + request.limit);
  const hasMore = startIndex + request.limit < projected.length;

  return buildMarketInvestigationPage({
    analysisBuildId: cohort.analysisBuildId,
    exporter: cohort.exporter,
    provenance: cohort.provenance,
    cohortSize: cohort.candidates.length,
    productCodes: request.productCodes,
    limit: request.limit,
    requestedCursor: request.cursor,
    analysisIdentity,
    window,
    hasMore,
  });
}

// Assemble the public page envelope from a pre-fetched candidate window. Both
// the in-memory fixture path (pageOpportunityCohort) and the production DuckDB
// adapter call this so the two feeds are byte-identical; the adapter supplies a
// SQL-fetched, reconstructed window plus a SQL COUNT cohort size and hasMore
// flag, and this function derives the nextCursor from the window's last row.
export function buildMarketInvestigationPage(input: {
  analysisBuildId: string;
  exporter: EconomyIdentity;
  provenance: OpportunityProvenance;
  cohortSize: number;
  productCodes: readonly string[] | null;
  limit: number;
  requestedCursor: string | null;
  analysisIdentity: string;
  window: readonly MarketInvestigationCandidate[];
  hasMore: boolean;
}): MarketInvestigationPage {
  const digest = productFilterDigest(input.productCodes);
  const lastRow = input.window[input.window.length - 1];
  const nextCursor =
    input.hasMore && lastRow !== undefined
      ? encodeOpportunityCursor({
          analysisIdentity: input.analysisIdentity,
          productFilterDigest: digest,
          lastKey: orderKeyOf(lastRow),
        })
      : null;

  return {
    schemaVersion: "market-investigation-result-v1",
    analysisBuildId: input.analysisBuildId,
    exporter: input.exporter,
    provenance: input.provenance,
    cohortSize: input.cohortSize,
    projection: {
      productCodes: input.productCodes,
    },
    page: {
      limit: input.limit,
      requestedCursor: input.requestedCursor,
      nextCursor,
      returnedCount: input.window.length,
    },
    candidates: input.window,
    nonClaims: OPPORTUNITY_NON_CLAIMS,
    discoveryDisclaimer: OPPORTUNITY_DISCOVERY_DISCLAIMER,
  };
}

// Decode an incoming cursor, failing closed if it was minted for a different
// analytical feed (different analysis identity or product filter). Returns the
// keyset lower bound, or `null` for a first page. The production adapter reuses
// this to translate the cursor into a SQL keyset predicate.
export function decodeAndValidateCursor(
  cursor: string | null,
  analysisIdentity: string,
  digest: string,
): OpportunityOrderKey | null {
  if (cursor === null) {
    return null;
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
  return payload.lastKey;
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

function resolveStartIndexFromKey(
  candidates: readonly MarketInvestigationCandidate[],
  lastKey: OpportunityOrderKey,
): number {
  const index = candidates.findIndex(
    (candidate) => compareToKey(candidate, lastKey) > 0,
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
