import { describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets.csv/route";
import { GET as getCandidateMarkets } from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import type {
  AnalysisOutcome,
  TradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
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
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { serializeCandidateMarketCsv } from "../../src/export/candidate-market-csv";
import {
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../../src/runtime/runtime-metrics";

const manifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);
const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

describe("versioned Candidate Market CSV route", () => {
  it("serves matching deterministic GET, conditional GET, and HEAD metadata", async () => {
    const url = exportUrl();
    const fixture = createFixtureApplicationRuntime();
    const platformOutcome = await fixture.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: manifest.analysisBuildId,
      exporterCode: "156",
      productCode: "010121",
    });
    if (platformOutcome.state !== "success") {
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
    const platformCsv = serializeCandidateMarketCsv({
      result: platformOutcome.payload,
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
      /^attachment; filename="hs-tracker_candidate-markets_from-156_HS12-010121_V202601_cmx1-[a-f0-9]{64}\.csv"$/u,
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("etag")).toMatch(
      /^W\/"sha256-[a-f0-9]{64}"$/u,
    );
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(bytes).toEqual(platformCsv.bytes);
    expect(bytes.slice(0, 3)).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));
    expect(new TextDecoder().decode(bytes).match(/\r\n/g)).toHaveLength(14);

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
    expect(head.headers.get("content-disposition")).toBe(
      first.headers.get("content-disposition"),
    );
  });

  it("returns an attributable CSV row for a valid empty analysis", async () => {
    const response = await GET(
      new Request(exportUrl({ product: "851712" })),
      routeContext(manifest.analysisBuildId),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /_HS12-851712_V202601_cmx1-[a-f0-9]{64}\.csv/u,
    );
    expect(body.match(/\r\n/g)).toHaveLength(2);
    expect(body).toContain('"EMPTY_ANALYSIS"');
    expect(body).toContain('"NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW"');
    expect(body).toContain('"蜂窝网络或其他无线网络用电话机"');
  });

  it("reuses the JSON Candidate Market computation for CSV serialization", async () => {
    const fixture = createFixtureApplicationRuntime();
    const runtime = createBoundedApplicationRuntime(fixture);
    const restore = installApplicationRuntime(runtime);
    const metrics: RuntimeRequestMetric[] = [];
    const unsubscribe = subscribeRuntimeMetrics((metric) => {
      metrics.push(metric);
    });

    try {
      const json = await getCandidateMarkets(
        new Request(
          `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/candidate-markets?exporter=156&product=010121`,
        ),
        routeContext(manifest.analysisBuildId),
      );
      const csv = await GET(
        new Request(exportUrl()),
        routeContext(manifest.analysisBuildId),
      );

      expect(json.status).toBe(200);
      expect(csv.status).toBe(200);
      expect(metrics.map((metric) => metric.cacheState)).toEqual([
        "miss",
        "hit",
      ]);
    } finally {
      unsubscribe();
      restore();
    }
  });

  it("returns the exact retryable response when export analysis capacity is exhausted", async () => {
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      tradeAnalytics: platformReturning({
        state: "capacity",
        recipe: "candidate-market-v1",
        analysisIdentity: null,
        datasetPackageIdentity: null,
        normalizedInputs: null,
        error: {
          code: "ANALYSIS_CAPACITY_EXCEEDED",
          reason: "queue-timeout",
          retryAfterSeconds: 2,
        },
      }),
    });

    try {
      const response = await GET(
        new Request(exportUrl()),
        routeContext(manifest.analysisBuildId),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "ANALYSIS_CAPACITY_EXCEEDED",
          message: "Candidate Market analysis is temporarily at capacity.",
        },
      });
    } finally {
      restore();
    }
  });

  it("cancels export work at the fifteen-second route deadline", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      tradeAnalytics: rejectingOnAbortPlatform(),
    });

    try {
      let response: Response | undefined;
      const pending = GET(
        new Request(exportUrl()),
        routeContext(manifest.analysisBuildId),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(15_000);

      expect(response).toBeDefined();
      await pending;
      expect(response?.status).toBe(503);
      await expect(response?.json()).resolves.toMatchObject({
        error: { code: "REQUEST_DEADLINE_EXCEEDED" },
      });
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "missing identity",
      mutate: (url: URL) => url.searchParams.delete("freshnessStatusId"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "duplicate identity",
      mutate: (url: URL) => url.searchParams.append("exporter", "156"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "candidate-list parameter",
      mutate: (url: URL) => url.searchParams.set("candidate", "528"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "locale parameter",
      mutate: (url: URL) => url.searchParams.set("locale", "zh-Hans"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "unsupported schema",
      mutate: (url: URL) =>
        url.searchParams.set("schema", "candidate-markets-csv-v2"),
      status: 400,
      code: "UNSUPPORTED_EXPORT_SCHEMA",
    },
    {
      name: "malformed product",
      mutate: (url: URL) => url.searchParams.set("product", "10121"),
      status: 400,
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "unknown exporter",
      mutate: (url: URL) => url.searchParams.set("exporter", "999"),
      status: 404,
      code: "UNKNOWN_EXPORTER",
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
    {
      name: "incompatible active analysis build",
      build: "acceptance-fixtures-v1-quantity-zero",
      status: 409,
      code: "INCOMPATIBLE_PRODUCT_SEARCH_BUILD",
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

  it("keeps unexpected failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = "failing-fixture-build";
    const response = await GET(
      new Request(exportUrl({ analysisBuildId: build })),
      routeContext(build),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Candidate Market export could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      },
    });
    expect(
      JSON.parse(String(errorLog.mock.calls[0]?.[0])),
    ).toMatchObject({
      level: "error",
      event: "candidate-market-csv-export-request-failed",
      correlationId: body.error.correlationId,
      error: { name: "Error", message: expect.any(String) },
    });
    vi.restoreAllMocks();
  });
});

function platformReturning(
  outcome: AnalysisOutcome<"candidate-market-v1">,
): TradeAnalyticsPlatform {
  return {
    async execute() {
      return outcome;
    },
  };
}

function rejectingOnAbortPlatform(): TradeAnalyticsPlatform {
  return {
    execute(_request, options) {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      });
    },
  };
}

function exportUrl(
  overrides: Partial<{
    analysisBuildId: string;
    exporter: string;
    product: string;
    productSearchBuildId: string;
    freshnessStatusId: string;
    schema: string;
  }> = {},
): string {
  const parameters = new URLSearchParams({
    exporter: overrides.exporter ?? "156",
    product: overrides.product ?? "010121",
    productSearchBuildId:
      overrides.productSearchBuildId ?? manifest.productSearchBuildId,
    freshnessStatusId:
      overrides.freshnessStatusId ?? manifest.freshness.freshnessStatusId,
    schema: overrides.schema ?? "candidate-markets-csv-v1",
  });
  return `http://localhost/api/v1/analyses/${
    overrides.analysisBuildId ?? manifest.analysisBuildId
  }/candidate-markets.csv?${parameters}`;
}
