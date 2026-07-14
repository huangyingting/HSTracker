import type { MarketYearEvidence } from "../../../../src/evidence/trade-evidence-source";

export function alternativeSuppliersFromShares(
  rawShares: readonly string[],
): MarketYearEvidence["alternativeSuppliers"] {
  const shares = rawShares.map(parseFixed);
  const scale = Math.max(0, ...shares.map((share) => share.scale));
  const values = shares.map(
    (share) => share.units * 10n ** BigInt(scale - share.scale),
  );
  return {
    count: values.length,
    valueKusd: formatFixed(
      values.reduce((sum, value) => sum + value, 0n),
      scale,
    ),
    valueSquareSumKusdSquared: formatFixed(
      values.reduce((sum, value) => sum + value * value, 0n),
      scale * 2,
    ),
  };
}

function parseFixed(value: string): { units: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (match === null) {
    throw new Error(`Fixture supplier share ${value} is not a decimal.`);
  }
  const fraction = match[2] ?? "";
  return {
    units: BigInt(`${match[1]}${fraction}`),
    scale: fraction.length,
  };
}

function formatFixed(units: bigint, scale: number): string {
  if (scale === 0) {
    return units.toString();
  }
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
