import type { MarketYearEvidence } from "../../../../../src/evidence/trade-evidence-source";

export function alternativeSuppliersFromShares(
  rawShares: readonly string[],
): MarketYearEvidence["alternativeSuppliers"] {
  const shares = rawShares.map(Number);
  return {
    count: shares.length,
    valueKusd: String(shares.reduce((sum, share) => sum + share, 0)),
    valueSquareSumKusdSquared: String(
      shares.reduce((sum, share) => sum + share ** 2, 0),
    ),
  };
}
