import type {
  ProductAliasRecord,
  ProductCatalog,
  ProductSearchLocale,
  ProductSearchMatchClass,
  ProductSearchMatchedField,
  ProductSearchProduct,
  ProductSearchResult,
} from "./product-catalog";
import { isSuppressedProductQuery } from "./product-query";

const MATCH_CLASS_ORDER: Record<ProductSearchMatchClass, number> = {
  EXACT_CODE: 0,
  CODE_PREFIX: 1,
  EXACT_DESCRIPTION: 2,
  EXACT_ALIAS: 3,
  DESCRIPTION_PREFIX: 4,
  ALIAS_PREFIX: 5,
  DESCRIPTION_TOKENS: 6,
  ALIAS_TOKENS: 7,
  LATIN_TYPO: 8,
};

type RankedMatch = ProductSearchResult["matches"][number] & {
  classOrder: number;
  unmatchedCharacters: number;
  editedCharacters: number;
  localePenalty: number;
  fieldKindPenalty: number;
};

type IndexedField = {
  text: string;
  field: ProductSearchMatchedField;
  kind: "code" | "description" | "alias";
  locale: ProductSearchLocale;
};

export function searchProductIndex(
  query: Parameters<ProductCatalog["search"]>[0],
  products: readonly ProductSearchProduct[],
  aliases: readonly ProductAliasRecord[],
  traditionalToSimplified: Readonly<Record<string, string>>,
): ProductSearchResult {
  const normalizedInput = normalizeQuery(
    query.query,
    traditionalToSimplified,
  );
  const unsupportedRevision = hasUnsupportedHsRevision(normalizedInput);
  const normalizedQuery = unsupportedRevision
    ? normalizedInput
    : removeAcceptedHs12Scope(normalizedInput);
  const querySuppressed = isSuppressedProductQuery(normalizedQuery);
  const allMatches =
    querySuppressed || unsupportedRevision
      ? []
      : products
          .flatMap((product) => {
            const match = matchProduct(
              product,
              aliases.filter(
                (alias) =>
                  alias.hsRevision === product.hsRevision &&
                  alias.code === product.code,
              ),
              normalizedQuery,
              query.locale,
            );
            return match === null ? [] : [match];
          })
          .sort(compareRankedMatches)
          .map(({ product, match }) => ({ product, match }));
  const matches = allMatches.slice(0, query.limit);

  return {
    schemaVersion: "product-search-result-v1",
    productSearchBuildId: query.productSearchBuildId,
    query: {
      normalized: normalizedQuery,
      locale: query.locale,
      limit: query.limit,
    },
    state: unsupportedRevision
      ? "UNSUPPORTED_HS_REVISION"
      : querySuppressed
        ? "SUPPRESSED_SHORT_QUERY"
        : allMatches.length === 0
          ? "NO_MATCH"
          : "RESULTS",
    messageCode: unsupportedRevision
      ? "UNSUPPORTED_HS_REVISION"
      : querySuppressed
        ? "QUERY_TOO_SHORT"
        : allMatches.length === 0
          ? "NO_HS12_PRODUCT_MATCH"
          : null,
    totalMatches: allMatches.length,
    truncated: matches.length < allMatches.length,
    matches,
  };
}

function matchProduct(
  product: ProductSearchProduct,
  aliases: readonly ProductAliasRecord[],
  normalizedQuery: string,
  locale: ProductSearchLocale,
): RankedMatch | null {
  const codeCandidate = matchCode(product, normalizedQuery);
  if (codeCandidate !== null || /^\d+$/u.test(normalizedQuery)) {
    return codeCandidate;
  }

  const fields: IndexedField[] = [
    {
      text: product.sourceDescriptionEn,
      field: "SOURCE_DESCRIPTION_EN",
      kind: "description",
      locale: "en",
    },
    {
      text: product.auxiliaryDescriptionZhHans,
      field: "AUXILIARY_DESCRIPTION_ZH_HANS",
      kind: "description",
      locale: "zh-Hans",
    },
    ...aliases.map(
      (alias): IndexedField => ({
        text: alias.alias,
        field: alias.locale === "en" ? "ALIAS_EN" : "ALIAS_ZH_HANS",
        kind: "alias",
        locale: alias.locale,
      }),
    ),
  ];

  return (
    fields
      .flatMap((field) => {
        const candidate = matchField(
          product,
          field,
          normalizedQuery,
          locale,
        );
        return candidate === null ? [] : [candidate];
      })
      .sort(compareRankedMatches)[0] ?? null
  );
}

function matchCode(
  product: ProductSearchProduct,
  normalizedQuery: string,
): RankedMatch | null {
  if (product.code === normalizedQuery) {
    return rankedMatch(
      product,
      "EXACT_CODE",
      {
        text: product.code,
        field: "CODE",
        kind: "code",
        locale: "en",
      },
      normalizedQuery,
      "en",
      0,
    );
  }
  if (/^\d+$/u.test(normalizedQuery) && product.code.startsWith(normalizedQuery)) {
    return rankedMatch(
      product,
      "CODE_PREFIX",
      {
        text: product.code,
        field: "CODE",
        kind: "code",
        locale: "en",
      },
      normalizedQuery,
      "en",
      0,
    );
  }
  return null;
}

function matchField(
  product: ProductSearchProduct,
  field: IndexedField,
  normalizedQuery: string,
  locale: ProductSearchLocale,
): RankedMatch | null {
  const normalizedField = normalizeSearchText(field.text);
  let matchClass: ProductSearchMatchClass | null = null;
  let editedCharacters = 0;

  if (normalizedField === normalizedQuery) {
    matchClass =
      field.kind === "description" ? "EXACT_DESCRIPTION" : "EXACT_ALIAS";
  } else if (normalizedField.startsWith(normalizedQuery)) {
    matchClass =
      field.kind === "description" ? "DESCRIPTION_PREFIX" : "ALIAS_PREFIX";
  } else if (containsEveryToken(normalizedField, normalizedQuery)) {
    matchClass =
      field.kind === "description" ? "DESCRIPTION_TOKENS" : "ALIAS_TOKENS";
  } else {
    const edits = boundedLatinTypoEdits(normalizedField, normalizedQuery);
    if (edits !== null) {
      matchClass = "LATIN_TYPO";
      editedCharacters = edits;
    }
  }

  return matchClass === null
    ? null
    : rankedMatch(
        product,
        matchClass,
        field,
        normalizedQuery,
        locale,
        editedCharacters,
      );
}

function rankedMatch(
  product: ProductSearchProduct,
  matchClass: ProductSearchMatchClass,
  indexedField: IndexedField,
  normalizedQuery: string,
  locale: ProductSearchLocale,
  editedCharacters: number,
): RankedMatch {
  const normalizedText =
    indexedField.kind === "code"
      ? indexedField.text
      : normalizeSearchText(indexedField.text);
  return {
    product,
    match: {
      class: matchClass,
      field: indexedField.field,
      matchedText: indexedField.text,
    },
    classOrder: MATCH_CLASS_ORDER[matchClass],
    unmatchedCharacters: Math.max(
      0,
      [...normalizedText].length - [...normalizedQuery].length,
    ),
    editedCharacters,
    localePenalty:
      indexedField.kind === "code" || indexedField.locale === locale ? 0 : 1,
    fieldKindPenalty: indexedField.kind === "alias" ? 1 : 0,
  };
}

function compareRankedMatches(
  left: RankedMatch,
  right: RankedMatch,
): number {
  return (
    left.classOrder - right.classOrder ||
    left.unmatchedCharacters +
      left.editedCharacters -
      (right.unmatchedCharacters + right.editedCharacters) ||
    left.localePenalty - right.localePenalty ||
    left.fieldKindPenalty - right.fieldKindPenalty ||
    left.product.code.localeCompare(right.product.code) ||
    left.match.matchedText.localeCompare(right.match.matchedText)
  );
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeQuery(
  value: string,
  traditionalToSimplified: Readonly<Record<string, string>>,
): string {
  const simplified = [...value.normalize("NFKC")]
    .map((character) => traditionalToSimplified[character] ?? character)
    .join("");
  return normalizeSearchText(simplified);
}

function hasUnsupportedHsRevision(normalizedQuery: string): boolean {
  const match = /^hs\s*(\d{2}|\d{4})(?:\s|$)/u.exec(normalizedQuery);
  return (
    match !== null &&
    match[1] !== "12" &&
    match[1] !== "2012"
  );
}

function removeAcceptedHs12Scope(normalizedQuery: string): string {
  const revision = /^hs\s*(12|2012)(?:\s+|$)(.*)$/u.exec(normalizedQuery);
  return revision === null ? normalizedQuery : revision[2].trim();
}

function containsEveryToken(
  normalizedField: string,
  normalizedQuery: string,
): boolean {
  const fieldTokens = new Set(normalizedField.split(" "));
  return normalizedQuery
    .split(" ")
    .every((token) => fieldTokens.has(token));
}

function boundedLatinTypoEdits(
  normalizedField: string,
  normalizedQuery: string,
): number | null {
  const queryTokens = normalizedQuery.split(" ");
  if (
    queryTokens.some(
      (token) => token.length < 4 || !/^\p{Script=Latin}+$/u.test(token),
    )
  ) {
    return null;
  }

  const fieldTokens = normalizedField.split(" ");
  let edits = 0;
  for (const queryToken of queryTokens) {
    const tokenEdits = Math.min(
      ...fieldTokens.map((fieldToken) =>
        damerauLevenshteinWithinOne(queryToken, fieldToken),
      ),
    );
    if (tokenEdits > 1) {
      return null;
    }
    edits += tokenEdits;
  }
  return edits > 0 ? edits : null;
}

function damerauLevenshteinWithinOne(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (Math.abs(left.length - right.length) > 1) {
    return 2;
  }
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        differences.push(index);
      }
    }
    if (differences.length === 1) {
      return 1;
    }
    if (
      differences.length === 2 &&
      differences[1] === differences[0] + 1 &&
      left[differences[0]] === right[differences[1]] &&
      left[differences[1]] === right[differences[0]]
    ) {
      return 1;
    }
    return 2;
  }

  const [shorter, longer] =
    left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return 2;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return 1;
}
