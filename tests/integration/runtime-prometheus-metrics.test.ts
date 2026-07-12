import { describe, expect, it } from "vitest";

import { RuntimeMetricRegistry } from "../../src/operations/runtime-prometheus-metrics";
import type { RuntimeRequestMetric } from "../../src/runtime/runtime-metrics";

describe("runtime Prometheus metrics", () => {
  it("renders bounded request, latency, queue, memory, and cache metrics", () => {
    const registry = new RuntimeMetricRegistry(() => ({
      cgroupMemoryCurrentFraction: 0.5,
      processRssFraction: 0.25,
      spillBytes: 4_096,
      volumeFreeFraction: 0.6,
      cpuPeriods: 100,
      cpuThrottledPeriods: 5,
    }));
    registry.observeRequest(metric());
    registry.observeRequest({
      ...metric(),
      status: 503,
      cacheState: "miss",
      correlationId: "must-not-be-exported",
      routeMs: 2_500,
      queueWaitMs: 1_200,
    });

    const output = registry.render();

    expect(output).toContain(
      'hs_tracker_http_requests_total{route_family="candidate-market",method="GET",synthetic="false",status="200",cache_state="hit",analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 1',
    );
    expect(output).toContain(
      'hs_tracker_http_requests_total{route_family="candidate-market",method="GET",synthetic="false",status="503",cache_state="miss",analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 1',
    );
    expect(output).toContain(
      'hs_tracker_route_duration_seconds_bucket{route_family="candidate-market",cache_state="miss",analysis_build_id="analysis-build-v1-test",baci_release="V202601",le="3"} 1',
    );
    expect(output).toContain(
      'hs_tracker_serialization_duration_seconds_bucket{route_family="candidate-market",cache_state="hit",analysis_build_id="analysis-build-v1-test",baci_release="V202601",le="0.01"} 1',
    );
    expect(output).toContain(
      'hs_tracker_result_bytes_bucket{route_family="candidate-market",cache_state="hit",analysis_build_id="analysis-build-v1-test",baci_release="V202601",le="1024"} 1',
    );
    expect(output).toContain(
      'hs_tracker_analysis_queue_depth{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 3',
    );
    expect(output).toContain(
      'hs_tracker_process_rss_bytes{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 536870912',
    );
    expect(output).toContain(
      'hs_tracker_cgroup_memory_current_fraction{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 0.5',
    );
    expect(output).toContain(
      'hs_tracker_process_rss_fraction{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 0.25',
    );
    expect(output).toContain(
      'hs_tracker_duckdb_spill_bytes{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 4096',
    );
    expect(output).toContain(
      'hs_tracker_volume_free_fraction{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 0.6',
    );
    expect(output).toContain(
      'hs_tracker_analysis_cache_bytes{analysis_build_id="analysis-build-v1-test",baci_release="V202601"} 2048',
    );
    expect(output).not.toContain("must-not-be-exported");
    expect(output).not.toContain("/data/releases");
  });

  it("tracks Source Freshness Status poll failures and alert resolution", () => {
    const registry = new RuntimeMetricRegistry(() => ({
      cgroupMemoryCurrentFraction: 0,
      processRssFraction: 0,
      spillBytes: 0,
      volumeFreeFraction: 1,
      cpuPeriods: 0,
      cpuThrottledPeriods: 0,
    }));
    registry.observeSourceStatusPoll({
      type: "status-poll-failed",
      polledAt: "2026-07-12T15:00:00Z",
      consecutiveFailures: 3,
      warningActive: true,
      error: new Error("private endpoint detail"),
    });
    registry.observeSourceStatusPoll({
      type: "freshness-alert-changed",
      observedAt: "2026-07-12T15:01:00Z",
      previous: {
        level: "warn",
        reason: "status-pointer-poll-failures",
      },
      current: { level: "none", reason: null },
    });

    const output = registry.render();

    expect(output).toContain(
      "hs_tracker_source_status_poll_failures_total 1",
    );
    expect(output).toContain(
      "hs_tracker_source_status_poll_consecutive_failures 3",
    );
    expect(output).toContain(
      'hs_tracker_source_freshness_alert{level="none"} 1',
    );
    expect(output).not.toContain("private endpoint detail");
  });
});

function metric(): RuntimeRequestMetric {
  return {
    routeFamily: "candidate-market",
    method: "GET",
    synthetic: false,
    status: 200,
    cacheState: "hit",
    activeAnalysisBuildId: "analysis-build-v1-test",
    baciRelease: "V202601",
    correlationId: "correlation-id",
    routeMs: 40,
    queueWaitMs: 10,
    queryMs: 20,
    serializationMs: 5,
    resultBytes: 1_024,
    resources: {
      analysisExecution: {
        active: 2,
        queued: 3,
        maxConcurrent: 2,
        maxQueued: 16,
      },
      caches: {
        analysis: { entries: 2, bytes: 2_048, maxBytes: 96 * 1024 ** 2 },
        search: { entries: 3, bytes: 4_096, maxBytes: 16 * 1024 ** 2 },
        statusMicroCache: { bytes: 512, maxBytes: 1024 ** 2 },
        safetyReserveBytes: 15 * 1024 ** 2,
      },
      duckDb: {
        connections: 2,
        activeConnections: 1,
        queued: 0,
        threads: 2,
        memoryLimit: "1GiB",
        tempDirectory: "/data/releases/spill",
        maxTempDirectorySize: "4GiB",
      },
    },
    process: {
      rssBytes: 512 * 1024 ** 2,
      heapUsedBytes: 128 * 1024 ** 2,
      constrainedMemoryBytes: 2 * 1024 ** 3,
      availableMemoryBytes: 1024 ** 3,
    },
  };
}
