export type ProductSearchLocale = "en" | "zh-Hans";

export type ProductCatalogRecord = {
  hsRevision: "HS12";
  code: string;
  sourceDescriptionEn: string;
};

export type ProductTranslationRecord = {
  hsRevision: "HS12";
  code: string;
  locale: "zh-Hans";
  description: string;
  translationStatus: "machine-assisted" | "reviewed";
  translationVersion: string;
};

export type ProductAliasRecord = {
  hsRevision: "HS12";
  code: string;
  locale: ProductSearchLocale;
  alias: string;
  reviewStatus: "reviewed";
};

export type ProductSearchMatchClass =
  | "EXACT_CODE"
  | "CODE_PREFIX"
  | "EXACT_DESCRIPTION"
  | "EXACT_ALIAS"
  | "DESCRIPTION_PREFIX"
  | "ALIAS_PREFIX"
  | "DESCRIPTION_TOKENS"
  | "ALIAS_TOKENS"
  | "LATIN_TYPO";

export type ProductSearchMatchedField =
  | "CODE"
  | "SOURCE_DESCRIPTION_EN"
  | "AUXILIARY_DESCRIPTION_ZH_HANS"
  | "ALIAS_EN"
  | "ALIAS_ZH_HANS";

export type ProductSearchProduct = ProductCatalogRecord & {
  auxiliaryDescriptionZhHans: string;
  translationStatus: ProductTranslationRecord["translationStatus"];
  translationVersion: string;
};

export type ProductSearchResult = {
  schemaVersion: "product-search-result-v1";
  productSearchBuildId: string;
  query: {
    normalized: string;
    locale: ProductSearchLocale;
    limit: number;
  };
  state:
    | "RESULTS"
    | "NO_MATCH"
    | "SUPPRESSED_SHORT_QUERY"
    | "UNSUPPORTED_HS_REVISION";
  messageCode:
    | "NO_HS12_PRODUCT_MATCH"
    | "QUERY_TOO_SHORT"
    | "UNSUPPORTED_HS_REVISION"
    | null;
  totalMatches: number;
  truncated: boolean;
  matches: readonly {
    product: ProductSearchProduct;
    match: {
      class: ProductSearchMatchClass;
      field: ProductSearchMatchedField;
      matchedText: string;
    };
  }[];
};

export interface ProductCatalog {
  normalizeQuery(query: string): string;
  search(query: {
    productSearchBuildId: string;
    query: string;
    locale: ProductSearchLocale;
    limit: number;
  }): Promise<ProductSearchResult>;
}
