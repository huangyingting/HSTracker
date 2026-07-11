import type {
  EconomyMatchClass,
  EconomyMatchedField,
  EconomyRecord,
  EconomySearchResult,
} from "./economy-directory";

const MATCH_CLASS_ORDER: Record<EconomyMatchClass, number> = {
  EXACT_CODE: 0,
  EXACT_CROSSWALK: 1,
  EXACT_NAME: 2,
  CODE_PREFIX: 3,
  CROSSWALK_PREFIX: 4,
  NAME_PREFIX: 5,
  NAME_TOKENS: 6,
};

type RankedEconomyMatch = EconomySearchResult["matches"][number] & {
  classOrder: number;
};

export function searchEconomies(
  economies: readonly EconomyRecord[],
  normalizedQuery: string,
): EconomySearchResult["matches"] {
  if (normalizedQuery === "") {
    return [...economies]
      .sort(compareEconomyCodes)
      .map((economy) => ({ economy, match: null }));
  }

  return economies
    .flatMap((economy) => {
      const match = matchEconomy(economy, normalizedQuery);
      return match === null ? [] : [match];
    })
    .sort(
      (left, right) =>
        left.classOrder - right.classOrder ||
        compareEconomyCodes(left.economy, right.economy),
    )
    .map(({ economy, match }) => ({ economy, match }));
}

export function normalizeEconomyQuery(query: string): string {
  return query
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .trim()
    .replace(/\s+/gu, " ");
}

function matchEconomy(
  economy: EconomyRecord,
  query: string,
): RankedEconomyMatch | null {
  if (economy.code === query) {
    return rankedMatch(economy, "EXACT_CODE", "CODE", economy.code);
  }

  const crosswalks = [
    ["ISO2", economy.iso2],
    ["ISO3", economy.iso3],
  ] as const;
  const exactCrosswalk = crosswalks.find(
    ([, value]) => value?.toLocaleLowerCase("und") === query,
  );
  if (exactCrosswalk !== undefined && exactCrosswalk[1] !== null) {
    return rankedMatch(
      economy,
      "EXACT_CROSSWALK",
      exactCrosswalk[0],
      exactCrosswalk[1],
    );
  }

  const normalizedName = normalizeEconomyQuery(economy.name);
  if (normalizedName === query) {
    return rankedMatch(economy, "EXACT_NAME", "NAME", economy.name);
  }
  if (economy.code.startsWith(query)) {
    return rankedMatch(economy, "CODE_PREFIX", "CODE", economy.code);
  }

  const crosswalkPrefix = crosswalks.find(([, value]) =>
    value?.toLocaleLowerCase("und").startsWith(query),
  );
  if (crosswalkPrefix !== undefined && crosswalkPrefix[1] !== null) {
    return rankedMatch(
      economy,
      "CROSSWALK_PREFIX",
      crosswalkPrefix[0],
      crosswalkPrefix[1],
    );
  }
  if (normalizedName.startsWith(query)) {
    return rankedMatch(economy, "NAME_PREFIX", "NAME", economy.name);
  }
  if (containsEveryNameToken(normalizedName, query)) {
    return rankedMatch(economy, "NAME_TOKENS", "NAME", economy.name);
  }
  return null;
}

function rankedMatch(
  economy: EconomyRecord,
  matchClass: EconomyMatchClass,
  field: EconomyMatchedField,
  matchedText: string,
): RankedEconomyMatch {
  return {
    economy,
    match: { class: matchClass, field, matchedText },
    classOrder: MATCH_CLASS_ORDER[matchClass],
  };
}

function containsEveryNameToken(name: string, query: string): boolean {
  const nameTokens = new Set(
    name.replace(/\p{P}+/gu, " ").split(/\s+/gu),
  );
  return query
    .replace(/\p{P}+/gu, " ")
    .split(/\s+/gu)
    .every((token) => nameTokens.has(token));
}

function compareEconomyCodes(
  left: EconomyRecord,
  right: EconomyRecord,
): number {
  return Number(left.code) - Number(right.code);
}
