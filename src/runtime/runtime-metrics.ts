import { randomUUID } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import type {
  ApplicationRuntime,
  ApplicationRuntimeResources,
  RuntimeOperationObservation,
} from "./application-runtime";

export type RuntimeRouteFamily =
  | "candidate-market"
  | "candidate-market-csv"
  | "product-search"
  | "economy-search"
  | "current-analysis"
  | "health";

export type RuntimeRequestMetric = Readonly<{
  routeFamily: RuntimeRouteFamily;
  method: "GET" | "HEAD";
  synthetic: boolean;
  status: number;
  cacheState: RuntimeOperationObservation["cacheState"] | "bypass";
  activeAnalysisBuildId: string;
  baciRelease: string;
  correlationId: string;
  routeMs: number;
  queueWaitMs: number | null;
  queryMs: number | null;
  serializationMs: number;
  resultBytes: number;
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
        activeAnalysisBuildId: manifest.analysisBuildId,
        baciRelease: manifest.source.baciRelease,
        correlationId,
        routeMs: performance.now() - startedAt,
        queueWaitMs: operation?.queueWaitMs ?? null,
        queryMs: operation?.queryMs ?? null,
        serializationMs,
        resultBytes:
          resultBytes === 0 ? (operation?.resultBytes ?? 0) : resultBytes,
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
  method: "GET" | "HEAD";
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
