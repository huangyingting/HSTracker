import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  RUNTIME_PROBE_CACHE_PARTITION_HEADER,
  RUNTIME_PROBE_CACHE_STATE_HEADER,
} from "../../src/runtime/runtime-metrics";
import {
  HttpPerformanceRunnerError,
  createPrometheusMixedLoadObservationAdapter,
  parseOriginBenchmarkPlan,
  resolveRequestUrl,
  deterministicGzipBytes,
  runOriginBenchmark,
  parseMixedLoadPlan,
  buildMixedLoadSchedule,
  runMixedLoad,
  type HttpBenchmarkExecutor,
  type HttpBenchmarkOutcome,
  type HttpBenchmarkRequest,
  type MixedLoadRunnerDependencies,
} from "../../src/promotion/http-performance-runner";
import type { RuntimeIdentityAttestor } from "../../src/promotion/runtime-identity-attestation";

function originRunnerDependencies() {
  return {
    now: () => 0,
    attestIdentity: fakeIdentityAttestor,
  } as const;
}

describe("origin-benchmark plan parsing", () => {
  it("accepts a complete candidate plan naming every required operation", () => {
    const plan = parseOriginBenchmarkPlan(acceptedPlanInput());

    expect(plan.measurementClass).toBe("candidate");
    expect(plan.origin).toBe("https://staging.example.com");
    expect(plan.requests).toHaveLength(91);
    expect(plan.warmupSamples).toBe(5);
  });

  it("rejects an http origin for candidate evidence", () => {
    const input = acceptedPlanInput();
    input.origin = "http://staging.example.com";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      HttpPerformanceRunnerError,
    );
  });

  it("rejects credentials embedded in the origin", () => {
    const input = acceptedPlanInput();
    input.origin = "https://user:pass@staging.example.com";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      /credentials/,
    );
  });

  it("permits a loopback http origin for local-smoke evidence only", () => {
    const input = acceptedPlanInput();
    input.measurementClass = "local-smoke";
    input.origin = "http://127.0.0.1:4000";

    const plan = parseOriginBenchmarkPlan(input);

    expect(plan.origin).toBe("http://127.0.0.1:4000");
  });

  it("rejects a non-loopback http origin for local-smoke evidence", () => {
    const input = acceptedPlanInput();
    input.measurementClass = "local-smoke";
    input.origin = "http://example.com";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      /loopback/,
    );
  });

  it("rejects a cross-origin request path", () => {
    const input = acceptedPlanInput();
    input.requests[0].request.path = "//evil.example.com/steal";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      HttpPerformanceRunnerError,
    );
  });

  it("rejects a request path embedding a protocol", () => {
    const input = acceptedPlanInput();
    input.requests[0].request.path = "https://evil.example.com/steal";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      HttpPerformanceRunnerError,
    );
  });

  it("fails closed when a required operation/product-role is missing", () => {
    const input = acceptedPlanInput();
    input.requests = input.requests.filter(
      (request: { operation: string; productRole?: string }) =>
        !(
          request.operation === "candidate-analysis-uncached" &&
          request.productRole === "maximum-row"
        ),
    );

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      "Missing origin-benchmark request candidate-analysis-uncached:maximum-row.",
    );
  });

  it("rejects a duplicate operation/product-role entry", () => {
    const input = acceptedPlanInput();
    input.requests.push({ ...input.requests[0] });

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(/Duplicate/);
  });

  it("rejects a singleton operation that names a product role", () => {
    const input = acceptedPlanInput();
    input.requests[0].productRole = "median";

    expect(() => parseOriginBenchmarkPlan(input)).toThrowError(
      /must not name a product role/,
    );
  });

  it("rejects reused uncached semantic keys or HTTP request targets", () => {
    const duplicateSemanticKey = acceptedPlanInput();
    const request = duplicateSemanticKey.requests.find(
      (entry) => entry.operation === "candidate-analysis-uncached",
    );
    if (request?.sampleRequests === undefined) {
      throw new Error("Expected candidate-analysis uncached samples.");
    }
    request.sampleRequests[1].semanticKey =
      request.sampleRequests[0].semanticKey;
    expect(() => parseOriginBenchmarkPlan(duplicateSemanticKey)).toThrow(
      /must not reuse semantic key/u,
    );

    const duplicateTarget = acceptedPlanInput();
    const targetRequest = duplicateTarget.requests.find(
      (entry) => entry.operation === "product-search-uncached",
    );
    if (targetRequest?.sampleRequests === undefined) {
      throw new Error("Expected product-search uncached samples.");
    }
    targetRequest.sampleRequests[1].request =
      targetRequest.sampleRequests[0].request;
    expect(() => parseOriginBenchmarkPlan(duplicateTarget)).toThrow(
      /must not repeat an HTTP request target/u,
    );
  });
});

describe("resolveRequestUrl", () => {
  it("resolves a relative path against the plan origin", () => {
    const url = resolveRequestUrl(
      "https://staging.example.com",
      "/api/v1/analyses/current",
    );

    expect(url.href).toBe(
      "https://staging.example.com/api/v1/analyses/current",
    );
  });
});

describe("deterministicGzipBytes", () => {
  it("returns the same byte count for the same content on every call", () => {
    const body = Buffer.from("x".repeat(10_000));

    expect(deterministicGzipBytes(body)).toBe(deterministicGzipBytes(body));
    expect(deterministicGzipBytes(body)).toBeGreaterThan(0);
    expect(deterministicGzipBytes(body)).toBeLessThan(body.byteLength);
  });
});

describe("runOriginBenchmark", () => {
  it("runs exactly 5 warmups plus the configured timed count per route and summarizes them", () => {
    const plan = parseOriginBenchmarkPlan(acceptedPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeExecutor(calls, () => ({
      timedOut: false,
      status: 200,
      ttfbMs: 10,
      totalMs: 20,
      body: Buffer.from("ok"),
      header: () => "release-42",
    }));

    return runOriginBenchmark(plan, executor, originRunnerDependencies()).then(
      (report) => {
        // 1 health check + 91 routes * (5 warmups + timedSamples).
        const perRoute = 5 + plan.timedSamples;
        expect(calls.length).toBe(1 + 91 * perRoute);
        expect(report.originBenchmarks).toHaveLength(91);
        expect(report.status).toBe("measurement-complete");
        expect(report.meetsAcceptanceEvidenceSampleSize).toBe(true);
        expect(report.firstFailure).toBeNull();
        const health = report.originBenchmarks.find(
          (entry) => entry.operation === "health",
        );
        expect(health).toMatchObject({
          warmupSamples: 5,
          timedSamples: plan.timedSamples,
          errors: 0,
          timeouts: 0,
        });
      },
    );
  });

  it("uses fetch-to-headers time for csv-analysis-hit and full duration otherwise", () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({ timedSamples: 100 }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeExecutor(calls, (request) => ({
      timedOut: false,
      status: 200,
      ttfbMs: 5,
      totalMs: request.url.pathname.includes("csv-analysis-hit") ? 400 : 40,
      body: Buffer.from("payload"),
      header: () => "release-42",
    }));

    return runOriginBenchmark(plan, executor, originRunnerDependencies()).then(
      (report) => {
        const csvHit = requireBenchmark(report, "csv-analysis-hit", "median");
        const tradeExplorerCsvHit = requireBenchmark(
          report,
          "trade-explorer-csv-analysis-hit",
          "median",
        );
        const csvUncached = requireBenchmark(report, "csv-uncached", "median");
        expect(csvHit.p50Ms).toBe(5);
        expect(csvHit.maximumRouteMs).toBe(400);
        expect(tradeExplorerCsvHit.p50Ms).toBe(5);
        expect(tradeExplorerCsvHit.maximumRouteMs).toBe(400);
        expect(csvUncached.p50Ms).toBe(40);
      },
    );
  });

  it("never retries a failed sample and preserves it in the first-failure detail", () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({ timedSamples: 100 }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    let healthSeen = false;
    const executor = fakeExecutor(calls, (request) => {
      if (!healthSeen) {
        healthSeen = true;
        return {
          timedOut: false,
          status: 200,
          ttfbMs: 1,
          totalMs: 1,
          body: Buffer.from("ok"),
          header: () => "release-42",
        };
      }
      const isFirstHtmlShellTimedSample =
        request.url.pathname === "/" && calls.length === 1 + 5 + 1;
      return {
        timedOut: false,
        status: isFirstHtmlShellTimedSample ? 500 : 200,
        ttfbMs: 5,
        totalMs: 10,
        body: Buffer.from("ok"),
        header: () => "release-42",
      };
    });

    return runOriginBenchmark(plan, executor, originRunnerDependencies()).then(
      (report) => {
        expect(report.firstFailure).toEqual({
          operation: "html-shell",
          productRole: null,
          sampleIndex: 0,
          status: 500,
          timedOut: false,
          elapsedMs: 10,
        });
        const htmlShell = requireBenchmark(report, "html-shell", undefined);
        expect(htmlShell.errors).toBe(1);
        expect(htmlShell.timedSamples).toBe(100);
      },
    );
  });

  it("records timeouts without letting them disappear from the summary", () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({ timedSamples: 100 }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    let healthSeen = false;
    const executor = fakeExecutor(calls, () => {
      if (!healthSeen) {
        healthSeen = true;
        return {
          timedOut: false,
          status: 200,
          ttfbMs: 1,
          totalMs: 1,
          body: Buffer.from("ok"),
          header: () => "release-42",
        };
      }
      const isFirstHtmlShellTimedSample = calls.length === 1 + 5 + 1;
      if (isFirstHtmlShellTimedSample) {
        return { timedOut: true, elapsedMs: 2_000 };
      }
      return {
        timedOut: false,
        status: 200,
        ttfbMs: 5,
        totalMs: 10,
        body: Buffer.from("ok"),
        header: () => "release-42",
      };
    });

    return runOriginBenchmark(plan, executor, originRunnerDependencies()).then(
      (report) => {
        const htmlShell = requireBenchmark(report, "html-shell", undefined);
        expect(htmlShell.timeouts).toBe(1);
        expect(htmlShell.maximumRouteMs).toBe(2_000);
        expect(report.firstFailure?.timedOut).toBe(true);
      },
    );
  });

  it("fails closed before benchmarking when the health check fails", () => {
    const plan = parseOriginBenchmarkPlan(acceptedPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeExecutor(calls, () => ({
      timedOut: false,
      status: 503,
      ttfbMs: 1,
      totalMs: 1,
      body: Buffer.from(""),
      header: () => null,
    }));

    return expect(
      runOriginBenchmark(plan, executor, originRunnerDependencies()),
    ).rejects.toThrowError(HttpPerformanceRunnerError);
  });

  it("does not send a benchmark request when deployment identity attestation fails", async () => {
    const plan = parseOriginBenchmarkPlan(acceptedPlanInput());
    const calls: HttpBenchmarkRequest[] = [];

    await expect(
      runOriginBenchmark(plan, fakeExecutor(calls, () => {
        throw new Error("must not execute");
      }), {
        now: () => 0,
        attestIdentity: async () => {
          throw new Error("attested build mismatch");
        },
      }),
    ).rejects.toThrow("attested build mismatch");
    expect(calls).toHaveLength(0);
  });

  it("rejects an executed uncached sample that differs from the attested query", async () => {
    const input = acceptedPlanInput({ timedSamples: 1 });
    const requestCase = input.requests.find(
      (request) =>
        request.operation === "candidate-analysis-uncached" &&
        request.productRole === "maximum-row",
    );
    if (requestCase?.sampleRequests === undefined) {
      throw new Error("Expected maximum-row uncached samples.");
    }
    requestCase.sampleRequests[0].request.path =
      "/api/v1/candidate-analysis-uncached/maximum-row?exporter=156&product=000001";
    const plan = parseOriginBenchmarkPlan(input);
    const calls: HttpBenchmarkRequest[] = [];

    await expect(
      runOriginBenchmark(
        plan,
        fakeExecutor(calls, () => {
          throw new Error("must not execute");
        }),
        originRunnerDependencies(),
      ),
    ).rejects.toThrow(
      "candidate-analysis-uncached:maximum-row sample",
    );
    expect(calls).toHaveLength(0);
  });

  it("binds Trade Explorer samples to the artifact-attested role query", async () => {
    const input = acceptedPlanInput({ timedSamples: 1 });
    const requestCase = input.requests.find(
      (request) =>
        request.operation === "trade-explorer-analysis-uncached" &&
        request.productRole === "maximum-row",
    );
    if (requestCase?.sampleRequests === undefined) {
      throw new Error("Expected maximum-row Trade Explorer samples.");
    }
    requestCase.sampleRequests[0].request.path =
      "/api/v1/analyses/test/trade-explorer?shape=importing-markets-v1&measures=TRADE_VALUE_USD&years=2023&exportEconomy=156&hsProduct=000001";
    const plan = parseOriginBenchmarkPlan(input);
    const calls: HttpBenchmarkRequest[] = [];

    await expect(
      runOriginBenchmark(
        plan,
        fakeExecutor(calls, () => {
          throw new Error("must not execute");
        }),
        originRunnerDependencies(),
      ),
    ).rejects.toThrow(
      "trade-explorer-analysis-uncached:maximum-row sample",
    );
    expect(calls).toHaveLength(0);
  });

  it("accepts Trade Explorer CSV requests that carry the export envelope the CSV route requires", async () => {
    const input = acceptedPlanInput({ timedSamples: 1 });
    const envelope = "&freshnessStatusId=fresh-1&schema=trade-explorers-csv-v1";
    for (const request of input.requests) {
      if (
        typeof request.operation === "string" &&
        request.operation.startsWith("trade-explorer-csv")
      ) {
        request.request.path += envelope;
        for (const sample of request.sampleRequests ?? []) {
          sample.request.path += envelope;
        }
      }
    }
    const plan = parseOriginBenchmarkPlan(input);
    const report = await runOriginBenchmark(
      plan,
      fakeExecutor([], () => ({
        timedOut: false,
        status: 200,
        ttfbMs: 1,
        totalMs: 1,
        body: Buffer.from("ok"),
        header: () => "release-42",
      })),
      originRunnerDependencies(),
    );

    const csvUncached = report.originBenchmarks.find(
      (benchmark) =>
        benchmark.operation === "trade-explorer-csv-uncached" &&
        benchmark.productRole === "maximum-row",
    );
    expect(csvUncached).toBeDefined();
  });

  it("uses a never-repeated request target for every uncached warmup and timed sample", async () => {
    const plan = parseOriginBenchmarkPlan(acceptedPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    await runOriginBenchmark(
      plan,
      fakeExecutor(calls, () => ({
        timedOut: false,
        status: 200,
        ttfbMs: 1,
        totalMs: 1,
        body: Buffer.from("ok"),
        header: () => "release-42",
      })),
      originRunnerDependencies(),
    );

    const uncachedCandidateCalls = calls.filter((request) =>
      request.url.pathname.includes("/candidate-analysis-uncached/median"),
    );
    expect(uncachedCandidateCalls).toHaveLength(105);
    expect(
      new Set(
        uncachedCandidateCalls.map(
          (request) =>
            `${request.url.href}:${request.headers[RUNTIME_PROBE_CACHE_PARTITION_HEADER]}`,
        ),
      ).size,
    ).toBe(105);
  });

  it("fails closed when a response does not retain the expected build identity", () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({
        identityAssertion: {
          headerName: "x-build-id",
          expectedValue: "build-30",
        },
      }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    let healthSeen = false;
    const executor = fakeExecutor(calls, () => {
      if (!healthSeen) {
        healthSeen = true;
        return {
          timedOut: false,
          status: 200,
          ttfbMs: 1,
          totalMs: 1,
          body: Buffer.from("ok"),
          header: (name: string) =>
            name === "x-build-id" ? "build-30" : null,
        };
      }
      return {
        timedOut: false,
        status: 200,
        ttfbMs: 1,
        totalMs: 1,
        body: Buffer.from("ok"),
        header: (name: string) =>
          name === "x-build-id" ? "build-wrong" : null,
      };
    });

    return expect(
      runOriginBenchmark(plan, executor, originRunnerDependencies()),
    ).rejects.toThrowError(/build\/release identity/);
  });

  it("records a deterministic compressed byte count for the largest observed body", () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({ timedSamples: 100 }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    let counter = 0;
    const executor = fakeExecutor(calls, () => {
      counter += 1;
      return {
        timedOut: false,
        status: 200,
        ttfbMs: 1,
        totalMs: 1,
        body: Buffer.from("x".repeat((counter % 5) * 100 + 10)),
        header: () => "release-42",
      };
    });

    return runOriginBenchmark(plan, executor, originRunnerDependencies()).then(
      (report) => {
        const health = requireBenchmark(report, "health", undefined);
        expect(health.compressedPayloadBytes).toBe(
          deterministicGzipBytes(Buffer.from("x".repeat(410))),
        );
      },
    );
  });

  it("retains a cache-state mismatch and blocks that benchmark", async () => {
    const plan = parseOriginBenchmarkPlan(
      acceptedPlanInput({ timedSamples: 1 }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    const report = await runOriginBenchmark(
      plan,
      fakeExecutor(
        calls,
        () => ({
          timedOut: false,
          status: 200,
          ttfbMs: 1,
          totalMs: 1,
          body: Buffer.from("ok"),
          header: () => "release-42",
        }),
        {
          cacheState(request) {
            return request.url.pathname.includes(
              "/candidate-analysis-uncached/median",
            )
              ? "hit"
              : fakeOriginCacheState(request);
          },
        },
      ),
      originRunnerDependencies(),
    );

    expect(
      requireBenchmark(report, "candidate-analysis-uncached", "median")
        .cacheStatesVerified,
    ).toBe(false);
    expect(report.cacheViolations).toHaveLength(6);
    expect(report.cacheViolations[0]).toMatchObject({
      operation: "candidate-analysis-uncached",
      productRole: "median",
      phase: "warmup",
      sampleIndex: 0,
      expected: "miss",
      actual: "hit",
    });
  });
});

function fakeExecutor(
  calls: HttpBenchmarkRequest[],
  respond: (request: HttpBenchmarkRequest) => HttpBenchmarkOutcome,
  options: {
    cacheState?: (request: HttpBenchmarkRequest) => string | null;
  } = {},
): HttpBenchmarkExecutor {
  return {
    async execute(request) {
      calls.push(request);
      const outcome = respond(request);
      if (outcome.timedOut) {
        return outcome;
      }
      return {
        ...outcome,
        header(name) {
          if (
            name.toLowerCase() ===
            RUNTIME_PROBE_CACHE_STATE_HEADER.toLowerCase()
          ) {
            return (
              options.cacheState?.(request) ??
              fakeOriginCacheState(request)
            );
          }
          return outcome.header(name);
        },
      };
    },
  };
}

function fakeOriginCacheState(request: HttpBenchmarkRequest): string | null {
  if (
    request.headers?.[RUNTIME_PROBE_CACHE_PARTITION_HEADER] !== undefined
  ) {
    return "miss";
  }
  if (request.url.pathname.includes("-uncached/")) {
    return "miss";
  }
  if (
    request.url.pathname.includes("-process-hit/") ||
    request.url.pathname.includes("-analysis-hit/")
  ) {
    return "hit";
  }
  return null;
}

type OriginBenchmarkReportForTest = {
  originBenchmarks: readonly {
    operation: string;
    productRole?: string;
    warmupSamples: number;
    timedSamples: number;
    p50Ms: number;
    p75Ms: number;
    p95Ms: number;
    p99Ms: number;
    maximumRouteMs: number;
    cacheStatesVerified: boolean;
    errors: number;
    timeouts: number;
    payloadBytes: number;
    compressedPayloadBytes?: number;
  }[];
};

function requireBenchmark(
  report: OriginBenchmarkReportForTest,
  operation: string,
  productRole: string | undefined,
) {
  const match = report.originBenchmarks.find(
    (entry) =>
      entry.operation === operation && entry.productRole === productRole,
  );
  if (match === undefined) {
    throw new Error(
      `Expected a ${operation}:${productRole ?? "all"} benchmark.`,
    );
  }
  return match;
}

type TestRequestCase = {
  operation: string;
  productRole?: string;
  request: { method: string; path: string; headers?: Record<string, string> };
  sampleRequests?: Array<{
    semanticKey: string;
    request: { method: string; path: string; headers?: Record<string, string> };
  }>;
  timeoutMs?: number;
};

type TestPlanInput = {
  schemaVersion: string;
  measurementClass: string;
  identity: Record<string, unknown>;
  origin: string;
  healthCheck: { method: string; path: string };
  identityAssertion?: { headerName: string; expectedValue: string };
  warmupSamples: number;
  timedSamples: number;
  requests: TestRequestCase[];
};

function acceptedPlanInput(
  overrides: {
    timedSamples?: number;
    identityAssertion?: { headerName: string; expectedValue: string };
  } = {},
): TestPlanInput {
  const timedSamples = overrides.timedSamples ?? 100;
  const singletons: TestRequestCase[] = [
    { operation: "html-shell", request: { method: "GET", path: "/" } },
    {
      operation: "current-manifest",
      request: { method: "GET", path: "/api/v1/analyses/current" },
    },
    { operation: "health", request: { method: "GET", path: "/healthz" } },
  ];
  const productOperations = [
    "economy-search-uncached",
    "economy-search-process-hit",
    "product-search-uncached",
    "product-search-process-hit",
    "candidate-analysis-uncached",
    "candidate-analysis-process-hit",
    "csv-uncached",
    "csv-analysis-hit",
    "trade-trend-analysis-uncached",
    "trade-trend-analysis-process-hit",
    "trade-trend-csv-uncached",
    "trade-trend-csv-analysis-hit",
    "supplier-competition-analysis-uncached",
    "supplier-competition-analysis-process-hit",
    "supplier-competition-csv-uncached",
    "supplier-competition-csv-analysis-hit",
    "recent-trade-momentum-uncached",
    "opportunity-feed-uncached",
    "trade-explorer-analysis-uncached",
    "trade-explorer-analysis-process-hit",
    "trade-explorer-csv-uncached",
    "trade-explorer-csv-analysis-hit",
  ];
  const uncachedOperations = new Set([
    "economy-search-uncached",
    "product-search-uncached",
    "candidate-analysis-uncached",
    "csv-uncached",
    "trade-trend-analysis-uncached",
    "trade-trend-csv-uncached",
    "supplier-competition-analysis-uncached",
    "supplier-competition-csv-uncached",
    "recent-trade-momentum-uncached",
    "opportunity-feed-uncached",
    "trade-explorer-analysis-uncached",
    "trade-explorer-csv-uncached",
  ]);
  const roles = [
    "sparse",
    "median",
    "upper-quartile",
    "maximum-row",
  ];
  const roleProductCodes: Record<string, string> = {
    sparse: "010121",
    median: "851712",
    "upper-quartile": "010121",
    "maximum-row": "851712",
  };

  const requests: TestRequestCase[] = [
    ...singletons,
    ...productOperations.flatMap((operation) =>
      roles.map((role) => {
        const attestedRequest = {
          method: "GET",
          path:
            operation === "opportunity-feed-uncached"
              ? "/api/v1/analyses/analysis-build-v1-620a5047a1a306ca/opportunities?exporter=156&limit=50"
              : operation === "recent-trade-momentum-uncached"
              ? `/api/v1/analyses/analysis-build-v1-620a5047a1a306ca/recent-trade-momentum?reporter=NL&product=${roleProductCodes[role]}`
              : operation.startsWith("trade-explorer")
              ? `/api/v1/${operation}/${role}?shape=finalized-trend-v1&measures=TRADE_VALUE_USD%2CRECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct=${roleProductCodes[role]}`
              : operation.startsWith("candidate-analysis") ||
                  operation.startsWith("csv-")
              ? `/api/v1/${operation}/${role}?exporter=156&product=${roleProductCodes[role]}`
              : `/api/v1/${operation}/${role}`,
        };
        const attestedUncachedOperation =
          operation === "candidate-analysis-uncached" ||
          operation === "csv-uncached" ||
          operation === "recent-trade-momentum-uncached" ||
          operation === "opportunity-feed-uncached" ||
          operation === "trade-explorer-analysis-uncached" ||
          operation === "trade-explorer-csv-uncached";
        return {
          operation,
          productRole: role,
          request: attestedRequest,
          ...(uncachedOperations.has(operation)
            ? {
                sampleRequests: Array.from(
                  { length: 5 + timedSamples },
                  (_, index) => {
                    const semanticKey = `${operation}:${role}:${index}`;
                    return {
                      semanticKey,
                      request: {
                        method: "GET",
                        path: attestedUncachedOperation
                          ? attestedRequest.path
                          : `/api/v1/${operation}/${role}?sample=${index}`,
                        ...(attestedUncachedOperation
                          ? {
                              headers: {
                                [RUNTIME_PROBE_CACHE_PARTITION_HEADER]:
                                  semanticKey,
                              },
                            }
                          : {}),
                      },
                    };
                  },
                ),
              }
            : {}),
        };
      }),
    ),
  ];

  return {
    schemaVersion: "origin-benchmark-plan-v1",
    measurementClass: "candidate",
    identity: {
      fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
      buildId: "build-30",
      baciRelease: "V202601",
      analysisBuildId: "analysis-build-v1-620a5047a1a306ca",
      productSearchBuildId: "product-search-v1-aa1f4027019c194b",
      artifactSha256: "b".repeat(64),
      machineId: "machine-01J00000000000000000000000",
      machineClass: "shared-cpu-2x",
      region: "sin",
    },
    origin: "https://staging.example.com",
    healthCheck: { method: "GET", path: "/healthz" },
    identityAssertion: overrides.identityAssertion,
    warmupSamples: 5,
    timedSamples,
    requests,
  };
}

const MIXED_LOAD_IDENTITY = {
  fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
  buildId: "build-30",
  baciRelease: "V202601",
  analysisBuildId: "analysis-build-v1-620a5047a1a306ca",
  productSearchBuildId: "product-search-v1-aa1f4027019c194b",
  artifactSha256: "b".repeat(64),
  machineId: "machine-01J00000000000000000000000",
  machineClass: "shared-cpu-2x",
  region: "sin",
};

const MIXED_LOAD_HOT_KEYS = ["hot-a", "hot-b", "hot-c", "hot-d", "hot-e"];
const MIXED_LOAD_DISTINCT_KEYS = [
  "max-row-key",
  ...Array.from({ length: 339 }, (_, index) => `dk-${index + 1}`),
];
const CANDIDATE_MIXED_LOAD_HOT_KEYS = Array.from(
  { length: 5 },
  (_, index) => String(800001 + index),
);
const CANDIDATE_MIXED_LOAD_DISTINCT_KEYS = [
  "851712",
  ...Array.from({ length: 339 }, (_, index) => String(900001 + index)),
];

type MixedLoadPlanOverrides = {
  measurementClass?: string;
  origin?: string;
  sustainedRequestsPerSecond?: number;
  sustainedSeconds?: number;
  burstRequestsPerSecond?: number;
  burstSeconds?: number;
  coordinatedBurstIntervalSeconds?: number;
  analysisHotKeys?: string[];
  analysisDistinctKeys?: string[];
  maximumRowAnalysisKey?: string;
  observations?: Record<string, unknown>;
  identityAssertion?: { headerName: string; expectedValue: string };
};

function acceptedMixedLoadPlanInput(overrides: MixedLoadPlanOverrides = {}) {
  const measurementClass = overrides.measurementClass ?? "local-smoke";
  const candidate = measurementClass === "candidate";
  const includeObservations =
    measurementClass !== "candidate" ||
    Object.prototype.hasOwnProperty.call(overrides, "observations");
  return {
    schemaVersion: "mixed-load-plan-v1",
    measurementClass,
    identity: MIXED_LOAD_IDENTITY,
    origin: overrides.origin ?? "http://127.0.0.1:4000",
    healthCheck: { method: "GET", path: "/healthz" },
    identityAssertion: overrides.identityAssertion,
    sustainedRequestsPerSecond: overrides.sustainedRequestsPerSecond ?? 100,
    sustainedSeconds: overrides.sustainedSeconds ?? 20,
    burstRequestsPerSecond: overrides.burstRequestsPerSecond ?? 10,
    burstSeconds: overrides.burstSeconds ?? 3,
    coordinatedBurstIntervalSeconds:
      overrides.coordinatedBurstIntervalSeconds ?? 20,
    requestTimeoutMs: 15_000,
    routeTemplates: {
      currentManifest: {
        method: "GET",
        pathTemplate: "/api/v1/analyses/current",
      },
      search: { method: "GET", pathTemplate: "/api/v1/product-search" },
      analysis: {
        method: "GET",
        pathTemplate: candidate
          ? `/api/v1/analyses/${MIXED_LOAD_IDENTITY.analysisBuildId}/trade-explorer?shape=finalized-trend-v1&measures=TRADE_VALUE_USD%2CRECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct={analysisKey}`
          : "/api/v1/analyses/{analysisKey}",
      },
      csv: {
        method: "GET",
        pathTemplate: candidate
          ? `/api/v1/analyses/${MIXED_LOAD_IDENTITY.analysisBuildId}/trade-explorer.csv?shape=finalized-trend-v1&measures=TRADE_VALUE_USD%2CRECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct={analysisKey}`
          : "/api/v1/analyses/{analysisKey}/export.csv",
      },
    },
    analysisHotKeys:
      overrides.analysisHotKeys ??
      (candidate ? CANDIDATE_MIXED_LOAD_HOT_KEYS : MIXED_LOAD_HOT_KEYS),
    analysisDistinctKeys:
      overrides.analysisDistinctKeys ??
      (candidate
        ? CANDIDATE_MIXED_LOAD_DISTINCT_KEYS
        : MIXED_LOAD_DISTINCT_KEYS),
    maximumRowAnalysisKey:
      overrides.maximumRowAnalysisKey ??
      (candidate ? "851712" : "max-row-key"),
    ...(includeObservations
      ? {
          observations:
            overrides.observations ??
            {
              peakCgroupMemoryFraction: 0.5,
              peakProcessRssFraction: 0.4,
              peakSpillBytes: 0,
              sparseOrMedianSpillCount: 0,
              minimumVolumeFreeFraction: 0.6,
              sharedCpuBurstBalanceDepleted: false,
            },
        }
      : {}),
  };
}

describe("mixed-load plan parsing", () => {
  it("accepts a complete local-smoke plan with actual (small) numbers", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());

    expect(plan.measurementClass).toBe("local-smoke");
    expect(plan.sustainedRequestsPerSecond).toBe(100);
    expect(plan.sustainedSeconds).toBe(20);
    expect(plan.analysisDistinctKeys).toContain("max-row-key");
  });

  it("rejects plan-controlled cache verification", () => {
    const input = {
      ...acceptedMixedLoadPlanInput(),
      cacheVerification: {
        header: "x-cache",
        hitValue: "HIT",
        missValue: "MISS",
      },
    };

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /plan-declared cacheVerification is forbidden/u,
    );
  });

  it("rejects a candidate plan below the sustained requests-per-second floor", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 2,
      sustainedSeconds: 600,
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /sustained requests per second/,
    );
  });

  it("rejects a candidate plan below the sustained-duration floor", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 60,
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /sustained seconds/,
    );
  });

  it("rejects a candidate plan below the burst floors", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      burstRequestsPerSecond: 2,
      burstSeconds: 5,
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /burst requests per second/,
    );
  });

  it("rejects a candidate plan whose coordinated burst interval exceeds 60 seconds", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      burstRequestsPerSecond: 10,
      burstSeconds: 30,
      coordinatedBurstIntervalSeconds: 120,
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /coordinatedBurstIntervalSeconds/,
    );
  });

  it("permits a local-smoke plan with a coordinated burst interval above 60 seconds", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({ coordinatedBurstIntervalSeconds: 200 }),
    );

    expect(plan.coordinatedBurstIntervalSeconds).toBe(200);
  });

  it("accepts the literal production target of 4 req/s over 600s", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        measurementClass: "candidate",
        origin: "https://staging.example.com",
        sustainedRequestsPerSecond: 4,
        sustainedSeconds: 600,
        burstRequestsPerSecond: 10,
        burstSeconds: 30,
        coordinatedBurstIntervalSeconds: 60,
      }),
    );

    expect(plan.sustainedRequestsPerSecond).toBe(4);
    expect(plan.sustainedSeconds).toBe(600);
  });

  it("rejects candidate mixed load that does not exercise Trade Explorer analysis and CSV", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      burstRequestsPerSecond: 10,
      burstSeconds: 30,
      coordinatedBurstIntervalSeconds: 60,
    });
    input.routeTemplates.analysis.pathTemplate =
      "/api/v1/analyses/{analysisKey}/candidate-markets";

    expect(() => parseMixedLoadPlan(input)).toThrow(
      "Candidate mixed-load analysis template must execute",
    );
  });

  it("requires all 337 never-reused candidate analysis keys", () => {
    const analysisDistinctKeys = [
      "851712",
      ...Array.from({ length: 335 }, (_, index) => `candidate-${index}`),
    ];
    expect(() =>
      parseMixedLoadPlan(
        acceptedMixedLoadPlanInput({
          measurementClass: "candidate",
          origin: "https://staging.example.com",
          sustainedRequestsPerSecond: 4,
          sustainedSeconds: 600,
          burstRequestsPerSecond: 10,
          burstSeconds: 30,
          coordinatedBurstIntervalSeconds: 60,
          analysisDistinctKeys,
        }),
      ),
    ).toThrow(/at least 337 never-reused distinct analysis keys/u);
  });

  it("accepts a candidate CSV template carrying the export envelope the CSV route requires", () => {
    const input = acceptedMixedLoadPlanInput({
      measurementClass: "candidate",
      origin: "https://staging.example.com",
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      burstRequestsPerSecond: 10,
      burstSeconds: 30,
      coordinatedBurstIntervalSeconds: 60,
    });
    input.routeTemplates.csv.pathTemplate =
      `/api/v1/analyses/${MIXED_LOAD_IDENTITY.analysisBuildId}/trade-explorer.csv?shape=finalized-trend-v1&measures=TRADE_VALUE_USD%2CRECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct={analysisKey}&freshnessStatusId=fresh-1&schema=trade-explorers-csv-v1`;

    const plan = parseMixedLoadPlan(input);

    expect(plan.routeTemplates.csv.pathTemplate).toContain(
      "schema=trade-explorers-csv-v1",
    );
  });

  it("derives a larger key pool for more frequent coordinated bursts", () => {
    expect(() =>
      parseMixedLoadPlan(
        acceptedMixedLoadPlanInput({
          measurementClass: "candidate",
          origin: "https://staging.example.com",
          sustainedRequestsPerSecond: 4,
          sustainedSeconds: 600,
          burstRequestsPerSecond: 10,
          burstSeconds: 30,
          coordinatedBurstIntervalSeconds: 30,
        }),
      ),
    ).toThrow(/at least 377 never-reused distinct analysis keys/u);
  });

  it("rejects candidate rates and durations above the exact target", () => {
    expect(() =>
      parseMixedLoadPlan(
        acceptedMixedLoadPlanInput({
          measurementClass: "candidate",
          origin: "https://staging.example.com",
          sustainedRequestsPerSecond: 5,
          sustainedSeconds: 600,
          burstRequestsPerSecond: 10,
          burstSeconds: 30,
          coordinatedBurstIntervalSeconds: 60,
        }),
      ),
    ).toThrow(/exactly 4 sustained requests per second/u);
  });

  it("rejects plan-declared runtime observations for candidate evidence", () => {
    expect(() =>
      parseMixedLoadPlan(
        acceptedMixedLoadPlanInput({
          measurementClass: "candidate",
          origin: "https://staging.example.com",
          sustainedRequestsPerSecond: 4,
          sustainedSeconds: 600,
          burstRequestsPerSecond: 10,
          burstSeconds: 30,
          coordinatedBurstIntervalSeconds: 60,
          observations: {
            peakCgroupMemoryFraction: 0,
            peakProcessRssFraction: 0,
            peakSpillBytes: 0,
            sparseOrMedianSpillCount: 0,
            minimumVolumeFreeFraction: 1,
            sharedCpuBurstBalanceDepleted: true,
          },
        }),
      ),
    ).toThrow(/plan-declared observations are forbidden/u);
  });

  it("rejects an https origin for local-smoke evidence", () => {
    const input = acceptedMixedLoadPlanInput({
      origin: "https://127.0.0.1:4000",
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      HttpPerformanceRunnerError,
    );
  });

  it("rejects an analysisDistinctKeys pool smaller than 4 keys", () => {
    const input = acceptedMixedLoadPlanInput({
      analysisDistinctKeys: ["dk-1", "dk-2", "max-row-key"],
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(/at least 4/);
  });

  it("rejects overlapping hot and distinct key pools", () => {
    const input = acceptedMixedLoadPlanInput({
      analysisHotKeys: [...MIXED_LOAD_HOT_KEYS, "dk-1"],
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(/overlap/);
  });

  it("rejects a maximumRowAnalysisKey outside analysisDistinctKeys", () => {
    const input = acceptedMixedLoadPlanInput({
      maximumRowAnalysisKey: "not-in-pool",
    });

    expect(() => parseMixedLoadPlan(input)).toThrowError(
      /maximumRowAnalysisKey/,
    );
  });
});

describe("mixed-load schedule", () => {
  it("applies the exact route and 80/20 analysis mix to the candidate burst", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        measurementClass: "candidate",
        origin: "https://staging.example.com",
        sustainedRequestsPerSecond: 4,
        sustainedSeconds: 600,
        burstRequestsPerSecond: 10,
        burstSeconds: 30,
        coordinatedBurstIntervalSeconds: 60,
      }),
    );
    const schedule = buildMixedLoadSchedule(plan);
    const routeCounts = Object.fromEntries(
      ["currentManifest", "search", "analysis", "csv"].map((routeKind) => [
        routeKind,
        schedule.burst.filter(
          (request) => request.routeKind === routeKind,
        ).length,
      ]),
    );
    const analysisClassCounts = Object.fromEntries(
      ["hot", "distinct"].map((keyClass) => [
        keyClass,
        schedule.burst.filter(
          (request) =>
            request.routeKind === "analysis" &&
            request.analysisKeyClass === keyClass,
        ).length,
      ]),
    );

    expect(routeCounts).toEqual({
      currentManifest: 30,
      search: 75,
      analysis: 165,
      csv: 30,
    });
    expect(analysisClassCounts).toEqual({ hot: 132, distinct: 33 });
    const distinctKeys = [
      ...schedule.sustained,
      ...schedule.coordinated,
      ...schedule.burst,
    ]
      .filter(
        (request) =>
          request.routeKind === "analysis" &&
          request.analysisKeyClass === "distinct",
      )
      .map((request) => request.analysisKey);
    expect(new Set(distinctKeys).size).toBe(distinctKeys.length);
  });

  it("splits a scaled deterministic schedule into the exact 10/25/55/10 route mix", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const schedule = buildMixedLoadSchedule(plan);

    expect(schedule.totalSustainedRequests).toBe(2_000);
    expect(schedule.totalCoordinatedRequests).toBe(4);
    expect(schedule.totalBurstRequests).toBe(30);

    const counts: Record<string, number> = {};
    for (const request of schedule.sustained) {
      counts[request.routeKind] = (counts[request.routeKind] ?? 0) + 1;
    }
    expect(counts.currentManifest).toBe(200);
    expect(counts.search).toBe(500);
    expect(counts.analysis).toBe(1_100);
    expect(counts.csv).toBe(200);
  });

  it("splits analysis requests into the exact 80/20 hot/distinct mix", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const schedule = buildMixedLoadSchedule(plan);

    const classCounts: Record<string, number> = {};
    for (const request of schedule.sustained) {
      if (request.routeKind === "analysis" && request.analysisKeyClass) {
        classCounts[request.analysisKeyClass] =
          (classCounts[request.analysisKeyClass] ?? 0) + 1;
      }
    }
    expect(classCounts.hot).toBe(880);
    expect(classCounts.distinct).toBe(220);
  });

  it("has every csv request reuse the most recent analysis key from its own session", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const schedule = buildMixedLoadSchedule(plan);

    const lastAnalysisKeyBySession = new Map<string, string>();
    for (const request of schedule.sustained) {
      if (request.routeKind === "analysis" && request.analysisKey !== null) {
        lastAnalysisKeyBySession.set(request.sessionId, request.analysisKey);
      } else if (request.routeKind === "csv") {
        expect(request.analysisKey).toBe(
          lastAnalysisKeyBySession.get(request.sessionId),
        );
      }
    }
  });

  it("includes the maximum-row analysis key at least once", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const schedule = buildMixedLoadSchedule(plan);

    expect(schedule.usesMaximumRowAnalysisKey).toBe(true);
    expect(schedule.coordinated[0].analysisKey).toBe("max-row-key");
  });

  it("launches four never-reused distinct analysis keys at the same instant in every coordinated window", () => {
    const schedule = buildMixedLoadSchedule(
      parseMixedLoadPlan(acceptedMixedLoadPlanInput()),
    );

    expect(schedule.coordinated).toHaveLength(4);
    expect(
      new Set(schedule.coordinated.map((request) => request.offsetSeconds)),
    ).toEqual(new Set([0]));
    const distinctAnalysisKeys = [
      ...schedule.sustained,
      ...schedule.coordinated,
    ]
      .filter(
        (request) =>
          request.routeKind === "analysis" &&
          request.analysisKeyClass === "distinct",
      )
      .map((request) => request.analysisKey);
    expect(new Set(distinctAnalysisKeys).size).toBe(
      distinctAnalysisKeys.length,
    );
  });

  it("throws when the sustained duration does not divide evenly into coordinated windows", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        sustainedSeconds: 20,
        coordinatedBurstIntervalSeconds: 7,
      }),
    );

    expect(() => buildMixedLoadSchedule(plan)).toThrowError(
      HttpPerformanceRunnerError,
    );
  });

  it("throws when a coordinated window cannot reach 4 distinct uncached keys", () => {
    expect(() =>
      buildMixedLoadSchedule({
        measurementClass: "local-smoke",
        sustainedRequestsPerSecond: 100,
        sustainedSeconds: 20,
        burstRequestsPerSecond: 10,
        burstSeconds: 3,
        coordinatedBurstIntervalSeconds: 20,
        analysisHotKeys: MIXED_LOAD_HOT_KEYS,
        analysisDistinctKeys: ["only-key"],
        maximumRowAnalysisKey: "only-key",
      }),
    ).toThrowError(/never-reused distinct analysis key/);
  });
});

function fakeMixedLoadExecutor(options: {
  calls: HttpBenchmarkRequest[];
  failures?: Map<number, HttpBenchmarkOutcome>;
  buildId?: string;
}): HttpBenchmarkExecutor {
  const cachedAnalysisKeys = new Set<string>();
  let bodyCallIndex = -1;
  return {
    async execute(request) {
      options.calls.push(request);
      const buildHeader = options.buildId ?? "build-30";
      if (request.url.pathname === "/healthz") {
        return {
          timedOut: false,
          status: 200,
          ttfbMs: 1,
          totalMs: 1,
          body: Buffer.from("ok"),
          header: (name) => (name === "x-build-id" ? buildHeader : null),
        };
      }
      bodyCallIndex += 1;
      const injected = options.failures?.get(bodyCallIndex);
      if (injected !== undefined) {
        return injected;
      }
      let cacheValue = "MISS";
      const analysisMatch =
        /^\/api\/v1\/analyses\/([^/]+)(\/export\.csv)?$/u.exec(
          request.url.pathname,
        );
      if (analysisMatch) {
        const key = decodeURIComponent(analysisMatch[1]);
        const isCsv = analysisMatch[2] !== undefined;
        cacheValue = cachedAnalysisKeys.has(key) ? "HIT" : "MISS";
        if (!isCsv) {
          cachedAnalysisKeys.add(key);
        }
      }
      return {
        timedOut: false,
        status: 200,
        ttfbMs: 2,
        totalMs: 2,
        body: Buffer.from("ok"),
        header: (name) => {
          if (
            name.toLowerCase() ===
            RUNTIME_PROBE_CACHE_STATE_HEADER.toLowerCase()
          ) {
            return cacheValue.toLowerCase();
          }
          if (name === "x-build-id") {
            return buildHeader;
          }
          return null;
        },
      };
    },
  };
}

const INSTANT_SLEEP = () => Promise.resolve();
const fakeIdentityAttestor: RuntimeIdentityAttestor = async (
  origin,
  identity,
) => ({
  schemaVersion: "runtime-identity-attestation-v1",
  origin,
  identity,
  benchmarkQueries: [
    {
      role: "sparse",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "median",
      productCode: "851712",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "upper-quartile",
      productCode: "010121",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "maximum-row",
      productCode: "851712",
      exporterCode: "156",
      candidateCount: 1,
    },
  ],
  tradeExplorerBenchmarkQueries: [
    {
      role: "sparse",
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode: "156",
      importEconomyCode: "276",
      hsProductCode: "010121",
      groupedRowCount: 5,
    },
    {
      role: "median",
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode: "156",
      importEconomyCode: "276",
      hsProductCode: "851712",
      groupedRowCount: 5,
    },
    {
      role: "upper-quartile",
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode: "156",
      importEconomyCode: "276",
      hsProductCode: "010121",
      groupedRowCount: 5,
    },
    {
      role: "maximum-row",
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode: "156",
      importEconomyCode: "276",
      hsProductCode: "851712",
      groupedRowCount: 5,
    },
  ],
  health: { path: "/healthz", bodySha256: "c".repeat(64) },
  currentManifest: {
    path: "/api/v1/analyses/current",
    etag: 'W/"manifest"',
    bodySha256: "d".repeat(64),
    schemaVersion: "current-analysis-manifest-v1",
  },
});

function mixedRunnerDependencies(
  overrides: MixedLoadRunnerDependencies = {},
): MixedLoadRunnerDependencies {
  return {
    now: () => 0,
    sleep: INSTANT_SLEEP,
    attestIdentity: fakeIdentityAttestor,
    ...overrides,
  };
}

function prometheusObservation(sample: number): string {
  const labels =
    `{analysis_build_id="${MIXED_LOAD_IDENTITY.analysisBuildId}",baci_release="${MIXED_LOAD_IDENTITY.baciRelease}"}`;
  return [
    `hs_tracker_cgroup_memory_current_fraction${labels} ${sample === 1 ? 0.41 : 0.42}`,
    `hs_tracker_process_rss_fraction${labels} ${sample === 1 ? 0.31 : 0.32}`,
    `hs_tracker_duckdb_spill_bytes${labels} 0`,
    `hs_tracker_volume_free_fraction${labels} ${sample === 1 ? 0.59 : 0.58}`,
    `hs_tracker_cgroup_cpu_periods_total${labels} ${sample * 100}`,
    `hs_tracker_cgroup_cpu_throttled_periods_total${labels} ${sample - 1}`,
  ].join("\n");
}

describe("mixed-load runtime observation adapter", () => {
  it("derives peak resource values and CPU depletion from identity-bound runtime metrics", async () => {
    let sample = 0;
    const fetchImplementation: typeof fetch = async () => {
      sample += 1;
      return new Response(prometheusObservation(sample), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    };
    const adapter = createPrometheusMixedLoadObservationAdapter(
      "http://127.0.0.1:4000",
      MIXED_LOAD_IDENTITY,
      { fetchImplementation, sampleIntervalMs: 60_000 },
    );

    const result = await adapter.observeDuring(async () => "completed");

    expect(result.output).toBe("completed");
    expect(result.observations).toMatchObject({
      source: "runtime-prometheus-v1",
      sampleCount: 2,
      peakCgroupMemoryFraction: 0.42,
      peakProcessRssFraction: 0.32,
      peakSpillBytes: 0,
      sparseOrMedianSpillCount: 0,
      minimumVolumeFreeFraction: 0.58,
      sharedCpuBurstBalanceDepleted: true,
    });
  });
});

describe("mixed-load runner", () => {
  it("reports measurement-complete with the plan's actual target-load numbers and no failures", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });

    return runMixedLoad(plan, executor, mixedRunnerDependencies()).then((report) => {
      expect(report.status).toBe("measurement-complete");
      expect(report.schemaVersion).toBe("mixed-load-report-v1");
      expect(report.firstFailure).toBeNull();
      expect(report.cacheViolations).toEqual([]);
      expect(report.targetLoad.sessions).toBe(20);
      expect(report.targetLoad.sustainedRequestsPerSecond).toBe(100);
      expect(report.targetLoad.sustainedSeconds).toBe(20);
      expect(report.targetLoad.routeMix).toEqual({
        currentManifest: 0.1,
        search: 0.25,
        analysis: 0.55,
        csv: 0.1,
      });
      expect(report.targetLoad.queueRejections).toBe(0);
      expect(report.targetLoad.unretryableErrors).toBe(0);
      expect(report.targetLoad.timeouts).toBe(0);
      expect(report.targetLoad.cacheStatesVerified).toBe(true);
      expect(report.targetLoad.includesMaximumRowProduct).toBe(true);
      expect(report.targetLoad.includesTradeExplorer).toBe(false);
    });
  });

  it("launches scheduled arrivals concurrently instead of accumulating response latency", async () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const base = fakeMixedLoadExecutor({ calls });
    let active = 0;
    let maximumActive = 0;
    const executor: HttpBenchmarkExecutor = {
      async execute(request) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        try {
          return await base.execute(request);
        } finally {
          active -= 1;
        }
      },
    };

    await runMixedLoad(plan, executor, mixedRunnerDependencies());

    expect(maximumActive).toBeGreaterThan(20);
  });

  it("does not send health, prime, or load traffic when deployment identity attestation fails", async () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];

    await expect(
      runMixedLoad(
        plan,
        fakeMixedLoadExecutor({ calls }),
        mixedRunnerDependencies({
          attestIdentity: async () => {
            throw new Error("attested machine mismatch");
          },
        }),
      ),
    ).rejects.toThrow("attested machine mismatch");
    expect(calls).toHaveLength(0);
  });

  it("never retries a failure and retains only the first failure while counting every failure", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const failures = new Map<number, HttpBenchmarkOutcome>([
      [
        MIXED_LOAD_HOT_KEYS.length + 3,
        {
          timedOut: false,
          status: 503,
          ttfbMs: 4,
          totalMs: 4,
          body: Buffer.from(""),
          header: (name) => (name === "retry-after" ? "1" : null),
        },
      ],
      [
        MIXED_LOAD_HOT_KEYS.length + 50,
        {
          timedOut: false,
          status: 500,
          ttfbMs: 4,
          totalMs: 4,
          body: Buffer.from(""),
          header: () => null,
        },
      ],
      [
        MIXED_LOAD_HOT_KEYS.length + 100,
        { timedOut: true, elapsedMs: 4_999 },
      ],
    ]);
    const executor = fakeMixedLoadExecutor({ calls, failures });

    return runMixedLoad(plan, executor, mixedRunnerDependencies()).then((report) => {
      expect(report.firstFailure).not.toBeNull();
      expect(report.firstFailure?.sequence).toBe(3);
      expect(report.firstFailure?.status).toBe(503);
      expect(report.targetLoad.queueRejections).toBe(1);
      expect(report.targetLoad.unretryableErrors).toBe(1);
      expect(report.targetLoad.timeouts).toBe(1);
      // Every scheduled request executed exactly once: no retry could have
      // erased or duplicated the recorded failures.
      expect(calls.length).toBe(1 + 5 + 2_000 + 4 + 30);
    });
  });

  it("records a cache violation without treating it as a fatal failure", () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });
    const wrappedExecutor: HttpBenchmarkExecutor = {
      async execute(request) {
        const outcome = await executor.execute(request);
        if (
          !outcome.timedOut &&
          request.url.pathname.includes("hot-a") &&
          request.url.pathname.includes("/api/v1/analyses/")
        ) {
          return { ...outcome, header: () => "MISS" };
        }
        return outcome;
      },
    };

    return runMixedLoad(
      plan,
      wrappedExecutor,
      mixedRunnerDependencies(),
    ).then((report) => {
      expect(report.firstFailure).toBeNull();
      expect(report.cacheViolations.length).toBeGreaterThan(0);
      expect(report.targetLoad.cacheStatesVerified).toBe(false);
    });
  });

  it("accepts in-flight coalescing as a verified process hit", async () => {
    const plan = parseMixedLoadPlan(acceptedMixedLoadPlanInput());
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });
    const wrappedExecutor: HttpBenchmarkExecutor = {
      async execute(request) {
        const outcome = await executor.execute(request);
        if (
          !outcome.timedOut &&
          request.url.pathname.includes("hot-a") &&
          request.url.pathname.includes("/api/v1/analyses/")
        ) {
          return {
            ...outcome,
            header(name) {
              return name.toLowerCase() ===
                RUNTIME_PROBE_CACHE_STATE_HEADER.toLowerCase()
                ? "coalesced"
                : outcome.header(name);
            },
          };
        }
        return outcome;
      },
    };

    const report = await runMixedLoad(
      plan,
      wrappedExecutor,
      mixedRunnerDependencies(),
    );

    expect(report.cacheViolations).toEqual([]);
    expect(report.targetLoad.cacheStatesVerified).toBe(true);
  });

  it("uses plan-declared observations when no adapter is supplied", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        observations: {
          peakCgroupMemoryFraction: 0.91,
          peakProcessRssFraction: 0.77,
          peakSpillBytes: 4_096,
          sparseOrMedianSpillCount: 2,
          minimumVolumeFreeFraction: 0.12,
          sharedCpuBurstBalanceDepleted: true,
        },
      }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });

    return runMixedLoad(plan, executor, mixedRunnerDependencies()).then((report) => {
      expect(report.targetLoad.peakCgroupMemoryFraction).toBe(0.91);
      expect(report.targetLoad.cpuPressure).toEqual({
        kind: "shared-cpu-burst-balance",
        depleted: true,
      });
      expect(report.targetLoad.sparseOrMedianSpillCount).toBe(2);
    });
  });

  it("fails closed when no observations or observation adapter is available", () => {
    const rawInput = acceptedMixedLoadPlanInput() as Record<string, unknown>;
    delete rawInput.observations;
    const plan = parseMixedLoadPlan(rawInput);
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });

    return expect(
      runMixedLoad(plan, executor, mixedRunnerDependencies()),
    ).rejects.toThrowError(HttpPerformanceRunnerError);
  });

  it("fails closed when a response does not retain the expected build identity", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        identityAssertion: { headerName: "x-build-id", expectedValue: "build-30" },
      }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls, buildId: "build-wrong" });

    return expect(
      runMixedLoad(
        plan,
        executor,
        mixedRunnerDependencies(),
      ),
    ).rejects.toThrowError(HttpPerformanceRunnerError);
  });

  it("preserves the plan's real (small) local-smoke numbers, which would fail candidate floors", () => {
    const plan = parseMixedLoadPlan(
      acceptedMixedLoadPlanInput({
        sustainedRequestsPerSecond: 2,
        sustainedSeconds: 200,
        burstRequestsPerSecond: 2,
        burstSeconds: 1,
        coordinatedBurstIntervalSeconds: 200,
      }),
    );
    const calls: HttpBenchmarkRequest[] = [];
    const executor = fakeMixedLoadExecutor({ calls });

    return runMixedLoad(plan, executor, mixedRunnerDependencies()).then((report) => {
      expect(report.targetLoad.sustainedRequestsPerSecond).toBe(2);
      expect(report.targetLoad.sustainedSeconds).toBe(200);
      expect(report.targetLoad.sustainedRequestsPerSecond).toBeLessThan(4);
      expect(report.targetLoad.sustainedSeconds).toBeLessThan(600);
    });
  });
});
