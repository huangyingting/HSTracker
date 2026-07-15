import { gzipSync } from "node:zlib";

import {
  RUNTIME_PROBE_CACHE_PARTITION_HEADER,
  RUNTIME_PROBE_CACHE_STATE_HEADER,
} from "../runtime/runtime-metrics";
import {
  summarizeBenchmarkSamples,
  type BenchmarkSample,
} from "./benchmark-statistics";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "./acceptance-fixture";
import type {
  OriginBenchmarkInput,
  OriginBenchmarkOperation,
  PerformanceMeasurementIdentity,
  PerformanceProductRole,
  TargetLoadInput,
} from "./performance-gates";
import {
  attestRuntimeIdentity,
  type RuntimeIdentityAttestation,
  type RuntimeIdentityAttestor,
} from "./runtime-identity-attestation";
import { decodeTradeExplorerQuery } from "../domain/trade-analytics/trade-explorer-v1-query-codec";

// ---------------------------------------------------------------------------
// This module is the HTTP-origin counterpart to src/promotion/browser-lab-
// runner.ts: it turns a strict versioned JSON plan into real GET/HEAD
// requests against a running origin, using an injected executor so tests can
// swap real network I/O for a tiny fake. It never retries a failed sample
// (a retry could otherwise erase evidence of a failure), and it never
// mutates release pointers or evaluates gates itself -- it only produces
// versioned reports that feed src/promotion/performance-gates.ts.
// ---------------------------------------------------------------------------

export class HttpPerformanceRunnerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HttpPerformanceRunnerError";
    this.code = code;
  }
}

function planError(message: string): HttpPerformanceRunnerError {
  return new HttpPerformanceRunnerError(
    "HTTP_PERFORMANCE_PLAN_INVALID",
    message,
  );
}

function scheduleError(message: string): HttpPerformanceRunnerError {
  return new HttpPerformanceRunnerError(
    "HTTP_PERFORMANCE_SCHEDULE_INVALID",
    message,
  );
}

function identityMismatchError(message: string): HttpPerformanceRunnerError {
  return new HttpPerformanceRunnerError(
    "HTTP_PERFORMANCE_IDENTITY_MISMATCH",
    message,
  );
}

// ---------------------------------------------------------------------------
// Small local validators (mirrors the duplicated-per-module convention used
// by src/promotion/performance-gates.ts and src/promotion/browser-lab-runner.ts).
// ---------------------------------------------------------------------------

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw planError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw planError(`${label} must be a nonempty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw planError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw planError(`${label} must be a lowercase hex SHA-256 digest.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw planError(`${label} must be a nonempty array.`);
  }
  return value.map((entry, index) =>
    nonemptyString(entry, `${label} entry ${index + 1}`),
  );
}

function uniqueStrings(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw planError(`${label} must not contain duplicate entries.`);
  }
}

function optionalHeaders(
  value: unknown,
  label: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const headers = record(value, label);
  const result: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(headers)) {
    result[nonemptyString(name, `${label} header name`)] = nonemptyString(
      headerValue,
      `${label} header ${name} value`,
    );
  }
  return result;
}

function measurementClassOf(value: unknown): "candidate" | "local-smoke" {
  if (value === "candidate" || value === "local-smoke") {
    return value;
  }
  throw planError("measurementClass must be candidate or local-smoke.");
}

function validateIdentity(value: unknown): PerformanceMeasurementIdentity {
  const identity = record(value, "plan identity");
  const fixtureManifestSha256 = sha256(
    identity.fixtureManifestSha256,
    "plan identity fixture manifest SHA-256",
  );
  if (fixtureManifestSha256 !== ACCEPTANCE_FIXTURE_CONTENT_SHA256) {
    throw planError(
      "plan identity fixture manifest SHA-256 must match the canonical acceptance fixture.",
    );
  }
  const buildId = nonemptyString(identity.buildId, "plan identity build ID");
  const baciRelease = identity.baciRelease;
  if (typeof baciRelease !== "string" || !/^V\d{6}$/u.test(baciRelease)) {
    throw planError(
      "plan identity BACI Release must use the VYYYYMM format.",
    );
  }
  const analysisBuildId = nonemptyString(
    identity.analysisBuildId,
    "plan identity analysis build ID",
  );
  const productSearchBuildId = nonemptyString(
    identity.productSearchBuildId,
    "plan identity product-search build ID",
  );
  const artifactSha256 = sha256(
    identity.artifactSha256,
    "plan identity artifact SHA-256",
  );
  const machineId = nonemptyString(
    identity.machineId,
    "plan identity Machine ID",
  );
  const machineClass = nonemptyString(
    identity.machineClass,
    "plan identity Machine class",
  );
  const region = identity.region;
  if (typeof region !== "string" || !/^[a-z]{3}$/u.test(region)) {
    throw planError(
      "plan identity region must be a three-letter provider region.",
    );
  }
  return {
    fixtureManifestSha256,
    buildId,
    baciRelease,
    analysisBuildId,
    productSearchBuildId,
    artifactSha256,
    machineId,
    machineClass,
    region,
  };
}

function validatePlanOrigin(
  value: unknown,
  measurementClass: "candidate" | "local-smoke",
): string {
  const raw = nonemptyString(value, "plan origin");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw planError("plan origin must be an absolute URL.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw planError("plan origin must not embed credentials.");
  }
  if (
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw planError(
      "plan origin must not encode a cross-origin path, query, or fragment.",
    );
  }
  const isLoopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (measurementClass === "candidate") {
    if (parsed.protocol !== "https:") {
      throw planError("Candidate evidence requires an HTTPS origin.");
    }
  } else if (parsed.protocol !== "http:" || !isLoopback) {
    throw planError(
      "Local-smoke evidence requires a loopback (http://127.0.0.1 or http://localhost) origin.",
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export type HttpMethod = "GET" | "HEAD";

export type HttpRequestCase = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
};

function validateRequestPath(value: unknown, label: string): string {
  const path = nonemptyString(value, label);
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw planError(`${label} must be an absolute path on the plan origin.`);
  }
  if (path.includes("://") || path.includes("@") || path.includes("\\")) {
    throw planError(
      `${label} must not reference another origin or embed credentials.`,
    );
  }
  return path;
}

function validateRequestCase(value: unknown, label: string): HttpRequestCase {
  const request = record(value, label);
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    throw planError(`${label} method must be GET or HEAD.`);
  }
  return {
    method,
    path: validateRequestPath(request.path, `${label} path`),
    headers: optionalHeaders(request.headers, `${label} headers`),
  };
}

// A request path never carries the origin, so resolving it against the
// validated plan origin and re-checking `.origin` closes the "cross-origin
// request path" and "credentials in the URL" gaps defensively, even though
// validateRequestPath() already rejects the obvious cases.
export function resolveRequestUrl(origin: string, path: string): URL {
  const originUrl = new URL(origin);
  const resolved = new URL(path, originUrl);
  if (resolved.origin !== originUrl.origin) {
    throw planError(
      "A request path must resolve to the configured plan origin.",
    );
  }
  if (resolved.username !== "" || resolved.password !== "") {
    throw planError("A resolved request URL must not embed credentials.");
  }
  return resolved;
}

export function deterministicGzipBytes(body: Buffer): number {
  return gzipSync(body, { level: 9 }).length;
}

function utcTimestamp(millisecondsSinceEpoch: number): string {
  return new Date(millisecondsSinceEpoch)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z");
}

// ---------------------------------------------------------------------------
// Origin benchmark: single-route GET/HEAD measurements against a running
// origin. These lists and per-operation deadlines mirror the private
// PRODUCT_BENCHMARK_OPERATIONS / SINGLETON_BENCHMARK_OPERATIONS /
// REQUIRED_PRODUCT_ROLES / ORIGIN_THRESHOLDS.routeDeadlineMs constants in
// src/promotion/performance-gates.ts, which are not exported. Keep the two
// lists in sync by hand if performance-gates.ts's operation set changes.
// ---------------------------------------------------------------------------

const SINGLETON_OPERATIONS = [
  "html-shell",
  "current-manifest",
  "health",
] as const satisfies readonly OriginBenchmarkOperation[];

const PRODUCT_OPERATIONS = [
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
  "trade-explorer-analysis-uncached",
  "trade-explorer-analysis-process-hit",
  "trade-explorer-csv-uncached",
  "trade-explorer-csv-analysis-hit",
] as const satisfies readonly OriginBenchmarkOperation[];
const UNCACHED_OPERATIONS = [
  "economy-search-uncached",
  "product-search-uncached",
  "candidate-analysis-uncached",
  "csv-uncached",
  "trade-trend-analysis-uncached",
  "trade-trend-csv-uncached",
  "supplier-competition-analysis-uncached",
  "supplier-competition-csv-uncached",
  "trade-explorer-analysis-uncached",
  "trade-explorer-csv-uncached",
] as const satisfies readonly OriginBenchmarkOperation[];
const CACHE_STATE_HIT = "hit";
const CACHE_STATE_MISS = "miss";

const PRODUCT_ROLES = [
  "sparse",
  "median",
  "upper-quartile",
  "maximum-row",
] as const satisfies readonly PerformanceProductRole[];

const ROUTE_DEADLINE_MS: Record<OriginBenchmarkOperation, number> = {
  "html-shell": 2_000,
  "current-manifest": 2_000,
  health: 2_000,
  "economy-search-uncached": 2_000,
  "economy-search-process-hit": 2_000,
  "product-search-uncached": 2_000,
  "product-search-process-hit": 2_000,
  "candidate-analysis-uncached": 12_000,
  "candidate-analysis-process-hit": 2_000,
  "csv-uncached": 15_000,
  "csv-analysis-hit": 15_000,
  "trade-trend-analysis-uncached": 12_000,
  "trade-trend-analysis-process-hit": 2_000,
  "trade-trend-csv-uncached": 15_000,
  "trade-trend-csv-analysis-hit": 15_000,
  "supplier-competition-analysis-uncached": 12_000,
  "supplier-competition-analysis-process-hit": 2_000,
  "supplier-competition-csv-uncached": 15_000,
  "supplier-competition-csv-analysis-hit": 15_000,
  "trade-explorer-analysis-uncached": 12_000,
  "trade-explorer-analysis-process-hit": 2_000,
  "trade-explorer-csv-uncached": 15_000,
  "trade-explorer-csv-analysis-hit": 15_000,
};

const REQUIRED_ORIGIN_BENCHMARK_COUNT =
  SINGLETON_OPERATIONS.length +
  PRODUCT_OPERATIONS.length * PRODUCT_ROLES.length;

function originBenchmarkKey(
  operation: OriginBenchmarkOperation,
  productRole: PerformanceProductRole | undefined,
): string {
  const singleton = (SINGLETON_OPERATIONS as readonly string[]).includes(
    operation,
  );
  if (singleton) {
    if (productRole !== undefined) {
      throw planError(`${operation} must not name a product role.`);
    }
    return `${operation}:all`;
  }
  if (
    productRole === undefined ||
    !(PRODUCT_ROLES as readonly string[]).includes(productRole)
  ) {
    throw planError(`${operation} must name a supported product role.`);
  }
  return `${operation}:${productRole}`;
}

export type OriginBenchmarkRequestCase = {
  readonly operation: OriginBenchmarkOperation;
  readonly productRole?: PerformanceProductRole;
  readonly request: HttpRequestCase;
  readonly sampleRequests?: readonly {
    readonly semanticKey: string;
    readonly request: HttpRequestCase;
  }[];
  readonly timeoutMs: number;
};

export type OriginBenchmarkIdentityAssertion = {
  readonly headerName: string;
  readonly expectedValue: string;
};

export type OriginBenchmarkPlan = {
  readonly schemaVersion: "origin-benchmark-plan-v1";
  readonly measurementClass: "candidate" | "local-smoke";
  readonly identity: PerformanceMeasurementIdentity;
  readonly origin: string;
  readonly healthCheck: HttpRequestCase;
  readonly identityAssertion?: OriginBenchmarkIdentityAssertion;
  readonly warmupSamples: number;
  readonly timedSamples: number;
  readonly requests: readonly OriginBenchmarkRequestCase[];
};

const MINIMUM_ACCEPTANCE_TIMED_SAMPLES = 100;
const FIXED_WARMUP_SAMPLES = 5;

export function parseOriginBenchmarkPlan(value: unknown): OriginBenchmarkPlan {
  const plan = record(value, "origin-benchmark plan");
  if (plan.schemaVersion !== "origin-benchmark-plan-v1") {
    throw planError(
      "origin-benchmark plan schemaVersion must be origin-benchmark-plan-v1.",
    );
  }
  const measurementClass = measurementClassOf(plan.measurementClass);
  const identity = validateIdentity(plan.identity);
  const origin = validatePlanOrigin(plan.origin, measurementClass);
  const healthCheck = validateRequestCase(
    plan.healthCheck,
    "origin-benchmark plan health check",
  );
  const identityAssertion = validateIdentityAssertion(
    plan.identityAssertion,
  );
  const warmupSamples = positiveInteger(
    plan.warmupSamples,
    "origin-benchmark plan warmupSamples",
  );
  if (warmupSamples !== FIXED_WARMUP_SAMPLES) {
    throw planError(
      `origin-benchmark plan warmupSamples must be exactly ${FIXED_WARMUP_SAMPLES}.`,
    );
  }
  const timedSamples = positiveInteger(
    plan.timedSamples,
    "origin-benchmark plan timedSamples",
  );
  const requestsInput = plan.requests;
  if (!Array.isArray(requestsInput)) {
    throw planError("origin-benchmark plan requests must be an array.");
  }
  const seenKeys = new Set<string>();
  const uncachedAnalysisSemanticKeys = new Set<string>();
  const requests = requestsInput.map((entry, index) => {
    const label = `origin-benchmark plan request ${index + 1}`;
    const requestPlan = record(entry, label);
    const operation = requestPlan.operation;
    if (
      typeof operation !== "string" ||
      !(
        (SINGLETON_OPERATIONS as readonly string[]).includes(operation) ||
        (PRODUCT_OPERATIONS as readonly string[]).includes(operation)
      )
    ) {
      throw planError(`${label} operation is not a supported operation.`);
    }
    const productRole =
      requestPlan.productRole === undefined
        ? undefined
        : requiredProductRole(requestPlan.productRole, label);
    const key = originBenchmarkKey(
      operation as OriginBenchmarkOperation,
      productRole,
    );
    if (seenKeys.has(key)) {
      throw planError(`Duplicate origin-benchmark request ${key}.`);
    }
    seenKeys.add(key);
    const timeoutMs =
      requestPlan.timeoutMs === undefined
        ? ROUTE_DEADLINE_MS[operation as OriginBenchmarkOperation]
        : positiveInteger(requestPlan.timeoutMs, `${label} timeoutMs`);
    if (
      timeoutMs !==
      ROUTE_DEADLINE_MS[operation as OriginBenchmarkOperation]
    ) {
      throw planError(
        `${label} timeoutMs must match the operation deadline of ${ROUTE_DEADLINE_MS[operation as OriginBenchmarkOperation]} ms.`,
      );
    }
    const requiresUncachedSamples = (
      UNCACHED_OPERATIONS as readonly string[]
    ).includes(operation);
    let sampleRequests:
      | Array<{ semanticKey: string; request: HttpRequestCase }>
      | undefined;
    if (requiresUncachedSamples) {
      if (
        !Array.isArray(requestPlan.sampleRequests) ||
        requestPlan.sampleRequests.length !==
          FIXED_WARMUP_SAMPLES + timedSamples
      ) {
        throw planError(
          `${label} sampleRequests must contain exactly ${FIXED_WARMUP_SAMPLES + timedSamples} never-reused semantic requests.`,
        );
      }
      const semanticKeys = new Set<string>();
      const requestTargets = new Set<string>();
      sampleRequests = requestPlan.sampleRequests.map(
        (sampleRequest, sampleIndex) => {
          const sample = record(
            sampleRequest,
            `${label} sample request ${sampleIndex + 1}`,
          );
          const semanticKey = nonemptyString(
            sample.semanticKey,
            `${label} sample request ${sampleIndex + 1} semanticKey`,
          );
          if (semanticKeys.has(semanticKey)) {
            throw planError(
              `${label} sampleRequests must not reuse semantic key ${semanticKey}.`,
            );
          }
          semanticKeys.add(semanticKey);
          if (uncachedAnalysisSemanticKeys.has(semanticKey)) {
            throw planError(
              `Uncached analysis and CSV samples must not reuse analysis semantic key ${semanticKey}.`,
            );
          }
          uncachedAnalysisSemanticKeys.add(semanticKey);
          const request = validateRequestCase(
            sample.request,
            `${label} sample request ${sampleIndex + 1} request`,
          );
          const requestTarget = `${request.method} ${request.path} ${JSON.stringify(request.headers ?? {})}`;
          if (requestTargets.has(requestTarget)) {
            throw planError(
              `${label} sampleRequests must not repeat an HTTP request target.`,
            );
          }
          requestTargets.add(requestTarget);
          return {
            semanticKey,
            request,
          };
        },
      );
    } else if (requestPlan.sampleRequests !== undefined) {
      throw planError(
        `${label} must not declare sampleRequests for a cache-hit or singleton operation.`,
      );
    }
    return {
      operation: operation as OriginBenchmarkOperation,
      productRole,
      request: validateRequestCase(requestPlan.request, `${label} request`),
      sampleRequests,
      timeoutMs,
    };
  });
  for (const operation of SINGLETON_OPERATIONS) {
    if (!seenKeys.has(`${operation}:all`)) {
      throw planError(`Missing origin-benchmark request ${operation}:all.`);
    }
  }
  for (const operation of PRODUCT_OPERATIONS) {
    for (const role of PRODUCT_ROLES) {
      if (!seenKeys.has(`${operation}:${role}`)) {
        throw planError(
          `Missing origin-benchmark request ${operation}:${role}.`,
        );
      }
    }
  }
  if (seenKeys.size !== REQUIRED_ORIGIN_BENCHMARK_COUNT) {
    throw planError(
      "origin-benchmark plan requests must name exactly the required operation/product-role set.",
    );
  }

  return {
    schemaVersion: "origin-benchmark-plan-v1",
    measurementClass,
    identity,
    origin,
    healthCheck,
    identityAssertion,
    warmupSamples,
    timedSamples,
    requests,
  };
}

function requiredProductRole(
  value: unknown,
  label: string,
): PerformanceProductRole {
  if (
    typeof value === "string" &&
    (PRODUCT_ROLES as readonly string[]).includes(value)
  ) {
    return value as PerformanceProductRole;
  }
  throw planError(`${label} productRole is not a supported product role.`);
}

function validateIdentityAssertion(
  value: unknown,
): OriginBenchmarkIdentityAssertion | undefined {
  if (value === undefined) {
    return undefined;
  }
  const assertion = record(value, "plan identityAssertion");
  return {
    headerName: nonemptyString(
      assertion.headerName,
      "plan identityAssertion headerName",
    ),
    expectedValue: nonemptyString(
      assertion.expectedValue,
      "plan identityAssertion expectedValue",
    ),
  };
}

// ---------------------------------------------------------------------------
// HTTP executor seam: production uses createFetchHttpExecutor(); tests inject
// a tiny fake that returns canned outcomes instantly, so no test ever sleeps
// for the real request/warmup/timed-sample durations this module drives.
// ---------------------------------------------------------------------------

export type HttpBenchmarkRequest = {
  readonly method: HttpMethod;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
};

export type HttpBenchmarkCompletedOutcome = {
  readonly timedOut: false;
  readonly status: number;
  readonly ttfbMs: number;
  readonly totalMs: number;
  readonly body: Buffer;
  header(name: string): string | null;
};

export type HttpBenchmarkTimedOutOutcome = {
  readonly timedOut: true;
  readonly elapsedMs: number;
};

export type HttpBenchmarkOutcome =
  | HttpBenchmarkCompletedOutcome
  | HttpBenchmarkTimedOutOutcome;

export interface HttpBenchmarkExecutor {
  execute(request: HttpBenchmarkRequest): Promise<HttpBenchmarkOutcome>;
}

export function createFetchHttpExecutor(): HttpBenchmarkExecutor {
  return {
    async execute(request): Promise<HttpBenchmarkOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, request.timeoutMs);
      const startedAt = performance.now();
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: {
            ...request.headers,
            "Cache-Control": "no-cache",
            "X-HS-Tracker-Probe": "external-v1",
          },
          signal: controller.signal,
        });
        const ttfbMs = performance.now() - startedAt;
        const body = Buffer.from(await response.arrayBuffer());
        const totalMs = performance.now() - startedAt;
        return {
          timedOut: false,
          status: response.status,
          ttfbMs,
          totalMs,
          body,
          header(name: string): string | null {
            return response.headers.get(name);
          },
        };
      } catch (error) {
        if (controller.signal.aborted) {
          return { timedOut: true, elapsedMs: performance.now() - startedAt };
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function successfulStatus(status: number): boolean {
  return (status >= 200 && status <= 299) || status === 304;
}

export type OriginBenchmarkSampleFailure = {
  readonly operation: OriginBenchmarkOperation;
  readonly productRole: PerformanceProductRole | null;
  readonly sampleIndex: number;
  readonly status: number | null;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
};

export type OriginBenchmarkCacheViolation = {
  readonly operation: OriginBenchmarkOperation;
  readonly productRole: PerformanceProductRole | null;
  readonly phase: "warmup" | "timed";
  readonly sampleIndex: number;
  readonly expected: "hit" | "miss";
  readonly actual: string | null;
};

export type OriginBenchmarkReport = {
  readonly schemaVersion: "origin-benchmark-report-v1";
  readonly measurementClass: "candidate" | "local-smoke";
  readonly identity: PerformanceMeasurementIdentity;
  readonly attestation: RuntimeIdentityAttestation;
  readonly origin: string;
  readonly generatedAt: string;
  readonly toolVersion: string;
  readonly originBenchmarks: readonly OriginBenchmarkInput[];
  readonly meetsAcceptanceEvidenceSampleSize: boolean;
  readonly firstFailure: OriginBenchmarkSampleFailure | null;
  readonly cacheViolations: readonly OriginBenchmarkCacheViolation[];
  readonly status: "measurement-complete";
};

export type OriginBenchmarkRunnerDependencies = {
  readonly toolVersion?: string;
  readonly now?: () => number;
  readonly attestIdentity?: RuntimeIdentityAttestor;
};

const DEFAULT_TOOL_VERSION = "http-performance-runner-v1";

function assertAttestedOriginBenchmarks(
  plan: OriginBenchmarkPlan,
  attestation: RuntimeIdentityAttestation,
): void {
  for (const requestCase of plan.requests) {
    if (
      requestCase.productRole === undefined ||
      (requestCase.operation !== "candidate-analysis-uncached" &&
        requestCase.operation !== "candidate-analysis-process-hit" &&
        requestCase.operation !== "csv-uncached" &&
        requestCase.operation !== "csv-analysis-hit" &&
        requestCase.operation !== "trade-explorer-analysis-uncached" &&
        requestCase.operation !== "trade-explorer-analysis-process-hit" &&
        requestCase.operation !== "trade-explorer-csv-uncached" &&
        requestCase.operation !== "trade-explorer-csv-analysis-hit")
    ) {
      continue;
    }
    const tradeExplorer = requestCase.operation.startsWith("trade-explorer-");
    const benchmark = (
      tradeExplorer
        ? attestation.tradeExplorerBenchmarkQueries
        : attestation.benchmarkQueries
    ).find((query) => query.role === requestCase.productRole);
    if (benchmark === undefined) {
      throw planError(
        `The deployed artifact does not attest a ${requestCase.productRole} benchmark query.`,
      );
    }
    if (tradeExplorer) {
      assertTradeExplorerRequestMatchesBenchmark(
        plan.origin,
        requestCase.request,
        benchmark as RuntimeIdentityAttestation["tradeExplorerBenchmarkQueries"][number],
        `${requestCase.operation}:${requestCase.productRole}`,
      );
    } else {
      assertRequestMatchesBenchmark(
        plan.origin,
        requestCase.request,
        benchmark as RuntimeIdentityAttestation["benchmarkQueries"][number],
        `${requestCase.operation}:${requestCase.productRole}`,
      );
    }
    if (
      requestCase.operation === "candidate-analysis-uncached" ||
      requestCase.operation === "csv-uncached" ||
      requestCase.operation === "trade-explorer-analysis-uncached" ||
      requestCase.operation === "trade-explorer-csv-uncached"
    ) {
      for (const sample of requestCase.sampleRequests ?? []) {
        const label = `${requestCase.operation}:${requestCase.productRole} sample ${sample.semanticKey}`;
        if (tradeExplorer) {
          assertTradeExplorerRequestMatchesBenchmark(
            plan.origin,
            sample.request,
            benchmark as RuntimeIdentityAttestation["tradeExplorerBenchmarkQueries"][number],
            label,
          );
        } else {
          assertRequestMatchesBenchmark(
            plan.origin,
            sample.request,
            benchmark as RuntimeIdentityAttestation["benchmarkQueries"][number],
            label,
          );
        }
        if (
          requestHeader(
            sample.request.headers,
            RUNTIME_PROBE_CACHE_PARTITION_HEADER,
          ) !== sample.semanticKey
        ) {
          throw planError(
            `${requestCase.operation}:${requestCase.productRole} sample ${sample.semanticKey} must use its semantic key as the probe cache partition.`,
          );
        }
      }
    }
  }
}

function assertRequestMatchesBenchmark(
  origin: string,
  request: HttpRequestCase,
  benchmark: RuntimeIdentityAttestation["benchmarkQueries"][number],
  label: string,
): void {
  const requestUrl = resolveRequestUrl(origin, request.path);
  if (
    requestUrl.searchParams.get("exporter") !== benchmark.exporterCode ||
    requestUrl.searchParams.get("product") !== benchmark.productCode
  ) {
    throw planError(
      `${label} does not match the deployed artifact benchmark query.`,
    );
  }
}

function assertTradeExplorerRequestMatchesBenchmark(
  origin: string,
  request: HttpRequestCase,
  benchmark: RuntimeIdentityAttestation["tradeExplorerBenchmarkQueries"][number],
  label: string,
): void {
  const requestUrl = resolveRequestUrl(origin, request.path);
  const query = decodeTradeExplorerQuery(requestUrl.searchParams);
  if (
    query === null ||
    query.shape !== benchmark.shape ||
    query.measures.length !== benchmark.measures.length ||
    query.measures.some(
      (measure, index) => measure !== benchmark.measures[index],
    ) ||
    query.filters.year.mode !== "list" ||
    query.filters.year.years.length !== 0 ||
    query.filters.exportEconomy.length !== 1 ||
    query.filters.exportEconomy[0] !== benchmark.exportEconomyCode ||
    query.filters.importEconomy.length !== 1 ||
    query.filters.importEconomy[0] !== benchmark.importEconomyCode ||
    query.filters.hsProduct.length !== 1 ||
    query.filters.hsProduct[0] !== benchmark.hsProductCode ||
    query.sort !== null
  ) {
    throw planError(
      `${label} does not match the deployed artifact Trade Explorer benchmark query.`,
    );
  }
}

function requestHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  const normalizedName = name.toLowerCase();
  return Object.entries(headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === normalizedName,
  )?.[1];
}

export async function runOriginBenchmark(
  plan: OriginBenchmarkPlan,
  executor: HttpBenchmarkExecutor,
  dependencies: OriginBenchmarkRunnerDependencies = {},
): Promise<OriginBenchmarkReport> {
  const now = dependencies.now ?? Date.now;
  const attestation = await (
    dependencies.attestIdentity ?? attestRuntimeIdentity
  )(plan.origin, plan.identity);
  assertAttestedOriginBenchmarks(plan, attestation);
  await assertIdentity(
    plan.origin,
    plan.healthCheck,
    plan.identityAssertion,
    executor,
  );

  let firstFailure: OriginBenchmarkSampleFailure | null = null;
  const cacheViolations: OriginBenchmarkCacheViolation[] = [];
  const originBenchmarks: OriginBenchmarkInput[] = [];

  for (const requestCase of plan.requests) {
    let cacheStatesVerified = true;
    const verifyCacheState = (
      outcome: HttpBenchmarkOutcome,
      phase: OriginBenchmarkCacheViolation["phase"],
      sampleIndex: number,
    ): void => {
      const expected = expectedOriginCacheState(
        requestCase.operation,
        phase,
        sampleIndex,
      );
      if (expected === null) {
        return;
      }

      const actual = outcome.timedOut
        ? null
        : outcome.header(RUNTIME_PROBE_CACHE_STATE_HEADER);
      if (actual === expected) {
        return;
      }
      cacheStatesVerified = false;
      cacheViolations.push({
        operation: requestCase.operation,
        productRole: requestCase.productRole ?? null,
        phase,
        sampleIndex,
        expected,
        actual,
      });
    };

    // Exactly five untimed warmups per route/product-role, never counted
    // toward the timed sample statistics.
    for (let warmup = 0; warmup < FIXED_WARMUP_SAMPLES; warmup += 1) {
      const request = originBenchmarkSampleRequest(requestCase, warmup);
      const outcome = await executor.execute({
        method: request.method,
        url: resolveRequestUrl(plan.origin, request.path),
        headers: request.headers ?? {},
        timeoutMs: requestCase.timeoutMs,
      });
      assertResponseIdentity(outcome, plan.identityAssertion, requestCase);
      verifyCacheState(outcome, "warmup", warmup);
    }

    const samples: BenchmarkSample[] = [];
    let largestBody: Buffer | null = null;
    let largestBodyBytes = -1;
    for (let sample = 0; sample < plan.timedSamples; sample += 1) {
      const request = originBenchmarkSampleRequest(
        requestCase,
        FIXED_WARMUP_SAMPLES + sample,
      );
      const outcome = await executor.execute({
        method: request.method,
        url: resolveRequestUrl(plan.origin, request.path),
        headers: request.headers ?? {},
        timeoutMs: requestCase.timeoutMs,
      });
      assertResponseIdentity(outcome, plan.identityAssertion, requestCase);
      verifyCacheState(outcome, "timed", sample);

      if (outcome.timedOut) {
        samples.push({
          measurementMs: outcome.elapsedMs,
          routeMs: outcome.elapsedMs,
          payloadBytes: 0,
          status: null,
          timedOut: true,
        });
        if (firstFailure === null) {
          firstFailure = {
            operation: requestCase.operation,
            productRole: requestCase.productRole ?? null,
            sampleIndex: sample,
            status: null,
            timedOut: true,
            elapsedMs: outcome.elapsedMs,
          };
        }
        continue;
      }

      const measurementMs =
        requestCase.operation === "csv-analysis-hit" ||
        requestCase.operation === "trade-trend-csv-analysis-hit" ||
        requestCase.operation === "supplier-competition-csv-analysis-hit" ||
        requestCase.operation === "trade-explorer-csv-analysis-hit"
          ? outcome.ttfbMs
          : outcome.totalMs;
      samples.push({
        measurementMs,
        routeMs: outcome.totalMs,
        payloadBytes: outcome.body.byteLength,
        status: outcome.status,
        timedOut: false,
      });
      if (outcome.body.byteLength > largestBodyBytes) {
        largestBodyBytes = outcome.body.byteLength;
        largestBody = outcome.body;
      }
      if (firstFailure === null && !successfulStatus(outcome.status)) {
        firstFailure = {
          operation: requestCase.operation,
          productRole: requestCase.productRole ?? null,
          sampleIndex: sample,
          status: outcome.status,
          timedOut: false,
          elapsedMs: outcome.totalMs,
        };
      }
    }

    const summary = summarizeBenchmarkSamples(samples);
    originBenchmarks.push({
      operation: requestCase.operation,
      productRole: requestCase.productRole,
      warmupSamples: FIXED_WARMUP_SAMPLES,
      timedSamples: summary.sampleCount,
      p50Ms: summary.p50Ms,
      p75Ms: summary.p75Ms,
      p95Ms: summary.p95Ms,
      p99Ms: summary.p99Ms,
      maximumRouteMs: summary.maximumRouteMs,
      cacheStatesVerified,
      errors: summary.errors,
      timeouts: summary.timeouts,
      payloadBytes: summary.maximumPayloadBytes,
      compressedPayloadBytes:
        largestBody === null
          ? undefined
          : deterministicGzipBytes(largestBody),
    });
  }

  return {
    schemaVersion: "origin-benchmark-report-v1",
    measurementClass: plan.measurementClass,
    identity: plan.identity,
    attestation,
    origin: plan.origin,
    generatedAt: utcTimestamp(now()),
    toolVersion: dependencies.toolVersion ?? DEFAULT_TOOL_VERSION,
    originBenchmarks,
    meetsAcceptanceEvidenceSampleSize:
      plan.timedSamples >= MINIMUM_ACCEPTANCE_TIMED_SAMPLES,
    firstFailure,
    cacheViolations,
    status: "measurement-complete",
  };
}

function expectedOriginCacheState(
  operation: OriginBenchmarkOperation,
  phase: OriginBenchmarkCacheViolation["phase"],
  sampleIndex: number,
): "hit" | "miss" | null {
  if ((SINGLETON_OPERATIONS as readonly string[]).includes(operation)) {
    return null;
  }
  if ((UNCACHED_OPERATIONS as readonly string[]).includes(operation)) {
    return CACHE_STATE_MISS;
  }
  return phase === "warmup" && sampleIndex === 0 ? null : CACHE_STATE_HIT;
}

function originBenchmarkSampleRequest(
  requestCase: OriginBenchmarkRequestCase,
  sampleIndex: number,
): HttpRequestCase {
  if (requestCase.sampleRequests === undefined) {
    return requestCase.request;
  }
  const sample = requestCase.sampleRequests[sampleIndex];
  if (sample === undefined) {
    throw new HttpPerformanceRunnerError(
      "HTTP_PERFORMANCE_PLAN_INVALID",
      `${requestCase.operation} has no request for sample ${sampleIndex}.`,
    );
  }
  return sample.request;
}

async function assertIdentity(
  origin: string,
  healthCheck: HttpRequestCase,
  identityAssertion: OriginBenchmarkIdentityAssertion | undefined,
  executor: HttpBenchmarkExecutor,
): Promise<void> {
  const url = resolveRequestUrl(origin, healthCheck.path);
  const outcome = await executor.execute({
    method: healthCheck.method,
    url,
    headers: healthCheck.headers ?? {},
    timeoutMs: ROUTE_DEADLINE_MS.health,
  });
  if (outcome.timedOut) {
    throw identityMismatchError(
      "The health check timed out before confirming build/release identity.",
    );
  }
  if (!successfulStatus(outcome.status)) {
    throw identityMismatchError(
      `The health check returned status ${outcome.status} instead of confirming build/release identity.`,
    );
  }
  if (identityAssertion !== undefined) {
    const actual = outcome.header(identityAssertion.headerName);
    if (actual !== identityAssertion.expectedValue) {
      throw identityMismatchError(
        `The health check ${identityAssertion.headerName} header was ${String(actual)}; expected ${identityAssertion.expectedValue}.`,
      );
    }
  }
}

function assertResponseIdentity(
  outcome: HttpBenchmarkOutcome,
  identityAssertion: OriginBenchmarkIdentityAssertion | undefined,
  requestCase: OriginBenchmarkRequestCase,
): void {
  if (identityAssertion === undefined || outcome.timedOut) {
    return;
  }
  const actual = outcome.header(identityAssertion.headerName);
  if (actual !== identityAssertion.expectedValue) {
    throw identityMismatchError(
      `${requestCase.operation} response did not retain the expected build/release identity: ${identityAssertion.headerName} was ${String(actual)}; expected ${identityAssertion.expectedValue}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Mixed-load schedule/runner: a deterministic 20-session schedule for a
// sustained 4 req/s over >=600s candidate window (10/25/55/10 route mix,
// 80/20 analysis hot/distinct keys, each CSV reusing its session's most
// recent analysis key, and >=4 distinct uncached coordinated analysis keys
// once per coordinatedBurstIntervalSeconds window), plus a separate burst
// phase. Local-smoke plans may scale every number down, but the emitted
// TargetLoadInput always reflects the plan's real numbers -- never inflated
// to look like a passing candidate run -- so it fails performance-gates.ts's
// candidate thresholds if ever mislabeled.
// ---------------------------------------------------------------------------

const SESSION_COUNT = 20;
export type RouteKind = "currentManifest" | "search" | "analysis" | "csv";
const ROUTE_KIND_ORDER: readonly RouteKind[] = [
  "currentManifest",
  "search",
  "analysis",
  "csv",
];
const ROUTE_MIX: Readonly<Record<RouteKind, number>> = {
  currentManifest: 0.1,
  search: 0.25,
  analysis: 0.55,
  csv: 0.1,
};
const MIXED_LOAD_ROUTE_TIMEOUT_MS: Readonly<Record<RouteKind, number>> = {
  currentManifest: 2_000,
  search: 2_000,
  analysis: 12_000,
  csv: 15_000,
};
// Parts-per-thousand equivalent of ROUTE_MIX, used for exact integer
// arithmetic: floating-point multiplication (e.g. 100 * 0.55) can land a
// hair off the nearest integer, which would wrongly reject an otherwise
// exact split.
const ROUTE_MIX_PARTS_PER_THOUSAND: Readonly<Record<RouteKind, number>> = {
  currentManifest: 100,
  search: 250,
  analysis: 550,
  csv: 100,
};
const ANALYSIS_HOT_FRACTION = 0.8;
const ANALYSIS_UNCACHED_FRACTION = 0.2;
const MINIMUM_COORDINATED_DISTINCT_KEYS = 4;
const MAXIMUM_COORDINATED_BURST_INTERVAL_SECONDS = 60;
const CANDIDATE_SUSTAINED_REQUESTS_PER_SECOND = 4;
const CANDIDATE_SUSTAINED_SECONDS = 600;
const CANDIDATE_BURST_REQUESTS_PER_SECOND = 10;
const CANDIDATE_BURST_SECONDS = 30;
const ANALYSIS_KEY_PLACEHOLDER = "{analysisKey}";

export type AnalysisKeyClass = "hot" | "distinct";

export type HttpRequestTemplate = {
  readonly method: HttpMethod;
  readonly pathTemplate: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type MixedLoadRouteTemplates = {
  readonly currentManifest: HttpRequestTemplate;
  readonly search: HttpRequestTemplate;
  readonly analysis: HttpRequestTemplate;
  readonly csv: HttpRequestTemplate;
};

export type MixedLoadObservationSnapshot = {
  readonly peakCgroupMemoryFraction: number;
  readonly peakProcessRssFraction: number;
  readonly peakSpillBytes: number;
  readonly sparseOrMedianSpillCount: number;
  readonly minimumVolumeFreeFraction: number;
  readonly sharedCpuBurstBalanceDepleted: boolean;
};

export type MixedLoadObservationEvidence = MixedLoadObservationSnapshot & {
  readonly source: "runtime-prometheus-v1" | "local-smoke-plan-v1";
  readonly sampleCount: number;
};

export interface MixedLoadObservationAdapter {
  observeDuring<Output>(
    work: () => Promise<Output>,
  ): Promise<{
    output: Output;
    observations: MixedLoadObservationEvidence;
  }>;
}

export function createPrometheusMixedLoadObservationAdapter(
  origin: string,
  identity: PerformanceMeasurementIdentity,
  options: {
    readonly sampleIntervalMs?: number;
    readonly fetchImplementation?: typeof fetch;
  } = {},
): MixedLoadObservationAdapter {
  const sampleIntervalMs = options.sampleIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(sampleIntervalMs) || sampleIntervalMs <= 0) {
    throw planError(
      "Prometheus observation sampleIntervalMs must be a positive safe integer.",
    );
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return {
    async observeDuring<Output>(
      work: () => Promise<Output>,
    ): Promise<{
      output: Output;
      observations: MixedLoadObservationEvidence;
    }> {
      const samples: RuntimePrometheusObservation[] = [];
      let sampleChain = Promise.resolve();
      let sampleError: unknown = null;
      const sample = (): Promise<void> => {
        sampleChain = sampleChain
          .then(async () => {
            samples.push(
              await fetchRuntimePrometheusObservation(
                origin,
                identity,
                fetchImplementation,
              ),
            );
          })
          .catch((error: unknown) => {
            sampleError ??= error;
          });
        return sampleChain;
      };

      await sample();
      if (sampleError !== null) {
        throw sampleError;
      }
      const timer = setInterval(() => {
        void sample();
      }, sampleIntervalMs);
      let output: Output;
      try {
        output = await work();
      } finally {
        clearInterval(timer);
      }
      await sampleChain;
      await sample();
      if (sampleError !== null) {
        throw sampleError;
      }
      if (samples.length < 2) {
        throw new HttpPerformanceRunnerError(
          "HTTP_PERFORMANCE_OBSERVATIONS_MISSING",
          "Runtime observation collection retained fewer than two samples.",
        );
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (
        last.cpuPeriods < first.cpuPeriods ||
        last.cpuThrottledPeriods < first.cpuThrottledPeriods
      ) {
        throw new HttpPerformanceRunnerError(
          "HTTP_PERFORMANCE_OBSERVATION_FAILED",
          "Cgroup CPU counters reset during the mixed-load measurement.",
        );
      }
      const peakSpillBytes = Math.max(
        ...samples.map((entry) => entry.spillBytes),
      );
      return {
        output,
        observations: {
          source: "runtime-prometheus-v1",
          sampleCount: samples.length,
          peakCgroupMemoryFraction: Math.max(
            ...samples.map((entry) => entry.cgroupMemoryCurrentFraction),
          ),
          peakProcessRssFraction: Math.max(
            ...samples.map((entry) => entry.processRssFraction),
          ),
          peakSpillBytes,
          sparseOrMedianSpillCount: peakSpillBytes === 0 ? 0 : 1,
          minimumVolumeFreeFraction: Math.min(
            ...samples.map((entry) => entry.volumeFreeFraction),
          ),
          sharedCpuBurstBalanceDepleted:
            last.cpuThrottledPeriods > first.cpuThrottledPeriods,
        },
      };
    },
  };
}

type RuntimePrometheusObservation = {
  readonly cgroupMemoryCurrentFraction: number;
  readonly processRssFraction: number;
  readonly spillBytes: number;
  readonly volumeFreeFraction: number;
  readonly cpuPeriods: number;
  readonly cpuThrottledPeriods: number;
};

async function fetchRuntimePrometheusObservation(
  origin: string,
  identity: PerformanceMeasurementIdentity,
  fetchImplementation: typeof fetch,
): Promise<RuntimePrometheusObservation> {
  const response = await fetchImplementation(new URL("/metrics", origin), {
    cache: "no-store",
    headers: {
      Accept: "text/plain",
      "Cache-Control": "no-cache",
      "X-HS-Tracker-Probe": "external-v1",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) {
    throw new HttpPerformanceRunnerError(
      "HTTP_PERFORMANCE_OBSERVATION_FAILED",
      `Runtime metrics returned HTTP ${response.status}; expected 200.`,
    );
  }
  const body = await response.text();
  const metric = (name: string): number =>
    prometheusIdentityMetric(body, name, identity);
  return {
    cgroupMemoryCurrentFraction: metric(
      "hs_tracker_cgroup_memory_current_fraction",
    ),
    processRssFraction: metric("hs_tracker_process_rss_fraction"),
    spillBytes: metric("hs_tracker_duckdb_spill_bytes"),
    volumeFreeFraction: metric("hs_tracker_volume_free_fraction"),
    cpuPeriods: metric("hs_tracker_cgroup_cpu_periods_total"),
    cpuThrottledPeriods: metric(
      "hs_tracker_cgroup_cpu_throttled_periods_total",
    ),
  };
}

function prometheusIdentityMetric(
  body: string,
  name: string,
  identity: PerformanceMeasurementIdentity,
): number {
  const prefix = `${name}{`;
  const matches = body
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .filter(
      (line) =>
        line.includes(
          `analysis_build_id="${identity.analysisBuildId}"`,
        ) && line.includes(`baci_release="${identity.baciRelease}"`),
    );
  if (matches.length !== 1) {
    throw new HttpPerformanceRunnerError(
      "HTTP_PERFORMANCE_OBSERVATION_FAILED",
      `Runtime metrics must expose exactly one ${name} sample for the measured build and release.`,
    );
  }
  const rawValue = matches[0].slice(matches[0].lastIndexOf(" ") + 1);
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new HttpPerformanceRunnerError(
      "HTTP_PERFORMANCE_OBSERVATION_FAILED",
      `Runtime metric ${name} must be a finite nonnegative number.`,
    );
  }
  return value;
}

export type MixedLoadPlan = {
  readonly schemaVersion: "mixed-load-plan-v1";
  readonly measurementClass: "candidate" | "local-smoke";
  readonly identity: PerformanceMeasurementIdentity;
  readonly origin: string;
  readonly healthCheck: HttpRequestCase;
  readonly identityAssertion?: OriginBenchmarkIdentityAssertion;
  readonly sustainedRequestsPerSecond: number;
  readonly sustainedSeconds: number;
  readonly burstRequestsPerSecond: number;
  readonly burstSeconds: number;
  readonly coordinatedBurstIntervalSeconds: number;
  readonly requestTimeoutMs: number;
  readonly routeTemplates: MixedLoadRouteTemplates;
  readonly analysisHotKeys: readonly string[];
  readonly analysisDistinctKeys: readonly string[];
  readonly maximumRowAnalysisKey: string;
  readonly observations?: MixedLoadObservationSnapshot;
};

function fraction(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw planError(`${label} must be a finite number between 0 and 1.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw planError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw planError(`${label} must be a boolean.`);
  }
  return value;
}

function placeholderOccurrences(pathTemplate: string): number {
  return pathTemplate.split(ANALYSIS_KEY_PLACEHOLDER).length - 1;
}

function validateRequestTemplate(
  value: unknown,
  label: string,
  requiresAnalysisKey: boolean,
): HttpRequestTemplate {
  const template = record(value, label);
  const method = template.method;
  if (method !== "GET" && method !== "HEAD") {
    throw planError(`${label} method must be GET or HEAD.`);
  }
  const pathTemplate = validateRequestPath(
    template.pathTemplate,
    `${label} pathTemplate`,
  );
  const occurrences = placeholderOccurrences(pathTemplate);
  if (requiresAnalysisKey && occurrences !== 1) {
    throw planError(
      `${label} pathTemplate must contain exactly one ${ANALYSIS_KEY_PLACEHOLDER} placeholder.`,
    );
  }
  if (!requiresAnalysisKey && occurrences !== 0) {
    throw planError(
      `${label} pathTemplate must not contain an ${ANALYSIS_KEY_PLACEHOLDER} placeholder.`,
    );
  }
  return {
    method,
    pathTemplate,
    headers: optionalHeaders(template.headers, `${label} headers`),
  };
}

function validateCandidateTradeExplorerTemplate(
  template: HttpRequestTemplate,
  exportCsv: boolean,
): void {
  const marker = "090100";
  const requestUrl = resolveRequestUrl(
    "https://candidate.invalid",
    renderPathTemplate(template.pathTemplate, marker),
  );
  const expectedSuffix = exportCsv ? "/trade-explorer.csv" : "/trade-explorer";
  const query = decodeTradeExplorerQuery(requestUrl.searchParams);
  if (
    !requestUrl.pathname.startsWith("/api/v1/analyses/") ||
    !requestUrl.pathname.endsWith(expectedSuffix) ||
    query === null ||
    query.shape !== "finalized-trend-v1" ||
    query.measures.length !== 2 ||
    query.measures[0] !== "TRADE_VALUE_USD" ||
    query.measures[1] !== "RECORDED_FLOW_COUNT" ||
    query.filters.year.mode !== "list" ||
    query.filters.year.years.length !== 0 ||
    query.filters.exportEconomy.length !== 1 ||
    query.filters.importEconomy.length !== 1 ||
    query.filters.hsProduct.length !== 1 ||
    query.filters.hsProduct[0] !== marker ||
    query.sort !== null
  ) {
    throw planError(
      `Candidate mixed-load ${exportCsv ? "CSV" : "analysis"} template must execute a full-window finalized-trend-v1 Trade Explorer query.`,
    );
  }
}

function validateObservationSnapshot(
  value: unknown,
): MixedLoadObservationSnapshot {
  const observations = record(value, "mixed-load plan observations");
  return {
    peakCgroupMemoryFraction: fraction(
      observations.peakCgroupMemoryFraction,
      "mixed-load plan observations peakCgroupMemoryFraction",
    ),
    peakProcessRssFraction: fraction(
      observations.peakProcessRssFraction,
      "mixed-load plan observations peakProcessRssFraction",
    ),
    peakSpillBytes: nonnegativeInteger(
      observations.peakSpillBytes,
      "mixed-load plan observations peakSpillBytes",
    ),
    sparseOrMedianSpillCount: nonnegativeInteger(
      observations.sparseOrMedianSpillCount,
      "mixed-load plan observations sparseOrMedianSpillCount",
    ),
    minimumVolumeFreeFraction: fraction(
      observations.minimumVolumeFreeFraction,
      "mixed-load plan observations minimumVolumeFreeFraction",
    ),
    sharedCpuBurstBalanceDepleted: booleanValue(
      observations.sharedCpuBurstBalanceDepleted,
      "mixed-load plan observations sharedCpuBurstBalanceDepleted",
    ),
  };
}

export function parseMixedLoadPlan(value: unknown): MixedLoadPlan {
  const plan = record(value, "mixed-load plan");
  if (plan.schemaVersion !== "mixed-load-plan-v1") {
    throw planError("The mixed-load plan schemaVersion must be mixed-load-plan-v1.");
  }
  const measurementClass = measurementClassOf(plan.measurementClass);
  const identity = validateIdentity(plan.identity);
  const origin = validatePlanOrigin(plan.origin, measurementClass);
  const healthCheck = validateRequestCase(
    plan.healthCheck,
    "mixed-load plan healthCheck",
  );
  const identityAssertion = validateIdentityAssertion(plan.identityAssertion);
  const sustainedRequestsPerSecond = positiveInteger(
    plan.sustainedRequestsPerSecond,
    "mixed-load plan sustainedRequestsPerSecond",
  );
  const sustainedSeconds = positiveInteger(
    plan.sustainedSeconds,
    "mixed-load plan sustainedSeconds",
  );
  const burstRequestsPerSecond = positiveInteger(
    plan.burstRequestsPerSecond,
    "mixed-load plan burstRequestsPerSecond",
  );
  const burstSeconds = positiveInteger(
    plan.burstSeconds,
    "mixed-load plan burstSeconds",
  );
  const coordinatedBurstIntervalSeconds = positiveInteger(
    plan.coordinatedBurstIntervalSeconds,
    "mixed-load plan coordinatedBurstIntervalSeconds",
  );
  const requestTimeoutMs = positiveInteger(
    plan.requestTimeoutMs,
    "mixed-load plan requestTimeoutMs",
  );
  if (requestTimeoutMs !== MIXED_LOAD_ROUTE_TIMEOUT_MS.csv) {
    throw planError(
      `mixed-load plan requestTimeoutMs must be ${MIXED_LOAD_ROUTE_TIMEOUT_MS.csv}; the runner applies each route's stricter deadline internally.`,
    );
  }
  const routeTemplatesInput = record(
    plan.routeTemplates,
    "mixed-load plan routeTemplates",
  );
  const routeTemplates: MixedLoadRouteTemplates = {
    currentManifest: validateRequestTemplate(
      routeTemplatesInput.currentManifest,
      "mixed-load plan routeTemplates.currentManifest",
      false,
    ),
    search: validateRequestTemplate(
      routeTemplatesInput.search,
      "mixed-load plan routeTemplates.search",
      false,
    ),
    analysis: validateRequestTemplate(
      routeTemplatesInput.analysis,
      "mixed-load plan routeTemplates.analysis",
      true,
    ),
    csv: validateRequestTemplate(
      routeTemplatesInput.csv,
      "mixed-load plan routeTemplates.csv",
      true,
    ),
  };
  if (measurementClass === "candidate") {
    validateCandidateTradeExplorerTemplate(routeTemplates.analysis, false);
    validateCandidateTradeExplorerTemplate(routeTemplates.csv, true);
  }
  const analysisHotKeys = stringArray(
    plan.analysisHotKeys,
    "mixed-load plan analysisHotKeys",
  );
  uniqueStrings(analysisHotKeys, "mixed-load plan analysisHotKeys");
  const analysisDistinctKeys = stringArray(
    plan.analysisDistinctKeys,
    "mixed-load plan analysisDistinctKeys",
  );
  uniqueStrings(analysisDistinctKeys, "mixed-load plan analysisDistinctKeys");
  if (analysisDistinctKeys.length < MINIMUM_COORDINATED_DISTINCT_KEYS) {
    throw planError(
      `The mixed-load plan analysisDistinctKeys must name at least ${MINIMUM_COORDINATED_DISTINCT_KEYS} keys.`,
    );
  }
  if (analysisHotKeys.some((key) => analysisDistinctKeys.includes(key))) {
    throw planError(
      "The mixed-load plan analysisHotKeys and analysisDistinctKeys must not overlap.",
    );
  }
  const maximumRowAnalysisKey = nonemptyString(
    plan.maximumRowAnalysisKey,
    "mixed-load plan maximumRowAnalysisKey",
  );
  if (!analysisDistinctKeys.includes(maximumRowAnalysisKey)) {
    throw planError(
      "The mixed-load plan maximumRowAnalysisKey must be one of analysisDistinctKeys.",
    );
  }
  if (plan.cacheVerification !== undefined) {
    throw planError(
      "The mixed-load runner uses the deployment-owned probe cache-state header; plan-declared cacheVerification is forbidden.",
    );
  }
  const observations =
    plan.observations === undefined
      ? undefined
      : validateObservationSnapshot(plan.observations);

  if (measurementClass === "candidate") {
    if (
      sustainedRequestsPerSecond !==
      CANDIDATE_SUSTAINED_REQUESTS_PER_SECOND
    ) {
      throw planError(
        `Candidate evidence requires exactly ${CANDIDATE_SUSTAINED_REQUESTS_PER_SECOND} sustained requests per second.`,
      );
    }
    if (sustainedSeconds !== CANDIDATE_SUSTAINED_SECONDS) {
      throw planError(
        `Candidate evidence requires exactly ${CANDIDATE_SUSTAINED_SECONDS} sustained seconds.`,
      );
    }
    if (burstRequestsPerSecond !== CANDIDATE_BURST_REQUESTS_PER_SECOND) {
      throw planError(
        `Candidate evidence requires exactly ${CANDIDATE_BURST_REQUESTS_PER_SECOND} burst requests per second.`,
      );
    }
    if (burstSeconds !== CANDIDATE_BURST_SECONDS) {
      throw planError(
        `Candidate evidence requires exactly ${CANDIDATE_BURST_SECONDS} burst seconds.`,
      );
    }
    if (
      coordinatedBurstIntervalSeconds >
      MAXIMUM_COORDINATED_BURST_INTERVAL_SECONDS
    ) {
      throw planError(
        `Candidate evidence requires coordinatedBurstIntervalSeconds not to exceed ${MAXIMUM_COORDINATED_BURST_INTERVAL_SECONDS} seconds.`,
      );
    }
    if (
      sustainedSeconds % coordinatedBurstIntervalSeconds !==
      0
    ) {
      throw planError(
        "Candidate sustainedSeconds must divide evenly into coordinated burst windows.",
      );
    }
    const sustainedDistinctKeys =
      sustainedRequestsPerSecond *
      sustainedSeconds *
      ROUTE_MIX.analysis *
      ANALYSIS_UNCACHED_FRACTION;
    const coordinatedDistinctKeys =
      (sustainedSeconds / coordinatedBurstIntervalSeconds) *
      MINIMUM_COORDINATED_DISTINCT_KEYS;
    const burstDistinctKeys =
      burstRequestsPerSecond *
      burstSeconds *
      ROUTE_MIX.analysis *
      ANALYSIS_UNCACHED_FRACTION;
    const requiredDistinctKeys =
      sustainedDistinctKeys +
      coordinatedDistinctKeys +
      burstDistinctKeys;
    if (
      !Number.isSafeInteger(requiredDistinctKeys) ||
      analysisDistinctKeys.length < requiredDistinctKeys
    ) {
      throw planError(
        `Candidate evidence requires at least ${requiredDistinctKeys} never-reused distinct analysis keys across sustained, coordinated, and burst traffic.`,
      );
    }
    if (observations !== undefined) {
      throw planError(
        "Candidate evidence must collect runtime observations; plan-declared observations are forbidden.",
      );
    }
  }

  return {
    schemaVersion: "mixed-load-plan-v1",
    measurementClass,
    identity,
    origin,
    healthCheck,
    identityAssertion,
    sustainedRequestsPerSecond,
    sustainedSeconds,
    burstRequestsPerSecond,
    burstSeconds,
    coordinatedBurstIntervalSeconds,
    requestTimeoutMs,
    routeTemplates,
    analysisHotKeys,
    analysisDistinctKeys,
    maximumRowAnalysisKey,
    observations,
  };
}

// A deterministic Bresenham-style weighted round robin: each step every kind
// earns credit proportional to its share of the total slots, and the kind
// with remaining supply and the highest credit is chosen next. It is a pure
// function of the requested counts (never Math.random), so the same plan
// always yields the same schedule.
function weightedRoundRobinSequence<Kind extends string>(
  counts: ReadonlyMap<Kind, number>,
  order: readonly Kind[],
): Kind[] {
  const total = order.reduce((sum, kind) => sum + (counts.get(kind) ?? 0), 0);
  const remaining = new Map<Kind, number>(
    order.map((kind) => [kind, counts.get(kind) ?? 0]),
  );
  const credit = new Map<Kind, number>(order.map((kind) => [kind, 0]));
  const sequence: Kind[] = [];
  for (let step = 0; step < total; step += 1) {
    for (const kind of order) {
      credit.set(kind, (credit.get(kind) ?? 0) + (counts.get(kind) ?? 0) / total);
    }
    let chosen: Kind | null = null;
    let chosenCredit = Number.NEGATIVE_INFINITY;
    for (const kind of order) {
      if ((remaining.get(kind) ?? 0) <= 0) {
        continue;
      }
      const kindCredit = credit.get(kind) ?? 0;
      if (kindCredit > chosenCredit) {
        chosenCredit = kindCredit;
        chosen = kind;
      }
    }
    if (chosen === null) {
      throw scheduleError(
        "The weighted round robin sequence ran out of remaining slots.",
      );
    }
    sequence.push(chosen);
    credit.set(chosen, (credit.get(chosen) ?? 0) - 1);
    remaining.set(chosen, (remaining.get(chosen) ?? 0) - 1);
  }
  return sequence;
}

type SessionSlot = {
  readonly routeKind: RouteKind;
  readonly analysisKey: string | null;
  readonly analysisKeyClass: AnalysisKeyClass | null;
};

function exactRouteMixCounts(perSessionTotal: number): Record<RouteKind, number> {
  const counts = {} as Record<RouteKind, number>;
  for (const kind of ROUTE_KIND_ORDER) {
    const scaled = perSessionTotal * ROUTE_MIX_PARTS_PER_THOUSAND[kind];
    if (scaled % 1_000 !== 0) {
      throw scheduleError(
        `The per-session request total (${perSessionTotal}) must split into an exact ${kind} route-mix count.`,
      );
    }
    counts[kind] = scaled / 1_000;
  }
  return counts;
}

function routeMixCounts(
  total: number,
  requireExact: boolean,
): Record<RouteKind, number> {
  if (requireExact) {
    return exactRouteMixCounts(total);
  }
  const counts = {} as Record<RouteKind, number>;
  const remainders: Array<{ kind: RouteKind; remainder: number }> = [];
  let assigned = 0;
  for (const kind of ROUTE_KIND_ORDER) {
    const scaled = total * ROUTE_MIX_PARTS_PER_THOUSAND[kind];
    counts[kind] = Math.floor(scaled / 1_000);
    assigned += counts[kind];
    remainders.push({ kind, remainder: scaled % 1_000 });
  }
  remainders.sort(
    (left, right) =>
      right.remainder - left.remainder ||
      ROUTE_KIND_ORDER.indexOf(left.kind) -
        ROUTE_KIND_ORDER.indexOf(right.kind),
  );
  for (let index = 0; assigned < total; index += 1, assigned += 1) {
    counts[remainders[index]!.kind] += 1;
  }
  return counts;
}

function buildSessionTemplate(
  perSessionCounts: Readonly<Record<RouteKind, number>>,
  analysisHotKeys: readonly string[],
  analysisDistinctKeys: readonly string[],
  hotKeyCursorOffset: number,
  distinctAnalysisCount: number,
  distinctKeyCursor: { value: number },
): SessionSlot[] {
  const routeSequence = weightedRoundRobinSequence(
    new Map(ROUTE_KIND_ORDER.map((kind) => [kind, perSessionCounts[kind]])),
    ROUTE_KIND_ORDER,
  );

  const analysisCount = perSessionCounts.analysis;
  const hotCount = analysisCount - distinctAnalysisCount;
  const classOrder: readonly AnalysisKeyClass[] = ["hot", "distinct"];
  const analysisClassSequence = weightedRoundRobinSequence(
    new Map<AnalysisKeyClass, number>([
      ["hot", hotCount],
      ["distinct", distinctAnalysisCount],
    ]),
    classOrder,
  );

  let hotKeyCursor = hotKeyCursorOffset;
  let analysisCursor = 0;
  let lastAnalysisKey: string | null = null;
  let lastAnalysisKeyClass: AnalysisKeyClass | null = null;

  return routeSequence.map((routeKind) => {
    if (routeKind === "analysis") {
      const keyClass = analysisClassSequence[analysisCursor];
      analysisCursor += 1;
      const key =
        keyClass === "hot"
          ? analysisHotKeys[hotKeyCursor % analysisHotKeys.length]
          : analysisDistinctKeys[distinctKeyCursor.value];
      if (keyClass === "hot") {
        hotKeyCursor += 1;
      } else {
        if (key === undefined) {
          throw scheduleError(
            "The mixed-load plan does not provide enough never-reused distinct analysis keys.",
          );
        }
        distinctKeyCursor.value += 1;
      }
      lastAnalysisKey = key;
      lastAnalysisKeyClass = keyClass;
      return { routeKind, analysisKey: key, analysisKeyClass: keyClass };
    }
    if (routeKind === "csv") {
      if (lastAnalysisKey === null || lastAnalysisKeyClass === null) {
        throw scheduleError(
          "A csv slot was scheduled before any analysis key was assigned in its session.",
        );
      }
      return {
        routeKind,
        analysisKey: lastAnalysisKey,
        analysisKeyClass: lastAnalysisKeyClass,
      };
    }
    return { routeKind, analysisKey: null, analysisKeyClass: null };
  });
}

export type ScheduledRequest = {
  readonly phase: "sustained" | "coordinated" | "burst";
  readonly sessionId: string;
  readonly sequence: number;
  readonly offsetSeconds: number;
  readonly routeKind: RouteKind;
  readonly analysisKey: string | null;
  readonly analysisKeyClass: AnalysisKeyClass | null;
};

export type MixedLoadSchedule = {
  readonly totalSustainedRequests: number;
  readonly totalCoordinatedRequests: number;
  readonly totalBurstRequests: number;
  readonly perSessionCounts: Readonly<Record<RouteKind, number>>;
  readonly sustained: readonly ScheduledRequest[];
  readonly coordinated: readonly ScheduledRequest[];
  readonly burst: readonly ScheduledRequest[];
  readonly coordinatedWindowSeconds: number;
  readonly usesMaximumRowAnalysisKey: boolean;
};

function buildCoordinatedDistinctKeyBursts(
  distinctKeys: readonly string[],
  sustainedSeconds: number,
  coordinatedBurstIntervalSeconds: number,
): ScheduledRequest[] {
  if (sustainedSeconds % coordinatedBurstIntervalSeconds !== 0) {
    throw scheduleError(
      `The sustained duration (${sustainedSeconds}s) must divide evenly into ${coordinatedBurstIntervalSeconds}s coordinated windows.`,
    );
  }
  const windowCount = sustainedSeconds / coordinatedBurstIntervalSeconds;
  const requiredKeys = windowCount * MINIMUM_COORDINATED_DISTINCT_KEYS;
  if (distinctKeys.length < requiredKeys) {
    throw scheduleError(
      `The coordinated bursts require ${requiredKeys} never-reused distinct analysis keys; received ${distinctKeys.length}.`,
    );
  }
  const coordinated: ScheduledRequest[] = [];
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const offsetSeconds = windowIndex * coordinatedBurstIntervalSeconds;
    const keys = distinctKeys.slice(
      windowIndex * MINIMUM_COORDINATED_DISTINCT_KEYS,
      (windowIndex + 1) * MINIMUM_COORDINATED_DISTINCT_KEYS,
    );
    if (new Set(keys).size !== MINIMUM_COORDINATED_DISTINCT_KEYS) {
      throw scheduleError(
        `Coordinated window ${windowIndex + 1} must use four distinct uncached analysis keys.`,
      );
    }
    keys.forEach((analysisKey, keyIndex) => {
      coordinated.push({
        phase: "coordinated",
        sessionId: `coordinated-${windowIndex}-${keyIndex}`,
        sequence:
          windowIndex * MINIMUM_COORDINATED_DISTINCT_KEYS + keyIndex,
        offsetSeconds,
        routeKind: "analysis",
        analysisKey,
        analysisKeyClass: "distinct",
      });
    });
  }
  return coordinated;
}

export function buildMixedLoadSchedule(
  plan: Pick<
    MixedLoadPlan,
    | "sustainedRequestsPerSecond"
    | "measurementClass"
    | "sustainedSeconds"
    | "burstRequestsPerSecond"
    | "burstSeconds"
    | "coordinatedBurstIntervalSeconds"
    | "analysisHotKeys"
    | "analysisDistinctKeys"
    | "maximumRowAnalysisKey"
  >,
): MixedLoadSchedule {
  const totalSustained =
    plan.sustainedRequestsPerSecond * plan.sustainedSeconds;
  if (totalSustained % SESSION_COUNT !== 0) {
    throw scheduleError(
      `The sustained request total (${totalSustained}) must divide evenly across ${SESSION_COUNT} sessions.`,
    );
  }
  const perSessionTotal = totalSustained / SESSION_COUNT;
  const perSessionCounts = exactRouteMixCounts(perSessionTotal);
  const totalAnalysisRequests = perSessionCounts.analysis * SESSION_COUNT;
  const totalDistinctAnalysisRequests =
    totalAnalysisRequests * ANALYSIS_UNCACHED_FRACTION;
  if (!Number.isSafeInteger(totalDistinctAnalysisRequests)) {
    throw scheduleError(
      "The sustained analysis count must split into an exact 80/20 hot/distinct mix.",
    );
  }
  const distinctKeysWithoutMaximum = plan.analysisDistinctKeys.filter(
    (key) => key !== plan.maximumRowAnalysisKey,
  );
  if (distinctKeysWithoutMaximum.length < totalDistinctAnalysisRequests) {
    throw scheduleError(
      `The sustained schedule requires ${totalDistinctAnalysisRequests} never-reused distinct analysis keys excluding the reserved maximum-row key.`,
    );
  }
  const sustainedDistinctKeys = distinctKeysWithoutMaximum.slice(
    0,
    totalDistinctAnalysisRequests,
  );
  const coordinatedDistinctKeys = [
    plan.maximumRowAnalysisKey,
    ...distinctKeysWithoutMaximum.slice(totalDistinctAnalysisRequests),
  ];
  const baseDistinctPerSession = Math.floor(
    totalDistinctAnalysisRequests / SESSION_COUNT,
  );
  const sessionsWithOneExtraDistinct =
    totalDistinctAnalysisRequests % SESSION_COUNT;
  const distinctKeyCursor = { value: 0 };
  const sessionTemplates: SessionSlot[][] = [];
  for (let sessionIndex = 0; sessionIndex < SESSION_COUNT; sessionIndex += 1) {
    sessionTemplates.push(
      buildSessionTemplate(
        perSessionCounts,
        plan.analysisHotKeys,
        sustainedDistinctKeys,
        sessionIndex,
        baseDistinctPerSession +
          (sessionIndex < sessionsWithOneExtraDistinct ? 1 : 0),
        distinctKeyCursor,
      ),
    );
  }

  const sustained: ScheduledRequest[] = [];
  for (let index = 0; index < totalSustained; index += 1) {
    const sessionIndex = index % SESSION_COUNT;
    const localIndex = Math.floor(index / SESSION_COUNT);
    const slot = sessionTemplates[sessionIndex][localIndex];
    sustained.push({
      phase: "sustained",
      sessionId: `session-${sessionIndex}`,
      sequence: index,
      offsetSeconds: index / plan.sustainedRequestsPerSecond,
      routeKind: slot.routeKind,
      analysisKey: slot.analysisKey,
      analysisKeyClass: slot.analysisKeyClass,
    });
  }

  const totalBurst = plan.burstRequestsPerSecond * plan.burstSeconds;
  const coordinated = buildCoordinatedDistinctKeyBursts(
    coordinatedDistinctKeys,
    plan.sustainedSeconds,
    plan.coordinatedBurstIntervalSeconds,
  );
  const burstCounts = routeMixCounts(
    totalBurst,
    plan.measurementClass === "candidate",
  );
  const exactBurstDistinctCount =
    burstCounts.analysis * ANALYSIS_UNCACHED_FRACTION;
  const burstDistinctCount =
    plan.measurementClass === "candidate"
      ? exactBurstDistinctCount
      : Math.round(exactBurstDistinctCount);
  if (!Number.isSafeInteger(burstDistinctCount)) {
    throw scheduleError(
      "The candidate burst analysis count must split into an exact 80/20 hot/distinct mix.",
    );
  }
  const coordinatedNonMaximumCount = coordinated.length - 1;
  const burstDistinctKeys = distinctKeysWithoutMaximum.slice(
    totalDistinctAnalysisRequests + coordinatedNonMaximumCount,
    totalDistinctAnalysisRequests +
      coordinatedNonMaximumCount +
      burstDistinctCount,
  );
  if (burstDistinctKeys.length !== burstDistinctCount) {
    throw scheduleError(
      `The burst requires ${burstDistinctCount} additional never-reused distinct analysis keys.`,
    );
  }
  const burstTemplate = buildSessionTemplate(
    burstCounts,
    plan.analysisHotKeys,
    burstDistinctKeys,
    0,
    burstDistinctCount,
    { value: 0 },
  );
  const burst: ScheduledRequest[] = burstTemplate.map((slot, index) => ({
    phase: "burst",
    sessionId: "burst",
    sequence: index,
    offsetSeconds: index / plan.burstRequestsPerSecond,
    routeKind: slot.routeKind,
    analysisKey: slot.analysisKey,
    analysisKeyClass: slot.analysisKeyClass,
  }));

  return {
    totalSustainedRequests: totalSustained,
    totalCoordinatedRequests: coordinated.length,
    totalBurstRequests: totalBurst,
    perSessionCounts,
    sustained,
    coordinated,
    burst,
    coordinatedWindowSeconds: plan.coordinatedBurstIntervalSeconds,
    usesMaximumRowAnalysisKey: [...sustained, ...coordinated, ...burst].some(
      (request) => request.analysisKey === plan.maximumRowAnalysisKey,
    ),
  };
}

function renderPathTemplate(
  pathTemplate: string,
  analysisKey: string | null,
): string {
  const occurrences = placeholderOccurrences(pathTemplate);
  if (occurrences === 0) {
    if (analysisKey !== null) {
      throw scheduleError(
        `A route without an ${ANALYSIS_KEY_PLACEHOLDER} placeholder was scheduled with an analysis key.`,
      );
    }
    return pathTemplate;
  }
  if (analysisKey === null) {
    throw scheduleError(
      `A route with an ${ANALYSIS_KEY_PLACEHOLDER} placeholder was scheduled without an analysis key.`,
    );
  }
  return pathTemplate.split(ANALYSIS_KEY_PLACEHOLDER).join(encodeURIComponent(analysisKey));
}

export type MixedLoadCacheViolation = {
  readonly phase: "sustained" | "coordinated" | "burst";
  readonly sessionId: string;
  readonly sequence: number;
  readonly offsetSeconds: number;
  readonly routeKind: RouteKind;
  readonly analysisKey: string | null;
  readonly expected: string;
  readonly actual: string | null;
};

export type MixedLoadFailure = {
  readonly phase: "sustained" | "coordinated" | "burst";
  readonly sessionId: string;
  readonly sequence: number;
  readonly offsetSeconds: number;
  readonly routeKind: RouteKind;
  readonly status: number | null;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
};

export type MixedLoadReport = {
  readonly schemaVersion: "mixed-load-report-v1";
  readonly measurementClass: "candidate" | "local-smoke";
  readonly identity: PerformanceMeasurementIdentity;
  readonly attestation: RuntimeIdentityAttestation;
  readonly origin: string;
  readonly generatedAt: string;
  readonly toolVersion: string;
  readonly targetLoad: TargetLoadInput;
  readonly observations: MixedLoadObservationEvidence;
  readonly firstFailure: MixedLoadFailure | null;
  readonly cacheViolations: readonly MixedLoadCacheViolation[];
  readonly status: "measurement-complete";
};

export type MixedLoadRunnerDependencies = {
  readonly toolVersion?: string;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly observationAdapter?: MixedLoadObservationAdapter;
  readonly attestIdentity?: RuntimeIdentityAttestor;
};

function requiredObservationAdapter(
  plan: MixedLoadPlan,
  adapter: MixedLoadObservationAdapter | undefined,
): MixedLoadObservationAdapter {
  if (adapter !== undefined) {
    return adapter;
  }
  const planObservations = plan.observations;
  if (
    plan.measurementClass === "local-smoke" &&
    planObservations !== undefined
  ) {
    return {
      async observeDuring<Output>(
        work: () => Promise<Output>,
      ): Promise<{
        output: Output;
        observations: MixedLoadObservationEvidence;
      }> {
        return {
          output: await work(),
          observations: {
            ...planObservations,
            source: "local-smoke-plan-v1",
            sampleCount: 0,
          },
        };
      },
    };
  }
  throw new HttpPerformanceRunnerError(
    "HTTP_PERFORMANCE_OBSERVATIONS_MISSING",
    "Mixed-load evidence requires a runtime observation adapter.",
  );
}

const REAL_SLEEP = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

async function primeHotAnalysisKeys(
  plan: MixedLoadPlan,
  executor: HttpBenchmarkExecutor,
): Promise<void> {
  const template = plan.routeTemplates.analysis;
  for (const analysisKey of plan.analysisHotKeys) {
    const outcome = await executor.execute({
      method: template.method,
      url: resolveRequestUrl(
        plan.origin,
        renderPathTemplate(template.pathTemplate, analysisKey),
      ),
      headers: template.headers ?? {},
      timeoutMs: MIXED_LOAD_ROUTE_TIMEOUT_MS.analysis,
    });
    if (outcome.timedOut || !successfulStatus(outcome.status)) {
      throw new HttpPerformanceRunnerError(
        "HTTP_PERFORMANCE_HOT_KEY_PRIME_FAILED",
        `Could not prime hot analysis key ${analysisKey}.`,
      );
    }
  }
}

function compareMixedLoadFailures(
  left: MixedLoadFailure,
  right: MixedLoadFailure,
): number {
  const phaseGroup = (phase: MixedLoadFailure["phase"]): number =>
    phase === "burst" ? 1 : 0;
  return (
    phaseGroup(left.phase) - phaseGroup(right.phase) ||
    left.offsetSeconds - right.offsetSeconds ||
    (left.phase === "sustained" ? 0 : 1) -
      (right.phase === "sustained" ? 0 : 1) ||
    left.sequence - right.sequence
  );
}

export async function runMixedLoad(
  plan: MixedLoadPlan,
  executor: HttpBenchmarkExecutor,
  dependencies: MixedLoadRunnerDependencies = {},
): Promise<MixedLoadReport> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? REAL_SLEEP;
  const schedule = buildMixedLoadSchedule(plan);
  const attestation = await (
    dependencies.attestIdentity ?? attestRuntimeIdentity
  )(plan.origin, plan.identity);
  if (plan.measurementClass === "candidate") {
    const maximumBenchmark = attestation.tradeExplorerBenchmarkQueries.find(
      ({ role }) => role === "maximum-row",
    );
    if (maximumBenchmark === undefined) {
      throw planError(
        "The deployed artifact does not attest a maximum-row Trade Explorer benchmark query.",
      );
    }
    assertTradeExplorerRequestMatchesBenchmark(
      plan.origin,
      {
        method: plan.routeTemplates.analysis.method,
        path: renderPathTemplate(
          plan.routeTemplates.analysis.pathTemplate,
          plan.maximumRowAnalysisKey,
        ),
        headers: plan.routeTemplates.analysis.headers,
      },
      maximumBenchmark,
      "mixed-load maximum-row analysis template",
    );
    assertTradeExplorerRequestMatchesBenchmark(
      plan.origin,
      {
        method: plan.routeTemplates.csv.method,
        path: renderPathTemplate(
          plan.routeTemplates.csv.pathTemplate,
          plan.maximumRowAnalysisKey,
        ),
        headers: plan.routeTemplates.csv.headers,
      },
      maximumBenchmark,
      "mixed-load maximum-row CSV template",
    );
  }

  await assertIdentity(
    plan.origin,
    plan.healthCheck,
    plan.identityAssertion,
    executor,
  );
  await primeHotAnalysisKeys(plan, executor);

  let firstFailure: MixedLoadFailure | null = null;
  const recordFailure = (failure: MixedLoadFailure): void => {
    if (
      firstFailure === null ||
      compareMixedLoadFailures(failure, firstFailure) < 0
    ) {
      firstFailure = failure;
    }
  };
  const cacheViolations: MixedLoadCacheViolation[] = [];
  let queueRejections = 0;
  let unretryableErrors = 0;
  let timeouts = 0;
  const routeSamples: Record<RouteKind, BenchmarkSample[]> = {
    currentManifest: [],
    search: [],
    analysis: [],
    csv: [],
  };

  const executeScheduledRequest = async (
    request: ScheduledRequest,
  ): Promise<void> => {
    const template = plan.routeTemplates[request.routeKind];
    const path = renderPathTemplate(template.pathTemplate, request.analysisKey);
    const url = resolveRequestUrl(plan.origin, path);
    const outcome = await executor.execute({
      method: template.method,
      url,
      headers: template.headers ?? {},
      timeoutMs: MIXED_LOAD_ROUTE_TIMEOUT_MS[request.routeKind],
    });

    if (outcome.timedOut) {
      timeouts += 1;
      if (request.phase === "sustained") {
        routeSamples[request.routeKind].push({
          measurementMs: outcome.elapsedMs,
          routeMs: outcome.elapsedMs,
          payloadBytes: 0,
          status: null,
          timedOut: true,
        });
      }
      recordFailure({
        phase: request.phase,
        sessionId: request.sessionId,
        sequence: request.sequence,
        offsetSeconds: request.offsetSeconds,
        routeKind: request.routeKind,
        status: null,
        timedOut: true,
        elapsedMs: outcome.elapsedMs,
      });
      return;
    }

    if (request.phase === "sustained") {
      routeSamples[request.routeKind].push({
        measurementMs: outcome.totalMs,
        routeMs: outcome.totalMs,
        payloadBytes: outcome.body.byteLength,
        status: outcome.status,
        timedOut: false,
      });
    }

    if (!successfulStatus(outcome.status)) {
      const retryAfter = outcome.header("retry-after");
      if (outcome.status === 503 && retryAfter !== null) {
        queueRejections += 1;
      } else {
        unretryableErrors += 1;
      }
      recordFailure({
        phase: request.phase,
        sessionId: request.sessionId,
        sequence: request.sequence,
        offsetSeconds: request.offsetSeconds,
        routeKind: request.routeKind,
        status: outcome.status,
        timedOut: false,
        elapsedMs: outcome.totalMs,
      });
    }

    if (request.routeKind === "analysis" || request.routeKind === "csv") {
      const expected =
        request.routeKind === "csv" || request.analysisKeyClass === "hot"
          ? CACHE_STATE_HIT
          : CACHE_STATE_MISS;
      const actual = outcome.header(RUNTIME_PROBE_CACHE_STATE_HEADER);
      const matchesExpected =
        actual === expected ||
        (expected === CACHE_STATE_HIT && actual === "coalesced");
      if (!matchesExpected) {
        cacheViolations.push({
          phase: request.phase,
          sessionId: request.sessionId,
          sequence: request.sequence,
          offsetSeconds: request.offsetSeconds,
          routeKind: request.routeKind,
          analysisKey: request.analysisKey,
          expected,
          actual,
        });
      }
    }
  };

  const runScheduledPhase = async (
    requests: readonly ScheduledRequest[],
  ): Promise<void> => {
    await Promise.all(
      requests.map(async (request) => {
        await sleep(request.offsetSeconds * 1_000);
        await executeScheduledRequest(request);
      }),
    );
  };
  const observationResult = await requiredObservationAdapter(
    plan,
    dependencies.observationAdapter,
  ).observeDuring(async () => {
    await runScheduledPhase([
      ...schedule.sustained,
      ...schedule.coordinated,
    ]);
    await runScheduledPhase(schedule.burst);
  });
  const observations = observationResult.observations;

  const targetLoad: TargetLoadInput = {
    sessions: SESSION_COUNT,
    sustainedRequestsPerSecond: plan.sustainedRequestsPerSecond,
    sustainedSeconds: plan.sustainedSeconds,
    routeMix: { ...ROUTE_MIX },
    analysisHotKeyFraction: ANALYSIS_HOT_FRACTION,
    analysisUncachedKeyFraction: ANALYSIS_UNCACHED_FRACTION,
    burstRequestsPerSecond: plan.burstRequestsPerSecond,
    burstSeconds: plan.burstSeconds,
    coordinatedDistinctKeys: MINIMUM_COORDINATED_DISTINCT_KEYS,
    coordinatedBurstIntervalSeconds: plan.coordinatedBurstIntervalSeconds,
    includesMaximumRowProduct: schedule.usesMaximumRowAnalysisKey,
    includesTradeExplorer:
      plan.measurementClass === "candidate" ||
      (plan.routeTemplates.analysis.pathTemplate.includes("/trade-explorer") &&
        plan.routeTemplates.csv.pathTemplate.includes("/trade-explorer.csv")),
    cacheStatesVerified: cacheViolations.length === 0,
    queueRejections,
    unretryableErrors,
    timeouts,
    routeP95Ms: {
      currentManifest: summarizeBenchmarkSamples(routeSamples.currentManifest)
        .p95Ms,
      search: summarizeBenchmarkSamples(routeSamples.search).p95Ms,
      analysis: summarizeBenchmarkSamples(routeSamples.analysis).p95Ms,
      csv: summarizeBenchmarkSamples(routeSamples.csv).p95Ms,
    },
    peakCgroupMemoryFraction: observations.peakCgroupMemoryFraction,
    peakProcessRssFraction: observations.peakProcessRssFraction,
    peakSpillBytes: observations.peakSpillBytes,
    sparseOrMedianSpillCount: observations.sparseOrMedianSpillCount,
    minimumVolumeFreeFraction: observations.minimumVolumeFreeFraction,
    sharedCpuBurstBalanceDepleted: observations.sharedCpuBurstBalanceDepleted,
  };
  const orderedCacheViolations = [...cacheViolations].sort(
    (left, right) =>
      (left.phase === "burst" ? 1 : 0) -
        (right.phase === "burst" ? 1 : 0) ||
      left.offsetSeconds - right.offsetSeconds ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.sequence - right.sequence,
  );

  return {
    schemaVersion: "mixed-load-report-v1",
    measurementClass: plan.measurementClass,
    identity: plan.identity,
    attestation,
    origin: plan.origin,
    generatedAt: utcTimestamp(now()),
    toolVersion: dependencies.toolVersion ?? DEFAULT_TOOL_VERSION,
    targetLoad,
    observations,
    firstFailure,
    cacheViolations: orderedCacheViolations,
    status: "measurement-complete",
  };
}
