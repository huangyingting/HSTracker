import { randomUUID } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import type {
  ApplicationRuntime,
  ApplicationRuntimeResources,
  RuntimeOperationObservation,
} from "./application-runtime";
import type { AnalysisRecipe } from "../domain/trade-analytics/trade-analytics-platform";

export type RuntimeRouteFamily =
  | "candidate-market"
  | "candidate-market-csv"
  | "trade-trend"
  | "trade-trend-csv"
  | "recent-trade-momentum"
  | "supplier-competition"
  | "supplier-competition-csv"
  | "market-analysis"
  | "trade-explorer"
  | "trade-explorer-csv"
  | "opportunity-feed"
  | "opportunity-detail"
  | "product-search"
  | "economy-search"
  | "current-analysis"
  | "health";

export type RuntimeRequestMetric = Readonly<{
  routeFamily: RuntimeRouteFamily;
  method: "GET" | "HEAD" | "POST";
  synthetic: boolean;
  status: number;
  cacheState: RuntimeOperationObservation["cacheState"] | "bypass";
  recipeVersion: AnalysisRecipe | "not-applicable";
  outcomeState:
    | NonNullable<RuntimeOperationObservation["outcomeState"]>
    | "not-applicable";
  rejectionReason:
    | NonNullable<RuntimeOperationObservation["rejectionReason"]>
    | "none";
  activeAnalysisBuildId: string;
  baciRelease: string;
  correlationId: string;
  routeMs: number;
  queueWaitMs: number | null;
  queryMs: number | null;
  serializationMs: number;
  resultBytes: number;
  scanRows: number | null;
  resultRows: number | null;
  resources: ApplicationRuntimeResources;
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    constrainedMemoryBytes: number;
    availableMemoryBytes: number;
  };
}>;

export type RuntimeRequestMeasurement = {
  readonly correlationId: string;
  readonly observeOperation: (
    observation: RuntimeOperationObservation,
  ) => void;
  measureSerialization<Result>(
    serialize: () => Result,
    bytes: (result: Result) => number,
  ): Result;
};

type MetricListener = (metric: RuntimeRequestMetric) => void;

const metricsChannel = channel("hs-tracker.runtime.request");
const EXTERNAL_PROBE_HEADER = "x-hs-tracker-probe";
const EXTERNAL_PROBE_VALUE = "external-v1";
export const RUNTIME_PROBE_CACHE_PARTITION_HEADER =
  "X-HS-Tracker-Cache-Partition";
export const RUNTIME_PROBE_CACHE_STATE_HEADER =
  "X-HS-Tracker-Cache-State";

type MetricsGlobal = typeof globalThis & {
  __hsTrackerRuntimeMetricListeners?: Set<MetricListener>;
};

export async function measureRuntimeRequest(
  runtime: ApplicationRuntime,
  routeFamily: RuntimeRouteFamily,
  classification: RuntimeRequestClassification,
  run: (measurement: RuntimeRequestMeasurement) => Promise<Response>,
): Promise<Response> {
  const active = startRuntimeMeasurement(
    runtime,
    routeFamily,
    classification,
  );
  let status = 500;
  try {
    const response = active.annotateProbeResponse(
      await run(active.measurement),
    );
    status = response.status;
    return response;
  } finally {
    active.publishMetric(status);
  }
}

export function measureRuntimeRequestSync(
  runtime: ApplicationRuntime,
  routeFamily: RuntimeRouteFamily,
  classification: RuntimeRequestClassification,
  run: (measurement: RuntimeRequestMeasurement) => Response,
): Response {
  const active = startRuntimeMeasurement(
    runtime,
    routeFamily,
    classification,
  );
  let status = 500;
  try {
    const response = active.annotateProbeResponse(run(active.measurement));
    status = response.status;
    return response;
  } finally {
    active.publishMetric(status);
  }
}

function startRuntimeMeasurement(
  runtime: ApplicationRuntime,
  routeFamily: RuntimeRouteFamily,
  classification: RuntimeRequestClassification,
): {
  measurement: RuntimeRequestMeasurement;
  annotateProbeResponse(response: Response): Response;
  publishMetric(status: number): void;
} {
  const startedAt = performance.now();
  const manifest = runtime.currentAnalysis();
  const correlationId = randomUUID();
  let operation: RuntimeOperationObservation | undefined;
  let serializationMs = 0;
  let resultBytes = 0;
  const measurement: RuntimeRequestMeasurement = {
    correlationId,
    observeOperation(observation) {
      operation = observation;
    },
    measureSerialization(serialize, bytes) {
      const serializationStartedAt = performance.now();
      const result = serialize();
      serializationMs += performance.now() - serializationStartedAt;
      resultBytes = bytes(result);
      return result;
    },
  };

  return {
    measurement,
    annotateProbeResponse(response) {
      if (!classification.synthetic) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set(
        RUNTIME_PROBE_CACHE_STATE_HEADER,
        operation?.cacheState ?? "bypass",
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    publishMetric(status) {
      publishRuntimeMetric({
        routeFamily,
        method: classification.method,
        synthetic: classification.synthetic,
        status,
        cacheState: operation?.cacheState ?? "bypass",
        recipeVersion: operation?.recipeVersion ?? "not-applicable",
        outcomeState: operation?.outcomeState ?? "not-applicable",
        rejectionReason: operation?.rejectionReason ?? "none",
        activeAnalysisBuildId: manifest.analysisBuildId,
        baciRelease: manifest.source.baciRelease,
        correlationId,
        routeMs: performance.now() - startedAt,
        queueWaitMs: operation?.queueWaitMs ?? null,
        queryMs: operation?.queryMs ?? null,
        serializationMs,
        resultBytes:
          resultBytes === 0 ? (operation?.resultBytes ?? 0) : resultBytes,
        scanRows: operation?.scanRows ?? null,
        resultRows: operation?.resultRows ?? null,
        resources: runtime.resources(),
        process: {
          rssBytes: process.memoryUsage.rss(),
          heapUsedBytes: process.memoryUsage().heapUsed,
          constrainedMemoryBytes: process.constrainedMemory(),
          availableMemoryBytes: process.availableMemory(),
        },
      });
    },
  };
}

export type RuntimeRequestClassification = Readonly<{
  method: "GET" | "HEAD" | "POST";
  synthetic: boolean;
}>;

export function classifyRuntimeRequest(
  request: Request | undefined,
  method: RuntimeRequestClassification["method"],
): RuntimeRequestClassification {
  return {
    method,
    synthetic:
      request?.headers.get(EXTERNAL_PROBE_HEADER) ===
      EXTERNAL_PROBE_VALUE,
  };
}

export function runtimeProbeCachePartition(
  request: Request,
): string | undefined {
  if (
    request.headers.get(EXTERNAL_PROBE_HEADER) !==
    EXTERNAL_PROBE_VALUE
  ) {
    return undefined;
  }
  const value = request.headers
    .get(RUNTIME_PROBE_CACHE_PARTITION_HEADER)
    ?.trim();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (value.length > 160 || !/^[A-Za-z0-9:._-]+$/u.test(value)) {
    throw new TypeError(
      "External probe cache partition is malformed.",
    );
  }
  return value;
}

export function subscribeRuntimeMetrics(
  listener: MetricListener,
): () => void {
  const listeners = metricListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publishRuntimeMetric(metric: RuntimeRequestMetric): void {
  metricsChannel.publish(metric);
  for (const listener of metricListeners()) {
    listener(metric);
  }
}

function metricListeners(): Set<MetricListener> {
  const metricsGlobal = globalThis as MetricsGlobal;
  metricsGlobal.__hsTrackerRuntimeMetricListeners ??= new Set();
  return metricsGlobal.__hsTrackerRuntimeMetricListeners;
}
