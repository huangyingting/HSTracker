import type { DeploymentActivation } from "../domain/release/deployment-activation";
import type { WorkspaceRouteFamily } from "../domain/workspace-route-family";
import type { SourceStatusPollerEvent } from "../runtime/source-status-poller";
import {
  observeRuntimeResources,
  type RuntimeResourceObserver,
} from "./runtime-resource-observations";
import {
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../runtime/runtime-metrics";

const ROUTE_DURATION_BUCKETS_SECONDS = [
  0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 3, 4, 6, 12, 15,
] as const;
const QUEUE_DURATION_BUCKETS_SECONDS = [
  0.05, 0.1, 0.25, 0.5, 1, 2, 5,
] as const;
const QUERY_DURATION_BUCKETS_SECONDS = [
  0.05, 0.1, 0.2, 0.5, 1, 2, 4, 5,
] as const;
const SERIALIZATION_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
] as const;
const RESULT_SIZE_BUCKETS_BYTES = [
  1_024, 16 * 1_024, 64 * 1_024, 300 * 1_024, 1_536 * 1_024,
  5 * 1_024 ** 2,
] as const;
const ANALYSIS_ROW_BUCKETS = [1, 5, 10, 25, 50, 100, 250] as const;

type MetricLabels = Readonly<Record<string, string>>;

type CounterEntry = {
  labels: MetricLabels;
  value: number;
};

type HistogramEntry = {
  labels: MetricLabels;
  buckets: number[];
  count: number;
  sum: number;
};

type RuntimeMetricsGlobal = typeof globalThis & {
  __hsTrackerRuntimeMetricRegistry?: RuntimeMetricRegistry;
  __hsTrackerRuntimeMetricUnsubscribe?: () => void;
};

export class RuntimeMetricRegistry {
  private readonly requestCounts = new Map<string, CounterEntry>();
  private readonly routeDurations = new Map<string, HistogramEntry>();
  private readonly queueDurations = new Map<string, HistogramEntry>();
  private readonly queryDurations = new Map<string, HistogramEntry>();
  private readonly serializationDurations = new Map<
    string,
    HistogramEntry
  >();
  private readonly resultSizes = new Map<string, HistogramEntry>();
  private readonly analysisScanRows = new Map<string, HistogramEntry>();
  private readonly analysisResultRows = new Map<string, HistogramEntry>();
  private readonly workspaceRouteViews = new Map<string, CounterEntry>();
  private latestRequest: RuntimeRequestMetric | null = null;
  private sourceStatusPollFailures = 0;
  private sourceStatusPollConsecutiveFailures = 0;
  private sourceFreshnessAlertLevel: "none" | "warn" | "page" = "none";
  // Bounded-cardinality runtime activation provenance gauges (see issue
  // #45): set once from `ReleaseHydrator.hydrateCurrent()`'s result at
  // startup and never recomputed afterward, matching the process's own
  // fixed activation mode for its lifetime.
  private deploymentActivationMode:
    | "current"
    | "last_verified_resident_fallback" = "current";
  private deploymentActivationFallbackReason:
    | "object_store_unavailable"
    | "current_deployment_invalid"
    | "none" = "none";

  constructor(
    private readonly observeResources: RuntimeResourceObserver =
      observeRuntimeResources,
  ) {}

  observeRequest(metric: RuntimeRequestMetric): void {
    const requestLabels = {
      route_family: metric.routeFamily,
      method: metric.method,
      synthetic: String(metric.synthetic),
      status: String(metric.status),
      cache_state: metric.cacheState,
      recipe_version: metric.recipeVersion,
      outcome_state: metric.outcomeState,
      rejection_reason: metric.rejectionReason ?? "none",
      analysis_build_id: metric.activeAnalysisBuildId,
      baci_release: metric.baciRelease,
    };
    incrementCounter(this.requestCounts, requestLabels);

    const operationLabels = {
      route_family: metric.routeFamily,
      cache_state: metric.cacheState,
      recipe_version: metric.recipeVersion,
      outcome_state: metric.outcomeState,
      rejection_reason: metric.rejectionReason ?? "none",
      analysis_build_id: metric.activeAnalysisBuildId,
      baci_release: metric.baciRelease,
    };
    observeHistogram(
      this.routeDurations,
      operationLabels,
      metric.routeMs / 1_000,
      ROUTE_DURATION_BUCKETS_SECONDS,
    );
    if (metric.queueWaitMs !== null) {
      observeHistogram(
        this.queueDurations,
        operationLabels,
        metric.queueWaitMs / 1_000,
        QUEUE_DURATION_BUCKETS_SECONDS,
      );
    }
    if (metric.queryMs !== null) {
      observeHistogram(
        this.queryDurations,
        operationLabels,
        metric.queryMs / 1_000,
        QUERY_DURATION_BUCKETS_SECONDS,
      );
    }
    observeHistogram(
      this.serializationDurations,
      operationLabels,
      metric.serializationMs / 1_000,
      SERIALIZATION_DURATION_BUCKETS_SECONDS,
    );
    observeHistogram(
      this.resultSizes,
      operationLabels,
      metric.resultBytes,
      RESULT_SIZE_BUCKETS_BYTES,
    );
    if (metric.scanRows !== null) {
      observeHistogram(
        this.analysisScanRows,
        operationLabels,
        metric.scanRows,
        ANALYSIS_ROW_BUCKETS,
      );
    }
    if (metric.resultRows !== null) {
      observeHistogram(
        this.analysisResultRows,
        operationLabels,
        metric.resultRows,
        ANALYSIS_ROW_BUCKETS,
      );
    }
    this.latestRequest = metric;
  }

  observeWorkspaceRouteView(routeFamily: WorkspaceRouteFamily): void {
    incrementCounter(this.workspaceRouteViews, {
      route_family: routeFamily,
    });
  }

  observeSourceStatusPoll(event: SourceStatusPollerEvent): void {
    if (event.type === "status-poll-failed") {
      this.sourceStatusPollFailures += 1;
      this.sourceStatusPollConsecutiveFailures =
        event.consecutiveFailures;
      return;
    }
    if (event.type === "status-poll-succeeded") {
      this.sourceStatusPollConsecutiveFailures = 0;
      return;
    }
    this.sourceFreshnessAlertLevel = event.current.level;
  }

  // Recorded once at startup from `ApplicationRuntime.activation()` (see
  // issue #45); never updated again for this process's lifetime, since
  // object-store recovery never hot-swaps a running process.
  observeDeploymentActivation(activation: DeploymentActivation): void {
    this.deploymentActivationMode =
      activation.mode === "CURRENT"
        ? "current"
        : "last_verified_resident_fallback";
    this.deploymentActivationFallbackReason =
      activation.mode === "LAST_VERIFIED_RESIDENT_FALLBACK"
        ? activation.reason === "OBJECT_STORE_UNAVAILABLE"
          ? "object_store_unavailable"
          : "current_deployment_invalid"
        : "none";
  }

  render(): string {
    const lines = [
      "# HELP hs_tracker_http_requests_total Public request outcomes.",
      "# TYPE hs_tracker_http_requests_total counter",
      ...renderCounters(
        "hs_tracker_http_requests_total",
        this.requestCounts,
      ),
      "# HELP hs_tracker_route_duration_seconds Route completion latency.",
      "# TYPE hs_tracker_route_duration_seconds histogram",
      ...renderHistograms(
        "hs_tracker_route_duration_seconds",
        this.routeDurations,
        ROUTE_DURATION_BUCKETS_SECONDS,
      ),
      "# HELP hs_tracker_analysis_queue_wait_seconds Analytical queue wait.",
      "# TYPE hs_tracker_analysis_queue_wait_seconds histogram",
      ...renderHistograms(
        "hs_tracker_analysis_queue_wait_seconds",
        this.queueDurations,
        QUEUE_DURATION_BUCKETS_SECONDS,
      ),
      "# HELP hs_tracker_duckdb_query_duration_seconds DuckDB query latency.",
      "# TYPE hs_tracker_duckdb_query_duration_seconds histogram",
      ...renderHistograms(
        "hs_tracker_duckdb_query_duration_seconds",
        this.queryDurations,
        QUERY_DURATION_BUCKETS_SECONDS,
      ),
      "# HELP hs_tracker_serialization_duration_seconds Response serialization latency.",
      "# TYPE hs_tracker_serialization_duration_seconds histogram",
      ...renderHistograms(
        "hs_tracker_serialization_duration_seconds",
        this.serializationDurations,
        SERIALIZATION_DURATION_BUCKETS_SECONDS,
      ),
      "# HELP hs_tracker_result_bytes Serialized response bytes.",
      "# TYPE hs_tracker_result_bytes histogram",
      ...renderHistograms(
        "hs_tracker_result_bytes",
        this.resultSizes,
        RESULT_SIZE_BUCKETS_BYTES,
      ),
      "# HELP hs_tracker_analysis_scan_rows Rows scanned by bounded analytical requests.",
      "# TYPE hs_tracker_analysis_scan_rows histogram",
      ...renderHistograms(
        "hs_tracker_analysis_scan_rows",
        this.analysisScanRows,
        ANALYSIS_ROW_BUCKETS,
      ),
      "# HELP hs_tracker_analysis_result_rows Rows returned by bounded analytical requests.",
      "# TYPE hs_tracker_analysis_result_rows histogram",
      ...renderHistograms(
        "hs_tracker_analysis_result_rows",
        this.analysisResultRows,
        ANALYSIS_ROW_BUCKETS,
      ),
      "# HELP hs_tracker_workspace_route_views_total Anonymous Export Market Workspace route-family views.",
      "# TYPE hs_tracker_workspace_route_views_total counter",
      ...renderCounters(
        "hs_tracker_workspace_route_views_total",
        this.workspaceRouteViews,
      ),
      "# HELP hs_tracker_source_status_poll_failures_total Failed Source Freshness Status polls.",
      "# TYPE hs_tracker_source_status_poll_failures_total counter",
      `hs_tracker_source_status_poll_failures_total ${this.sourceStatusPollFailures}`,
      "# HELP hs_tracker_source_status_poll_consecutive_failures Current consecutive poll failures.",
      "# TYPE hs_tracker_source_status_poll_consecutive_failures gauge",
      `hs_tracker_source_status_poll_consecutive_failures ${this.sourceStatusPollConsecutiveFailures}`,
      "# HELP hs_tracker_source_freshness_alert Current Source Freshness Status alert level.",
      "# TYPE hs_tracker_source_freshness_alert gauge",
      ...(["none", "warn", "page"] as const).map(
        (level) =>
          `hs_tracker_source_freshness_alert${labels({ level })} ${
            this.sourceFreshnessAlertLevel === level ? 1 : 0
          }`,
      ),
      "# HELP hs_tracker_deployment_activation_mode Runtime deployment activation provenance: current or last-verified-resident fallback.",
      "# TYPE hs_tracker_deployment_activation_mode gauge",
      ...(["current", "last_verified_resident_fallback"] as const).map(
        (mode) =>
          `hs_tracker_deployment_activation_mode${labels({ mode })} ${
            this.deploymentActivationMode === mode ? 1 : 0
          }`,
      ),
      "# HELP hs_tracker_deployment_activation_fallback_reason Fallback reason category while serving the last verified resident deployment.",
      "# TYPE hs_tracker_deployment_activation_fallback_reason gauge",
      ...(
        [
          "object_store_unavailable",
          "current_deployment_invalid",
          "none",
        ] as const
      ).map(
        (reason) =>
          `hs_tracker_deployment_activation_fallback_reason${labels({ reason })} ${
            this.deploymentActivationFallbackReason === reason ? 1 : 0
          }`,
      ),
      ...this.renderLatestRuntimeGauges(),
    ];
    return `${lines.join("\n")}\n`;
  }

  private renderLatestRuntimeGauges(): string[] {
    const metric = this.latestRequest;
    if (metric === null) {
      return [];
    }
    const identityLabels = {
      analysis_build_id: metric.activeAnalysisBuildId,
      baci_release: metric.baciRelease,
    };
    const resources = this.observeResources();
    return [
      "# HELP hs_tracker_analysis_active Current analytical computations.",
      "# TYPE hs_tracker_analysis_active gauge",
      `hs_tracker_analysis_active${labels(identityLabels)} ${metric.resources.analysisExecution.activeMembers ?? metric.resources.analysisExecution.active}`,
      "# HELP hs_tracker_analysis_queue_depth Current analytical queue depth.",
      "# TYPE hs_tracker_analysis_queue_depth gauge",
      `hs_tracker_analysis_queue_depth${labels(identityLabels)} ${metric.resources.analysisExecution.queuedMembers ?? metric.resources.analysisExecution.queued}`,
      "# HELP hs_tracker_process_rss_bytes Resident process memory.",
      "# TYPE hs_tracker_process_rss_bytes gauge",
      `hs_tracker_process_rss_bytes${labels(identityLabels)} ${metric.process.rssBytes}`,
      "# HELP hs_tracker_process_heap_used_bytes JavaScript heap in use.",
      "# TYPE hs_tracker_process_heap_used_bytes gauge",
      `hs_tracker_process_heap_used_bytes${labels(identityLabels)} ${metric.process.heapUsedBytes}`,
      "# HELP hs_tracker_process_rss_fraction Process RSS divided by the cgroup memory limit.",
      "# TYPE hs_tracker_process_rss_fraction gauge",
      `hs_tracker_process_rss_fraction${labels(identityLabels)} ${formatNumber(resources.processRssFraction)}`,
      "# HELP hs_tracker_cgroup_memory_current_fraction Cgroup memory.current divided by memory.max.",
      "# TYPE hs_tracker_cgroup_memory_current_fraction gauge",
      `hs_tracker_cgroup_memory_current_fraction${labels(identityLabels)} ${formatNumber(resources.cgroupMemoryCurrentFraction)}`,
      "# HELP hs_tracker_duckdb_spill_bytes Current bytes in the bounded DuckDB spill directory.",
      "# TYPE hs_tracker_duckdb_spill_bytes gauge",
      `hs_tracker_duckdb_spill_bytes${labels(identityLabels)} ${resources.spillBytes}`,
      "# HELP hs_tracker_volume_free_fraction Available serving-volume blocks divided by total blocks.",
      "# TYPE hs_tracker_volume_free_fraction gauge",
      `hs_tracker_volume_free_fraction${labels(identityLabels)} ${formatNumber(resources.volumeFreeFraction)}`,
      "# HELP hs_tracker_cgroup_cpu_periods_total Cgroup CPU scheduling periods.",
      "# TYPE hs_tracker_cgroup_cpu_periods_total counter",
      `hs_tracker_cgroup_cpu_periods_total${labels(identityLabels)} ${resources.cpuPeriods}`,
      "# HELP hs_tracker_cgroup_cpu_throttled_periods_total Cgroup CPU periods throttled after shared CPU capacity was exhausted.",
      "# TYPE hs_tracker_cgroup_cpu_throttled_periods_total counter",
      `hs_tracker_cgroup_cpu_throttled_periods_total${labels(identityLabels)} ${resources.cpuThrottledPeriods}`,
      "# HELP hs_tracker_analysis_cache_bytes Analytical result cache bytes.",
      "# TYPE hs_tracker_analysis_cache_bytes gauge",
      `hs_tracker_analysis_cache_bytes${labels(identityLabels)} ${metric.resources.caches.analysis.bytes}`,
      "# HELP hs_tracker_search_cache_bytes Search cache bytes.",
      "# TYPE hs_tracker_search_cache_bytes gauge",
      `hs_tracker_search_cache_bytes${labels(identityLabels)} ${metric.resources.caches.search.bytes}`,
      "# HELP hs_tracker_status_cache_bytes Source Freshness Status cache bytes.",
      "# TYPE hs_tracker_status_cache_bytes gauge",
      `hs_tracker_status_cache_bytes${labels(identityLabels)} ${metric.resources.caches.statusMicroCache.bytes}`,
    ];
  }
}

export function startRuntimeMetricCollection(): RuntimeMetricRegistry {
  const metricsGlobal = globalThis as RuntimeMetricsGlobal;
  metricsGlobal.__hsTrackerRuntimeMetricRegistry ??=
    new RuntimeMetricRegistry();
  metricsGlobal.__hsTrackerRuntimeMetricUnsubscribe ??=
    subscribeRuntimeMetrics((metric) => {
      metricsGlobal.__hsTrackerRuntimeMetricRegistry?.observeRequest(
        metric,
      );
    });
  return metricsGlobal.__hsTrackerRuntimeMetricRegistry;
}

export function runtimeMetricRegistry(): RuntimeMetricRegistry {
  return startRuntimeMetricCollection();
}

export function observeSourceStatusPollMetric(
  event: SourceStatusPollerEvent,
): void {
  runtimeMetricRegistry().observeSourceStatusPoll(event);
}

export function observeDeploymentActivationMetric(
  activation: DeploymentActivation,
): void {
  runtimeMetricRegistry().observeDeploymentActivation(activation);
}

function incrementCounter(
  counters: Map<string, CounterEntry>,
  metricLabels: MetricLabels,
): void {
  const key = labelKey(metricLabels);
  const current = counters.get(key);
  if (current === undefined) {
    counters.set(key, { labels: metricLabels, value: 1 });
    return;
  }
  current.value += 1;
}

function observeHistogram(
  histograms: Map<string, HistogramEntry>,
  metricLabels: MetricLabels,
  value: number,
  buckets: readonly number[],
): void {
  const key = labelKey(metricLabels);
  let histogram = histograms.get(key);
  if (histogram === undefined) {
    histogram = {
      labels: metricLabels,
      buckets: buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    histograms.set(key, histogram);
  }
  histogram.count += 1;
  histogram.sum += value;
  for (let index = 0; index < buckets.length; index += 1) {
    if (value <= buckets[index]) {
      histogram.buckets[index] += 1;
    }
  }
}

function renderCounters(
  name: string,
  counters: ReadonlyMap<string, CounterEntry>,
): string[] {
  return [...counters.values()]
    .sort((left, right) =>
      labelKey(left.labels).localeCompare(labelKey(right.labels)),
    )
    .map(
      (counter) =>
        `${name}${labels(counter.labels)} ${counter.value}`,
    );
}

function renderHistograms(
  name: string,
  histograms: ReadonlyMap<string, HistogramEntry>,
  buckets: readonly number[],
): string[] {
  return [...histograms.values()]
    .sort((left, right) =>
      labelKey(left.labels).localeCompare(labelKey(right.labels)),
    )
    .flatMap((histogram) => [
      ...buckets.map(
        (upperBound, index) =>
          `${name}_bucket${labels({
            ...histogram.labels,
            le: formatNumber(upperBound),
          })} ${histogram.buckets[index]}`,
      ),
      `${name}_bucket${labels({
        ...histogram.labels,
        le: "+Inf",
      })} ${histogram.count}`,
      `${name}_sum${labels(histogram.labels)} ${formatNumber(histogram.sum)}`,
      `${name}_count${labels(histogram.labels)} ${histogram.count}`,
    ]);
}

function labelKey(metricLabels: MetricLabels): string {
  return JSON.stringify(metricLabels);
}

function labels(metricLabels: MetricLabels): string {
  const entries = Object.entries(metricLabels);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries
    .map(
      ([key, value]) =>
        `${key}="${value
          .replaceAll("\\", "\\\\")
          .replaceAll("\n", "\\n")
          .replaceAll('"', '\\"')}"`,
    )
    .join(",")}}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
