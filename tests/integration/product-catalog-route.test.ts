import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/product-catalogs/[productSearchBuildId]/products/route";
import { PRODUCT_CATALOG_ROUTE_ERROR_CASES } from "../../fixtures/acceptance/v1/expected/error-cases";
import {
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
  PRODUCT_SEARCH_FIXTURE_TEST_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";

const routeContext = (productSearchBuildId: string) => ({
  params: Promise.resolve({ productSearchBuildId }),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("versioned Product Catalog route", () => {
  it("serves normalized-equivalent deterministic GET and HEAD representations", async () => {
    const build = ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core;
    const route =
      `http://localhost/api/v1/product-catalogs/${build}/products`;
    const firstUrl = `${route}?q=horse&locale=en&limit=20`;
    const equivalentUrl =
      `${route}?q=%EF%BC%A8%EF%BC%AF%EF%BC%B2%EF%BC%B3%EF%BC%A5&locale=en&limit=20`;

    const first = await GET(
      new Request(firstUrl),
      routeContext(build),
    );
    const firstBody = await first.text();
    const equivalent = await GET(
      new Request(equivalentUrl),
      routeContext(build),
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
      routeContext(build),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));

    const head = await HEAD(
      new Request(firstUrl, { method: "HEAD" }),
      routeContext(build),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(head.headers.get("cache-control")).toBe(
      first.headers.get("cache-control"),
    );
  });

  it.each([
    {
      name: "equivalent strong validator",
      header: (etag: string) => etag.replace(/^W\//u, ""),
    },
    {
      name: "matching validator in a list",
      header: (etag: string) => `"unrelated", ${etag}`,
    },
    {
      name: "wildcard validator",
      header: () => "*",
    },
  ])("uses weak comparison for $name", async ({ header }) => {
    const build = ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core;
    const url =
      `http://localhost/api/v1/product-catalogs/${build}/products` +
      "?q=horse&locale=en&limit=20";
    const initial = await GET(new Request(url), routeContext(build));
    const etag = initial.headers.get("etag")!;

    const response = await GET(
      new Request(url, {
        headers: { "If-None-Match": header(etag) },
      }),
      routeContext(build),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("cancels product search at the two-second route deadline", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      searchProducts(_query, options) {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    });
    const build = ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core;

    try {
      let response: Response | undefined;
      const pending = GET(
        new Request(
          `http://localhost/api/v1/product-catalogs/${build}/products?q=horse&locale=en&limit=20`,
        ),
        routeContext(build),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(response).toBeDefined();
      await pending;
      expect(response?.status).toBe(503);
      await expect(response?.json()).resolves.toMatchObject({
        error: { code: "REQUEST_DEADLINE_EXCEEDED" },
      });
    } finally {
      restore();
    }
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
    expect(
      JSON.parse(String(errorLog.mock.calls[0]?.[0])),
    ).toMatchObject({
      level: "error",
      event: "product-catalog-request-failed",
      correlationId: body.error.correlationId,
      error: { name: "Error", message: expect.any(String) },
    });
  });
});
