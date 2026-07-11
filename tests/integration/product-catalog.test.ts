import { describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import {
  PRODUCT_SEARCH_GOLDEN_CASES,
  PRODUCT_SEARCH_GOLDEN_ERROR_CASES,
} from "../../test/fixtures/acceptance/v1/expected/product-search-cases";
import { ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";

const PRODUCT_SEARCH_BUILD_ID = ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core;

describe("ProductCatalog", () => {
  it("finds an HS12 product by its exact six-character code", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "010121",
      locale: "en",
      limit: 20,
    });

    expect(result).toEqual({
      schemaVersion: "product-search-result-v1",
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: {
        normalized: "010121",
        locale: "en",
        limit: 20,
      },
      state: "RESULTS",
      messageCode: null,
      totalMatches: 1,
      truncated: false,
      matches: [
        {
          product: {
            hsRevision: "HS12",
            code: "010121",
            sourceDescriptionEn:
              "Horses: live, pure-bred breeding animals",
            auxiliaryDescriptionZhHans: "纯种繁殖用活马",
            translationStatus: "reviewed",
            translationVersion: "acceptance-zh-hans-v1",
          },
          match: {
            class: "EXACT_CODE",
            field: "CODE",
            matchedText: "010121",
          },
        },
      ],
    });
  });

  it("browses matching HS12 products in stable code order", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "01",
      locale: "en",
      limit: 20,
    });

    expect(result.query.normalized).toBe("01");
    expect(result.state).toBe("RESULTS");
    expect(result.totalMatches).toBe(4);
    expect(
      result.matches.map(({ product, match }) => ({
        code: product.code,
        class: match.class,
        field: match.field,
        matchedText: match.matchedText,
      })),
    ).toEqual([
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
    ]);
  });

  it("normalizes full-width code input without losing its leading zero", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "０１０１２１",
      locale: "en",
      limit: 20,
    });

    expect(result.query.normalized).toBe("010121");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "EXACT_CODE",
        field: "CODE",
        matchedText: "010121",
      },
    });
  });

  it.each([
    {
      name: "source English",
      query: "Horses: live, pure-bred breeding animals",
      locale: "en" as const,
      field: "SOURCE_DESCRIPTION_EN",
      matchedText: "Horses: live, pure-bred breeding animals",
      expectedCodes: ["010121", "010129"],
    },
    {
      name: "auxiliary Simplified Chinese",
      query: "纯种繁殖用活马",
      locale: "zh-Hans" as const,
      field: "AUXILIARY_DESCRIPTION_ZH_HANS",
      matchedText: "纯种繁殖用活马",
      expectedCodes: ["010121"],
    },
  ])("finds products by exact $name descriptions", async (fixture) => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: fixture.query,
      locale: fixture.locale,
      limit: 20,
    });

    expect(result.matches.map(({ product }) => product.code)).toEqual(
      fixture.expectedCodes,
    );
    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "EXACT_DESCRIPTION",
        field: fixture.field,
        matchedText: fixture.matchedText,
      },
    });
  });

  it("orders description-prefix matches by stable code", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "horses live",
      locale: "en",
      limit: 20,
    });

    expect(
      result.matches.map(({ product, match }) => ({
        code: product.code,
        class: match.class,
        field: match.field,
      })),
    ).toEqual([
      {
        code: "010121",
        class: "DESCRIPTION_PREFIX",
        field: "SOURCE_DESCRIPTION_EN",
      },
      {
        code: "010129",
        class: "DESCRIPTION_PREFIX",
        field: "SOURCE_DESCRIPTION_EN",
      },
    ]);
  });

  it("matches every punctuation-normalized query token in one description", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "hinnies, mules",
      locale: "en",
      limit: 20,
    });

    expect(result.query.normalized).toBe("hinnies mules");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      product: { code: "010190" },
      match: {
        class: "DESCRIPTION_TOKENS",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText: "Mules and hinnies: live",
      },
    });
  });

  it("returns every product for an ambiguous reviewed alias", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "马",
      locale: "zh-Hans",
      limit: 20,
    });

    expect(
      result.matches.map(({ product, match }) => ({
        code: product.code,
        class: match.class,
        field: match.field,
        matchedText: match.matchedText,
      })),
    ).toEqual([
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
    ]);
  });

  it("folds supported Traditional Chinese input into the canonical search form", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "純種繁殖用活馬",
      locale: "zh-Hans",
      limit: 20,
    });

    expect(result.query.normalized).toBe("纯种繁殖用活马");
    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "EXACT_DESCRIPTION",
        field: "AUXILIARY_DESCRIPTION_ZH_HANS",
      },
    });
  });

  it("returns reviewed English aliases as explicit match evidence", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "purebred horse",
      locale: "en",
      limit: 20,
    });

    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "EXACT_ALIAS",
        field: "ALIAS_EN",
        matchedText: "purebred horse",
      },
    });
  });

  it("matches reviewed alias prefixes after description-prefix candidates", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "purebred",
      locale: "en",
      limit: 20,
    });

    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "ALIAS_PREFIX",
        field: "ALIAS_EN",
        matchedText: "purebred horse",
      },
    });
  });

  it("ranks fewer unmatched characters before the stable code tie-breaker", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "wire",
      locale: "en",
      limit: 20,
    });

    expect(
      result.matches.map(({ product, match }) => ({
        code: product.code,
        class: match.class,
        matchedText: match.matchedText,
      })),
    ).toEqual([
      {
        code: "851712",
        class: "ALIAS_PREFIX",
        matchedText: "wireless phone",
      },
      {
        code: "010121",
        class: "ALIAS_PREFIX",
        matchedText: "wireless purebred horse telephone",
      },
    ]);
  });

  it("matches every query token within one reviewed alias", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "breeding horse",
      locale: "en",
      limit: 20,
    });

    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "ALIAS_TOKENS",
        field: "ALIAS_EN",
        matchedText: "horse breeding",
      },
    });
  });

  it.each([
    { locale: "en" as const, field: "ALIAS_EN" },
    { locale: "zh-Hans" as const, field: "ALIAS_ZH_HANS" },
  ])(
    "uses the $locale field only to break otherwise equal matches",
    async ({ locale, field }) => {
      const catalog = createFixtureProductCatalog();

      const result = await catalog.search({
        productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
        query: "mobile",
        locale,
        limit: 20,
      });

      expect(result.matches.map(({ product }) => product.code)).toEqual([
        "851712",
      ]);
      expect(result.matches[0]!.match).toEqual({
        class: "EXACT_ALIAS",
        field,
        matchedText: "mobile",
      });
    },
  );

  it("bounds typo matching to explainable Latin token edits", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "horss",
      locale: "en",
      limit: 20,
    });

    expect(
      result.matches.map(({ product, match }) => ({
        code: product.code,
        class: match.class,
        field: match.field,
      })),
    ).toEqual([
      {
        code: "010121",
        class: "LATIN_TYPO",
        field: "ALIAS_EN",
      },
      {
        code: "010129",
        class: "LATIN_TYPO",
        field: "SOURCE_DESCRIPTION_EN",
      },
    ]);
  });

  it("prefers description evidence over an otherwise equal alias", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "horses live pure bred breeding animalz",
      locale: "en",
      limit: 20,
    });

    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: {
        class: "LATIN_TYPO",
        field: "SOURCE_DESCRIPTION_EN",
        matchedText: "Horses: live, pure-bred breeding animals",
      },
    });
  });

  it("suppresses broad one-character Latin searches", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "h",
      locale: "en",
      limit: 20,
    });

    expect(result).toMatchObject({
      query: { normalized: "h" },
      state: "SUPPRESSED_SHORT_QUERY",
      messageCode: "QUERY_TOO_SHORT",
      totalMatches: 0,
      truncated: false,
      matches: [],
    });
  });

  it("rejects explicit non-HS12 revision input without reusing its digits", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "HS 2022 851713",
      locale: "en",
      limit: 20,
    });

    expect(result).toMatchObject({
      query: { normalized: "hs 2022 851713" },
      state: "UNSUPPORTED_HS_REVISION",
      messageCode: "UNSUPPORTED_HS_REVISION",
      totalMatches: 0,
      truncated: false,
      matches: [],
    });
  });

  it("accepts an explicit HS12 scope while preserving canonical code identity", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "HS 2012 010121",
      locale: "en",
      limit: 20,
    });

    expect(result.query.normalized).toBe("010121");
    expect(result.matches[0]).toMatchObject({
      product: { code: "010121" },
      match: { class: "EXACT_CODE", field: "CODE" },
    });
  });

  it("rejects input longer than 300 Unicode code points without truncating it", async () => {
    const catalog = createFixtureProductCatalog();

    await expect(
      catalog.search({
        productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
        query: "x".repeat(301),
        locale: "en",
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PRODUCT_SEARCH_QUERY",
      status: 400,
      publicMessage: "The product search query is invalid.",
    });
  });

  it.each([0, 21, 1.5])(
    "rejects an out-of-contract result limit of %s",
    async (limit) => {
      const catalog = createFixtureProductCatalog();

      await expect(
        catalog.search({
          productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
          query: "horse",
          locale: "en",
          limit,
        }),
      ).rejects.toMatchObject({
        name: "ProductCatalogError",
        code: "INVALID_PRODUCT_SEARCH_QUERY",
        status: 400,
        publicMessage: "The product search query is invalid.",
      });
    },
  );

  it.each([
    {
      productSearchBuildId: "retired-product-search-v1",
      code: "PRODUCT_SEARCH_BUILD_RETIRED",
      status: 410,
    },
    {
      productSearchBuildId: "unavailable-product-search-v1",
      code: "PRODUCT_SEARCH_UNAVAILABLE",
      status: 503,
    },
  ])(
    "returns a typed build outcome for $productSearchBuildId",
    async ({ productSearchBuildId, code, status }) => {
      const catalog = createFixtureProductCatalog();

      await expect(
        catalog.search({
          productSearchBuildId,
          query: "horse",
          locale: "en",
          limit: 20,
        }),
      ).rejects.toMatchObject({ code, status });
    },
  );

  it("caps large stable ties at the requested maximum", async () => {
    const catalog = createFixtureProductCatalog();

    const result = await catalog.search({
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      query: "catalog cap",
      locale: "en",
      limit: 20,
    });

    expect(result.totalMatches).toBe(21);
    expect(result.truncated).toBe(true);
    expect(result.matches.map(({ product }) => product.code)).toEqual([
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
    ]);
    expect(
      result.matches.every(
        ({ match }) =>
          match.class === "EXACT_ALIAS" &&
          match.field === "ALIAS_EN" &&
          match.matchedText === "catalog cap",
      ),
    ).toBe(true);
  });

  it.each(PRODUCT_SEARCH_GOLDEN_CASES)(
    "conforms to the golden case: $name",
    async (fixture) => {
      const catalog = createFixtureProductCatalog();

      const result = await catalog.search({
        productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
        query: fixture.query,
        locale: fixture.locale,
        limit: 20,
      });

      expect(result.state).toBe(fixture.expectedState);
      expect(
        result.matches.map(({ product, match }) => ({
          code: product.code,
          ...match,
        })),
      ).toEqual(fixture.expectedMatches);
      expect(result.totalMatches).toBe(
        fixture.expectedTotalMatches ?? fixture.expectedMatches.length,
      );
      expect(result.truncated).toBe(fixture.expectedTruncated ?? false);
    },
  );

  it.each(PRODUCT_SEARCH_GOLDEN_ERROR_CASES)(
    "conforms to the golden error case: $name",
    async (fixture) => {
      const catalog = createFixtureProductCatalog();

      await expect(
        catalog.search({
          productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
          query: fixture.query,
          locale: fixture.locale,
          limit: 20,
        }),
      ).rejects.toMatchObject(fixture.expectedError);
    },
  );
});
