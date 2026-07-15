import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  evaluatePerformanceGates,
  PerformanceGateInputError,
  type OriginBenchmarkInput,
  type PerformanceGateInput,
} from "../../src/promotion/performance-gates";

const KIB = 1024;

describe("production performance gates", () => {
  it("accepts complete candidate measurements at every numeric boundary", () => {
    const result = evaluatePerformanceGates(acceptedInput());

    expect(result).toMatchObject({
      schemaVersion: "production-performance-gates-v1",
      status: "accepted",
      gates: {
        measurementContext: { status: "accepted" },
        browserLab: {
          status: "accepted",
          products: {
            median: { trials: 5, status: "accepted" },
            "maximum-row": { trials: 5, status: "accepted" },
          },
        },
        origin: {
          status: "accepted",
          benchmarkCount: 51,
        },
        targetLoad: {
          status: "accepted",
          sustainedSeconds: 600,
          burstSeconds: 30,
        },
        lifecycle: {
          status: "accepted",
          restartToReadyLimitMs: 90_000,
          coldHydrationToReadyLimitMs: 900_000,
          rollbackToReadyLimitMs: 900_000,
        },
      },
    });
  });

  it("blocks a browser threshold miss and retains the measured failure", () => {
    const input = acceptedInput();
    for (const trial of input.browserLab[0].trials.slice(0, 3)) {
      trial.lcpMs = 2_501;
    }

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.browserLab.status).toBe("blocked");
    expect(result.gates.browserLab.products.median).toMatchObject({
      medianLcpMs: 2_501,
      lcpLimitMs: 2_500,
      status: "blocked",
    });
  });

  it("gates user-visible analyze-to-complete-list p75 and p95", () => {
    const input = acceptedInput();
    input.browserLab[0].trials = [
      2_000,
      2_000,
      2_500,
      2_500,
      4_001,
    ].map((analyzeToCompleteListMs) => ({
      ...input.browserLab[0].trials[0],
      analyzeToCompleteListMs,
    }));

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.browserLab.products.median).toMatchObject({
      analyzeToCompleteListP75Ms: 2_500,
      analyzeToCompleteListP95Ms: 4_001,
      status: "blocked",
    });
  });

  it("blocks an analysis p75 miss even when p95 remains within its limit", () => {
    const input = acceptedInput();
    input.browserLab[0].trials = [
      2_000,
      2_000,
      2_500,
      2_501,
      3_000,
    ].map((analyzeToCompleteListMs) => ({
      ...input.browserLab[0].trials[0],
      analyzeToCompleteListMs,
    }));

    const result = evaluatePerformanceGates(input);

    expect(result.gates.browserLab.products.median).toMatchObject({
      analyzeToCompleteListP75Ms: 2_501,
      analyzeToCompleteListP95Ms: 3_000,
      status: "blocked",
    });
  });

  it("blocks zero-valued candidate lifecycle placeholders", () => {
    const input = acceptedInput();
    input.lifecycle.restartToReadyMs = 0;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.lifecycle).toMatchObject({
      hasMeasuredCandidateDurations: false,
      status: "blocked",
    });
  });

  it("blocks a browser product when any attempted trial failed", () => {
    const input = acceptedInput();
    input.browserLab[0].trials.push({
      ...input.browserLab[0].trials[0],
    });
    input.browserLab[0].failedTrialCount = 1;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.browserLab.products.median).toMatchObject({
      trials: 6,
      failedTrialCount: 1,
      status: "blocked",
    });
  });

  it("requires review for a sustained cgroup warning below the hard limit", () => {
    const input = acceptedInput();
    input.targetLoad.peakCgroupMemoryFraction = 0.8;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("review-required");
    expect(result.gates.targetLoad).toMatchObject({
      peakCgroupMemoryFraction: 0.8,
      cgroupWarningFraction: 0.75,
      cgroupLimitFraction: 0.85,
      status: "review-required",
    });
  });

  it("fails closed when a required route/product benchmark is absent", () => {
    const input = acceptedInput();
    input.originBenchmarks = input.originBenchmarks.filter(
      (benchmark) =>
        !(
          benchmark.operation === "candidate-analysis-uncached" &&
          benchmark.productRole === "maximum-row"
        ),
    );

    expect(() => evaluatePerformanceGates(input)).toThrowError(
      new PerformanceGateInputError(
        "Missing origin benchmark candidate-analysis-uncached:maximum-row.",
      ),
    );
  });

  it("requires Trade Trend sparse/median/upper-quartile/maximum-row queries the same way as Candidate Market", () => {
    const input = acceptedInput();
    input.originBenchmarks = input.originBenchmarks.filter(
      (benchmark) =>
        !(
          benchmark.operation === "trade-trend-analysis-uncached" &&
          benchmark.productRole === "sparse"
        ),
    );

    expect(() => evaluatePerformanceGates(input)).toThrowError(
      new PerformanceGateInputError(
        "Missing origin benchmark trade-trend-analysis-uncached:sparse.",
      ),
    );
  });

  it("blocks a Trade Trend origin benchmark that misses its accept/block threshold", () => {
    const input = acceptedInput();
    const benchmark = input.originBenchmarks.find(
      (candidate) =>
        candidate.operation === "trade-trend-analysis-uncached" &&
        candidate.productRole === "maximum-row",
    )!;
    benchmark.p95Ms = 2_001;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(
      result.gates.origin.benchmarks.find(
        (evaluated) =>
          evaluated.operation === "trade-trend-analysis-uncached" &&
          evaluated.productRole === "maximum-row",
      ),
    ).toMatchObject({ p95Ms: 2_001, status: "blocked" });
  });

  it("blocks a benchmark whose declared cache class was not observed", () => {
    const input = acceptedInput();
    input.originBenchmarks[3].cacheStatesVerified = false;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.origin.benchmarks[3]).toMatchObject({
      cacheStatesVerified: false,
      status: "blocked",
    });
  });

  it("never accepts developer-laptop measurements as candidate evidence", () => {
    const input = acceptedInput();
    input.measurementClass = "local-smoke";

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.measurementContext).toEqual({
      measurementClass: "local-smoke",
      requiredMeasurementClass: "candidate",
      status: "blocked",
    });
  });
});

function acceptedInput(): PerformanceGateInput {
  const browserTrial = () => ({
    analyzeToCompleteListMs: 2_500,
    lcpMs: 2_500,
    cls: 0.1,
    interactionToNextPaintMs: 200,
    longestTaskMs: 200,
    criticalCompressedBytes: 200 * KIB,
    totalFirstPartyCompressedBytes: 500 * KIB,
    firstPartyJavaScriptCompressedBytes: 250 * KIB,
    candidateResultBytes: 1_536 * KIB,
    candidateResultCompressedBytes: 300 * KIB,
  });

  return {
    measurementClass: "candidate",
    measuredAt: "2026-07-12T15:30:00Z",
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
    browserLab: [
      {
        productRole: "median",
        trials: Array.from({ length: 5 }, browserTrial),
        failedTrialCount: 0,
      },
      {
        productRole: "maximum-row",
        trials: Array.from({ length: 5 }, browserTrial),
        failedTrialCount: 0,
      },
    ],
    originBenchmarks: completeOriginBenchmarks(),
    targetLoad: {
      sessions: 20,
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      routeMix: {
        currentManifest: 0.1,
        search: 0.25,
        analysis: 0.55,
        csv: 0.1,
      },
      analysisHotKeyFraction: 0.8,
      analysisUncachedKeyFraction: 0.2,
      burstRequestsPerSecond: 10,
      burstSeconds: 30,
      coordinatedDistinctKeys: 4,
      coordinatedBurstIntervalSeconds: 60,
      includesMaximumRowProduct: true,
      cacheStatesVerified: true,
      queueRejections: 0,
      unretryableErrors: 0,
      timeouts: 0,
      routeP95Ms: {
        currentManifest: 100,
        search: 200,
        analysis: 2_000,
        csv: 3_000,
      },
      peakCgroupMemoryFraction: 0.75,
      peakProcessRssFraction: 0.75,
      peakSpillBytes: 4 * 1024 ** 3,
      sparseOrMedianSpillCount: 0,
      minimumVolumeFreeFraction: 0.3,
      sharedCpuBurstBalanceDepleted: true,
    },
    lifecycle: {
      restartToReadyMs: 90_000,
      coldHydrationToReadyMs: 900_000,
      rollbackToReadyMs: 900_000,
      deployInterruptionMs: 120_000,
      recoveryTimeMs: 1_800_000,
      acceptedArtifactLossCount: 0,
    },
  };
}

function completeOriginBenchmarks(): OriginBenchmarkInput[] {
  const singletons: OriginBenchmarkInput["operation"][] = [
    "html-shell",
    "current-manifest",
    "health",
  ];
  const productOperations: OriginBenchmarkInput["operation"][] = [
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
  ];
  const roles = [
    "sparse",
    "median",
    "upper-quartile",
    "maximum-row",
  ] as const;

  return [
    ...singletons.map((operation) => benchmark(operation)),
    ...productOperations.flatMap((operation) =>
      roles.map((role) => benchmark(operation, role)),
    ),
  ];
}

function benchmark(
  operation: OriginBenchmarkInput["operation"],
  productRole?: OriginBenchmarkInput["productRole"],
): OriginBenchmarkInput {
  const thresholds = {
    "html-shell": [200, 500, 2_000],
    "current-manifest": [100, 250, 2_000],
    health: [50, 100, 2_000],
    "economy-search-uncached": [200, 500, 2_000],
    "economy-search-process-hit": [50, 100, 2_000],
    "product-search-uncached": [200, 500, 2_000],
    "product-search-process-hit": [50, 100, 2_000],
    "candidate-analysis-uncached": [2_000, 4_000, 12_000],
    "candidate-analysis-process-hit": [100, 250, 2_000],
    "csv-uncached": [3_000, 6_000, 15_000],
    "csv-analysis-hit": [250, 500, 15_000],
    "trade-trend-analysis-uncached": [2_000, 4_000, 12_000],
    "trade-trend-analysis-process-hit": [100, 250, 2_000],
    "trade-trend-csv-uncached": [3_000, 6_000, 15_000],
    "trade-trend-csv-analysis-hit": [250, 500, 15_000],
  } as const;
  const payloadBytes =
    operation === "current-manifest"
      ? 16 * KIB
      : operation.includes("search")
        ? 64 * KIB
        : operation.startsWith("candidate-analysis") ||
            operation.startsWith("trade-trend-analysis")
          ? 1_536 * KIB
          : operation.startsWith("csv") || operation.startsWith("trade-trend-csv")
            ? 5 * 1024 * KIB
            : 8 * KIB;
  const [p95Ms, p99Ms, deadlineMs] = thresholds[operation];

  return {
    operation,
    productRole,
    warmupSamples: 5,
    timedSamples: 100,
    p50Ms: p95Ms / 2,
    p75Ms: p95Ms * 0.75,
    p95Ms,
    p99Ms,
    maximumRouteMs: deadlineMs,
    cacheStatesVerified: true,
    errors: 0,
    timeouts: 0,
    payloadBytes,
    compressedPayloadBytes:
      operation.startsWith("candidate-analysis") ||
      operation.startsWith("trade-trend-analysis")
        ? 300 * KIB
        : undefined,
  };
}
