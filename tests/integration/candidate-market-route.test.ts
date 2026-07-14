import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import {
  type AnalysisRequest,
  type AnalysisOutcome,
  type TradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import {
  RUNTIME_PROBE_CACHE_PARTITION_HEADER,
  RUNTIME_PROBE_CACHE_STATE_HEADER,
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../../src/runtime/runtime-metrics";
import { ANALYSIS_ROUTE_ERROR_CASES } from "../../fixtures/acceptance/v1/expected/error-cases";
import { FIXTURE_ADAPTER_TEST_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";

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
    const fixture = createFixtureApplicationRuntime();
    const platformOutcome = await fixture.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });
    if (platformOutcome.state !== "success") {
      throw new TypeError("Expected the fixture platform oracle to succeed.");
    }

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
    expect(firstBody).toBe(JSON.stringify(platformOutcome.payload));
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
      tradeAnalytics: platformReturning(unresolvedOutcome({
        state: "capacity",
        error: {
          code: "ANALYSIS_CAPACITY_EXCEEDED",
          reason: "queue-full",
          retryAfterSeconds: 2,
        },
      }),
      ),
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

  it("rate limits each anonymous HTTP request without exposing its source in metrics", async () => {
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
    const unsubscribe = subscribeRuntimeMetrics((metric) => {
      metrics.push(metric);
    });
    const request = (address: string) =>
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121",
        {
          headers: {
            "Fly-Client-IP": address,
            "X-Forwarded-For": "203.0.113.99",
          },
        },
      );

    try {
      await expect(
        GET(request("198.51.100.24"), routeContext("acceptance-fixtures-v1")),
      ).resolves.toHaveProperty("status", 200);
      const rejected = await GET(
        request("198.51.100.24"),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("1");
      await expect(rejected.json()).resolves.toMatchObject({
        error: { code: "ANALYSIS_RATE_LIMITED" },
      });
      expect(metrics.at(-1)).toMatchObject({
        recipeVersion: "candidate-market-v1",
        outcomeState: "rate-limit",
        rejectionReason: "SOURCE_REQUEST_LIMIT",
      });
      expect(JSON.stringify(metrics)).not.toContain("198.51.100.24");
      expect(JSON.stringify(metrics)).not.toContain("203.0.113.99");

      await expect(
        GET(
          request("198.51.100.25"),
          routeContext("acceptance-fixtures-v1"),
        ),
      ).resolves.toHaveProperty("status", 200);

      now = 1_000;
      await expect(
        GET(
          request("198.51.100.24"),
          routeContext("acceptance-fixtures-v1"),
        ),
      ).resolves.toHaveProperty("status", 200);
    } finally {
      unsubscribe();
      restore();
    }
  });

  it.each([
    {
      name: "an incompatible Dataset Package",
      outcome: unresolvedOutcome({
        state: "incompatible-package",
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: "MISSING_REQUIRED_CAPABILITY",
        },
      }),
      status: 503,
      code: "ANALYSIS_UNAVAILABLE",
      retryAfter: null,
    },
    {
      name: "an exceeded execution budget",
      outcome: unresolvedOutcome({
        state: "budget",
        error: {
          code: "ANALYSIS_BUDGET_EXCEEDED",
          budget: "EXECUTION_DEADLINE",
        },
      }),
      status: 413,
      code: "ANALYSIS_BUDGET_EXCEEDED",
      retryAfter: null,
    },
    {
      name: "a platform rate limit",
      outcome: unresolvedOutcome({
        state: "rate-limit",
        error: {
          code: "ANALYSIS_RATE_LIMITED",
          retryAfterSeconds: 7,
        },
      }),
      status: 429,
      code: "ANALYSIS_RATE_LIMITED",
      retryAfter: "7",
    },
    {
      name: "temporary platform unavailability",
      outcome: unresolvedOutcome({
        state: "temporary-unavailability",
        error: { code: "ANALYSIS_UNAVAILABLE" },
      }),
      status: 503,
      code: "ANALYSIS_UNAVAILABLE",
      retryAfter: null,
    },
  ])(
    "preserves the public v1 error contract for $name",
    async ({ outcome, status, code, retryAfter }) => {
      const fixture = createFixtureApplicationRuntime();
      const restore = installApplicationRuntime({
        ...fixture,
        tradeAnalytics: platformReturning(outcome),
      });

      try {
        const response = await GET(
          new Request(
            "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121",
          ),
          routeContext("acceptance-fixtures-v1"),
        );

        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("retry-after")).toBe(retryAfter);
        await expect(response.json()).resolves.toMatchObject({
          error: { code },
        });
      } finally {
        restore();
      }
    },
  );

  it("cancels Candidate Market work at the twelve-second route deadline", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      tradeAnalytics: rejectingOnAbortPlatform(),
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

  type AdapterFailureOutcome = Extract<
    AnalysisOutcome<"candidate-market-v1">,
    {
      state:
        | "incompatible-package"
        | "budget"
        | "rate-limit"
        | "capacity"
        | "temporary-unavailability";
    }
  >;
  type AdapterFailureInput =
    AdapterFailureOutcome extends infer Failure
      ? Failure extends AdapterFailureOutcome
        ? Pick<Failure, "state" | "error">
        : never
      : never;
  type UnresolvedOutcomeMetadata = Readonly<{
    recipe: "candidate-market-v1";
    analysisIdentity: null;
    datasetPackageIdentity: null;
    normalizedInputs: null;
  }>;

  function unresolvedOutcome<Outcome extends AdapterFailureInput>(
    outcome: Outcome,
  ): Outcome & UnresolvedOutcomeMetadata {
    return {
      recipe: "candidate-market-v1",
      analysisIdentity: null,
      datasetPackageIdentity: null,
      normalizedInputs: null,
      ...outcome,
    };
  }

  function platformReturning(
    outcome: AnalysisOutcome<"candidate-market-v1">,
  ): TradeAnalyticsPlatform {
    return {
      async execute<Request extends AnalysisRequest>(_request: Request) {
        void _request;
        return outcome as AnalysisOutcome<Request["recipe"]>;
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
        new Request(url, {
          headers: { "X-HS-Tracker-Probe": "external-v1" },
        }),
        routeContext("acceptance-fixtures-v1"),
      );
      const firstBody = await first.text();
      const second = await GET(
        new Request(url, {
          headers: { "X-HS-Tracker-Probe": "external-v1" },
        }),
        routeContext("acceptance-fixtures-v1"),
      );
      expect(first.headers.get(RUNTIME_PROBE_CACHE_STATE_HEADER)).toBe("miss");
      expect(second.headers.get(RUNTIME_PROBE_CACHE_STATE_HEADER)).toBe("hit");

      expect(metrics).toEqual([
        {
          routeFamily: "candidate-market",
          method: "GET",
          synthetic: true,
          status: 200,
          cacheState: "miss",
          recipeVersion: "candidate-market-v1",
          outcomeState: "success",
          rejectionReason: "none",
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
          method: "GET",
          synthetic: true,
          status: 200,
          cacheState: "hit",
          recipeVersion: "candidate-market-v1",
          outcomeState: "success",
          rejectionReason: "none",
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

  it("measures the attested query through distinct probe cache partitions", async () => {
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    );
    const restore = installApplicationRuntime(runtime);
    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";
    const request = (partition: string) =>
      new Request(url, {
        headers: {
          "X-HS-Tracker-Probe": "external-v1",
          [RUNTIME_PROBE_CACHE_PARTITION_HEADER]: partition,
        },
      });

    try {
      const first = await GET(
        request("candidate-analysis:median:0"),
        routeContext("acceptance-fixtures-v1"),
      );
      const second = await GET(
        request("candidate-analysis:median:1"),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(first.headers.get(RUNTIME_PROBE_CACHE_STATE_HEADER)).toBe(
        "miss",
      );
      expect(second.headers.get(RUNTIME_PROBE_CACHE_STATE_HEADER)).toBe(
        "miss",
      );
      await expect(first.json()).resolves.toEqual(await second.json());
    } finally {
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
