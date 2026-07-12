import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { AnalysisCapacityExceededError } from "../../src/runtime/analysis-capacity-error";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import {
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../../src/runtime/runtime-metrics";
import { ANALYSIS_ROUTE_ERROR_CASES } from "../../test/fixtures/acceptance/v1/expected/error-cases";
import { FIXTURE_ADAPTER_TEST_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("versioned Candidate Market route", () => {
  it("serves deterministic immutable GET and HEAD representations", async () => {
    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";

    const first = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
    const firstBody = await first.text();
    const second = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(secondBody).toBe(firstBody);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(JSON.parse(firstBody)).toMatchObject({
      schemaVersion: "candidate-market-result-v1",
      cohortSize: 13,
    });

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(notModified.headers.get("cache-control")).toBe(
      first.headers.get("cache-control"),
    );

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext("acceptance-fixtures-v1"),
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
    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";
    const initial = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
    const etag = initial.headers.get("etag")!;

    const response = await GET(
      new Request(url, {
        headers: { "If-None-Match": header(etag) },
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("returns a cacheable empty representation for a valid empty query", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=851712",
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    await expect(response.json()).resolves.toMatchObject({
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      candidates: [],
    });
  });

  it("returns the exact retryable response when analysis capacity is exhausted", async () => {
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      async analyze() {
        throw new AnalysisCapacityExceededError("queue-full");
      },
    });

    try {
      const response = await GET(
        new Request(
          "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121",
        ),
        routeContext("acceptance-fixtures-v1"),
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

  it("cancels Candidate Market work at the twelve-second route deadline", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      analyze(_query, options) {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    });

    try {
      let response: Response | undefined;
      const pending = GET(
        new Request(
          "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121",
        ),
        routeContext("acceptance-fixtures-v1"),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(12_000);

      expect(response).toBeDefined();
      await pending;
      expect(response?.status).toBe(503);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      await expect(response?.json()).resolves.toEqual({
        error: {
          code: "REQUEST_DEADLINE_EXCEEDED",
          message: "The request exceeded its processing deadline.",
        },
      });
    } finally {
      restore();
    }
  });

  it("records route, cache, queue, query, serialization, and byte metrics", async () => {
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    );
    const restore = installApplicationRuntime(runtime);
    const metrics: RuntimeRequestMetric[] = [];
    const unsubscribe = subscribeRuntimeMetrics((metric) => {
      metrics.push(metric);
    });
    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";

    try {
      const first = await GET(
        new Request(url),
        routeContext("acceptance-fixtures-v1"),
      );
      const firstBody = await first.text();
      await GET(
        new Request(url),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(metrics).toEqual([
        {
          routeFamily: "candidate-market",
          status: 200,
          cacheState: "miss",
          activeAnalysisBuildId: "acceptance-fixtures-v1",
          baciRelease: "V202601",
          correlationId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          ),
          routeMs: expect.any(Number),
          queueWaitMs: expect.any(Number),
          queryMs: expect.any(Number),
          serializationMs: expect.any(Number),
          resultBytes: new TextEncoder().encode(firstBody).byteLength,
          resources: expect.objectContaining({
            analysisExecution: {
              active: 0,
              queued: 0,
              maxConcurrent: 2,
              maxQueued: 16,
            },
            caches: expect.objectContaining({
              analysis: expect.objectContaining({
                entries: 1,
                maxBytes: 96 * 1024 * 1024,
              }),
            }),
          }),
          process: {
            rssBytes: expect.any(Number),
            heapUsedBytes: expect.any(Number),
            constrainedMemoryBytes: expect.any(Number),
            availableMemoryBytes: expect.any(Number),
          },
        },
        {
          routeFamily: "candidate-market",
          status: 200,
          cacheState: "hit",
          activeAnalysisBuildId: "acceptance-fixtures-v1",
          baciRelease: "V202601",
          correlationId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          ),
          routeMs: expect.any(Number),
          queueWaitMs: null,
          queryMs: null,
          serializationMs: expect.any(Number),
          resultBytes: new TextEncoder().encode(firstBody).byteLength,
          resources: expect.objectContaining({
            analysisExecution: {
              active: 0,
              queued: 0,
              maxConcurrent: 2,
              maxQueued: 16,
            },
            caches: expect.objectContaining({
              analysis: expect.objectContaining({
                entries: 1,
                maxBytes: 96 * 1024 * 1024,
              }),
            }),
          }),
          process: {
            rssBytes: expect.any(Number),
            heapUsedBytes: expect.any(Number),
            constrainedMemoryBytes: expect.any(Number),
            availableMemoryBytes: expect.any(Number),
          },
        },
      ]);
      expect(JSON.stringify(metrics)).not.toContain("010121");
    } finally {
      unsubscribe();
      restore();
    }
  });

  it.each(ANALYSIS_ROUTE_ERROR_CASES)(
    "returns a typed no-store error for $name",
    async (fixture) => {
      const response = await GET(
        new Request(
          `http://localhost/api/v1/analyses/${fixture.build}/candidate-markets?${fixture.query}`,
        ),
        routeContext(fixture.build),
      );

      expect(response.status).toBe(fixture.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(response.json()).resolves.toMatchObject({
        error: { code: fixture.code, message: fixture.message },
      });
    },
  );

  it("returns no body for a typed HEAD error", async () => {
    const response = await HEAD(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=malformed",
        { method: "HEAD" },
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("keeps unexpected adapter failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${FIXTURE_ADAPTER_TEST_BUILD_IDS.failing}/candidate-markets?exporter=156&product=010121`,
      ),
      routeContext(FIXTURE_ADAPTER_TEST_BUILD_IDS.failing),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Candidate Market analysis could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain("fixture adapter failure");
    expect(
      JSON.parse(String(errorLog.mock.calls[0]?.[0])),
    ).toMatchObject({
      level: "error",
      event: "candidate-market-analysis-request-failed",
      correlationId: body.error.correlationId,
      error: { name: "Error", message: expect.any(String) },
    });
  });
});
