import type {
  MarketInvestigationCandidate,
  MarketInvestigationPage,
} from "../domain/opportunity-discovery/result";
import type { ConfirmedProduct } from "../operations/store/model";

export type PortfolioProjectionMode = "complete" | "portfolio";

export type PortfolioProjectionRow = Readonly<{
  canonicalRank: number;
  candidate: MarketInvestigationCandidate;
}>;

export type PortfolioProjection = Readonly<{
  completeCandidates: MarketInvestigationPage["candidates"];
  completeRows: readonly PortfolioProjectionRow[];
  scopeRows: readonly PortfolioProjectionRow[];
  portfolioProductCodes: readonly string[];
  mode: PortfolioProjectionMode;
}>;

export function buildPortfolioProjection(
  page: MarketInvestigationPage,
  portfolio: readonly ConfirmedProduct[],
  mode: PortfolioProjectionMode,
): PortfolioProjection {
  const portfolioProductCodes = canonicalPortfolioProductCodes(portfolio);
  const rows = page.candidates.map((candidate, index) => ({
    canonicalRank: index + 1,
    candidate,
  }));
  const portfolioProducts = new Set(portfolioProductCodes);
  return {
    completeCandidates: page.candidates,
    completeRows: rows,
    scopeRows:
      mode === "portfolio"
        ? rows.filter((row) => portfolioProducts.has(row.candidate.product.code))
        : rows,
    portfolioProductCodes,
    mode,
  };
}

export function candidateProjectionKey(
  candidate: MarketInvestigationCandidate,
): string {
  return `${candidate.product.code}:${candidate.market.code}`;
}

function canonicalPortfolioProductCodes(
  portfolio: readonly ConfirmedProduct[],
): readonly string[] {
  return [
    ...new Set(
      portfolio
        .filter(({ product }) => product.hsRevision === "HS12")
        .map(({ product }) => product.code),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
