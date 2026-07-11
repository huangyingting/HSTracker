export type ProductCatalogErrorCode =
  | "INVALID_PRODUCT_SEARCH_QUERY"
  | "PRODUCT_SEARCH_BUILD_RETIRED"
  | "PRODUCT_SEARCH_UNAVAILABLE";

export class ProductCatalogError extends Error {
  constructor(
    readonly code: ProductCatalogErrorCode,
    readonly status: 400 | 410 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "ProductCatalogError";
  }
}

export function invalidProductSearchQuery(message: string) {
  return new ProductCatalogError(
    "INVALID_PRODUCT_SEARCH_QUERY",
    400,
    message,
    "The product search query is invalid.",
  );
}

export function retiredProductSearchBuild(id: string) {
  return new ProductCatalogError(
    "PRODUCT_SEARCH_BUILD_RETIRED",
    410,
    `Product search build ${id} is no longer served.`,
    "The requested product search build is no longer served.",
  );
}

export function unavailableProductSearchBuild(id: string) {
  return new ProductCatalogError(
    "PRODUCT_SEARCH_UNAVAILABLE",
    503,
    `Product search build ${id} is temporarily unavailable.`,
    "Product search is temporarily unavailable.",
  );
}
