import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
  POST,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer/route";
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
const BASE = "http://localhost/api/v1/analyses/acceptance-fixtures-v1/trade-explorer";
const queryUrl =
  `${BASE}?shape=finalized-trend-v1&measures=TRADE_VALUE_USD&exportEconomy=156&importEconomy=528&hsProduct=010121`;

function jsonBody() {
  return {
    shape: "finalized-trend-v1",
    dimensions: ["YEAR"],
    measures: ["TRADE_VALUE_USD"],
    filters: {
      year: { mode: "list", years: [] },
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
    },
    sort: null,
  } as const;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Trade Explorer route", () => {
  it("serves the platform payload as a deterministic immutable GET and HEAD representation", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      recipe: "trade-explorer-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      ...jsonBody(),
    });
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }

    const first = await GET(new Request(queryUrl), routeContext("acceptance-fixtures-v1"));
    const firstBody = await first.text();
    const second = await GET(new Request(queryUrl), routeContext("acceptance-fixtures-v1"));

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
      new Request(queryUrl, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const head = await HEAD(
      new Request(queryUrl, { method: "HEAD" }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("serves the identical result through a structured POST body", async () => {
    const getResponse = await GET(
      new Request(queryUrl),
      routeContext("acceptance-fixtures-v1"),
    );
    const postResponse = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonBody()),
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(postResponse.status).toBe(200);
    expect(postResponse.headers.get("cache-control")).toBe("no-store");
    expect(await postResponse.text()).toBe(await getResponse.text());
  });

  it("never returns a bodyless conditional response for a POST query", async () => {
    const getResponse = await GET(
      new Request(queryUrl),
      routeContext("acceptance-fixtures-v1"),
    );
    const postResponse = await POST(
      new Request(BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-None-Match": getResponse.headers.get("etag")!,
        },
        body: JSON.stringify(jsonBody()),
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(postResponse.status).toBe(200);
    expect(postResponse.headers.get("cache-control")).toBe("no-store");
    expect(await postResponse.text()).not.toBe("");
  });

  it("serves a typed empty outcome for a non-enumerable combination", async () => {
    const response = await GET(
      new Request(
        `${BASE}?shape=finalized-trend-v1&measures=TRADE_VALUE_USD&exportEconomy=842&importEconomy=276&hsProduct=010121`,
      ),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { emptyReason: string | null; rows: unknown[] };
    expect(body.emptyReason).toBe("NO_ENUMERABLE_COHORT");
    expect(body.rows).toEqual([]);
  });

  it("rejects an unrecognized query parameter without executing the analysis", async () => {
    const response = await GET(
      new Request(`${queryUrl}&extra=1`),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_ANALYSIS_QUERY",
        message: "The Trade Explorer query is invalid.",
      },
    });
  });

  it("rejects a POST body naming an extra unrecognized field", async () => {
    const response = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...jsonBody(), sql: "DROP TABLE trades" }),
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("rejects an oversized POST representation before parsing it", async () => {
    const response = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(4 * 1024) }),
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        message: expect.stringContaining("Narrow the Trade Explorer request"),
      },
    });
  });

  it("cancels an already-aborted pending POST body instead of waiting for the deadline", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const controller = new AbortController();
    controller.abort(new Error("client disconnected"));
    const request = new Request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await Promise.race([
      POST(request, routeContext("acceptance-fixtures-v1")),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Pre-aborted body remained pending.")),
          250,
        );
      }),
    ]);

    expect(response.status).toBe(500);
    expect(cancelled).toBe(true);
  });

  it("rejects a request exceeding its cohort budget with a 413", async () => {
    const codes = Array.from({ length: 26 }, (_, index) => String(index + 1)).join(",");
    const response = await GET(
      new Request(
        `${BASE}?shape=importing-markets-v1&measures=TRADE_VALUE_USD&years=2023&exportEconomy=156&importEconomy=${codes}&hsProduct=010121`,
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_BUDGET_EXCEEDED" },
    });
  });

  it("admits a maximum-size cohort through the generic runtime input budget", async () => {
    const codes = Array.from({ length: 25 }, () => "528").join(",");
    const response = await GET(
      new Request(
        `${BASE}?shape=importing-markets-v1&measures=TRADE_VALUE_USD,RECORDED_FLOW_COUNT&years=2023&exportEconomy=156&importEconomy=${codes}&hsProduct=010121&sortKey=RECORDED_FLOW_COUNT&sortDirection=desc`,
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(200);
  });

  it("applies anonymous-source limits and low-cardinality recipe metrics to Trade Explorer", async () => {
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
    const request = new Request(queryUrl, {
      headers: { "Fly-Client-IP": "198.51.100.31" },
    });

    try {
      await expect(
        GET(request, routeContext("acceptance-fixtures-v1")),
      ).resolves.toHaveProperty("status", 200);
      const rejected = await GET(
        new Request(queryUrl, {
          headers: { "Fly-Client-IP": "198.51.100.31" },
        }),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("1");
      expect(metrics.at(-1)).toMatchObject({
        routeFamily: "trade-explorer",
        recipeVersion: "trade-explorer-v1",
        outcomeState: "rate-limit",
        rejectionReason: "SOURCE_REQUEST_LIMIT",
      });
      expect(JSON.stringify(metrics)).not.toContain("198.51.100.31");

      now = 1_000;
      await expect(
        GET(
          new Request(queryUrl, {
            headers: { "Fly-Client-IP": "198.51.100.31" },
          }),
          routeContext("acceptance-fixtures-v1"),
        ),
      ).resolves.toHaveProperty("status", 200);
    } finally {
      unsubscribe();
      restore();
    }
  });

  it("exposes only GET, HEAD, and POST -- Next.js returns 405 for every other method", async () => {
    const routeModule = await import(
      "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer/route"
    );
    expect(Object.keys(routeModule).sort()).toEqual(
      ["GET", "HEAD", "POST", "dynamic", "runtime"].sort(),
    );
  });
});
