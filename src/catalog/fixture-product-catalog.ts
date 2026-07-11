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
  invalidProductSearchQuery,
  retiredProductSearchBuild,
  unavailableProductSearchBuild,
} from "./product-catalog-errors";
import { searchProductIndex } from "./product-search";

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

export class FixtureProductCatalog implements ProductCatalog {
  async search(
    query: Parameters<ProductCatalog["search"]>[0],
  ): Promise<ProductSearchResult> {
    if ([...query.query].length > 300) {
      throw invalidProductSearchQuery(
        "Product search query exceeds 300 Unicode code points.",
      );
    }
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 20
    ) {
      throw invalidProductSearchQuery(
        "Product search limit must be an integer from 1 through 20.",
      );
    }
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
      products,
      ACCEPTANCE_PRODUCT_ALIASES,
      ACCEPTANCE_TRADITIONAL_TO_SIMPLIFIED,
    );
  }
}

export function createFixtureProductCatalog(): ProductCatalog {
  return new FixtureProductCatalog();
}
