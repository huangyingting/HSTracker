import type {
  MarketInvestigationCandidate,
  MarketInvestigationPage,
} from "../domain/opportunity-discovery/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  resolvePinnedContext,
  type TradeAnalysisRecipeIdentity,
} from "./trade-analysis-context";

type ResolvedOpportunityPin = ReturnType<typeof resolvePinnedContext>;

export function opportunityCandidateKey(
  candidate: MarketInvestigationCandidate,
): string {
  return `${candidate.product.code}:${candidate.market.code}`;
}

export function appendOpportunityPage(
  current: MarketInvestigationPage,
  next: MarketInvestigationPage,
  requestedCursor: string,
): MarketInvestigationPage {
  const currentProducts = current.projection.productCodes ?? [];
  const nextProducts = next.projection.productCodes ?? [];
  if (
    next.page.requestedCursor !== requestedCursor ||
    next.analysisBuildId !== current.analysisBuildId ||
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
  page: MarketInvestigationPage,
  analysisBuildId: string,
  manifest: CurrentAnalysisManifest,
  pinResolution: ResolvedOpportunityPin,
  recipe: TradeAnalysisRecipeIdentity = "opportunity-discovery-v1",
): void {
  if (page.analysisBuildId !== analysisBuildId) {
    throw new TypeError("Opportunity feed does not match the requested build.");
  }
  if (pinResolution.state === "retained") {
    if (
      page.provenance.baciRelease !== pinResolution.deployment.baciRelease ||
      page.provenance.artifactSha256 !== pinResolution.deployment.artifactSha256
    ) {
      throw new TypeError(
        "Opportunity feed does not match the retained manifest.",
      );
    }
    return;
  }
  if (
    page.provenance.recipeVersion !== recipe ||
    page.provenance.baciRelease !== manifest.source.baciRelease
  ) {
    throw new TypeError(
      "Opportunity feed does not match the current manifest.",
    );
  }
}
