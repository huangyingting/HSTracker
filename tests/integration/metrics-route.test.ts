import { describe, expect, it } from "vitest";

import { GET } from "../../src/app/metrics/route";
import { runtimeMetricRegistry } from "../../src/operations/runtime-prometheus-metrics";

describe("runtime metrics route", () => {
  it("serves scrapeable no-store Prometheus text without credentials", async () => {
    runtimeMetricRegistry().observeSourceStatusPoll({
      type: "status-poll-succeeded",
      polledAt: "2026-07-12T16:00:00Z",
      sourceStatusSnapshotId: "source-status-v1-test",
      changed: false,
    });

    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain(
      "# TYPE hs_tracker_source_status_poll_failures_total counter",
    );
    expect(body).not.toContain("HS_TRACKER_RELEASE_");
  });
});
