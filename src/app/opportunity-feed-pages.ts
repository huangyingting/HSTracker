import type {
  MarketInvestigationCandidate,
} from "../domain/opportunity-discovery/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { OpportunityDiscoveryV1Payload } from "../domain/trade-analytics/opportunity-discovery-v1-adapter";
import { loadMarketInvestigationPage } from "./opportunity-discovery-client";
import { resolvePinnedContext } from "./trade-analysis-context";

type ResolvedOpportunityPin = ReturnType<typeof resolvePinnedContext>;

export function opportunityCandidateKey(
  candidate: MarketInvestigationCandidate,
): string {
  return `${candidate.product.code}:${candidate.market.code}`;
}

export function appendOpportunityPage(
  current: OpportunityDiscoveryV1Payload,
  next: OpportunityDiscoveryV1Payload,
  requestedCursor: string,
): OpportunityDiscoveryV1Payload {
  const currentProducts = current.projection.productCodes ?? [];
  const nextProducts = next.projection.productCodes ?? [];
  if (
    next.page.requestedCursor !== requestedCursor ||
    next.analysisBuildId !== current.analysisBuildId ||
    next.analysisIdentity !== current.analysisIdentity ||
    next.datasetPackageIdentity !== current.datasetPackageIdentity ||
    next.exporter.code !== current.exporter.code ||
    next.cohortSize !== current.cohortSize ||
    next.provenance.artifactSha256 !== current.provenance.artifactSha256 ||
    currentProducts.length !== nextProducts.length ||
    currentProducts.some((code, index) => code !== nextProducts[index])
  ) {
    throw new TypeError(
      "Opportunity continuation does not match the loaded candidate feed.",
    );
  }
  const existingKeys = new Set(
    current.candidates.map(opportunityCandidateKey),
  );
  if (
    next.candidates.some((candidate) =>
      existingKeys.has(opportunityCandidateKey(candidate)),
    )
  ) {
    throw new TypeError("Opportunity continuation repeats a loaded candidate.");
  }
  const candidates = [...current.candidates, ...next.candidates];
  return {
    ...current,
    page: {
      ...next.page,
      returnedCount: candidates.length,
    },
    candidates,
  };
}

export function validateOpportunityPageIdentity(
  page: OpportunityDiscoveryV1Payload,
  analysisBuildId: string,
  manifest: CurrentAnalysisManifest,
  pinResolution: ResolvedOpportunityPin,
): void {
  if (page.analysisBuildId !== analysisBuildId) {
    throw new TypeError("Opportunity feed does not match the requested build.");
  }
  const deployment =
    pinResolution.state === "retained" ? pinResolution.deployment : manifest;
  const opportunityMapping =
    deployment.recommendation.opportunityDiscovery;
  if (
    opportunityMapping === null ||
    page.datasetPackageIdentity !==
      opportunityMapping.datasetPackageIdentity
  ) {
    throw new TypeError(
      "Opportunity feed does not match the declared Dataset Package.",
    );
  }
  if (pinResolution.state === "retained") {
    if (page.provenance.baciRelease !== pinResolution.deployment.baciRelease) {
      throw new TypeError(
        "Opportunity feed does not match the retained manifest.",
      );
    }
    return;
  }
  if (
    page.provenance.recipeVersion !== "opportunity-discovery-v1" ||
    page.provenance.baciRelease !== manifest.source.baciRelease
  ) {
    throw new TypeError(
      "Opportunity feed does not match the current manifest.",
    );
  }
}

export async function loadCompleteOpportunityFeed({
  page,
  fetcher,
  signal,
}: {
  page: OpportunityDiscoveryV1Payload;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<OpportunityDiscoveryV1Payload> {
  let completePage = page;
  const requestedCursors = new Set<string>();
  while (completePage.page.nextCursor !== null) {
    const cursor = completePage.page.nextCursor;
    if (requestedCursors.has(cursor)) {
      throw new TypeError(
        "Opportunity export pagination repeated a cursor.",
      );
    }
    requestedCursors.add(cursor);
    const nextPage = await loadMarketInvestigationPage({
      analysisBuildId: completePage.analysisBuildId,
      exporterCode: completePage.exporter.code,
      productCodes: completePage.projection.productCodes,
      limit: completePage.page.limit,
      cursor,
      fetcher,
      signal,
    });
    completePage = appendOpportunityPage(completePage, nextPage, cursor);
  }
  return completePage;
}
