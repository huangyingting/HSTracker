import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/product-catalogs/[productSearchBuildId]/products/route";
import { PRODUCT_CATALOG_ROUTE_ERROR_CASES } from "../../test/fixtures/acceptance/v1/expected/error-cases";
import { PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";

const routeContext = (productSearchBuildId: string) => ({
  params: Promise.resolve({ productSearchBuildId }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Product Catalog route", () => {
  it("serves normalized-equivalent deterministic GET and HEAD representations", async () => {
    const firstUrl =
      "http://localhost/api/v1/product-catalogs/acceptance-product-search-v1/products?q=horse&locale=en&limit=20";
    const equivalentUrl =
      "http://localhost/api/v1/product-catalogs/acceptance-product-search-v1/products?q=%EF%BC%A8%EF%BC%AF%EF%BC%B2%EF%BC%B3%EF%BC%A5&locale=en&limit=20";

    const first = await GET(
      new Request(firstUrl),
      routeContext("acceptance-product-search-v1"),
    );
    const firstBody = await first.text();
    const equivalent = await GET(
      new Request(equivalentUrl),
      routeContext("acceptance-product-search-v1"),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(await equivalent.text()).toBe(firstBody);
    expect(equivalent.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(JSON.parse(firstBody)).toMatchObject({
      schemaVersion: "product-search-result-v1",
      query: { normalized: "horse", locale: "en", limit: 20 },
    });

    const notModified = await GET(
      new Request(firstUrl, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext("acceptance-product-search-v1"),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));

    const head = await HEAD(
      new Request(firstUrl, { method: "HEAD" }),
      routeContext("acceptance-product-search-v1"),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(head.headers.get("cache-control")).toBe(
      first.headers.get("cache-control"),
    );
  });

  it.each(PRODUCT_CATALOG_ROUTE_ERROR_CASES)(
    "returns a typed no-store error for $name",
    async (fixture) => {
      const response = await GET(
        new Request(
          `http://localhost/api/v1/product-catalogs/${fixture.build}/products?${fixture.query}`,
        ),
        routeContext(fixture.build),
      );

      expect(response.status).toBe(fixture.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(response.json()).resolves.toEqual({
        error: { code: fixture.code, message: fixture.message },
      });
    },
  );

  it("keeps unexpected catalog failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS.failing;
    const response = await GET(
      new Request(
        `http://localhost/api/v1/product-catalogs/${build}/products?q=horse&locale=en&limit=20`,
      ),
      routeContext(build),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Product search could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain("fixture catalog failure");
    expect(errorLog).toHaveBeenCalledWith(
      "Product Catalog request failed",
      expect.objectContaining({
        correlationId: body.error.correlationId,
        error: expect.any(Error),
      }),
    );
  });
});
