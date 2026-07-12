import { compareCodeUnits } from "./deterministic-order";

const conversionIndexCache = new WeakMap<
  object,
  ReadonlyMap<string, readonly (readonly [string, string])[]>
>();

export function convertTraditionalToSimplified(
  value: string,
  mappings: Readonly<Record<string, string>>,
): string {
  const conversionIndex = traditionalConversionIndex(mappings);
  let simplified = "";
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    const mapping = conversionIndex
      .get(character)
      ?.find(([traditional]) => value.startsWith(traditional, index));
    if (mapping === undefined) {
      simplified += character;
      index += character.length;
    } else {
      simplified += mapping[1];
      index += mapping[0].length;
    }
  }
  return simplified;
}

function traditionalConversionIndex(
  mappings: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly (readonly [string, string])[]> {
  const cached = conversionIndexCache.get(mappings);
  if (cached !== undefined) {
    return cached;
  }
  const mutable = new Map<string, [string, string][]>();
  for (const [traditional, simplified] of Object.entries(mappings)) {
    const first = [...traditional][0];
    if (first === undefined) {
      continue;
    }
    const entries = mutable.get(first) ?? [];
    entries.push([traditional, simplified]);
    mutable.set(first, entries);
  }
  for (const entries of mutable.values()) {
    entries.sort(
      ([left], [right]) =>
        right.length - left.length || compareCodeUnits(left, right),
    );
  }
  conversionIndexCache.set(mappings, mutable);
  return mutable;
}
