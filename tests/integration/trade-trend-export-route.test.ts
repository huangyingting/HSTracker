import { describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/trade-trends.csv/route";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_RELEASE_INCOMPATIBLE_FRESHNESS_STATUS,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { serializeTradeTrendCsv } from "../../src/export/trade-trend-csv";

const manifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);
const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

describe("versioned Trade Trend CSV route", () => {
  it("serves matching deterministic GET, conditional GET, and HEAD metadata", async () => {
    const url = exportUrl();
    const fixture = createFixtureApplicationRuntime();
    const outcome = await fixture.tradeAnalytics.execute({
      recipe: "trade-trend-v1",
      analysisBuildId: manifest.analysisBuildId,
      importerCode: "528",
      productCode: "010121",
    });
    if (outcome.state !== "success") {
      throw new TypeError("Expected the fixture platform oracle to succeed.");
    }
    const freshness = fixture.resolveFreshnessStatus(
      manifest.freshness.freshnessStatusId,
    );
    const productSearch = await fixture.searchProducts({
      productSearchBuildId: manifest.productSearchBuildId,
      query: "010121",
      locale: "en",
      limit: 1,
    });
    const product = productSearch.matches.find(
      (match) => match.product.code === "010121",
    )?.product;
    if (freshness === null || product === undefined) {
      throw new TypeError("Expected the fixture export dependencies.");
    }
    const platformCsv = serializeTradeTrendCsv({
      result: {
        ...outcome.payload,
        analysisIdentity: outcome.analysisIdentity,
        datasetPackageIdentity: outcome.datasetPackageIdentity,
      },
      product,
      manifest: { ...manifest, freshness },
    });
    const first = await GET(
      new Request(url),
      routeContext(manifest.analysisBuildId),
    );
    const bytes = new Uint8Array(await first.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8; header=present",
    );
    expect(first.headers.get("content-disposition")).toMatch(
      /^attachment; filename="hs-tracker_trade-trend_for-528_HS12-010121_V202601_ttx1-[a-f0-9]{64}\.csv"$/u,
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("etag")).toMatch(/^W\/"sha256-[a-f0-9]{64}"$/u);
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(bytes).toEqual(platformCsv.bytes);
    expect(bytes.slice(0, 3)).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext(manifest.analysisBuildId),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext(manifest.analysisBuildId),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("preserves the dedicated CSV representation-limit contract", async () => {
    const fixture = createFixtureApplicationRuntime();
    const oversizedDescription = "x".repeat(5 * 1024 * 1024);
    const restore = installApplicationRuntime({
      ...fixture,
      async searchProducts(query, options) {
        const search = await fixture.searchProducts(query, options);
        return {
          ...search,
          matches: search.matches.map((match) => ({
            ...match,
            product: {
              ...match.product,
              auxiliaryDescriptionZhHans: oversizedDescription,
            },
          })),
        };
      },
    });

    try {
      const response = await GET(
        new Request(exportUrl()),
        routeContext(manifest.analysisBuildId),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "EXPORT_REPRESENTATION_LIMIT_EXCEEDED",
          message:
            "The complete Trade Trend export is temporarily unavailable.",
        },
      });
    } finally {
      restore();
    }
  });

  it("applies anonymous-source rate limiting inherited from Candidate Market protections", async () => {
    const { createBoundedApplicationRuntime } = await import(
      "../../src/runtime/bounded-application-runtime"
    );
    const now = 0;
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
      {
        now: () => now,
        anonymousSourceRateLimit: {
          capacity: 1,
          refillTokensPerSecond: 1,
        },
      },
    );
    const restore = installApplicationRuntime(runtime);
    const request = new Request(exportUrl(), {
      headers: { "Fly-Client-IP": "198.51.100.55" },
    });

    try {
      await expect(
        GET(request, routeContext(manifest.analysisBuildId)),
      ).resolves.toHaveProperty("status", 200);
      const rejected = await GET(
        new Request(exportUrl(), {
          headers: { "Fly-Client-IP": "198.51.100.55" },
        }),
        routeContext(manifest.analysisBuildId),
      );

      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("1");
    } finally {
      restore();
    }
  });

  it.each([
    {
      name: "malformed importer",
      mutate: (url: URL) => url.searchParams.set("importer", "5280"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "malformed product",
      mutate: (url: URL) => url.searchParams.set("product", "10121"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "unknown importer",
      mutate: (url: URL) => url.searchParams.set("importer", "999"),
      status: 404,
      code: "UNKNOWN_IMPORTER",
    },
    {
      name: "unknown product",
      mutate: (url: URL) => url.searchParams.set("product", "999999"),
      status: 404,
      code: "UNKNOWN_PRODUCT",
    },
    {
      name: "retired product-search build",
      mutate: (url: URL) =>
        url.searchParams.set(
          "productSearchBuildId",
          "retired-product-search-v1",
        ),
      status: 410,
      code: "PRODUCT_SEARCH_BUILD_RETIRED",
    },
    {
      name: "unknown freshness status",
      mutate: (url: URL) =>
        url.searchParams.set("freshnessStatusId", "freshness:unknown"),
      status: 404,
      code: "FRESHNESS_STATUS_NOT_FOUND",
    },
  ])("returns a typed no-store error for $name", async (fixture) => {
    const url = new URL(exportUrl());
    fixture.mutate(url);

    const response = await GET(
      new Request(url),
      routeContext(manifest.analysisBuildId),
    );

    expect(response.status).toBe(fixture.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(response.json()).resolves.toMatchObject({
      error: { code: fixture.code },
    });
  });

  it.each([
    {
      name: "retired analysis build",
      build: "unknown-analysis-build",
      status: 410,
      code: "ANALYSIS_BUILD_RETIRED",
    },
    {
      name: "unavailable analysis build",
      build: "unavailable-fixture-build",
      status: 503,
      code: "ANALYSIS_UNAVAILABLE",
    },
  ])("does not substitute a build for $name", async (fixture) => {
    const response = await GET(
      new Request(exportUrl({ analysisBuildId: fixture.build })),
      routeContext(fixture.build),
    );

    expect(response.status).toBe(fixture.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: fixture.code },
    });
  });

  it("rejects a known freshness status bound to another BACI Release", async () => {
    const response = await GET(
      new Request(
        exportUrl({
          freshnessStatusId:
            FIXTURE_RELEASE_INCOMPATIBLE_FRESHNESS_STATUS.freshnessStatusId,
        }),
      ),
      routeContext(manifest.analysisBuildId),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INCOMPATIBLE_FRESHNESS_STATUS" },
    });
  });

  it("rejects a retired product-search build reference", async () => {
    const response = await GET(
      new Request(
        exportUrl({
          productSearchBuildId: "retired-product-search-v1",
        }),
      ),
      routeContext(manifest.analysisBuildId),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PRODUCT_SEARCH_BUILD_RETIRED" },
    });
  });

  it("keeps unexpected failures opaque and correlated", async () => {
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      tradeAnalytics: {
        execute() {
          throw new Error("boom");
        },
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await GET(
        new Request(exportUrl()),
        routeContext(manifest.analysisBuildId),
      );

      expect(response.status).toBe(500);
      const body = (await response.json()) as {
        error: { code: string; correlationId: string };
      };
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.correlationId).toMatch(/^[a-z0-9-]+$/u);
    } finally {
      errorSpy.mockRestore();
      restore();
    }
  });
});

function exportUrl(
  overrides: Partial<{
    analysisBuildId: string;
    importer: string;
    product: string;
    productSearchBuildId: string;
    freshnessStatusId: string;
    schema: string;
  }> = {},
): string {
  const parameters = new URLSearchParams({
    importer: overrides.importer ?? "528",
    product: overrides.product ?? "010121",
    productSearchBuildId:
      overrides.productSearchBuildId ?? manifest.productSearchBuildId,
    freshnessStatusId:
      overrides.freshnessStatusId ?? manifest.freshness.freshnessStatusId,
    schema: overrides.schema ?? "trade-trends-csv-v1",
  });
  return `http://localhost/api/v1/analyses/${
    overrides.analysisBuildId ?? manifest.analysisBuildId
  }/trade-trends.csv?${parameters}`;
}
