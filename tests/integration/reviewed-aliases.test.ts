import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  ProductAliasRecord,
  ProductSearchProduct,
} from "../../src/catalog/product-catalog";
import {
  indexProductSearchCatalog,
  searchProductIndex,
} from "../../src/catalog/product-search";
import { normalizeProductSearchText } from "../../src/catalog/product-search-normalization";

type AliasInputRow = {
  code: string;
  locale: "en" | "zh-Hans";
  alias: string;
  normalizedSearchText: string;
  aliasKind: string;
  reviewStatus: string;
  reviewer: string;
};

type AliasInput = {
  schemaVersion: string;
  aliasVersion: string;
  rows: AliasInputRow[];
};

type SourceTerminology = {
  schemaVersion: string;
  terminologyVersion: string;
  rows: {
    level: number;
    code: string;
  }[];
};

const ALIAS_INPUT = JSON.parse(
  readFileSync(
    resolve("data/catalog/inputs/baci-hs12-reviewed-aliases-v1.json"),
    "utf8",
  ),
) as AliasInput;

const SOURCE_TERMINOLOGY = JSON.parse(
  readFileSync(
    resolve("data/catalog/inputs/taiwan-customs-hs2012-terminology-v1.json"),
    "utf8",
  ),
) as SourceTerminology;

const sourceProducts: readonly ProductSearchProduct[] =
  SOURCE_TERMINOLOGY.rows
    .filter((row) => row.level === 6)
    .map((row) => ({
      hsRevision: "HS12",
      code: row.code,
      sourceDescriptionEn: `HS12 ${row.code}`,
      auxiliaryDescriptionZhHans: `HS12 ${row.code}`,
      translationStatus: "reviewed",
      translationVersion: SOURCE_TERMINOLOGY.terminologyVersion,
    }));
const sourceProductCodes = new Set(
  sourceProducts.map((product) => product.code),
);

const aliasRecords: readonly ProductAliasRecord[] = ALIAS_INPUT.rows.map(
  (row) => ({
    hsRevision: "HS12",
    code: row.code,
    locale: row.locale,
    alias: row.alias,
    reviewStatus: "reviewed",
  }),
);

const index = indexProductSearchCatalog(sourceProducts, aliasRecords);

function search(query: string, locale: "en" | "zh-Hans"): string[] {
  const result = searchProductIndex(
    { productSearchBuildId: "test", query, locale, limit: 20 },
    index,
    {},
  );
  return result.matches.map((match) => match.product.code);
}

describe("reviewed discovery aliases", () => {
  it("uses the published alias schema and reviewed provenance", () => {
    expect(ALIAS_INPUT.schemaVersion).toBe("hs12-product-aliases-v1");
    expect(SOURCE_TERMINOLOGY.schemaVersion).toBe("hs12-zh-terminology-v1");
    for (const row of ALIAS_INPUT.rows) {
      expect(row.reviewStatus).toBe("reviewed");
      expect(row.reviewer.length).toBeGreaterThan(0);
      expect(row.aliasKind.length).toBeGreaterThan(0);
      expect(["en", "zh-Hans"]).toContain(row.locale);
    }
  });

  it("normalizes every alias exactly as the search index will", () => {
    for (const row of ALIAS_INPUT.rows) {
      expect(row.normalizedSearchText).toBe(
        normalizeProductSearchText(row.alias),
      );
    }
  });

  it("references only HS12 codes present in tracked source terminology", () => {
    for (const row of ALIAS_INPUT.rows) {
      expect(sourceProductCodes.has(row.code)).toBe(true);
    }
  });

  it("keeps every code/locale/alias triple unique", () => {
    const keys = ALIAS_INPUT.rows.map(
      (row) => `${row.code}\u0000${row.locale}\u0000${row.alias}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves the common term 'computer' to the data-processing family", () => {
    const codes = search("computer", "en");
    expect(codes).toEqual(
      expect.arrayContaining(["847130", "847141", "847149", "847150"]),
    );
  });

  it.each([
    { query: "monitor", locale: "en" as const, expected: ["852851", "852859"] },
    { query: "printer", locale: "en" as const, expected: ["844331", "844332", "844339"] },
    { query: "projector", locale: "en" as const, expected: ["852861", "852869"] },
    { query: "television", locale: "en" as const, expected: ["852871", "852872", "852873"] },
    { query: "camera", locale: "en" as const, expected: ["852580"] },
    { query: "tablet", locale: "en" as const, expected: ["847130"] },
    { query: "car", locale: "en" as const, expected: ["870323"] },
    { query: "电脑", locale: "zh-Hans" as const, expected: ["847130"] },
    { query: "电视", locale: "zh-Hans" as const, expected: ["852872"] },
    { query: "汽车", locale: "zh-Hans" as const, expected: ["870323"] },
  ])(
    "resolves the common term '$query' to its intended HS12 products",
    ({ query, locale, expected }) => {
      expect(search(query, locale)).toEqual(expect.arrayContaining(expected));
    },
  );
});
