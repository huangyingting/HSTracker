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
          benchmarkCount: 91,
        },
        tradeExplorer: { status: "accepted" },
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

  it("accepts a local machine-class load without a shared-CPU burst balance", () => {
    const input = acceptedInput();
    input.identity.machineClass = "local";
    input.identity.region = "loc";
    input.targetLoad.cpuPressure = { kind: "dedicated-cpu" };

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("accepted");
    expect(result.gates.targetLoad).toMatchObject({
      cpuPressure: { kind: "dedicated-cpu" },
      requiredCpuPressureKind: "dedicated-cpu",
      cpuPressureStatus: "accepted",
      status: "accepted",
    });
  });

  it("blocks a local machine-class load that reports shared-CPU burst evidence", () => {
    const input = acceptedInput();
    input.identity.machineClass = "local";
    input.identity.region = "loc";
    input.targetLoad.cpuPressure = {
      kind: "shared-cpu-burst-balance",
      depleted: true,
    };

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.targetLoad).toMatchObject({
      requiredCpuPressureKind: "dedicated-cpu",
      cpuPressureStatus: "blocked",
      status: "blocked",
    });
  });

  it("blocks a shared-CPU load whose burst balance was never depleted", () => {
    const input = acceptedInput();
    input.targetLoad.cpuPressure = {
      kind: "shared-cpu-burst-balance",
      depleted: false,
    };

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.targetLoad).toMatchObject({
      requiredCpuPressureKind: "shared-cpu-burst-balance",
      cpuPressureStatus: "blocked",
      status: "blocked",
    });
  });

  it("blocks a shared-CPU load that reports dedicated-CPU evidence", () => {
    const input = acceptedInput();
    input.targetLoad.cpuPressure = { kind: "dedicated-cpu" };

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.targetLoad).toMatchObject({
      requiredCpuPressureKind: "shared-cpu-burst-balance",
      cpuPressureStatus: "blocked",
      status: "blocked",
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

  it("requires Trade Explorer origin evidence for every representative role", () => {
    const input = acceptedInput();
    input.originBenchmarks = input.originBenchmarks.filter(
      (benchmark) =>
        !(
          benchmark.operation === "trade-explorer-csv-analysis-hit" &&
          benchmark.productRole === "upper-quartile"
        ),
    );

    expect(() => evaluatePerformanceGates(input)).toThrowError(
      new PerformanceGateInputError(
        "Missing origin benchmark trade-explorer-csv-analysis-hit:upper-quartile.",
      ),
    );
  });

  it("requires Opportunity feed origin evidence for every representative role", () => {
    const input = acceptedInput();
    input.originBenchmarks = input.originBenchmarks.filter(
      (benchmark) =>
        !(
          benchmark.operation === "opportunity-feed-uncached" &&
          benchmark.productRole === "median"
        ),
    );

    expect(() => evaluatePerformanceGates(input)).toThrowError(
      new PerformanceGateInputError(
        "Missing origin benchmark opportunity-feed-uncached:median.",
      ),
    );
  });

  it("gates Recent Trade Momentum uncached p95 at 200 ms and p99 at 500 ms", () => {
    const input = acceptedInput();
    const accepted = input.originBenchmarks.find(
      (benchmark) =>
        benchmark.operation === "recent-trade-momentum-uncached" &&
        benchmark.productRole === "median",
    )!;
    expect(accepted).toMatchObject({
      p95Ms: 200,
      p99Ms: 500,
      maximumRouteMs: 2_000,
      cacheStatesVerified: true,
    });

    accepted.p95Ms = 201;
    accepted.p99Ms = 501;
    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(
      result.gates.origin.benchmarks.find(
        (evaluated) =>
          evaluated.operation === "recent-trade-momentum-uncached" &&
          evaluated.productRole === "median",
      ),
    ).toMatchObject({
      p95Ms: 201,
      p95LimitMs: 200,
      p99Ms: 501,
      p99LimitMs: 500,
      status: "blocked",
    });
  });

  it("requires Recent Trade Momentum uncached evidence for every representative role", () => {
    const input = acceptedInput();
    input.originBenchmarks = input.originBenchmarks.filter(
      (benchmark) =>
        !(
          benchmark.operation === "recent-trade-momentum-uncached" &&
          benchmark.productRole === "sparse"
        ),
    );

    expect(() => evaluatePerformanceGates(input)).toThrowError(
      new PerformanceGateInputError(
        "Missing origin benchmark recent-trade-momentum-uncached:sparse.",
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

  it("blocks an Opportunity feed benchmark outside its latency or page budget", () => {
    const input = acceptedInput();
    const benchmark = input.originBenchmarks.find(
      (candidate) =>
        candidate.operation === "opportunity-feed-uncached" &&
        candidate.productRole === "maximum-row",
    )!;
    benchmark.p95Ms = 501;
    benchmark.p99Ms = 1_001;
    benchmark.payloadBytes = 256 * KIB + 1;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(
      result.gates.origin.benchmarks.find(
        (evaluated) =>
          evaluated.operation === "opportunity-feed-uncached" &&
          evaluated.productRole === "maximum-row",
      ),
    ).toMatchObject({
      p95Ms: 501,
      p95LimitMs: 500,
      p99Ms: 1_001,
      p99LimitMs: 1_000,
      payloadBytes: 256 * KIB + 1,
      payloadLimitBytes: 256 * KIB,
      status: "blocked",
    });
  });

  it("blocks a Trade Explorer query that exceeds its scan budget", () => {
    const input = acceptedInput();
    const maximumRow = input.tradeExplorer.queries.find(
      (query) => query.productRole === "maximum-row",
    )!;
    maximumRow.scanRows = 251;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.tradeExplorer).toMatchObject({
      status: "blocked",
      reasons: ["maximum-row Trade Explorer scan rows 251 exceed 250."],
    });
  });

  it.each([
    ["resultRows", 251, "result rows 251 exceed 250"],
    ["resultBytes", 1024 * KIB + 1, "result bytes 1048577 exceed 1048576"],
    ["exportBytes", 1024 * KIB + 1, "export bytes 1048577 exceed 1048576"],
    [
      "peakMemoryBytes",
      1024 ** 3 + 1,
      "peak memory bytes 1073741825 exceed 1073741824",
    ],
    [
      "peakSpillBytes",
      4 * 1024 ** 3 + 1,
      "peak spill bytes 4294967297 exceed 4294967296",
    ],
    ["queueWaitMs", 5_001, "queue wait milliseconds 5001 exceed 5000"],
    ["executionMs", 5_001, "execution milliseconds 5001 exceed 5000"],
    [
      "cancellationReleaseMs",
      5_001,
      "cancellation release milliseconds 5001 exceed 5000",
    ],
  ] as const)(
    "blocks a Trade Explorer %s budget violation",
    (field, value, reason) => {
      const input = acceptedInput();
      input.tradeExplorer.queries[0][field] = value;
      if (field === "resultRows") {
        input.tradeExplorer.benchmarkQueries[0].groupedRowCount = value;
      }

      const result = evaluatePerformanceGates(input);

      expect(result.gates.tradeExplorer.reasons).toContain(
        `sparse Trade Explorer ${reason}.`,
      );
      expect(result.status).toBe("blocked");
    },
  );

  it("blocks unless timed-out Trade Explorer work releases capacity", () => {
    const input = acceptedInput();
    const sparse = input.tradeExplorer.queries.find(
      (query) => query.productRole === "sparse",
    )!;
    sparse.cancellationReleased = false;

    const result = evaluatePerformanceGates(input);

    expect(result.status).toBe("blocked");
    expect(result.gates.tradeExplorer.reasons).toContain(
      "sparse Trade Explorer cancellation did not release capacity.",
    );
  });

  it("rejects a zero Trade Explorer execution-time placeholder", () => {
    const input = acceptedInput();
    input.tradeExplorer.queries[0].executionMs = 0;

    expect(() => evaluatePerformanceGates(input)).toThrow(
      "sparse Trade Explorer execution must be a finite positive number.",
    );
  });

  it("rejects Trade Explorer resource evidence that does not match runtime attestation", () => {
    const input = acceptedInput();
    input.tradeExplorer.queries[0].benchmarkQuery.importEconomyCode = "528";

    expect(() => evaluatePerformanceGates(input)).toThrow(
      "sparse Trade Explorer measurement does not match its artifact-attested benchmark query.",
    );
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
    tradeExplorer: {
      benchmarkQueries: ([
        "sparse",
        "median",
        "upper-quartile",
        "maximum-row",
      ] as const).map((role) => ({
        role,
        shape: "finalized-trend-v1" as const,
        measures: [
          "TRADE_VALUE_USD",
          "RECORDED_FLOW_COUNT",
        ] as ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
        exportEconomyCode: "156",
        importEconomyCode: "276",
        hsProductCode: "010121",
        groupedRowCount: 250,
      })),
      queries: ([
        "sparse",
        "median",
        "upper-quartile",
        "maximum-row",
      ] as const).map((productRole) => ({
        productRole,
        benchmarkQuery: {
          shape: "finalized-trend-v1" as const,
          measures: [
            "TRADE_VALUE_USD",
            "RECORDED_FLOW_COUNT",
          ] as ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
          exportEconomyCode: "156",
          importEconomyCode: "276",
          hsProductCode: "010121",
        },
        scanRows: 250,
        resultRows: 250,
        resultBytes: 1024 * KIB,
        exportBytes: 1024 * KIB,
        peakMemoryBytes: 1024 ** 3,
        peakSpillBytes: 4 * 1024 ** 3,
        queueWaitMs: 5_000,
        executionMs: 5_000,
        cancellationReleaseMs: 5_000,
        cancellationReleased: true,
        cacheUnpoisoned: true,
        queueUnpoisoned: true,
        subsequentRequestSucceeded: true,
      })),
    },
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
      includesTradeExplorer: true,
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
      cpuPressure: { kind: "shared-cpu-burst-balance", depleted: true },
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
    "supplier-competition-analysis-uncached": [2_000, 4_000, 12_000],
    "supplier-competition-analysis-process-hit": [100, 250, 2_000],
    "supplier-competition-csv-uncached": [3_000, 6_000, 15_000],
    "supplier-competition-csv-analysis-hit": [250, 500, 15_000],
    "recent-trade-momentum-uncached": [200, 500, 2_000],
    "opportunity-feed-uncached": [500, 1_000, 2_000],
    "trade-explorer-analysis-uncached": [2_000, 4_000, 12_000],
    "trade-explorer-analysis-process-hit": [100, 250, 2_000],
    "trade-explorer-csv-uncached": [3_000, 6_000, 15_000],
    "trade-explorer-csv-analysis-hit": [250, 500, 15_000],
  } as const;
  const payloadBytes =
    operation === "current-manifest"
      ? 16 * KIB
     : operation === "opportunity-feed-uncached"
       ? 256 * KIB
     : operation === "recent-trade-momentum-uncached"
       ? 64 * KIB
     : operation.includes("search")
        ? 64 * KIB
        : operation.startsWith("trade-explorer")
          ? 1024 * KIB
        : operation.startsWith("candidate-analysis") ||
            operation.startsWith("trade-trend-analysis") ||
            operation.startsWith("supplier-competition-analysis") ||
            operation.startsWith("trade-explorer-analysis")
          ? 1_536 * KIB
          : operation.startsWith("csv") ||
              operation.startsWith("trade-trend-csv") ||
              operation.startsWith("supplier-competition-csv") ||
              operation.startsWith("trade-explorer-csv")
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
      operation.startsWith("trade-trend-analysis") ||
      operation.startsWith("supplier-competition-analysis") ||
      operation.startsWith("trade-explorer-analysis")
        ? 300 * KIB
        : undefined,
  };
}
