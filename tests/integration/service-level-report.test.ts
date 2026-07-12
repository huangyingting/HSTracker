import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  evaluateServiceLevelReport,
  ServiceLevelReportInputError,
  type ObservabilityAlertResult,
  type ServiceLevelReportInput,
} from "../../src/operations/service-level-report";

const SIGNALS: readonly ObservabilityAlertResult["signal"][] = [
  "route-latency-target-miss",
  "http-5xx-rate",
  "queue-wait",
  "shared-cpu-throttle",
  "duckdb-spill",
  "cgroup-memory",
  "process-rss",
  "volume-free",
  "status-pointer-poll",
  "known-refresh-failure",
  "refresh-duration",
  "monthly-error-budget",
  "monthly-cost-forecast",
];

describe("production service-level report", () => {
  it("accepts measurable request and probe SLIs with every alert resolved", () => {
    const result = evaluateServiceLevelReport(acceptedInput());

    expect(result).toMatchObject({
      schemaVersion: "production-service-level-report-v1",
      measuredAt: "2026-07-12T16:00:00Z",
      status: "accepted",
      identity: {
        analysisBuildId: "analysis-build-v1-test",
        baciRelease: "V202601",
      },
      requestSli: {
        sampleCount: 2,
        eligibleCount: 2,
        successfulCount: 2,
        failedCount: 0,
        successFraction: 1,
      },
      probeSli: {
        sampleCount: 1,
        successfulCount: 1,
        failedCount: 0,
        successFraction: 1,
      },
      requestErrorBudget: { status: "ok" },
      probeErrorBudget: { status: "ok" },
      alerts: { status: "accepted", count: 13 },
    });
  });

  it("blocks promotion while an operational warning is active", () => {
    const input = acceptedInput();
    input.alerts[7] = {
      ...input.alerts[7],
      severity: "warn",
    };

    const result = evaluateServiceLevelReport(input);

    expect(result.status).toBe("blocked");
    expect(result.alerts).toMatchObject({
      status: "blocked",
      warningCount: 1,
      pageCount: 0,
    });
  });

  it("fails closed when an alert signal is missing", () => {
    const input = acceptedInput();
    input.alerts = input.alerts.filter(
      (alert) => alert.signal !== "duckdb-spill",
    );

    expect(() => evaluateServiceLevelReport(input)).toThrowError(
      new ServiceLevelReportInputError(
        "Missing observability alert result for duckdb-spill.",
      ),
    );
  });
});

function acceptedInput(): ServiceLevelReportInput {
  const identity = {
    analysisBuildId: "analysis-build-v1-test",
    baciRelease: "V202601",
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    smokeAnalysisKey: "156:010121",
  };
  return {
    schemaVersion: "production-service-level-input-v1",
    measuredAt: "2026-07-12T16:00:00Z",
    identity,
    requestWindows: [
      {
        identity: {
          routeFamily: "candidate-market",
          cacheState: "miss",
          analysisBuildId: identity.analysisBuildId,
          baciRelease: identity.baciRelease,
        },
        samples: [
          {
            routeFamily: "candidate-market",
            cacheState: "miss",
            analysisBuildId: identity.analysisBuildId,
            baciRelease: identity.baciRelease,
            method: "GET",
            synthetic: false,
            timedOut: false,
            status: 200,
          },
        ],
      },
      {
        identity: {
          routeFamily: "current-analysis",
          cacheState: "bypass",
          analysisBuildId: identity.analysisBuildId,
          baciRelease: identity.baciRelease,
        },
        samples: [
          {
            routeFamily: "current-analysis",
            cacheState: "bypass",
            analysisBuildId: identity.analysisBuildId,
            baciRelease: identity.baciRelease,
            method: "HEAD",
            synthetic: false,
            timedOut: false,
            status: 304,
          },
        ],
      },
    ],
    probeIntervals: [
      {
        analysisBuildId: identity.analysisBuildId,
        baciRelease: identity.baciRelease,
        fixtureManifestSha256: identity.fixtureManifestSha256,
        smokeAnalysisKey: identity.smokeAnalysisKey,
        intervalStartedAt: "2026-07-12T16:00:00Z",
        manifestOutcome: "success",
        smokeAnalysisOutcome: "success",
      },
    ],
    probeWindow: {
      startedAt: "2026-07-12T16:00:00Z",
      endedAt: "2026-07-12T16:01:00Z",
    },
    alerts: SIGNALS.map((signal) => ({
      signal,
      severity: "ok",
      identity: {
        analysisBuildId: identity.analysisBuildId,
        baciRelease: identity.baciRelease,
      },
      sampleCount: 1,
    })),
  };
}
