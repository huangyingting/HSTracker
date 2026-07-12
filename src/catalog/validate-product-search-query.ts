import type { ProductCatalog } from "./product-catalog";
import { invalidProductSearchQuery } from "./product-catalog-errors";

export function validateProductSearchQuery(
  query: Parameters<ProductCatalog["search"]>[0],
): void {
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
  if (query.locale !== "en" && query.locale !== "zh-Hans") {
    throw invalidProductSearchQuery("Product search locale is unsupported.");
  }
}
