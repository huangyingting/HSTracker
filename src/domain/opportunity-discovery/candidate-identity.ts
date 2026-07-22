import type { MarketInvestigationCandidate } from "./result";

export function marketInvestigationCandidateKey(
  candidate: MarketInvestigationCandidate,
): string {
  return `${candidate.product.code}:${candidate.market.code}`;
}
