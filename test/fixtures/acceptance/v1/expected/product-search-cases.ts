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
  expectedTotalMatches?: number;
  expectedTruncated?: boolean;
};

type ProductSearchGoldenErrorCase = {
  name: string;
  query: string;
  locale: ProductSearchLocale;
  expectedError: {
    code: "INVALID_PRODUCT_SEARCH_QUERY";
    status: 400;
  };
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

const CAPPED_ALIAS_CODES = [
  "900001",
  "900002",
  "900003",
  "900004",
  "900005",
  "900006",
  "900007",
  "900008",
  "900009",
  "900010",
  "900011",
  "900012",
  "900013",
  "900014",
  "900015",
  "900016",
  "900017",
  "900018",
  "900019",
  "900020",
] as const;

const CAPPED_ALIAS_MATCHES = CAPPED_ALIAS_CODES.map((code) => ({
  code,
  class: "EXACT_ALIAS" as const,
  field: "ALIAS_EN" as const,
  matchedText: "catalog cap",
}));

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
    name: "exact source English description wins over its duplicate alias",
    query: "Horses: live, pure-bred breeding animals",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "EXACT_DESCRIPTION",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText: "Horses: live, pure-bred breeding animals",
      },
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
    name: "exact auxiliary Simplified Chinese description",
    query: "纯种繁殖用活马",
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
    name: "English description prefix",
    query: "horses live",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "DESCRIPTION_PREFIX",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText: "Horses: live, pure-bred breeding animals",
      },
      {
        code: "010129",
        class: "DESCRIPTION_PREFIX",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText:
          "Horses: live, other than pure-bred breeding animals",
      },
    ],
  },
  {
    name: "punctuation-normalized multi-token description",
    query: "hinnies, mules",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010190",
        class: "DESCRIPTION_TOKENS",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText: "Mules and hinnies: live",
      },
    ],
  },
  {
    name: "bounded Latin typo",
    query: "horss",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "LATIN_TYPO",
        field: "ALIAS_EN",
        matchedText: "purebred horse",
      },
      {
        code: "010129",
        class: "LATIN_TYPO",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText:
          "Horses: live, other than pure-bred breeding animals",
      },
    ],
  },
  {
    name: "ambiguous reviewed alias",
    query: "马",
    locale: "zh-Hans",
    expectedState: "RESULTS",
    expectedMatches: [
      {
        code: "010121",
        class: "EXACT_ALIAS",
        field: "ALIAS_ZH_HANS",
        matchedText: "马",
      },
      {
        code: "010129",
        class: "EXACT_ALIAS",
        field: "ALIAS_ZH_HANS",
        matchedText: "马",
      },
    ],
  },
  {
    name: "stable capped alias tie",
    query: "catalog cap",
    locale: "en",
    expectedState: "RESULTS",
    expectedMatches: CAPPED_ALIAS_MATCHES,
    expectedTotalMatches: 21,
    expectedTruncated: true,
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

export const PRODUCT_SEARCH_GOLDEN_ERROR_CASES: readonly ProductSearchGoldenErrorCase[] =
  [
    {
      name: "query over 300 Unicode code points",
      query: "x".repeat(301),
      locale: "en",
      expectedError: {
        code: "INVALID_PRODUCT_SEARCH_QUERY",
        status: 400,
      },
    },
  ];
