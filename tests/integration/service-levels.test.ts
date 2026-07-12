import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  evaluateCgroupMemoryAlert,
  evaluateDuckdbSpillAlert,
  evaluateHttp5xxRateAlert,
  evaluateKnownRefreshFailureAlert,
  evaluateMonthlyCostForecastAlert,
  evaluateMonthlyErrorBudget,
  evaluateMonthlyErrorBudgetAlert,
  evaluateProbeSli,
  evaluateProcessRssAlert,
  evaluateQueueWaitAlert,
  evaluateRefreshDurationAlert,
  evaluateRequestSli,
  evaluateRouteLatencyTargetAlert,
  evaluateSharedCpuThrottleAlert,
  evaluateStatusPointerPollAlert,
  evaluateVolumeFreeAlert,
  ServiceLevelValidationError,
  type AlertIdentity,
  type ProbeIdentity,
  type ProbeInterval,
  type RequestOutcomeSample,
  type RouteObservationIdentity,
} from "../../src/operations/service-levels";

const identity: RouteObservationIdentity = {
  routeFamily: "candidate-market-route",
  cacheState: "revalidate",
  analysisBuildId: "build-2026-07-11",
  baciRelease: "V202601",
};

function sample(
  overrides: Partial<RequestOutcomeSample> = {},
): RequestOutcomeSample {
  return {
    ...identity,
    method: "GET",
    synthetic: false,
    timedOut: false,
    status: 200,
    ...overrides,
  };
}

describe("request SLI", () => {
  it("counts 2xx and 304 responses as successful and eligible", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: 200 }),
      sample({ status: 201 }),
      sample({ status: 304 }),
    ]);

    expect(result).toEqual({
      kind: "request-sli",
      identity,
      sampleCount: 3,
      eligibleCount: 3,
      successfulCount: 3,
      failedCount: 0,
      excludedCount: 0,
      measurable: true,
      successFraction: 1,
    });
  });

  it("fails 500, 503, and other unsuccessful statuses", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: 500 }),
      sample({ status: 503 }),
      sample({ status: 429 }),
      sample({ status: 301 }),
    ]);

    expect(result.eligibleCount).toBe(4);
    expect(result.successfulCount).toBe(0);
    expect(result.failedCount).toBe(4);
    expect(result.excludedCount).toBe(0);
    expect(result.successFraction).toBe(0);
  });

  it("fails a timed-out request without a status", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: null, timedOut: true }),
    ]);

    expect(result.eligibleCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.successFraction).toBe(0);
  });

  it("excludes expected client/input statuses 400, 404, 409, and 410 from numerator and denominator", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: 200 }),
      sample({ status: 400 }),
      sample({ status: 404 }),
      sample({ status: 409 }),
      sample({ status: 410 }),
    ]);

    expect(result.sampleCount).toBe(5);
    expect(result.eligibleCount).toBe(1);
    expect(result.successfulCount).toBe(1);
    expect(result.excludedCount).toBe(4);
    expect(result.successFraction).toBe(1);
  });

  it("excludes synthetic requests from numerator and denominator regardless of status", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: 200 }),
      sample({ status: 500, synthetic: true }),
      sample({ status: 200, synthetic: true }),
    ]);

    expect(result.sampleCount).toBe(3);
    expect(result.eligibleCount).toBe(1);
    expect(result.excludedCount).toBe(2);
    expect(result.successFraction).toBe(1);
  });

  it("reports an empty eligible window explicitly rather than as success", () => {
    const result = evaluateRequestSli(identity, [
      sample({ status: 400 }),
      sample({ status: 200, synthetic: true }),
    ]);

    expect(result.sampleCount).toBe(2);
    expect(result.eligibleCount).toBe(0);
    expect(result.measurable).toBe(false);
    expect(result.successFraction).toBeNull();
  });

  it("reports an entirely empty measurement window explicitly", () => {
    const result = evaluateRequestSli(identity, []);

    expect(result).toEqual({
      kind: "request-sli",
      identity,
      sampleCount: 0,
      eligibleCount: 0,
      successfulCount: 0,
      failedCount: 0,
      excludedCount: 0,
      measurable: false,
      successFraction: null,
    });
  });

  it("rejects a window whose declared identity is missing a field", () => {
    expect(() =>
      evaluateRequestSli(
        { ...identity, routeFamily: "" },
        [sample()],
      ),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a window whose samples mix a different route family", () => {
    expect(() =>
      evaluateRequestSli(identity, [
        sample(),
        sample({ routeFamily: "product-catalog-route" }),
      ]),
    ).toThrow(/identity is missing or mixed/u);
  });

  it("rejects a window whose samples mix a different release", () => {
    expect(() =>
      evaluateRequestSli(identity, [
        sample(),
        sample({ baciRelease: "V202602" }),
      ]),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a sample that reports a status while timed out", () => {
    expect(() =>
      evaluateRequestSli(identity, [
        sample({ timedOut: true, status: 200 }),
      ]),
    ).toThrow(/must not report a status while timed out/u);
  });

  it("rejects a sample missing a status while not timed out", () => {
    expect(() =>
      evaluateRequestSli(identity, [sample({ status: null })]),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a sample with a method other than GET or HEAD", () => {
    expect(() =>
      evaluateRequestSli(identity, [
        // @ts-expect-error -- exercising runtime rejection of an invalid method
        sample({ method: "POST" }),
      ]),
    ).toThrow(/method must be GET or HEAD/u);
  });
});

const probeIdentity: ProbeIdentity = {
  analysisBuildId: "build-2026-07-11",
  baciRelease: "V202601",
  fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
  smokeAnalysisKey: "156:010121",
};

function probeInterval(overrides: Partial<ProbeInterval> = {}): ProbeInterval {
  return {
    ...probeIdentity,
    intervalStartedAt: "2026-07-12T16:00:00Z",
    manifestOutcome: "success",
    smokeAnalysisOutcome: "success",
    ...overrides,
  };
}

describe("probe SLI", () => {
  it("succeeds only when both the manifest and the pinned smoke analysis succeed", () => {
    const result = evaluateProbeSli(
      probeIdentity,
      [
        probeInterval(),
        probeInterval({
          intervalStartedAt: "2026-07-12T16:01:00Z",
          smokeAnalysisOutcome: "failure",
        }),
        probeInterval({
          intervalStartedAt: "2026-07-12T16:02:00Z",
          manifestOutcome: "timeout",
        }),
      ],
      {
        startedAt: "2026-07-12T16:00:00Z",
        endedAt: "2026-07-12T16:03:00Z",
      },
    );

    expect(result).toEqual({
      kind: "probe-sli",
      identity: probeIdentity,
      sampleCount: 3,
      successfulCount: 1,
      failedCount: 2,
      measurable: true,
      successFraction: 1 / 3,
    });
  });

  it("reports an empty probe window explicitly rather than as success", () => {
    const result = evaluateProbeSli(probeIdentity, [], {
      startedAt: "2026-07-12T16:00:00Z",
      endedAt: "2026-07-12T16:00:00Z",
    });

    expect(result).toEqual({
      kind: "probe-sli",
      identity: probeIdentity,
      sampleCount: 0,
      successfulCount: 0,
      failedCount: 0,
      measurable: false,
      successFraction: null,
    });
  });

  it("rejects a probe window whose declared identity is missing a field", () => {
    expect(() =>
      evaluateProbeSli(
        { ...probeIdentity, baciRelease: "" },
        [probeInterval()],
        {
          startedAt: "2026-07-12T16:00:00Z",
          endedAt: "2026-07-12T16:01:00Z",
        },
      ),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a probe window whose intervals mix a different build/release identity", () => {
    expect(() =>
      evaluateProbeSli(
        probeIdentity,
        [
          probeInterval(),
          probeInterval({
            intervalStartedAt: "2026-07-12T16:01:00Z",
            analysisBuildId: "build-2026-07-12",
          }),
        ],
        {
          startedAt: "2026-07-12T16:00:00Z",
          endedAt: "2026-07-12T16:02:00Z",
        },
      ),
    ).toThrow(/identity is missing or mixed/u);
  });

  it("rejects an interval with an invalid probe outcome", () => {
    expect(() =>
      evaluateProbeSli(
        probeIdentity,
        [
          // @ts-expect-error -- exercising runtime rejection of an invalid outcome
          probeInterval({ manifestOutcome: "degraded" }),
        ],
        {
          startedAt: "2026-07-12T16:00:00Z",
          endedAt: "2026-07-12T16:01:00Z",
        },
      ),
    ).toThrow(/manifest outcome must be success, failure, or timeout/u);
  });

  it("rejects missing or duplicate one-minute probe intervals", () => {
    expect(() =>
      evaluateProbeSli(
        probeIdentity,
        [probeInterval(), probeInterval()],
        {
          startedAt: "2026-07-12T16:00:00Z",
          endedAt: "2026-07-12T16:02:00Z",
        },
      ),
    ).toThrow(/Probe interval 1 must start at 2026-07-12T16:01:00Z/u);
    expect(() =>
      evaluateProbeSli(probeIdentity, [probeInterval()], {
        startedAt: "2026-07-12T16:00:00Z",
        endedAt: "2026-07-12T16:02:00Z",
      }),
    ).toThrow(/requires exactly 2 one-minute intervals/u);
  });

  it("rejects a probe interval that is not aligned to an exact UTC minute", () => {
    expect(() =>
      evaluateProbeSli(
        probeIdentity,
        [probeInterval({ intervalStartedAt: "2026-07-12T16:00:30Z" })],
        {
          startedAt: "2026-07-12T16:00:00Z",
          endedAt: "2026-07-12T16:01:00Z",
        },
      ),
    ).toThrow(/exact UTC minute timestamp/u);
  });
});

describe("monthly error budget", () => {
  it("reports 0% consumed and ok when there are no failures", () => {
    expect(
      evaluateMonthlyErrorBudget({ eligibleCount: 4000, failedCount: 0 }),
    ).toEqual({
      kind: "monthly-error-budget",
      eligibleCount: 4000,
      failedCount: 0,
      observedFailureFraction: 0,
      consumedFraction: 0,
      targetFraction: 0.995,
      budgetFraction: 0.005,
      status: "ok",
    });
  });

  it("stays ok just below the 50% consumed warn boundary", () => {
    const result = evaluateMonthlyErrorBudget({
      eligibleCount: 4000,
      failedCount: 9,
    });

    expect(result.consumedFraction).toBeCloseTo(0.45, 10);
    expect(result.status).toBe("ok");
  });

  it("warns exactly at the 50% consumed boundary", () => {
    const result = evaluateMonthlyErrorBudget({
      eligibleCount: 4000,
      failedCount: 10,
    });

    expect(result.observedFailureFraction).toBeCloseTo(0.0025, 10);
    expect(result.consumedFraction).toBeCloseTo(0.5, 10);
    expect(result.status).toBe("warn");
  });

  it("stays warn just below the 80% consumed page boundary", () => {
    const result = evaluateMonthlyErrorBudget({
      eligibleCount: 4000,
      failedCount: 15,
    });

    expect(result.consumedFraction).toBeCloseTo(0.75, 10);
    expect(result.status).toBe("warn");
  });

  it("pages exactly at the 80% consumed boundary", () => {
    const result = evaluateMonthlyErrorBudget({
      eligibleCount: 4000,
      failedCount: 16,
    });

    expect(result.consumedFraction).toBeCloseTo(0.8, 10);
    expect(result.status).toBe("page");
  });

  it("remains page for a fully missed monthly SLO", () => {
    const result = evaluateMonthlyErrorBudget({
      eligibleCount: 4000,
      failedCount: 4000,
    });

    expect(result.consumedFraction).toBe(200);
    expect(result.status).toBe("page");
  });

  it("represents an empty eligible window as unmeasured, not success", () => {
    expect(
      evaluateMonthlyErrorBudget({ eligibleCount: 0, failedCount: 0 }),
    ).toEqual({
      kind: "monthly-error-budget",
      eligibleCount: 0,
      failedCount: 0,
      observedFailureFraction: null,
      consumedFraction: null,
      targetFraction: 0.995,
      budgetFraction: 0.005,
      status: "unmeasured",
    });
  });

  it("rejects a failed count greater than the eligible count", () => {
    expect(() =>
      evaluateMonthlyErrorBudget({ eligibleCount: 10, failedCount: 11 }),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a negative eligible count", () => {
    expect(() =>
      evaluateMonthlyErrorBudget({ eligibleCount: -1, failedCount: 0 }),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a non-integer failed count", () => {
    expect(() =>
      evaluateMonthlyErrorBudget({ eligibleCount: 10, failedCount: 1.5 }),
    ).toThrow(ServiceLevelValidationError);
  });
});

const alertIdentity: AlertIdentity = {
  analysisBuildId: "build-2026-07-11",
  baciRelease: "V202601",
};

describe("observability alert: route p95/p99 target", () => {
  it("is ok below the 5-minute warn boundary", () => {
    const result = evaluateRouteLatencyTargetAlert(alertIdentity, {
      metric: "p95",
      missDurationMinutes: 4.9,
    });

    expect(result).toEqual({
      signal: "route-latency-target-miss",
      severity: "ok",
      identity: alertIdentity,
      metric: "p95",
      measuredValue: 4.9,
      warnThreshold: 5,
      pageThreshold: 15,
      sampleCount: null,
    });
  });

  it("warns exactly at the 5-minute boundary", () => {
    const result = evaluateRouteLatencyTargetAlert(alertIdentity, {
      metric: "p95",
      missDurationMinutes: 5,
    });

    expect(result.severity).toBe("warn");
  });

  it("stays warn just below the 15-minute page boundary", () => {
    const result = evaluateRouteLatencyTargetAlert(alertIdentity, {
      metric: "p99",
      missDurationMinutes: 14.9,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages exactly at the 15-minute boundary", () => {
    const result = evaluateRouteLatencyTargetAlert(alertIdentity, {
      metric: "p99",
      missDurationMinutes: 15,
    });

    expect(result.severity).toBe("page");
  });

  it("rejects an invalid metric", () => {
    expect(() =>
      evaluateRouteLatencyTargetAlert(alertIdentity, {
        // @ts-expect-error -- exercising runtime rejection of an invalid metric
        metric: "p50",
        missDurationMinutes: 0,
      }),
    ).toThrow(/metric must be p95 or p99/u);
  });

  it("rejects a negative miss duration", () => {
    expect(() =>
      evaluateRouteLatencyTargetAlert(alertIdentity, {
        metric: "p95",
        missDurationMinutes: -1,
      }),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a missing analysis build identity", () => {
    expect(() =>
      evaluateRouteLatencyTargetAlert(
        { ...alertIdentity, analysisBuildId: "" },
        { metric: "p95", missDurationMinutes: 0 },
      ),
    ).toThrow(ServiceLevelValidationError);
  });
});

describe("observability alert: 500/503 rate", () => {
  it("is ok at exactly the 1% boundary since the threshold is strictly greater-than", () => {
    const result = evaluateHttp5xxRateAlert(alertIdentity, {
      serverErrorCount: 1,
      totalCount: 100,
    });

    expect(result).toEqual({
      signal: "http-5xx-rate",
      severity: "ok",
      identity: alertIdentity,
      measuredValue: 0.01,
      warnThreshold: 0.01,
      pageThreshold: 0.05,
      sampleCount: 100,
    });
  });

  it("warns just above the 1% boundary", () => {
    const result = evaluateHttp5xxRateAlert(alertIdentity, {
      serverErrorCount: 2,
      totalCount: 100,
    });

    expect(result.measuredValue).toBeCloseTo(0.02, 10);
    expect(result.severity).toBe("warn");
  });

  it("stays warn at exactly the 5% boundary since the threshold is strictly greater-than", () => {
    const result = evaluateHttp5xxRateAlert(alertIdentity, {
      serverErrorCount: 5,
      totalCount: 100,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages just above the 5% boundary", () => {
    const result = evaluateHttp5xxRateAlert(alertIdentity, {
      serverErrorCount: 6,
      totalCount: 100,
    });

    expect(result.severity).toBe("page");
  });

  it("fails closed on a zero-request window rather than reporting ok", () => {
    expect(() =>
      evaluateHttp5xxRateAlert(alertIdentity, {
        serverErrorCount: 0,
        totalCount: 0,
      }),
    ).toThrow(ServiceLevelValidationError);
  });

  it("rejects a server error count greater than the total count", () => {
    expect(() =>
      evaluateHttp5xxRateAlert(alertIdentity, {
        serverErrorCount: 11,
        totalCount: 10,
      }),
    ).toThrow(/cannot exceed total count/u);
  });
});

describe("observability alert: queue wait", () => {
  it("is ok at exactly the 1-second boundary since the threshold is strictly greater-than", () => {
    const result = evaluateQueueWaitAlert(alertIdentity, {
      p95WaitSeconds: 1,
      rejectedAtTargetLoad: false,
      depth: 0,
    });

    expect(result).toEqual({
      signal: "queue-wait",
      severity: "ok",
      identity: alertIdentity,
      p95WaitSeconds: 1,
      warnP95Seconds: 1,
      rejectedAtTargetLoad: false,
      depth: 0,
      pageDepth: 16,
      sampleCount: null,
    });
  });

  it("warns just above the 1-second p95 boundary", () => {
    const result = evaluateQueueWaitAlert(alertIdentity, {
      p95WaitSeconds: 1.01,
      rejectedAtTargetLoad: false,
      depth: 0,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages when a request is rejected at target load regardless of depth", () => {
    const result = evaluateQueueWaitAlert(alertIdentity, {
      p95WaitSeconds: 0,
      rejectedAtTargetLoad: true,
      depth: 0,
    });

    expect(result.severity).toBe("page");
  });

  it("stays warn just below the depth-16 page boundary", () => {
    const result = evaluateQueueWaitAlert(alertIdentity, {
      p95WaitSeconds: 1.5,
      rejectedAtTargetLoad: false,
      depth: 15,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages exactly at the depth-16 boundary", () => {
    const result = evaluateQueueWaitAlert(alertIdentity, {
      p95WaitSeconds: 0,
      rejectedAtTargetLoad: false,
      depth: 16,
    });

    expect(result.severity).toBe("page");
  });

  it("rejects a negative depth", () => {
    expect(() =>
      evaluateQueueWaitAlert(alertIdentity, {
        p95WaitSeconds: 0,
        rejectedAtTargetLoad: false,
        depth: -1,
      }),
    ).toThrow(ServiceLevelValidationError);
  });
});

describe("observability alert: shared-CPU throttle", () => {
  it("is ok below the 5% throttle boundary even when sustained", () => {
    const result = evaluateSharedCpuThrottleAlert(alertIdentity, {
      throttledFraction: 0.05,
      sustainedMinutes: 20,
      causedTargetLoadGateFailure: false,
    });

    expect(result).toEqual({
      signal: "shared-cpu-throttle",
      severity: "ok",
      identity: alertIdentity,
      throttledFraction: 0.05,
      warnThreshold: 0.05,
      sustainedMinutes: 20,
      warnSustainedMinutes: 15,
      causedTargetLoadGateFailure: false,
      sampleCount: null,
    });
  });

  it("is ok when throttled above 5% but not sustained for 15 minutes", () => {
    const result = evaluateSharedCpuThrottleAlert(alertIdentity, {
      throttledFraction: 0.2,
      sustainedMinutes: 14.9,
      causedTargetLoadGateFailure: false,
    });

    expect(result.severity).toBe("ok");
  });

  it("warns when throttled above 5% for at least 15 minutes", () => {
    const result = evaluateSharedCpuThrottleAlert(alertIdentity, {
      throttledFraction: 0.06,
      sustainedMinutes: 15,
      causedTargetLoadGateFailure: false,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages only when the throttle causes a target-load gate failure", () => {
    const result = evaluateSharedCpuThrottleAlert(alertIdentity, {
      throttledFraction: 0.06,
      sustainedMinutes: 15,
      causedTargetLoadGateFailure: true,
    });

    expect(result.severity).toBe("page");
  });

  it("rejects a throttled fraction outside the unit range", () => {
    expect(() =>
      evaluateSharedCpuThrottleAlert(alertIdentity, {
        throttledFraction: 1.1,
        sustainedMinutes: 15,
        causedTargetLoadGateFailure: false,
      }),
    ).toThrow(ServiceLevelValidationError);
  });
});

describe("observability alert: DuckDB spill", () => {
  it("is ok with no fixture spill and a low, brief analysis spill fraction", () => {
    const result = evaluateDuckdbSpillAlert(alertIdentity, {
      sparseOrMedianFixtureSpilled: false,
      spilledAnalysisFraction: 0.05,
      sustainedMinutes: 20,
      spillCapOrFilesystemError: false,
    });

    expect(result).toEqual({
      signal: "duckdb-spill",
      severity: "ok",
      identity: alertIdentity,
      sparseOrMedianFixtureSpilled: false,
      spilledAnalysisFraction: 0.05,
      warnAnalysisFractionThreshold: 0.1,
      sustainedMinutes: 20,
      warnSustainedMinutes: 15,
      spillCapOrFilesystemError: false,
      sampleCount: null,
    });
  });

  it("warns on any sparse/median fixture spill regardless of analysis fraction", () => {
    const result = evaluateDuckdbSpillAlert(alertIdentity, {
      sparseOrMedianFixtureSpilled: true,
      spilledAnalysisFraction: 0,
      sustainedMinutes: 0,
      spillCapOrFilesystemError: false,
    });

    expect(result.severity).toBe("warn");
  });

  it("is ok when the analysis fraction is above 10% but not sustained for 15 minutes", () => {
    const result = evaluateDuckdbSpillAlert(alertIdentity, {
      sparseOrMedianFixtureSpilled: false,
      spilledAnalysisFraction: 0.2,
      sustainedMinutes: 14.9,
      spillCapOrFilesystemError: false,
    });

    expect(result.severity).toBe("ok");
  });

  it("warns when the analysis fraction is above 10% for at least 15 minutes", () => {
    const result = evaluateDuckdbSpillAlert(alertIdentity, {
      sparseOrMedianFixtureSpilled: false,
      spilledAnalysisFraction: 0.11,
      sustainedMinutes: 15,
      spillCapOrFilesystemError: false,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages on a spill-cap or filesystem error regardless of other fields", () => {
    const result = evaluateDuckdbSpillAlert(alertIdentity, {
      sparseOrMedianFixtureSpilled: false,
      spilledAnalysisFraction: 0,
      sustainedMinutes: 0,
      spillCapOrFilesystemError: true,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: cgroup memory", () => {
  it("is ok below the 75% warn boundary even when sustained", () => {
    const result = evaluateCgroupMemoryAlert(alertIdentity, {
      usedFraction: 0.75,
      sustainedMinutes: 20,
      oomOccurred: false,
    });

    expect(result).toEqual({
      signal: "cgroup-memory",
      severity: "ok",
      identity: alertIdentity,
      usedFraction: 0.75,
      warnThreshold: 0.75,
      pageThreshold: 0.85,
      sustainedMinutes: 20,
      warnSustainedMinutes: 15,
      oomOccurred: false,
      sampleCount: null,
    });
  });

  it("is ok above 75% when not sustained for 15 minutes", () => {
    const result = evaluateCgroupMemoryAlert(alertIdentity, {
      usedFraction: 0.8,
      sustainedMinutes: 14.9,
      oomOccurred: false,
    });

    expect(result.severity).toBe("ok");
  });

  it("warns above 75% sustained for at least 15 minutes", () => {
    const result = evaluateCgroupMemoryAlert(alertIdentity, {
      usedFraction: 0.8,
      sustainedMinutes: 15,
      oomOccurred: false,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages exactly at the 85% boundary regardless of sustained duration", () => {
    const result = evaluateCgroupMemoryAlert(alertIdentity, {
      usedFraction: 0.85,
      sustainedMinutes: 0,
      oomOccurred: false,
    });

    expect(result.severity).toBe("page");
  });

  it("pages on OOM regardless of used fraction", () => {
    const result = evaluateCgroupMemoryAlert(alertIdentity, {
      usedFraction: 0.1,
      sustainedMinutes: 0,
      oomOccurred: true,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: process RSS", () => {
  it("is ok below the 75% warn boundary even when sustained", () => {
    const result = evaluateProcessRssAlert(alertIdentity, {
      usedFraction: 0.75,
      sustainedMinutes: 20,
    });

    expect(result).toEqual({
      signal: "process-rss",
      severity: "ok",
      identity: alertIdentity,
      usedFraction: 0.75,
      warnThreshold: 0.75,
      pageThreshold: 0.85,
      sustainedMinutes: 20,
      warnSustainedMinutes: 15,
      sampleCount: null,
    });
  });

  it("warns above 75% sustained for at least 15 minutes", () => {
    const result = evaluateProcessRssAlert(alertIdentity, {
      usedFraction: 0.76,
      sustainedMinutes: 15,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages exactly at the 85% boundary regardless of sustained duration", () => {
    const result = evaluateProcessRssAlert(alertIdentity, {
      usedFraction: 0.85,
      sustainedMinutes: 0,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: volume free", () => {
  it("is ok exactly at the 30% boundary since the threshold is strictly less-than", () => {
    const result = evaluateVolumeFreeAlert(alertIdentity, {
      freeFraction: 0.3,
    });

    expect(result).toEqual({
      signal: "volume-free",
      severity: "ok",
      identity: alertIdentity,
      freeFraction: 0.3,
      warnThreshold: 0.3,
      pageThreshold: 0.25,
      sampleCount: null,
    });
  });

  it("warns just below the 30% boundary", () => {
    const result = evaluateVolumeFreeAlert(alertIdentity, {
      freeFraction: 0.29,
    });

    expect(result.severity).toBe("warn");
  });

  it("stays warn exactly at the 25% boundary since the threshold is strictly less-than", () => {
    const result = evaluateVolumeFreeAlert(alertIdentity, {
      freeFraction: 0.25,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages just below the 25% boundary", () => {
    const result = evaluateVolumeFreeAlert(alertIdentity, {
      freeFraction: 0.24,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: status pointer poll", () => {
  it("stays ok just below the 3-consecutive-failures boundary", () => {
    const result = evaluateStatusPointerPollAlert(alertIdentity, {
      consecutiveFailures: 2,
      publicTransition: "none",
    });

    expect(result).toEqual({
      signal: "status-pointer-poll",
      severity: "ok",
      identity: alertIdentity,
      consecutiveFailures: 2,
      warnThreshold: 3,
      publicTransition: "none",
      sampleCount: null,
    });
  });

  it("warns exactly at the 3-consecutive-failures boundary", () => {
    const result = evaluateStatusPointerPollAlert(alertIdentity, {
      consecutiveFailures: 3,
      publicTransition: "none",
    });

    expect(result.severity).toBe("warn");
  });

  it("pages when the public snapshot reaches an overdue transition", () => {
    const result = evaluateStatusPointerPollAlert(alertIdentity, {
      consecutiveFailures: 0,
      publicTransition: "overdue",
    });

    expect(result.severity).toBe("page");
  });

  it("pages when the public snapshot reaches a delayed transition", () => {
    const result = evaluateStatusPointerPollAlert(alertIdentity, {
      consecutiveFailures: 0,
      publicTransition: "delayed",
    });

    expect(result.severity).toBe("page");
  });

  it("rejects an invalid public transition value", () => {
    expect(() =>
      evaluateStatusPointerPollAlert(alertIdentity, {
        consecutiveFailures: 0,
        // @ts-expect-error -- exercising runtime rejection of an invalid transition
        publicTransition: "latest",
      }),
    ).toThrow(/must be none, overdue, or delayed/u);
  });
});

describe("observability alert: known refresh failure", () => {
  it("is ok when no known refresh failure has occurred", () => {
    const result = evaluateKnownRefreshFailureAlert(alertIdentity, {
      occurred: false,
    });

    expect(result).toEqual({
      signal: "known-refresh-failure",
      severity: "ok",
      identity: alertIdentity,
      occurred: false,
      sampleCount: null,
    });
  });

  it("pages immediately when a known refresh failure occurs", () => {
    const result = evaluateKnownRefreshFailureAlert(alertIdentity, {
      occurred: true,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: refresh duration", () => {
  it("is ok exactly at the 24-hour boundary since the threshold is strictly greater-than", () => {
    const result = evaluateRefreshDurationAlert(alertIdentity, {
      durationHours: 24,
    });

    expect(result).toEqual({
      signal: "refresh-duration",
      severity: "ok",
      identity: alertIdentity,
      durationHours: 24,
      warnThreshold: 24,
      pageThreshold: 48,
      sampleCount: null,
    });
  });

  it("warns just above the 24-hour boundary", () => {
    const result = evaluateRefreshDurationAlert(alertIdentity, {
      durationHours: 24.1,
    });

    expect(result.severity).toBe("warn");
  });

  it("stays warn exactly at the 48-hour boundary since the threshold is strictly greater-than", () => {
    const result = evaluateRefreshDurationAlert(alertIdentity, {
      durationHours: 48,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages just above the 48-hour boundary", () => {
    const result = evaluateRefreshDurationAlert(alertIdentity, {
      durationHours: 48.1,
    });

    expect(result.severity).toBe("page");
  });
});

describe("observability alert: monthly error budget", () => {
  it("stays ok just below the 50% consumed boundary", () => {
    const result = evaluateMonthlyErrorBudgetAlert(alertIdentity, {
      consumedFraction: 0.49,
    });

    expect(result).toEqual({
      signal: "monthly-error-budget",
      severity: "ok",
      identity: alertIdentity,
      consumedFraction: 0.49,
      warnThreshold: 0.5,
      pageThreshold: 0.8,
      sampleCount: null,
    });
  });

  it("warns exactly at the 50% consumed boundary", () => {
    const result = evaluateMonthlyErrorBudgetAlert(alertIdentity, {
      consumedFraction: 0.5,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages exactly at the 80% consumed boundary", () => {
    const result = evaluateMonthlyErrorBudgetAlert(alertIdentity, {
      consumedFraction: 0.8,
    });

    expect(result.severity).toBe("page");
  });

  it("remains page for a fully missed monthly SLO", () => {
    const result = evaluateMonthlyErrorBudgetAlert(alertIdentity, {
      consumedFraction: 200,
    });

    expect(result.severity).toBe("page");
  });

  it("rejects a negative consumed fraction", () => {
    expect(() =>
      evaluateMonthlyErrorBudgetAlert(alertIdentity, {
        consumedFraction: -0.1,
      }),
    ).toThrow(ServiceLevelValidationError);
  });
});

describe("observability alert: monthly cost forecast", () => {
  it("is ok exactly at the $40 boundary since the threshold is strictly greater-than", () => {
    const result = evaluateMonthlyCostForecastAlert(alertIdentity, {
      forecastUsd: 40,
      architectureDecisionApproved: false,
    });

    expect(result).toEqual({
      signal: "monthly-cost-forecast",
      severity: "ok",
      identity: alertIdentity,
      forecastUsd: 40,
      warnThreshold: 40,
      pageThreshold: 50,
      architectureDecisionApproved: false,
      sampleCount: null,
    });
  });

  it("warns just above $40", () => {
    const result = evaluateMonthlyCostForecastAlert(alertIdentity, {
      forecastUsd: 40.01,
      architectureDecisionApproved: false,
    });

    expect(result.severity).toBe("warn");
  });

  it("pages just above $50 without an approved architecture decision", () => {
    const result = evaluateMonthlyCostForecastAlert(alertIdentity, {
      forecastUsd: 50.01,
      architectureDecisionApproved: false,
    });

    expect(result.severity).toBe("page");
  });

  it("warns rather than pages above $50 with an approved architecture decision", () => {
    const result = evaluateMonthlyCostForecastAlert(alertIdentity, {
      forecastUsd: 60,
      architectureDecisionApproved: true,
    });

    expect(result.severity).toBe("warn");
  });
});
