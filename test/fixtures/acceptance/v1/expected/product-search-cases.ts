import type {
  ProductSearchLocale,
  ProductSearchMatchClass,
  ProductSearchMatchedField,
} from "../../../../../src/catalog/product-catalog";

type ProductSearchGoldenCase = {
  name: string;
  query: string;
  locale: ProductSearchLocale;
  expectedState:
    | "RESULTS"
    | "NO_MATCH"
    | "SUPPRESSED_SHORT_QUERY"
    | "UNSUPPORTED_HS_REVISION";
  expectedMatches: readonly {
    code: string;
    class: ProductSearchMatchClass;
    field: ProductSearchMatchedField;
    matchedText: string;
  }[];
};

const HORSE_CODE_PREFIX_MATCHES = [
  {
    code: "010121",
    class: "CODE_PREFIX",
    field: "CODE",
    matchedText: "010121",
  },
  {
    code: "010129",
    class: "CODE_PREFIX",
    field: "CODE",
    matchedText: "010129",
  },
  {
    code: "010130",
    class: "CODE_PREFIX",
    field: "CODE",
    matchedText: "010130",
  },
  {
    code: "010190",
    class: "CODE_PREFIX",
    field: "CODE",
    matchedText: "010190",
  },
] as const;

export const PRODUCT_SEARCH_GOLDEN_CASES: readonly ProductSearchGoldenCase[] = [
  {
    name: "exact code",
    query: "010121",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "EXACT_CODE",
        field: "CODE",
        matchedText: "010121",
      },
    ],
  },
  {
    name: "two-digit code browsing",
    query: "01",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: HORSE_CODE_PREFIX_MATCHES,
  },
  {
    name: "four-digit code browsing",
    query: "0101",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: HORSE_CODE_PREFIX_MATCHES,
  },
  {
    name: "full-width exact code",
    query: "０１０１２１",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "EXACT_CODE",
        field: "CODE",
        matchedText: "010121",
      },
    ],
  },
  {
    name: "supported Traditional description",
    query: "純種繁殖用活馬",
    locale: "zh-Hans",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "EXACT_DESCRIPTION",
        field: "AUXILIARY_DESCRIPTION_ZH_HANS",
        matchedText: "纯种繁殖用活马",
      },
    ],
  },
  {
    name: "qualifier words remain significant",
    query: "horses other than pure bred",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010129",
        class: "DESCRIPTION_TOKENS",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText:
          "Horses: live, other than pure-bred breeding animals",
      },
    ],
  },
  {
    name: "well-formed absent HS12 code",
    query: "851713",
    locale: "en",
    expectedState: "NO_MATCH",
    expectedMatches: [],
  },
  {
    name: "Latin typo beyond the bound",
    query: "hxrxse",
    locale: "en",
    expectedState: "NO_MATCH",
    expectedMatches: [],
  },
  {
    name: "one-character Latin suppression",
    query: "h",
    locale: "en",
    expectedState: "SUPPRESSED_SHORT_QUERY",
    expectedMatches: [],
  },
  {
    name: "compact older HS revision",
    query: "HS07 010121",
    locale: "en",
    expectedState: "UNSUPPORTED_HS_REVISION",
    expectedMatches: [],
  },
  {
    name: "future HS revision",
    query: "HS 2027 010121",
    locale: "en",
    expectedState: "UNSUPPORTED_HS_REVISION",
    expectedMatches: [],
  },
];
