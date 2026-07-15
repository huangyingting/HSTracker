export type FixedDecimal = Readonly<{
  units: bigint;
  scale: number;
}>;

export function parsePositiveFixedDecimal(
  value: string,
  field: string,
): FixedDecimal {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (match === null) {
    throw new TypeError(`${field} must be a positive decimal string.`);
  }
  const fraction = match[2] ?? "";
  const units = BigInt(`${match[1]}${fraction}`);
  if (units === 0n) {
    throw new TypeError(`${field} must be positive.`);
  }
  return normalizeFixedDecimal({ units, scale: fraction.length });
}

export function normalizeFixedDecimal(value: FixedDecimal): FixedDecimal {
  if (value.units === 0n) {
    return { units: 0n, scale: 0 };
  }
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}

export function divideHalfUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function formatFixedDecimal(value: FixedDecimal): string {
  const normalized = normalizeFixedDecimal(value);
  return formatFixedDecimalScale(normalized, normalized.scale);
}

export function formatFixedDecimalScale(
  value: FixedDecimal,
  scale: number,
): string {
  if (value.scale > scale) {
    throw new TypeError(
      "A fixed decimal cannot be formatted at lower precision.",
    );
  }
  const scaledUnits = value.units * tenTo(scale - value.scale);
  const sign = scaledUnits < 0n ? "-" : "";
  const absolute = scaledUnits < 0n ? -scaledUnits : scaledUnits;
  if (scale === 0) {
    return `${sign}${absolute}`;
  }
  const padded = absolute.toString().padStart(scale + 1, "0");
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

export function tenTo(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
