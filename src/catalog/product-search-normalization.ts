import { convertTraditionalToSimplified } from "./traditional-to-simplified";

export const PRODUCT_SEARCH_ALGORITHM_VERSION =
  "deterministic-lexical-product-search-v3";

export function normalizeProductSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeProductSearchQuery(
  value: string,
  traditionalToSimplified: Readonly<Record<string, string>>,
): string {
  return normalizeProductSearchText(
    convertTraditionalToSimplified(
      value.normalize("NFKC"),
      traditionalToSimplified,
    ),
  );
}
