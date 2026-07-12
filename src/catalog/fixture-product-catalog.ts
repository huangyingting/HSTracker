import { ACCEPTANCE_PRODUCT_ALIASES } from "../../test/fixtures/acceptance/v1/catalog/aliases";
import { ACCEPTANCE_PRODUCT_RECORDS } from "../../test/fixtures/acceptance/v1/catalog/products";
import { ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED } from "../../test/fixtures/acceptance/v1/catalog/traditional-to-simplified";
import { ACCEPTANCE_PRODUCT_TRANSLATIONS } from "../../test/fixtures/acceptance/v1/catalog/translations";
import {
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
  PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS,
} from "../../test/fixtures/acceptance/v1/metadata";
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
import { normalizeProductSearchQuery } from "./product-search-normalization";
import { validateProductSearchQuery } from "./validate-product-search-query";

const products: readonly ProductSearchProduct[] =
  ACCEPTANCE_PRODUCT_RECORDS.map((product) => {
    const translation = ACCEPTANCE_PRODUCT_TRANSLATIONS.find(
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
  ACCEPTANCE_PRODUCT_ALIASES,
);

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
