import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/trade-trends/route";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import {
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../../src/runtime/runtime-metrics";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});
const url =
  "http://localhost/api/v1/analyses/acceptance-fixtures-v1/trade-trends?importer=528&product=010121";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Trade Trend route", () => {
  it("serves the platform payload as a deterministic immutable GET and HEAD representation", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      recipe: "trade-trend-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "528",
      productCode: "010121",
    });
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }

    const first = await GET(new Request(url), routeContext("acceptance-fixtures-v1"));
    const firstBody = await first.text();
    const second = await GET(new Request(url), routeContext("acceptance-fixtures-v1"));

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(firstBody).toBe(
      JSON.stringify({
        ...outcome.payload,
        analysisIdentity: outcome.analysisIdentity,
        datasetPackageIdentity: outcome.datasetPackageIdentity,
      }),
    );
    expect(await second.text()).toBe(firstBody);

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("returns the Trade Trend's exact typed importer error", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/trade-trends?importer=999&product=010121",
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNKNOWN_IMPORTER",
        message: "The requested importing economy is not available.",
      },
    });
  });

  it("applies anonymous-source limits and low-cardinality recipe metrics to Trade Trend", async () => {
    let now = 0;
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
    const metrics: RuntimeRequestMetric[] = [];
    const unsubscribe = subscribeRuntimeMetrics((metric) => metrics.push(metric));
    const request = new Request(url, {
      headers: { "Fly-Client-IP": "198.51.100.24" },
    });

    try {
      await expect(
        GET(request, routeContext("acceptance-fixtures-v1")),
      ).resolves.toHaveProperty("status", 200);
      const rejected = await GET(
        new Request(url, {
          headers: { "Fly-Client-IP": "198.51.100.24" },
        }),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("1");
      expect(metrics.at(-1)).toMatchObject({
        routeFamily: "trade-trend",
        recipeVersion: "trade-trend-v1",
        outcomeState: "rate-limit",
        rejectionReason: "SOURCE_REQUEST_LIMIT",
      });
      expect(JSON.stringify(metrics)).not.toContain("198.51.100.24");

      now = 1_000;
      await expect(
        GET(
          new Request(url, {
            headers: { "Fly-Client-IP": "198.51.100.24" },
          }),
          routeContext("acceptance-fixtures-v1"),
        ),
      ).resolves.toHaveProperty("status", 200);
    } finally {
      unsubscribe();
      restore();
    }
  });
});
