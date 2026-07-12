export type EconomyRecord = {
  code: string;
  iso2: string | null;
  iso3: string | null;
  name: string;
  identityNote: string | null;
};

export type EconomyMatchClass =
  | "EXACT_CODE"
  | "EXACT_CROSSWALK"
  | "EXACT_NAME"
  | "CODE_PREFIX"
  | "CROSSWALK_PREFIX"
  | "NAME_PREFIX"
  | "NAME_TOKENS";

export type EconomyMatchedField = "CODE" | "ISO2" | "ISO3" | "NAME";

export type EconomySearchResult = {
  schemaVersion: "economy-search-result-v1";
  analysisBuildId: string;
  query: {
    normalized: string;
    limit: number;
  };
  totalMatches: number;
  truncated: boolean;
  matches: readonly {
    economy: EconomyRecord;
    match: {
      class: EconomyMatchClass;
      field: EconomyMatchedField;
      matchedText: string;
    } | null;
  }[];
};

export type EconomySearchQuery = {
  analysisBuildId: string;
  query: string;
  limit: number;
};

export interface EconomyDirectory {
  search(query: EconomySearchQuery): Promise<EconomySearchResult>;
}
