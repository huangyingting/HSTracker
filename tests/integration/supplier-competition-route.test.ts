import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/supplier-competitions/route";
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
  "http://localhost/api/v1/analyses/acceptance-fixtures-v1/supplier-competitions?importer=124&product=010121";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Supplier Competition route", () => {
  it("serves the platform payload as a deterministic immutable GET and HEAD representation", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      recipe: "supplier-competition-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "124",
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

  it("serves the empty cohort fixture with a distinct, still-immutable representation", async () => {
    const emptyUrl =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/supplier-competitions?importer=616&product=010121";
    const response = await GET(
      new Request(emptyUrl),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      cohortSize: number;
      emptyReason: string | null;
      concentration: { state: string };
    };
    expect(body.cohortSize).toBe(0);
    expect(body.emptyReason).toBe("NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW");
    expect(body.concentration).toEqual({
      state: "UNAVAILABLE",
      reason: "NO_POOLED_SUPPLIER_VALUE",
    });
  });

  it("returns the Supplier Competition's exact typed importer error", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/supplier-competitions?importer=999&product=010121",
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

  it("rejects a malformed query without executing the analysis", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/supplier-competitions?importer=124&product=010121&extra=1",
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_ANALYSIS_QUERY",
        message: "The analysis query is invalid.",
      },
    });
  });

  it("applies anonymous-source limits and low-cardinality recipe metrics to Supplier Competition", async () => {
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
      headers: { "Fly-Client-IP": "198.51.100.25" },
    });

    try {
      await expect(
        GET(request, routeContext("acceptance-fixtures-v1")),
      ).resolves.toHaveProperty("status", 200);
      const rejected = await GET(
        new Request(url, {
          headers: { "Fly-Client-IP": "198.51.100.25" },
        }),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("1");
      expect(metrics.at(-1)).toMatchObject({
        routeFamily: "supplier-competition",
        recipeVersion: "supplier-competition-v1",
        outcomeState: "rate-limit",
        rejectionReason: "SOURCE_REQUEST_LIMIT",
      });
      expect(JSON.stringify(metrics)).not.toContain("198.51.100.25");

      now = 1_000;
      await expect(
        GET(
          new Request(url, {
            headers: { "Fly-Client-IP": "198.51.100.25" },
          }),
          routeContext("acceptance-fixtures-v1"),
        ),
      ).resolves.toHaveProperty("status", 200);
    } finally {
      unsubscribe();
      restore();
    }
  });

  it("rejects unsupported methods", async () => {
    // The route module only exports GET and HEAD handlers; Next.js itself
    // returns 405 for other methods, so this asserts the module surface
    // stays limited to the immutable-read contract shared with Trade Trend.
    const routeModule = await import(
      "../../src/app/api/v1/analyses/[analysisBuildId]/supplier-competitions/route"
    );
    expect(Object.keys(routeModule).sort()).toEqual(
      ["GET", "HEAD", "dynamic", "runtime"].sort(),
    );
  });
});
