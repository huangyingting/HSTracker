import { nonnegativeSafeInteger } from "../deployment/value-validation";
import type { TradeExplorerArtifactBenchmarkQuery } from "../evidence/analysis-artifact-manifest";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "./acceptance-fixture";

const KIB = 1024;
const GIB = 1024 ** 3;

const BROWSER_LIMITS = {
  lcpMs: 2_500,
  cls: 0.1,
  interactionToNextPaintMs: 200,
  longestTaskMs: 200,
  criticalCompressedBytes: 200 * KIB,
  totalFirstPartyCompressedBytes: 500 * KIB,
  firstPartyJavaScriptCompressedBytes: 250 * KIB,
  candidateResultBytes: 1_536 * KIB,
  candidateResultCompressedBytes: 300 * KIB,
  analyzeToCompleteListP75Ms: 2_500,
  analyzeToCompleteListP95Ms: 4_000,
  marketAnalysisToCompleteP75Ms: 2_500,
  marketAnalysisToCompleteP95Ms: 4_000,
} as const;

const TARGET_ROUTE_P95_MS = {
  currentManifest: 100,
  search: 200,
  analysis: 2_000,
  csv: 3_000,
} as const;

export const REQUIRED_PRODUCT_ROLES = [
  "sparse",
  "median",
  "upper-quartile",
  "maximum-row",
] as const;

const PRODUCT_BENCHMARK_OPERATIONS = [
  "economy-search-uncached",
  "economy-search-process-hit",
  "product-search-uncached",
  "product-search-process-hit",
  "candidate-analysis-uncached",
  "candidate-analysis-process-hit",
  "market-analysis-uncached",
  "market-analysis-process-hit",
  "csv-uncached",
  "csv-analysis-hit",
  // Trade Trend reuses the same origin p95/p99 measurement contract as
  // Candidate Market analysis and CSV export (docs/research/2026-07-11-mvp-
  // performance-and-caching-targets.md does not name a separate Trade Trend
  // budget), so its sparse/median/upper-quartile/maximum-row package
  // queries are measured and gated the same way rather than left
  // unmeasured. Real HTTP execution against a deployed candidate remains
  // for #48; this module only supplies the accept/block plumbing.
  "trade-trend-analysis-uncached",
  "trade-trend-analysis-process-hit",
  "trade-trend-csv-uncached",
  "trade-trend-csv-analysis-hit",
  // Supplier Competition follows the identical accept/block plumbing as
  // Trade Trend above; see the comment beside its ORIGIN_THRESHOLDS
  // entries below.
  "supplier-competition-analysis-uncached",
  "supplier-competition-analysis-process-hit",
  "supplier-competition-csv-uncached",
  "supplier-competition-csv-analysis-hit",
  // Recent Trade Momentum is a small, monthly side-evidence route. Its
  // uncached target is deliberately tighter than annual BACI analysis:
  // p95 ≤ 200 ms and p99 ≤ 500 ms on the intended Machine class.
  "recent-trade-momentum-uncached",
  // Opportunity Discovery serves a precomputed exporter-scoped feed from its
  // own index; its recipe doc sets a tighter loaded-artifact uncached budget
  // than the heavier analysis routes.
  "opportunity-feed-uncached",
  "trade-explorer-analysis-uncached",
  "trade-explorer-analysis-process-hit",
  "trade-explorer-csv-uncached",
  "trade-explorer-csv-analysis-hit",
] as const;

export type OriginBenchmarkCapabilities = {
  recentTradeMomentum: boolean;
  opportunityDiscovery: boolean;
};

const ALL_ORIGIN_BENCHMARK_CAPABILITIES: OriginBenchmarkCapabilities = {
  recentTradeMomentum: true,
  opportunityDiscovery: true,
};

const SINGLETON_BENCHMARK_OPERATIONS = [
  "html-shell",
  "current-manifest",
  "health",
] as const;

export type PerformanceGateStatus =
  | "accepted"
  | "review-required"
  | "blocked";

export type PerformanceProductRole =
  (typeof REQUIRED_PRODUCT_ROLES)[number];

export type OriginBenchmarkOperation =
  | (typeof PRODUCT_BENCHMARK_OPERATIONS)[number]
  | (typeof SINGLETON_BENCHMARK_OPERATIONS)[number];

export type PerformanceMeasurementIdentity = {
  fixtureManifestSha256: string;
  buildId: string;
  baciRelease: string;
  analysisBuildId: string;
  productSearchBuildId: string;
  artifactSha256: string;
  machineId: string;
  machineClass: string;
  region: string;
};

export type BrowserLabTrialInput = {
  analyzeToCompleteListMs: number;
  marketAnalysisToCompleteMs: number;
  lcpMs: number;
  cls: number;
  interactionToNextPaintMs: number;
  longestTaskMs: number;
  criticalCompressedBytes: number;
  totalFirstPartyCompressedBytes: number;
  firstPartyJavaScriptCompressedBytes: number;
  candidateResultBytes: number;
  candidateResultCompressedBytes: number;
};

export type BrowserLabProductInput = {
  productRole: "median" | "maximum-row";
  trials: BrowserLabTrialInput[];
  failedTrialCount: number;
};

export type OriginBenchmarkInput = {
  operation: OriginBenchmarkOperation;
  productRole?: PerformanceProductRole;
  warmupSamples: number;
  timedSamples: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumRouteMs: number;
  cacheStatesVerified: boolean;
  errors: number;
  timeouts: number;
  payloadBytes: number;
  compressedPayloadBytes?: number;
};

export type TradeExplorerQueryMeasurementInput = {
  productRole: PerformanceProductRole;
  benchmarkQuery: Pick<
    TradeExplorerArtifactBenchmarkQuery,
    | "shape"
    | "measures"
    | "exportEconomyCode"
    | "importEconomyCode"
    | "hsProductCode"
  >;
  scanRows: number;
  resultRows: number;
  resultBytes: number;
  exportBytes: number;
  peakMemoryBytes: number;
  peakSpillBytes: number;
  queueWaitMs: number;
  executionMs: number;
  cancellationReleaseMs: number;
  cancellationReleased: boolean;
  cacheUnpoisoned: boolean;
  queueUnpoisoned: boolean;
  subsequentRequestSucceeded: boolean;
};

export type TradeExplorerMeasurementInput = {
  queries: TradeExplorerQueryMeasurementInput[];
  benchmarkQueries: readonly TradeExplorerArtifactBenchmarkQuery[];
};

export type TargetLoadCpuPressure =
  | { readonly kind: "shared-cpu-burst-balance"; readonly depleted: boolean }
  | { readonly kind: "dedicated-cpu" };

export type TargetLoadInput = {
  sessions: number;
  sustainedRequestsPerSecond: number;
  sustainedSeconds: number;
  routeMix: {
    currentManifest: number;
    search: number;
    analysis: number;
    csv: number;
  };
  analysisHotKeyFraction: number;
  analysisUncachedKeyFraction: number;
  burstRequestsPerSecond: number;
  burstSeconds: number;
  coordinatedDistinctKeys: number;
  coordinatedBurstIntervalSeconds: number;
  includesMaximumRowProduct: boolean;
  includesTradeExplorer: boolean;
  includesMarketAnalysis: boolean;
  cacheStatesVerified: boolean;
  queueRejections: number;
  unretryableErrors: number;
  timeouts: number;
  routeP95Ms: {
    currentManifest: number;
    search: number;
    analysis: number;
    csv: number;
  };
  peakCgroupMemoryFraction: number;
  peakProcessRssFraction: number;
  peakSpillBytes: number;
  sparseOrMedianSpillCount: number;
  minimumVolumeFreeFraction: number;
  cpuPressure: TargetLoadCpuPressure;
};

export type LifecycleMeasurementInput = {
  restartToReadyMs: number;
  coldHydrationToReadyMs: number;
  rollbackToReadyMs: number;
  deployInterruptionMs: number;
  recoveryTimeMs: number;
  acceptedArtifactLossCount: number;
};

export type PerformanceGateInput = {
  measurementClass: "candidate" | "local-smoke";
  measuredAt: string;
  identity: PerformanceMeasurementIdentity;
  browserLab: BrowserLabProductInput[];
  originCapabilities: OriginBenchmarkCapabilities;
  originBenchmarks: OriginBenchmarkInput[];
  tradeExplorer: TradeExplorerMeasurementInput;
  targetLoad: TargetLoadInput;
  lifecycle: LifecycleMeasurementInput;
};

export class PerformanceGateInputError extends Error {
  readonly code = "PERFORMANCE_GATE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PerformanceGateInputError";
  }
}

type OriginThreshold = {
  p95LimitMs: number;
  p99LimitMs: number;
  routeDeadlineMs: number;
  payloadLimitBytes?: number;
  compressedPayloadLimitBytes?: number;
};

const ORIGIN_THRESHOLDS: Record<
  OriginBenchmarkOperation,
  OriginThreshold
> = {
  "html-shell": {
    p95LimitMs: 200,
    p99LimitMs: 500,
    routeDeadlineMs: 2_000,
  },
  "current-manifest": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 16 * KIB,
  },
  health: {
    p95LimitMs: 50,
    p99LimitMs: 100,
    routeDeadlineMs: 2_000,
  },
  "economy-search-uncached": {
    p95LimitMs: 200,
    p99LimitMs: 500,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 64 * KIB,
  },
  "economy-search-process-hit": {
    p95LimitMs: 50,
    p99LimitMs: 100,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 64 * KIB,
  },
  "product-search-uncached": {
    p95LimitMs: 200,
    p99LimitMs: 500,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 64 * KIB,
  },
  "product-search-process-hit": {
    p95LimitMs: 50,
    p99LimitMs: 100,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 64 * KIB,
  },
  "candidate-analysis-uncached": {
    p95LimitMs: 2_000,
    p99LimitMs: 4_000,
    routeDeadlineMs: 12_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "candidate-analysis-process-hit": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "market-analysis-uncached": {
    p95LimitMs: 2_500,
    p99LimitMs: 5_000,
    routeDeadlineMs: 12_000,
    payloadLimitBytes: 1024 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "market-analysis-process-hit": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 1024 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "csv-uncached": {
    p95LimitMs: 3_000,
    p99LimitMs: 6_000,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  "csv-analysis-hit": {
    p95LimitMs: 250,
    p99LimitMs: 500,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  "trade-trend-analysis-uncached": {
    p95LimitMs: 2_000,
    p99LimitMs: 4_000,
    routeDeadlineMs: 12_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "trade-trend-analysis-process-hit": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "trade-trend-csv-uncached": {
    p95LimitMs: 3_000,
    p99LimitMs: 6_000,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  "trade-trend-csv-analysis-hit": {
    p95LimitMs: 250,
    p99LimitMs: 500,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  // Supplier Competition reuses the identical origin p95/p99 measurement
  // contract as Trade Trend above, for the same reason: no separate budget
  // is named in docs/research/2026-07-11-mvp-performance-and-caching-
  // targets.md, so its sparse/median/upper-quartile/maximum-row package
  // queries and CSV hits/misses are measured and gated the same way.
  "supplier-competition-analysis-uncached": {
    p95LimitMs: 2_000,
    p99LimitMs: 4_000,
    routeDeadlineMs: 12_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "supplier-competition-analysis-process-hit": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 1_536 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "supplier-competition-csv-uncached": {
    p95LimitMs: 3_000,
    p99LimitMs: 6_000,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  "supplier-competition-csv-analysis-hit": {
    p95LimitMs: 250,
    p99LimitMs: 500,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 5 * 1024 * KIB,
  },
  "recent-trade-momentum-uncached": {
    p95LimitMs: 200,
    p99LimitMs: 500,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 64 * KIB,
  },
  "opportunity-feed-uncached": {
    p95LimitMs: 500,
    p99LimitMs: 1_000,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 256 * KIB,
  },
  "trade-explorer-analysis-uncached": {
    p95LimitMs: 2_000,
    p99LimitMs: 4_000,
    routeDeadlineMs: 12_000,
    payloadLimitBytes: 1024 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "trade-explorer-analysis-process-hit": {
    p95LimitMs: 100,
    p99LimitMs: 250,
    routeDeadlineMs: 2_000,
    payloadLimitBytes: 1024 * KIB,
    compressedPayloadLimitBytes: 300 * KIB,
  },
  "trade-explorer-csv-uncached": {
    p95LimitMs: 3_000,
    p99LimitMs: 6_000,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 1024 * KIB,
  },
  "trade-explorer-csv-analysis-hit": {
    p95LimitMs: 250,
    p99LimitMs: 500,
    routeDeadlineMs: 15_000,
    payloadLimitBytes: 1024 * KIB,
  },
};

export function evaluatePerformanceGates(input: PerformanceGateInput) {
  validateMeasurementIdentity(input.identity);
  utcTimestamp(input.measuredAt, "performance measuredAt");

  const measurementContext = {
    measurementClass: input.measurementClass,
    requiredMeasurementClass: "candidate" as const,
    status: (
      input.measurementClass === "candidate" ? "accepted" : "blocked"
    ) as PerformanceGateStatus,
  };
  const browserLab = evaluateBrowserLab(input.browserLab);
  const origin = evaluateOriginBenchmarks(
    input.originBenchmarks,
    input.originCapabilities,
  );
  const tradeExplorer = evaluateTradeExplorer(input.tradeExplorer);
  const targetLoad = evaluateTargetLoad(
    input.targetLoad,
    input.identity.machineClass,
  );
  const lifecycle = evaluateLifecycle(
    input.lifecycle,
    input.measurementClass,
  );

  return {
    schemaVersion: "production-performance-gates-v1" as const,
    measuredAt: input.measuredAt,
    identity: input.identity,
    status: combinedStatus([
      measurementContext.status,
      browserLab.status,
      origin.status,
      tradeExplorer.status,
      targetLoad.status,
      lifecycle.status,
    ]),
    gates: {
      measurementContext,
      browserLab,
      origin,
      tradeExplorer,
      targetLoad,
      lifecycle,
    },
  };
}

const TRADE_EXPLORER_LIMITS = {
  scanRows: 250,
  resultRows: 250,
  resultBytes: 1024 * KIB,
  exportBytes: 1024 * KIB,
  peakMemoryBytes: GIB,
  peakSpillBytes: 4 * GIB,
  queueWaitMs: 5_000,
  executionMs: 5_000,
  cancellationReleaseMs: 5_000,
} as const;

export function evaluateTradeExplorer(input: TradeExplorerMeasurementInput) {
  const queries = REQUIRED_PRODUCT_ROLES.map((productRole) => {
    const candidates = input.queries.filter(
      (query) => query.productRole === productRole,
    );
    if (candidates.length !== 1) {
      throw new PerformanceGateInputError(
        `Trade Explorer evidence requires exactly one ${productRole} query.`,
      );
    }
    const benchmarks = input.benchmarkQueries.filter(
      (query) => query.role === productRole,
    );
    if (benchmarks.length !== 1) {
      throw new PerformanceGateInputError(
        `Trade Explorer attestation requires exactly one ${productRole} benchmark query.`,
      );
    }
    return evaluateTradeExplorerQuery(candidates[0], benchmarks[0]);
  });
  if (
    input.queries.length !== REQUIRED_PRODUCT_ROLES.length ||
    input.benchmarkQueries.length !== REQUIRED_PRODUCT_ROLES.length
  ) {
    throw new PerformanceGateInputError(
      "Trade Explorer evidence contains an unsupported query.",
    );
  }
  const reasons = queries.flatMap((query) => query.reasons);
  return {
    limits: TRADE_EXPLORER_LIMITS,
    queries,
    reasons,
    status: (reasons.length === 0
      ? "accepted"
      : "blocked") as PerformanceGateStatus,
  };
}

function evaluateTradeExplorerQuery(
  input: TradeExplorerQueryMeasurementInput,
  benchmark: TradeExplorerArtifactBenchmarkQuery,
) {
  const label = `${input.productRole} Trade Explorer`;
  if (
    input.benchmarkQuery.shape !== benchmark.shape ||
    input.benchmarkQuery.measures.length !== benchmark.measures.length ||
    input.benchmarkQuery.measures.some(
      (measure, index) => measure !== benchmark.measures[index],
    ) ||
    input.benchmarkQuery.exportEconomyCode !==
      benchmark.exportEconomyCode ||
    input.benchmarkQuery.importEconomyCode !==
      benchmark.importEconomyCode ||
    input.benchmarkQuery.hsProductCode !== benchmark.hsProductCode ||
    input.resultRows !== benchmark.groupedRowCount
  ) {
    throw new PerformanceGateInputError(
      `${label} measurement does not match its artifact-attested benchmark query.`,
    );
  }
  const measurements = {
    productRole: input.productRole,
    benchmarkQuery: input.benchmarkQuery,
    scanRows: count(input.scanRows, `${label} scan rows`),
    resultRows: count(input.resultRows, `${label} result rows`),
    resultBytes: nonnegativeBytes(input.resultBytes, `${label} result bytes`),
    exportBytes: nonnegativeBytes(input.exportBytes, `${label} export bytes`),
    peakMemoryBytes: nonnegativeBytes(
      input.peakMemoryBytes,
      `${label} peak memory bytes`,
    ),
    peakSpillBytes: nonnegativeBytes(
      input.peakSpillBytes,
      `${label} peak spill bytes`,
    ),
    queueWaitMs: duration(input.queueWaitMs, `${label} queue wait`),
    executionMs: positiveNumber(input.executionMs, `${label} execution`),
    cancellationReleaseMs: duration(
      input.cancellationReleaseMs,
      `${label} cancellation release`,
    ),
    cancellationReleased: requiredBoolean(
      input.cancellationReleased,
      `${label} cancellation released`,
    ),
    cacheUnpoisoned: requiredBoolean(
      input.cacheUnpoisoned,
      `${label} cache unpoisoned`,
    ),
    queueUnpoisoned: requiredBoolean(
      input.queueUnpoisoned,
      `${label} queue unpoisoned`,
    ),
    subsequentRequestSucceeded: requiredBoolean(
      input.subsequentRequestSucceeded,
      `${label} subsequent request succeeded`,
    ),
  };
  const reasons: string[] = [];
  for (const [field, name] of [
    ["scanRows", "scan rows"],
    ["resultRows", "result rows"],
    ["resultBytes", "result bytes"],
    ["exportBytes", "export bytes"],
    ["peakMemoryBytes", "peak memory bytes"],
    ["peakSpillBytes", "peak spill bytes"],
    ["queueWaitMs", "queue wait milliseconds"],
    ["executionMs", "execution milliseconds"],
    ["cancellationReleaseMs", "cancellation release milliseconds"],
  ] as const) {
    if (measurements[field] > TRADE_EXPLORER_LIMITS[field]) {
      reasons.push(
        `${label} ${name} ${measurements[field]} exceed ${TRADE_EXPLORER_LIMITS[field]}.`,
      );
    }
  }
  if (!measurements.cancellationReleased) {
    reasons.push(`${label} cancellation did not release capacity.`);
  }
  if (!measurements.cacheUnpoisoned) {
    reasons.push(`${label} cancellation poisoned the cache.`);
  }
  if (!measurements.queueUnpoisoned) {
    reasons.push(`${label} cancellation poisoned the queue.`);
  }
  if (!measurements.subsequentRequestSucceeded) {
    reasons.push(`${label} subsequent request did not succeed.`);
  }
  return {
    ...measurements,
    reasons,
    status: (reasons.length === 0
      ? "accepted"
      : "blocked") as PerformanceGateStatus,
  };
}

function evaluateBrowserLab(input: BrowserLabProductInput[]) {
  const median = evaluateBrowserProduct(
    requiredBrowserProduct(input, "median"),
  );
  const maximumRow = evaluateBrowserProduct(
    requiredBrowserProduct(input, "maximum-row"),
  );
  if (input.length !== 2) {
    throw new PerformanceGateInputError(
      "Browser lab evidence must contain only median and maximum-row products.",
    );
  }

  return {
    status: combinedStatus([median.status, maximumRow.status]),
    products: {
      median,
      "maximum-row": maximumRow,
    },
  };
}

function requiredBrowserProduct(
  input: BrowserLabProductInput[],
  productRole: BrowserLabProductInput["productRole"],
): BrowserLabProductInput {
  const products = input.filter(
    (candidate) => candidate.productRole === productRole,
  );
  if (products.length !== 1) {
    throw new PerformanceGateInputError(
      `Browser lab evidence requires exactly one ${productRole} product.`,
    );
  }
  return products[0];
}

function evaluateBrowserProduct(input: BrowserLabProductInput) {
  const trials = input.trials.map((trial, index) =>
    validateBrowserTrial(
      trial,
      `${input.productRole} browser trial ${index + 1}`,
    ),
  );
  const failedTrialCount = count(
    input.failedTrialCount,
    `${input.productRole} failed browser trials`,
  );
  const sampleStatus: PerformanceGateStatus =
    trials.length >= 5 && failedTrialCount === 0
      ? "accepted"
      : "blocked";
  const medianLcpMs = median(trials.map((trial) => trial.lcpMs));
  const medianCls = median(trials.map((trial) => trial.cls));
  const medianInteractionToNextPaintMs = median(
    trials.map((trial) => trial.interactionToNextPaintMs),
  );
  const medianLongestTaskMs = median(
    trials.map((trial) => trial.longestTaskMs),
  );
  const maximumCriticalCompressedBytes = maximum(
    trials.map((trial) => trial.criticalCompressedBytes),
  );
  const maximumTotalFirstPartyCompressedBytes = maximum(
    trials.map((trial) => trial.totalFirstPartyCompressedBytes),
  );
  const maximumFirstPartyJavaScriptCompressedBytes = maximum(
    trials.map((trial) => trial.firstPartyJavaScriptCompressedBytes),
  );
  const maximumCandidateResultBytes = maximum(
    trials.map((trial) => trial.candidateResultBytes),
  );
  const maximumCandidateResultCompressedBytes = maximum(
    trials.map((trial) => trial.candidateResultCompressedBytes),
  );
  const analyzeToCompleteListP75Ms = percentile(
    trials.map((trial) => trial.analyzeToCompleteListMs),
    0.75,
  );
  const analyzeToCompleteListP95Ms = percentile(
    trials.map((trial) => trial.analyzeToCompleteListMs),
    0.95,
  );
  const marketAnalysisToCompleteP75Ms = percentile(
    trials.map((trial) => trial.marketAnalysisToCompleteMs),
    0.75,
  );
  const marketAnalysisToCompleteP95Ms = percentile(
    trials.map((trial) => trial.marketAnalysisToCompleteMs),
    0.95,
  );
  const thresholdStatus: PerformanceGateStatus =
    medianLcpMs <= BROWSER_LIMITS.lcpMs &&
    medianCls <= BROWSER_LIMITS.cls &&
    medianInteractionToNextPaintMs <=
      BROWSER_LIMITS.interactionToNextPaintMs &&
    medianLongestTaskMs <= BROWSER_LIMITS.longestTaskMs &&
    maximumCriticalCompressedBytes <=
      BROWSER_LIMITS.criticalCompressedBytes &&
    maximumTotalFirstPartyCompressedBytes <=
      BROWSER_LIMITS.totalFirstPartyCompressedBytes &&
    maximumFirstPartyJavaScriptCompressedBytes <=
      BROWSER_LIMITS.firstPartyJavaScriptCompressedBytes &&
    maximumCandidateResultBytes <= BROWSER_LIMITS.candidateResultBytes &&
    maximumCandidateResultCompressedBytes <=
      BROWSER_LIMITS.candidateResultCompressedBytes &&
    analyzeToCompleteListP75Ms <=
      BROWSER_LIMITS.analyzeToCompleteListP75Ms &&
    analyzeToCompleteListP95Ms <=
      BROWSER_LIMITS.analyzeToCompleteListP95Ms &&
    marketAnalysisToCompleteP75Ms <=
      BROWSER_LIMITS.marketAnalysisToCompleteP75Ms &&
    marketAnalysisToCompleteP95Ms <=
      BROWSER_LIMITS.marketAnalysisToCompleteP95Ms
      ? "accepted"
      : "blocked";

  return {
    trials: trials.length,
    minimumTrials: 5,
    failedTrialCount,
    medianLcpMs,
    lcpLimitMs: BROWSER_LIMITS.lcpMs,
    medianCls,
    clsLimit: BROWSER_LIMITS.cls,
    medianInteractionToNextPaintMs,
    interactionToNextPaintLimitMs:
      BROWSER_LIMITS.interactionToNextPaintMs,
    medianLongestTaskMs,
    longestTaskLimitMs: BROWSER_LIMITS.longestTaskMs,
    maximumCriticalCompressedBytes,
    criticalCompressedBytesLimit:
      BROWSER_LIMITS.criticalCompressedBytes,
    maximumTotalFirstPartyCompressedBytes,
    totalFirstPartyCompressedBytesLimit:
      BROWSER_LIMITS.totalFirstPartyCompressedBytes,
    maximumFirstPartyJavaScriptCompressedBytes,
    firstPartyJavaScriptCompressedBytesLimit:
      BROWSER_LIMITS.firstPartyJavaScriptCompressedBytes,
    maximumCandidateResultBytes,
    candidateResultBytesLimit: BROWSER_LIMITS.candidateResultBytes,
    maximumCandidateResultCompressedBytes,
    candidateResultCompressedBytesLimit:
      BROWSER_LIMITS.candidateResultCompressedBytes,
    analyzeToCompleteListP75Ms,
    analyzeToCompleteListP75LimitMs:
      BROWSER_LIMITS.analyzeToCompleteListP75Ms,
    analyzeToCompleteListP95Ms,
    analyzeToCompleteListP95LimitMs:
      BROWSER_LIMITS.analyzeToCompleteListP95Ms,
    marketAnalysisToCompleteP75Ms,
    marketAnalysisToCompleteP75LimitMs:
      BROWSER_LIMITS.marketAnalysisToCompleteP75Ms,
    marketAnalysisToCompleteP95Ms,
    marketAnalysisToCompleteP95LimitMs:
      BROWSER_LIMITS.marketAnalysisToCompleteP95Ms,
    status: combinedStatus([sampleStatus, thresholdStatus]),
  };
}

function validateBrowserTrial(
  input: BrowserLabTrialInput,
  label: string,
): BrowserLabTrialInput {
  positiveNumber(
    input.analyzeToCompleteListMs,
    `${label} analyze-to-complete-list`,
  );
  positiveNumber(
    input.marketAnalysisToCompleteMs,
    `${label} Market Analysis-to-complete`,
  );
  nonnegativeNumber(input.lcpMs, `${label} LCP`);
  fraction(input.cls, `${label} CLS`);
  nonnegativeNumber(
    input.interactionToNextPaintMs,
    `${label} interaction-to-next-paint`,
  );
  nonnegativeNumber(input.longestTaskMs, `${label} longest task`);
  nonnegativeBytes(
    input.criticalCompressedBytes,
    `${label} critical compressed bytes`,
  );
  nonnegativeBytes(
    input.totalFirstPartyCompressedBytes,
    `${label} total first-party compressed bytes`,
  );
  nonnegativeBytes(
    input.firstPartyJavaScriptCompressedBytes,
    `${label} first-party JavaScript compressed bytes`,
  );
  nonnegativeBytes(
    input.candidateResultBytes,
    `${label} Candidate Market result bytes`,
  );
  nonnegativeBytes(
    input.candidateResultCompressedBytes,
    `${label} Candidate Market compressed result bytes`,
  );
  return input;
}

export function evaluateOriginBenchmarks(
  input: OriginBenchmarkInput[],
  capabilities: OriginBenchmarkCapabilities = ALL_ORIGIN_BENCHMARK_CAPABILITIES,
) {
  const validatedCapabilities = validateOriginBenchmarkCapabilities(capabilities);
  const requiredProductOperations = requiredProductBenchmarkOperations(
    validatedCapabilities,
  );
  const benchmarks = new Map<
    string,
    ReturnType<typeof evaluateOriginBenchmark>
  >();
  for (const benchmark of input) {
    const key = originBenchmarkKey(benchmark);
    if (benchmarks.has(key)) {
      throw new PerformanceGateInputError(
        `Duplicate origin benchmark ${key}.`,
      );
    }
    benchmarks.set(key, evaluateOriginBenchmark(benchmark));
  }

  for (const operation of SINGLETON_BENCHMARK_OPERATIONS) {
    requireOriginBenchmark(benchmarks, `${operation}:all`);
  }
  for (const operation of requiredProductOperations) {
    for (const role of REQUIRED_PRODUCT_ROLES) {
      requireOriginBenchmark(benchmarks, `${operation}:${role}`);
    }
  }
  const requiredBenchmarkCount =
    SINGLETON_BENCHMARK_OPERATIONS.length +
    requiredProductOperations.length * REQUIRED_PRODUCT_ROLES.length;
  if (benchmarks.size !== requiredBenchmarkCount) {
    throw new PerformanceGateInputError(
      "Origin evidence contains an unsupported benchmark.",
    );
  }

  const results = [...benchmarks.values()];
  return {
    benchmarkCount: results.length,
    benchmarks: results,
    capabilities: validatedCapabilities,
    status: combinedStatus(results.map((result) => result.status)),
  };
}

function validateOriginBenchmarkCapabilities(
  capabilities: OriginBenchmarkCapabilities,
): OriginBenchmarkCapabilities {
  if (
    typeof capabilities !== "object" ||
    capabilities === null ||
    typeof capabilities.recentTradeMomentum !== "boolean" ||
    typeof capabilities.opportunityDiscovery !== "boolean"
  ) {
    throw new PerformanceGateInputError(
      "Origin benchmark capabilities must explicitly declare Recent Trade Momentum and Opportunity Discovery availability.",
    );
  }
  return {
    recentTradeMomentum: capabilities.recentTradeMomentum,
    opportunityDiscovery: capabilities.opportunityDiscovery,
  };
}

function requiredProductBenchmarkOperations(
  capabilities: OriginBenchmarkCapabilities,
): readonly (typeof PRODUCT_BENCHMARK_OPERATIONS)[number][] {
  return PRODUCT_BENCHMARK_OPERATIONS.filter(
    (operation) =>
      (operation !== "recent-trade-momentum-uncached" ||
        capabilities.recentTradeMomentum) &&
      (operation !== "opportunity-feed-uncached" ||
        capabilities.opportunityDiscovery),
  );
}

function originBenchmarkKey(input: OriginBenchmarkInput): string {
  const singleton = (
    SINGLETON_BENCHMARK_OPERATIONS as readonly OriginBenchmarkOperation[]
  ).includes(input.operation);
  if (singleton) {
    if (input.productRole !== undefined) {
      throw new PerformanceGateInputError(
        `${input.operation} must not name a product role.`,
      );
    }
    return `${input.operation}:all`;
  }
  if (
    input.productRole === undefined ||
    !(
      REQUIRED_PRODUCT_ROLES as readonly (
        OriginBenchmarkInput["productRole"]
      )[]
    ).includes(input.productRole)
  ) {
    throw new PerformanceGateInputError(
      `${input.operation} must name a supported product role.`,
    );
  }
  return `${input.operation}:${input.productRole}`;
}

function requireOriginBenchmark(
  benchmarks: ReadonlyMap<string, unknown>,
  key: string,
): void {
  if (!benchmarks.has(key)) {
    throw new PerformanceGateInputError(
      `Missing origin benchmark ${key}.`,
    );
  }
}

function evaluateOriginBenchmark(input: OriginBenchmarkInput) {
  const threshold = ORIGIN_THRESHOLDS[input.operation];
  const warmupSamples = count(
    input.warmupSamples,
    `${input.operation} warm-up samples`,
  );
  const timedSamples = count(
    input.timedSamples,
    `${input.operation} timed samples`,
  );
  const p50Ms = duration(input.p50Ms, `${input.operation} p50`);
  const p75Ms = duration(input.p75Ms, `${input.operation} p75`);
  const p95Ms = duration(input.p95Ms, `${input.operation} p95`);
  const p99Ms = duration(input.p99Ms, `${input.operation} p99`);
  const maximumRouteMs = duration(
    input.maximumRouteMs,
    `${input.operation} maximum route duration`,
  );
  if (
    p50Ms > p75Ms ||
    p75Ms > p95Ms ||
    p95Ms > p99Ms ||
    p99Ms > maximumRouteMs
  ) {
    throw new PerformanceGateInputError(
      `${input.operation} latency percentiles must be monotonic.`,
    );
  }
  const errors = count(input.errors, `${input.operation} errors`);
  const timeouts = count(input.timeouts, `${input.operation} timeouts`);
  const payloadBytes = nonnegativeBytes(
    input.payloadBytes,
    `${input.operation} payload bytes`,
  );
  const compressedPayloadBytes =
    input.compressedPayloadBytes === undefined
      ? null
      : nonnegativeBytes(
          input.compressedPayloadBytes,
          `${input.operation} compressed payload bytes`,
        );
  const status: PerformanceGateStatus =
    warmupSamples >= 5 &&
    timedSamples >= 100 &&
    p95Ms <= threshold.p95LimitMs &&
    p99Ms <= threshold.p99LimitMs &&
    maximumRouteMs <= threshold.routeDeadlineMs &&
    input.cacheStatesVerified &&
    errors === 0 &&
    timeouts === 0 &&
    (threshold.payloadLimitBytes === undefined ||
      payloadBytes <= threshold.payloadLimitBytes) &&
    (threshold.compressedPayloadLimitBytes === undefined ||
      (compressedPayloadBytes !== null &&
        compressedPayloadBytes <=
          threshold.compressedPayloadLimitBytes))
      ? "accepted"
      : "blocked";

  return {
    operation: input.operation,
    productRole: input.productRole ?? null,
    warmupSamples,
    minimumWarmupSamples: 5,
    timedSamples,
    minimumTimedSamples: 100,
    p50Ms,
    p75Ms,
    p95Ms,
    p95LimitMs: threshold.p95LimitMs,
    p99Ms,
    p99LimitMs: threshold.p99LimitMs,
    maximumRouteMs,
    routeDeadlineMs: threshold.routeDeadlineMs,
    cacheStatesVerified: input.cacheStatesVerified,
    errors,
    timeouts,
    payloadBytes,
    payloadLimitBytes: threshold.payloadLimitBytes ?? null,
    compressedPayloadBytes,
    compressedPayloadLimitBytes:
      threshold.compressedPayloadLimitBytes ?? null,
    status,
  };
}

const LOCAL_MACHINE_CLASS = "local";

/**
 * The kind of CPU-pressure evidence the target-load gate requires for a Machine
 * class. A shared-CPU Fly Machine must prove it depleted its burst balance under
 * load; a dedicated local host (ADR-0004) has no burst balance, so its load is
 * accepted on the SLO, error, and resource-headroom criteria alone.
 */
export function machineClassCpuPressureKind(
  machineClass: string,
): TargetLoadCpuPressure["kind"] {
  return machineClass === LOCAL_MACHINE_CLASS
    ? "dedicated-cpu"
    : "shared-cpu-burst-balance";
}

/**
 * Builds the CPU-pressure evidence for a Machine class from a measured
 * shared-CPU burst-balance depletion signal, so runners and gate authors classify
 * a run the same way.
 */
export function resolveTargetLoadCpuPressure(
  machineClass: string,
  sharedCpuBurstBalanceDepleted: boolean,
): TargetLoadCpuPressure {
  return machineClassCpuPressureKind(machineClass) === "dedicated-cpu"
    ? { kind: "dedicated-cpu" }
    : {
        kind: "shared-cpu-burst-balance",
        depleted: sharedCpuBurstBalanceDepleted,
      };
}

function targetLoadCpuPressure(value: TargetLoadCpuPressure): TargetLoadCpuPressure {
  if (value === null || typeof value !== "object") {
    throw new PerformanceGateInputError(
      "target-load CPU pressure evidence is required.",
    );
  }
  if (value.kind === "dedicated-cpu") {
    return { kind: "dedicated-cpu" };
  }
  if (value.kind === "shared-cpu-burst-balance") {
    if (typeof value.depleted !== "boolean") {
      throw new PerformanceGateInputError(
        "target-load shared-CPU burst-balance depletion must be a boolean.",
      );
    }
    return { kind: "shared-cpu-burst-balance", depleted: value.depleted };
  }
  throw new PerformanceGateInputError(
    "target-load CPU pressure kind is unsupported.",
  );
}

function evaluateTargetLoad(
  input: TargetLoadInput,
  machineClass: string,
) {
  const sessions = count(input.sessions, "target-load sessions");
  const sustainedRequestsPerSecond = nonnegativeNumber(
    input.sustainedRequestsPerSecond,
    "target-load sustained requests per second",
  );
  const sustainedSeconds = count(
    input.sustainedSeconds,
    "target-load sustained seconds",
  );
  const burstRequestsPerSecond = nonnegativeNumber(
    input.burstRequestsPerSecond,
    "target-load burst requests per second",
  );
  const burstSeconds = count(
    input.burstSeconds,
    "target-load burst seconds",
  );
  const coordinatedDistinctKeys = count(
    input.coordinatedDistinctKeys,
    "target-load coordinated distinct keys",
  );
  const coordinatedBurstIntervalSeconds = count(
    input.coordinatedBurstIntervalSeconds,
    "target-load coordinated burst interval seconds",
  );
  const queueRejections = count(
    input.queueRejections,
    "target-load queue rejections",
  );
  const unretryableErrors = count(
    input.unretryableErrors,
    "target-load unretryable errors",
  );
  const timeouts = count(input.timeouts, "target-load timeouts");
  const peakCgroupMemoryFraction = fraction(
    input.peakCgroupMemoryFraction,
    "target-load peak cgroup memory fraction",
  );
  const peakProcessRssFraction = fraction(
    input.peakProcessRssFraction,
    "target-load peak process RSS fraction",
  );
  const peakSpillBytes = nonnegativeBytes(
    input.peakSpillBytes,
    "target-load peak spill bytes",
  );
  const sparseOrMedianSpillCount = count(
    input.sparseOrMedianSpillCount,
    "target-load sparse or median spill count",
  );
  const minimumVolumeFreeFraction = fraction(
    input.minimumVolumeFreeFraction,
    "target-load minimum volume free fraction",
  );
  const routeP95Ms = {
    currentManifest: duration(
      input.routeP95Ms.currentManifest,
      "target-load current-manifest p95",
    ),
    search: duration(
      input.routeP95Ms.search,
      "target-load search p95",
    ),
    analysis: duration(
      input.routeP95Ms.analysis,
      "target-load analysis p95",
    ),
    csv: duration(input.routeP95Ms.csv, "target-load CSV p95"),
  };
  const routeMix = {
    currentManifest: fraction(
      input.routeMix.currentManifest,
      "target-load current-manifest route fraction",
    ),
    search: fraction(
      input.routeMix.search,
      "target-load search route fraction",
    ),
    analysis: fraction(
      input.routeMix.analysis,
      "target-load analysis route fraction",
    ),
    csv: fraction(
      input.routeMix.csv,
      "target-load CSV route fraction",
    ),
  };
  const analysisHotKeyFraction = fraction(
    input.analysisHotKeyFraction,
    "target-load hot-key analysis fraction",
  );
  const analysisUncachedKeyFraction = fraction(
    input.analysisUncachedKeyFraction,
    "target-load uncached-key analysis fraction",
  );
  const requiredCpuPressureKind = machineClassCpuPressureKind(machineClass);
  const cpuPressure = targetLoadCpuPressure(input.cpuPressure);
  const cpuPressureSatisfied =
    cpuPressure.kind === requiredCpuPressureKind &&
    (cpuPressure.kind === "dedicated-cpu" || cpuPressure.depleted);
  const cpuPressureStatus: PerformanceGateStatus = cpuPressureSatisfied
    ? "accepted"
    : "blocked";

  const hardFailure =
    sessions !== 20 ||
    sustainedRequestsPerSecond !== 4 ||
    sustainedSeconds !== 600 ||
    !approximately(routeMix.currentManifest, 0.1) ||
    !approximately(routeMix.search, 0.25) ||
    !approximately(routeMix.analysis, 0.55) ||
    !approximately(routeMix.csv, 0.1) ||
    !approximately(
      routeMix.currentManifest +
        routeMix.search +
        routeMix.analysis +
        routeMix.csv,
      1,
    ) ||
    !approximately(analysisHotKeyFraction, 0.8) ||
    !approximately(analysisUncachedKeyFraction, 0.2) ||
    burstRequestsPerSecond !== 10 ||
    burstSeconds !== 30 ||
    coordinatedDistinctKeys !== 4 ||
    coordinatedBurstIntervalSeconds > 60 ||
    !input.includesMaximumRowProduct ||
    !input.includesTradeExplorer ||
    !input.includesMarketAnalysis ||
    !input.cacheStatesVerified ||
    queueRejections > 0 ||
    unretryableErrors > 0 ||
    timeouts > 0 ||
    routeP95Ms.currentManifest > TARGET_ROUTE_P95_MS.currentManifest ||
    routeP95Ms.search > TARGET_ROUTE_P95_MS.search ||
    routeP95Ms.analysis > TARGET_ROUTE_P95_MS.analysis ||
    routeP95Ms.csv > TARGET_ROUTE_P95_MS.csv ||
    peakCgroupMemoryFraction > 0.85 ||
    peakProcessRssFraction > 0.75 ||
    peakSpillBytes > 4 * GIB ||
    minimumVolumeFreeFraction < 0.25 ||
    !cpuPressureSatisfied;
  const warning =
    peakCgroupMemoryFraction > 0.75 ||
    sparseOrMedianSpillCount > 0 ||
    minimumVolumeFreeFraction < 0.3;
  const status: PerformanceGateStatus = hardFailure
    ? "blocked"
    : warning
      ? "review-required"
      : "accepted";

  return {
    sessions,
    minimumSessions: 20,
    sustainedRequestsPerSecond,
    minimumSustainedRequestsPerSecond: 4,
    sustainedSeconds,
    minimumSustainedSeconds: 600,
    routeMix,
    requiredRouteMix: {
      currentManifest: 0.1,
      search: 0.25,
      analysis: 0.55,
      csv: 0.1,
    },
    analysisHotKeyFraction,
    requiredAnalysisHotKeyFraction: 0.8,
    analysisUncachedKeyFraction,
    requiredAnalysisUncachedKeyFraction: 0.2,
    burstRequestsPerSecond,
    minimumBurstRequestsPerSecond: 10,
    burstSeconds,
    minimumBurstSeconds: 30,
    coordinatedDistinctKeys,
    minimumCoordinatedDistinctKeys: 4,
    coordinatedBurstIntervalSeconds,
    maximumCoordinatedBurstIntervalSeconds: 60,
    includesMaximumRowProduct: input.includesMaximumRowProduct,
    includesTradeExplorer: input.includesTradeExplorer,
    includesMarketAnalysis: input.includesMarketAnalysis,
    cacheStatesVerified: input.cacheStatesVerified,
    queueRejections,
    unretryableErrors,
    timeouts,
    routeP95Ms,
    routeP95LimitsMs: TARGET_ROUTE_P95_MS,
    peakCgroupMemoryFraction,
    cgroupWarningFraction: 0.75,
    cgroupLimitFraction: 0.85,
    peakProcessRssFraction,
    processRssLimitFraction: 0.75,
    peakSpillBytes,
    spillLimitBytes: 4 * GIB,
    sparseOrMedianSpillCount,
    minimumVolumeFreeFraction,
    volumeWarningFreeFraction: 0.3,
    volumeMinimumFreeFraction: 0.25,
    cpuPressure,
    requiredCpuPressureKind,
    cpuPressureStatus,
    status,
  };
}

function evaluateLifecycle(
  input: LifecycleMeasurementInput,
  measurementClass: PerformanceGateInput["measurementClass"],
) {
  const restartToReadyMs = duration(
    input.restartToReadyMs,
    "restart-to-readiness duration",
  );
  const coldHydrationToReadyMs = duration(
    input.coldHydrationToReadyMs,
    "cold-hydration-to-readiness duration",
  );
  const rollbackToReadyMs = duration(
    input.rollbackToReadyMs,
    "rollback-to-readiness duration",
  );
  const deployInterruptionMs = duration(
    input.deployInterruptionMs,
    "deployment interruption duration",
  );
  const recoveryTimeMs = duration(
    input.recoveryTimeMs,
    "recovery time",
  );
  const acceptedArtifactLossCount = count(
    input.acceptedArtifactLossCount,
    "accepted artifact loss count",
  );
  const hasMeasuredCandidateDurations =
    measurementClass !== "candidate" ||
    [
      restartToReadyMs,
      coldHydrationToReadyMs,
      rollbackToReadyMs,
      deployInterruptionMs,
      recoveryTimeMs,
    ].every((value) => value > 0);
  const status: PerformanceGateStatus =
    hasMeasuredCandidateDurations &&
    restartToReadyMs <= 90_000 &&
    coldHydrationToReadyMs <= 900_000 &&
    rollbackToReadyMs <= 900_000 &&
    deployInterruptionMs <= 120_000 &&
    recoveryTimeMs <= 1_800_000 &&
    acceptedArtifactLossCount === 0
      ? "accepted"
      : "blocked";

  return {
    restartToReadyMs,
    restartToReadyLimitMs: 90_000,
    coldHydrationToReadyMs,
    coldHydrationToReadyLimitMs: 900_000,
    rollbackToReadyMs,
    rollbackToReadyLimitMs: 900_000,
    deployInterruptionMs,
    deployInterruptionLimitMs: 120_000,
    recoveryTimeMs,
    recoveryTimeLimitMs: 1_800_000,
    acceptedArtifactLossCount,
    acceptedArtifactLossLimit: 0,
    hasMeasuredCandidateDurations,
    status,
  };
}

function validateMeasurementIdentity(
  identity: PerformanceMeasurementIdentity,
): void {
  sha256(identity.fixtureManifestSha256, "fixture manifest SHA-256");
  if (identity.fixtureManifestSha256 !== ACCEPTANCE_FIXTURE_CONTENT_SHA256) {
    throw new PerformanceGateInputError(
      "Fixture manifest SHA-256 must match the canonical acceptance fixture.",
    );
  }
  nonemptyString(identity.buildId, "build ID");
  if (!/^V\d{6}$/u.test(identity.baciRelease)) {
    throw new PerformanceGateInputError(
      "BACI Release must use the VYYYYMM format.",
    );
  }
  nonemptyString(identity.analysisBuildId, "analysis build ID");
  nonemptyString(identity.productSearchBuildId, "product-search build ID");
  sha256(identity.artifactSha256, "artifact SHA-256");
  nonemptyString(identity.machineId, "Machine ID");
  nonemptyString(identity.machineClass, "Machine class");
  if (!/^[a-z]{3}$/u.test(identity.region)) {
    throw new PerformanceGateInputError(
      "Region must be a three-letter provider region.",
    );
  }
}

function combinedStatus(
  statuses: readonly PerformanceGateStatus[],
): PerformanceGateStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  return statuses.includes("review-required")
    ? "review-required"
    : "accepted";
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new PerformanceGateInputError(
      "A median requires at least one sample.",
    );
  }

  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) / 2)];
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    throw new PerformanceGateInputError(
      "A percentile requires at least one sample.",
    );
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(quantile * ordered.length) - 1];
}

function maximum(values: readonly number[]): number {
  if (values.length === 0) {
    throw new PerformanceGateInputError(
      "A maximum requires at least one sample.",
    );
  }
  return Math.max(...values);
}

function duration(value: number, label: string): number {
  return nonnegativeNumber(value, `${label} milliseconds`);
}

function nonnegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new PerformanceGateInputError(
      `${label} must be a finite nonnegative number.`,
    );
  }

  return value;
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PerformanceGateInputError(
      `${label} must be a finite positive number.`,
    );
  }
  return value;
}

function requiredBoolean(value: boolean, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new PerformanceGateInputError(`${label} must be a boolean.`);
  }
  return value;
}

function fraction(value: number, label: string): number {
  const parsed = nonnegativeNumber(value, label);
  if (parsed > 1) {
    throw new PerformanceGateInputError(
      `${label} must not exceed one.`,
    );
  }
  return parsed;
}

function count(value: number, label: string): number {
  return nonnegativeSafeInteger(value, label, performanceInputError);
}

function nonnegativeBytes(value: number, label: string): number {
  return nonnegativeSafeInteger(value, label, performanceInputError);
}

function nonemptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PerformanceGateInputError(
      `${label} must be a nonempty string.`,
    );
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new PerformanceGateInputError(
      `${label} must be a lowercase SHA-256.`,
    );
  }
  return value;
}

function utcTimestamp(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PerformanceGateInputError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function performanceInputError(
  message: string,
): PerformanceGateInputError {
  return new PerformanceGateInputError(message);
}
