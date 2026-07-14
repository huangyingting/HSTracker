import { createHash } from "node:crypto";

import { ACCEPTANCE_PRODUCT_ALIASES } from "../../fixtures/acceptance/v1/catalog/aliases";
import {
  DEMO_PRODUCT_ALIASES,
  DEMO_PRODUCT_RECORDS,
  DEMO_PRODUCT_TRANSLATIONS,
} from "../../fixtures/acceptance/v1/catalog/demo-products";
import { ACCEPTANCE_PRODUCT_RECORDS } from "../../fixtures/acceptance/v1/catalog/products";
import { ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED } from "../../fixtures/acceptance/v1/catalog/traditional-to-simplified";
import { ACCEPTANCE_PRODUCT_TRANSLATIONS } from "../../fixtures/acceptance/v1/catalog/translations";
import {
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
  PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import type {
  ProductCatalog,
  ProductSearchProduct,
  ProductSearchResult,
} from "./product-catalog";
import {
  retiredProductSearchBuild,
  unavailableProductSearchBuild,
} from "./product-catalog-errors";
import {
  indexProductSearchCatalog,
  searchProductIndex,
} from "./product-search";
import {
  normalizeProductSearchQuery,
  normalizeProductSearchText,
  PRODUCT_SEARCH_ALGORITHM_VERSION,
} from "./product-search-normalization";
import { validateProductSearchQuery } from "./validate-product-search-query";
import { releaseJsonBytes } from "../release/release-manifest";

// The fixture (development and end-to-end) runtime layers a curated set of
// recognizable real HS12 products on top of the minimal acceptance catalog so
// everyday searches such as "computer" or "car" resolve. The acceptance fixture
// inputs stay pristine, preserving their content-addressed promotion identity.
const catalogRecords = [
  ...ACCEPTANCE_PRODUCT_RECORDS,
  ...DEMO_PRODUCT_RECORDS,
];
const catalogTranslations = [
  ...ACCEPTANCE_PRODUCT_TRANSLATIONS,
  ...DEMO_PRODUCT_TRANSLATIONS,
];
const catalogAliases = [
  ...ACCEPTANCE_PRODUCT_ALIASES,
  ...DEMO_PRODUCT_ALIASES,
];

const products: readonly ProductSearchProduct[] =
  catalogRecords.map((product) => {
    const translation = catalogTranslations.find(
      (candidate) => candidate.code === product.code,
    );
    if (translation === undefined) {
      throw new Error(`Fixture product ${product.code} has no translation.`);
    }

    return {
      ...product,
      auxiliaryDescriptionZhHans: translation.description,
      translationStatus: translation.translationStatus,
      translationVersion: translation.translationVersion,
    };
  });
const searchIndex = indexProductSearchCatalog(
  products,
  catalogAliases,
);

export const FIXTURE_PRODUCT_CATALOG_ARTIFACT_BYTES =
  releaseJsonBytes({
    schemaVersion: "product-catalog-artifact-v1",
    productSearchBuildId:
      ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
    searchAlgorithmVersion: PRODUCT_SEARCH_ALGORITHM_VERSION,
    searchResponseSchemaVersion: "product-search-result-v1",
    translationAttribution:
      "Acceptance and demo fixture auxiliary translations.",
    products: products.map((product) => ({
      ...product,
      sourceDescriptionSha256: createHash("sha256")
        .update(product.sourceDescriptionEn, "utf8")
        .digest("hex"),
      normalizedSourceDescriptionEn:
        normalizeProductSearchText(product.sourceDescriptionEn),
      normalizedAuxiliaryDescriptionZhHans:
        normalizeProductSearchText(
          product.auxiliaryDescriptionZhHans,
        ),
    })),
    aliases: catalogAliases.map((alias) => ({
      ...alias,
      normalizedSearchText: normalizeProductSearchText(alias.alias),
    })),
    traditionalToSimplified:
      ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED,
  });

class FixtureProductCatalog implements ProductCatalog {
  normalizeQuery(query: string): string {
    return normalizeProductSearchQuery(
      query,
      ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED,
    );
  }

  async search(
    query: Parameters<ProductCatalog["search"]>[0],
  ): Promise<ProductSearchResult> {
    validateProductSearchQuery(query);
    if (
      query.productSearchBuildId ===
      PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS.failing
    ) {
      throw new Error("fixture catalog failure");
    }
    if (
      query.productSearchBuildId ===
      PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS.unavailable
    ) {
      throw unavailableProductSearchBuild(query.productSearchBuildId);
    }
    if (
      query.productSearchBuildId !== ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core
    ) {
      throw retiredProductSearchBuild(query.productSearchBuildId);
    }

    return searchProductIndex(
      query,
      searchIndex,
      ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED,
    );
  }
}

export function createFixtureProductCatalog(): ProductCatalog {
  return new FixtureProductCatalog();
}
