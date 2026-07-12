export class ServiceLevelValidationError extends Error {
  readonly code = "SERVICE_LEVEL_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ServiceLevelValidationError";
  }
}

function serviceLevelError(message: string): ServiceLevelValidationError {
  return new ServiceLevelValidationError(message);
}

function nonemptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw serviceLevelError(`${label} must be a nonempty string.`);
  }
  return value;
}

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw serviceLevelError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  const parsed = nonnegativeSafeInteger(value, label);
  if (parsed === 0) {
    throw serviceLevelError(`${label} must be positive.`);
  }
  return parsed;
}

function nonnegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw serviceLevelError(`${label} must be a finite nonnegative number.`);
  }
  return value;
}

function unitFraction(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw serviceLevelError(
      `${label} must be a finite fraction between 0 and 1.`,
    );
  }
  return value;
}

function requireBoolean(value: boolean, label: string): boolean {
  if (typeof value !== "boolean") {
    throw serviceLevelError(`${label} must be a boolean.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Request SLI (docs/research/2026-07-11-mvp-performance-and-caching-targets.md §10)
// ---------------------------------------------------------------------------

export type RouteObservationIdentity = {
  routeFamily: string;
  cacheState: string;
  analysisBuildId: string;
  baciRelease: string;
};

export type RequestOutcomeSample = RouteObservationIdentity & {
  method: "GET" | "HEAD";
  synthetic: boolean;
  timedOut: boolean;
  /** HTTP status code; must be null exactly when timedOut is true. */
  status: number | null;
};

export type RequestSliResult = {
  kind: "request-sli";
  identity: RouteObservationIdentity;
  sampleCount: number;
  eligibleCount: number;
  successfulCount: number;
  failedCount: number;
  excludedCount: number;
  measurable: boolean;
  successFraction: number | null;
};

const EXCLUDED_CLIENT_STATUSES: ReadonlySet<number> = new Set([
  400, 404, 409, 410,
]);

export function evaluateRequestSli(
  identity: RouteObservationIdentity,
  samples: readonly RequestOutcomeSample[],
): RequestSliResult {
  const windowIdentity = requireRouteObservationIdentity(identity);
  let successfulCount = 0;
  let failedCount = 0;
  let excludedCount = 0;

  samples.forEach((sample, index) => {
    requireSampleIdentityMatches(windowIdentity, sample, index);
    requireRequestOutcomeShape(sample, index);

    if (sample.synthetic) {
      excludedCount += 1;
      return;
    }
    if (sample.timedOut) {
      failedCount += 1;
      return;
    }
    const status = sample.status as number;
    if (EXCLUDED_CLIENT_STATUSES.has(status)) {
      excludedCount += 1;
      return;
    }
    if (status === 304 || (status >= 200 && status < 300)) {
      successfulCount += 1;
    } else {
      failedCount += 1;
    }
  });

  const eligibleCount = successfulCount + failedCount;
  return {
    kind: "request-sli",
    identity: windowIdentity,
    sampleCount: samples.length,
    eligibleCount,
    successfulCount,
    failedCount,
    excludedCount,
    measurable: eligibleCount > 0,
    successFraction: eligibleCount > 0 ? successfulCount / eligibleCount : null,
  };
}

function requireRouteObservationIdentity(
  identity: RouteObservationIdentity,
): RouteObservationIdentity {
  return {
    routeFamily: nonemptyString(identity.routeFamily, "route family"),
    cacheState: nonemptyString(identity.cacheState, "cache state"),
    analysisBuildId: nonemptyString(
      identity.analysisBuildId,
      "analysis build ID",
    ),
    baciRelease: nonemptyString(identity.baciRelease, "BACI Release"),
  };
}

function requireSampleIdentityMatches(
  identity: RouteObservationIdentity,
  sample: RouteObservationIdentity,
  index: number,
): void {
  if (
    sample.routeFamily !== identity.routeFamily ||
    sample.cacheState !== identity.cacheState ||
    sample.analysisBuildId !== identity.analysisBuildId ||
    sample.baciRelease !== identity.baciRelease
  ) {
    throw serviceLevelError(
      `Request sample ${index} identity is missing or mixed within the measurement window.`,
    );
  }
}

function requireRequestOutcomeShape(
  sample: RequestOutcomeSample,
  index: number,
): void {
  if (sample.method !== "GET" && sample.method !== "HEAD") {
    throw serviceLevelError(
      `Request sample ${index} method must be GET or HEAD.`,
    );
  }
  if (
    typeof sample.synthetic !== "boolean" ||
    typeof sample.timedOut !== "boolean"
  ) {
    throw serviceLevelError(
      `Request sample ${index} synthetic and timedOut flags must be booleans.`,
    );
  }
  if (sample.timedOut) {
    if (sample.status !== null) {
      throw serviceLevelError(
        `Request sample ${index} must not report a status while timed out.`,
      );
    }
    return;
  }
  if (
    sample.status === null ||
    !Number.isInteger(sample.status) ||
    sample.status < 100 ||
    sample.status > 599
  ) {
    throw serviceLevelError(
      `Request sample ${index} status must be a valid HTTP status code when not timed out.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Probe SLI (docs/research/2026-07-11-mvp-performance-and-caching-targets.md §10)
// ---------------------------------------------------------------------------

export type ProbeIdentity = {
  analysisBuildId: string;
  baciRelease: string;
  fixtureManifestSha256: string;
  smokeAnalysisKey: string;
};

export type ProbeOutcome = "success" | "failure" | "timeout";

const PROBE_OUTCOMES: ReadonlySet<ProbeOutcome> = new Set([
  "success",
  "failure",
  "timeout",
]);

export type ProbeInterval = ProbeIdentity & {
  intervalStartedAt: string;
  manifestOutcome: ProbeOutcome;
  smokeAnalysisOutcome: ProbeOutcome;
};

export type ProbeMeasurementWindow = {
  startedAt: string;
  endedAt: string;
};

export type ProbeSliResult = {
  kind: "probe-sli";
  identity: ProbeIdentity;
  sampleCount: number;
  successfulCount: number;
  failedCount: number;
  measurable: boolean;
  successFraction: number | null;
};

export function evaluateProbeSli(
  identity: ProbeIdentity,
  intervals: readonly ProbeInterval[],
  measurementWindow: ProbeMeasurementWindow,
): ProbeSliResult {
  const windowIdentity = requireProbeIdentity(identity);
  const window = requireProbeMeasurementWindow(measurementWindow);
  const expectedIntervalCount =
    (window.endedAtMs - window.startedAtMs) / 60_000;
  if (intervals.length !== expectedIntervalCount) {
    throw serviceLevelError(
      `Probe window requires exactly ${expectedIntervalCount} one-minute intervals; received ${intervals.length}.`,
    );
  }
  let successfulCount = 0;
  let failedCount = 0;

  intervals.forEach((interval, index) => {
    requireProbeIntervalIdentityMatches(windowIdentity, interval, index);
    const expectedStartedAt = new Date(
      window.startedAtMs + index * 60_000,
    ).toISOString().replace(".000Z", "Z");
    const intervalStartedAt = utcMinute(
      interval.intervalStartedAt,
      `Probe interval ${index} start`,
    );
    if (intervalStartedAt !== expectedStartedAt) {
      throw serviceLevelError(
        `Probe interval ${index} must start at ${expectedStartedAt}; received ${intervalStartedAt}.`,
      );
    }
    requireProbeOutcome(interval.manifestOutcome, index, "manifest");
    requireProbeOutcome(interval.smokeAnalysisOutcome, index, "smoke analysis");

    const succeeded =
      interval.manifestOutcome === "success" &&
      interval.smokeAnalysisOutcome === "success";
    if (succeeded) {
      successfulCount += 1;
    } else {
      failedCount += 1;
    }
  });

  const sampleCount = intervals.length;
  return {
    kind: "probe-sli",
    identity: windowIdentity,
    sampleCount,
    successfulCount,
    failedCount,
    measurable: sampleCount > 0,
    successFraction: sampleCount > 0 ? successfulCount / sampleCount : null,
  };
}

function requireProbeIdentity(identity: ProbeIdentity): ProbeIdentity {
  return {
    analysisBuildId: nonemptyString(
      identity.analysisBuildId,
      "analysis build ID",
    ),
    baciRelease: nonemptyString(identity.baciRelease, "BACI Release"),
    fixtureManifestSha256: sha256(
      identity.fixtureManifestSha256,
      "fixture manifest SHA-256",
    ),
    smokeAnalysisKey: nonemptyString(
      identity.smokeAnalysisKey,
      "smoke analysis key",
    ),
  };
}

function requireProbeIntervalIdentityMatches(
  identity: ProbeIdentity,
  interval: ProbeIdentity,
  index: number,
): void {
  if (
    interval.analysisBuildId !== identity.analysisBuildId ||
    interval.baciRelease !== identity.baciRelease ||
    interval.fixtureManifestSha256 !== identity.fixtureManifestSha256 ||
    interval.smokeAnalysisKey !== identity.smokeAnalysisKey
  ) {
    throw serviceLevelError(
      `Probe interval ${index} identity is missing or mixed within the measurement window.`,
    );
  }
}

function requireProbeMeasurementWindow(
  window: ProbeMeasurementWindow,
): {
  startedAtMs: number;
  endedAtMs: number;
} {
  const startedAt = utcMinute(window.startedAt, "Probe window start");
  const endedAt = utcMinute(window.endedAt, "Probe window end");
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (endedAtMs < startedAtMs) {
    throw serviceLevelError("Probe window end must not precede its start.");
  }
  if (endedAtMs - startedAtMs > 32 * 24 * 60 * 60 * 1_000) {
    throw serviceLevelError("Probe window must not exceed 32 days.");
  }
  return { startedAtMs, endedAtMs };
}

function utcMinute(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw serviceLevelError(
      `${label} must be an exact UTC minute timestamp.`,
    );
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw serviceLevelError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requireProbeOutcome(
  outcome: ProbeOutcome,
  index: number,
  label: "manifest" | "smoke analysis",
): void {
  if (!PROBE_OUTCOMES.has(outcome)) {
    throw serviceLevelError(
      `Probe interval ${index} ${label} outcome must be success, failure, or timeout.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Monthly error budget (docs/research/2026-07-11-mvp-performance-and-caching-targets.md §10, §12)
// ---------------------------------------------------------------------------

export const MONTHLY_SLI_TARGET_FRACTION = 0.995;
export const MONTHLY_ERROR_BUDGET_FRACTION = 0.005;
export const ERROR_BUDGET_WARN_CONSUMED_FRACTION = 0.5;
export const ERROR_BUDGET_PAGE_CONSUMED_FRACTION = 0.8;

/**
 * "unmeasured" represents an empty eligible window: it is distinct from "ok"
 * because an empty window must never be reported as success.
 */
export type ErrorBudgetStatus = "ok" | "warn" | "page" | "unmeasured";

export type MonthlyErrorBudgetResult = {
  kind: "monthly-error-budget";
  eligibleCount: number;
  failedCount: number;
  observedFailureFraction: number | null;
  consumedFraction: number | null;
  targetFraction: 0.995;
  budgetFraction: 0.005;
  status: ErrorBudgetStatus;
};

export function evaluateMonthlyErrorBudget(input: {
  eligibleCount: number;
  failedCount: number;
}): MonthlyErrorBudgetResult {
  const eligibleCount = nonnegativeSafeInteger(
    input.eligibleCount,
    "eligible count",
  );
  const failedCount = nonnegativeSafeInteger(
    input.failedCount,
    "failed count",
  );
  if (failedCount > eligibleCount) {
    throw serviceLevelError(
      "Failed count cannot exceed eligible count.",
    );
  }

  if (eligibleCount === 0) {
    return {
      kind: "monthly-error-budget",
      eligibleCount,
      failedCount,
      observedFailureFraction: null,
      consumedFraction: null,
      targetFraction: MONTHLY_SLI_TARGET_FRACTION,
      budgetFraction: MONTHLY_ERROR_BUDGET_FRACTION,
      status: "unmeasured",
    };
  }

  const observedFailureFraction = failedCount / eligibleCount;
  const consumedFraction =
    observedFailureFraction / MONTHLY_ERROR_BUDGET_FRACTION;
  const status: ErrorBudgetStatus =
    consumedFraction >= ERROR_BUDGET_PAGE_CONSUMED_FRACTION
      ? "page"
      : consumedFraction >= ERROR_BUDGET_WARN_CONSUMED_FRACTION
        ? "warn"
        : "ok";

  return {
    kind: "monthly-error-budget",
    eligibleCount,
    failedCount,
    observedFailureFraction,
    consumedFraction,
    targetFraction: MONTHLY_SLI_TARGET_FRACTION,
    budgetFraction: MONTHLY_ERROR_BUDGET_FRACTION,
    status,
  };
}

// ---------------------------------------------------------------------------
// Observability alerts (docs/research/2026-07-11-mvp-performance-and-caching-targets.md §12)
// ---------------------------------------------------------------------------

export type AlertSeverity = "ok" | "warn" | "page";

export type AlertIdentity = {
  analysisBuildId: string;
  baciRelease: string;
};

function requireAlertIdentity(identity: AlertIdentity): AlertIdentity {
  return {
    analysisBuildId: nonemptyString(
      identity.analysisBuildId,
      "analysis build ID",
    ),
    baciRelease: nonemptyString(identity.baciRelease, "BACI Release"),
  };
}

// -- Route p95/p99 target: warn miss 5 minutes; page miss 15 minutes. -------

export const ROUTE_LATENCY_WARN_MISS_MINUTES = 5;
export const ROUTE_LATENCY_PAGE_MISS_MINUTES = 15;

export type RouteLatencyTargetAlertInput = {
  metric: "p95" | "p99";
  missDurationMinutes: number;
};

export type RouteLatencyTargetAlertResult = {
  signal: "route-latency-target-miss";
  severity: AlertSeverity;
  identity: AlertIdentity;
  metric: "p95" | "p99";
  measuredValue: number;
  warnThreshold: number;
  pageThreshold: number;
  sampleCount: null;
};

export function evaluateRouteLatencyTargetAlert(
  identity: AlertIdentity,
  input: RouteLatencyTargetAlertInput,
): RouteLatencyTargetAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  if (input.metric !== "p95" && input.metric !== "p99") {
    throw serviceLevelError("Route latency metric must be p95 or p99.");
  }
  const missDurationMinutes = nonnegativeFinite(
    input.missDurationMinutes,
    "route latency miss duration minutes",
  );
  const severity: AlertSeverity =
    missDurationMinutes >= ROUTE_LATENCY_PAGE_MISS_MINUTES
      ? "page"
      : missDurationMinutes >= ROUTE_LATENCY_WARN_MISS_MINUTES
        ? "warn"
        : "ok";

  return {
    signal: "route-latency-target-miss",
    severity,
    identity: alertIdentity,
    metric: input.metric,
    measuredValue: missDurationMinutes,
    warnThreshold: ROUTE_LATENCY_WARN_MISS_MINUTES,
    pageThreshold: ROUTE_LATENCY_PAGE_MISS_MINUTES,
    sampleCount: null,
  };
}

// -- 500/503 rate: warn >1% over 10 minutes; page >5% over 10 minutes. ------

export const HTTP_5XX_WARN_RATE = 0.01;
export const HTTP_5XX_PAGE_RATE = 0.05;

export type Http5xxRateAlertInput = {
  serverErrorCount: number;
  totalCount: number;
};

export type Http5xxRateAlertResult = {
  signal: "http-5xx-rate";
  severity: AlertSeverity;
  identity: AlertIdentity;
  measuredValue: number;
  warnThreshold: number;
  pageThreshold: number;
  sampleCount: number;
};

export function evaluateHttp5xxRateAlert(
  identity: AlertIdentity,
  input: Http5xxRateAlertInput,
): Http5xxRateAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  // A zero-request window cannot yield a rate; fail closed instead of
  // silently reporting "ok" for missing measurement input.
  const totalCount = positiveSafeInteger(input.totalCount, "total count");
  const serverErrorCount = nonnegativeSafeInteger(
    input.serverErrorCount,
    "server error count",
  );
  if (serverErrorCount > totalCount) {
    throw serviceLevelError(
      "Server error count cannot exceed total count.",
    );
  }

  const rate = serverErrorCount / totalCount;
  const severity: AlertSeverity =
    rate > HTTP_5XX_PAGE_RATE
      ? "page"
      : rate > HTTP_5XX_WARN_RATE
        ? "warn"
        : "ok";

  return {
    signal: "http-5xx-rate",
    severity,
    identity: alertIdentity,
    measuredValue: rate,
    warnThreshold: HTTP_5XX_WARN_RATE,
    pageThreshold: HTTP_5XX_PAGE_RATE,
    sampleCount: totalCount,
  };
}

// -- Queue wait: warn p95 >1s; page rejection at target load or depth >=16. -

export const QUEUE_WAIT_WARN_P95_SECONDS = 1;
export const QUEUE_WAIT_PAGE_DEPTH = 16;

export type QueueWaitAlertInput = {
  p95WaitSeconds: number;
  rejectedAtTargetLoad: boolean;
  depth: number;
};

export type QueueWaitAlertResult = {
  signal: "queue-wait";
  severity: AlertSeverity;
  identity: AlertIdentity;
  p95WaitSeconds: number;
  warnP95Seconds: number;
  rejectedAtTargetLoad: boolean;
  depth: number;
  pageDepth: number;
  sampleCount: null;
};

export function evaluateQueueWaitAlert(
  identity: AlertIdentity,
  input: QueueWaitAlertInput,
): QueueWaitAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const p95WaitSeconds = nonnegativeFinite(
    input.p95WaitSeconds,
    "queue wait p95 seconds",
  );
  const rejectedAtTargetLoad = requireBoolean(
    input.rejectedAtTargetLoad,
    "queue wait rejected-at-target-load flag",
  );
  const depth = nonnegativeSafeInteger(input.depth, "queue wait depth");

  const severity: AlertSeverity =
    rejectedAtTargetLoad || depth >= QUEUE_WAIT_PAGE_DEPTH
      ? "page"
      : p95WaitSeconds > QUEUE_WAIT_WARN_P95_SECONDS
        ? "warn"
        : "ok";

  return {
    signal: "queue-wait",
    severity,
    identity: alertIdentity,
    p95WaitSeconds,
    warnP95Seconds: QUEUE_WAIT_WARN_P95_SECONDS,
    rejectedAtTargetLoad,
    depth,
    pageDepth: QUEUE_WAIT_PAGE_DEPTH,
    sampleCount: null,
  };
}

// -- Shared-CPU throttle: warn >5% CPU time for 15 minutes; -----------------
// -- page only when it causes a target-load latency/error gate to fail. ----

export const SHARED_CPU_THROTTLE_WARN_FRACTION = 0.05;
export const SHARED_CPU_THROTTLE_WARN_MINUTES = 15;

export type SharedCpuThrottleAlertInput = {
  throttledFraction: number;
  sustainedMinutes: number;
  causedTargetLoadGateFailure: boolean;
};

export type SharedCpuThrottleAlertResult = {
  signal: "shared-cpu-throttle";
  severity: AlertSeverity;
  identity: AlertIdentity;
  throttledFraction: number;
  warnThreshold: number;
  sustainedMinutes: number;
  warnSustainedMinutes: number;
  causedTargetLoadGateFailure: boolean;
  sampleCount: null;
};

export function evaluateSharedCpuThrottleAlert(
  identity: AlertIdentity,
  input: SharedCpuThrottleAlertInput,
): SharedCpuThrottleAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const throttledFraction = unitFraction(
    input.throttledFraction,
    "shared-CPU throttled fraction",
  );
  const sustainedMinutes = nonnegativeFinite(
    input.sustainedMinutes,
    "shared-CPU throttle sustained minutes",
  );
  const causedTargetLoadGateFailure = requireBoolean(
    input.causedTargetLoadGateFailure,
    "shared-CPU throttle target-load gate failure flag",
  );

  const severity: AlertSeverity = causedTargetLoadGateFailure
    ? "page"
    : throttledFraction > SHARED_CPU_THROTTLE_WARN_FRACTION &&
        sustainedMinutes >= SHARED_CPU_THROTTLE_WARN_MINUTES
      ? "warn"
      : "ok";

  return {
    signal: "shared-cpu-throttle",
    severity,
    identity: alertIdentity,
    throttledFraction,
    warnThreshold: SHARED_CPU_THROTTLE_WARN_FRACTION,
    sustainedMinutes,
    warnSustainedMinutes: SHARED_CPU_THROTTLE_WARN_MINUTES,
    causedTargetLoadGateFailure,
    sampleCount: null,
  };
}

// -- DuckDB spill: warn any sparse/median spill or >10% of analyses over ----
// -- 15 minutes; page a spill-cap/filesystem error. -------------------------

export const DUCKDB_SPILL_WARN_ANALYSIS_FRACTION = 0.1;
export const DUCKDB_SPILL_WARN_MINUTES = 15;

export type DuckdbSpillAlertInput = {
  sparseOrMedianFixtureSpilled: boolean;
  spilledAnalysisFraction: number;
  sustainedMinutes: number;
  spillCapOrFilesystemError: boolean;
};

export type DuckdbSpillAlertResult = {
  signal: "duckdb-spill";
  severity: AlertSeverity;
  identity: AlertIdentity;
  sparseOrMedianFixtureSpilled: boolean;
  spilledAnalysisFraction: number;
  warnAnalysisFractionThreshold: number;
  sustainedMinutes: number;
  warnSustainedMinutes: number;
  spillCapOrFilesystemError: boolean;
  sampleCount: null;
};

export function evaluateDuckdbSpillAlert(
  identity: AlertIdentity,
  input: DuckdbSpillAlertInput,
): DuckdbSpillAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const sparseOrMedianFixtureSpilled = requireBoolean(
    input.sparseOrMedianFixtureSpilled,
    "DuckDB sparse/median fixture spill flag",
  );
  const spilledAnalysisFraction = unitFraction(
    input.spilledAnalysisFraction,
    "DuckDB spilled analysis fraction",
  );
  const sustainedMinutes = nonnegativeFinite(
    input.sustainedMinutes,
    "DuckDB spill sustained minutes",
  );
  const spillCapOrFilesystemError = requireBoolean(
    input.spillCapOrFilesystemError,
    "DuckDB spill-cap/filesystem error flag",
  );

  const severity: AlertSeverity = spillCapOrFilesystemError
    ? "page"
    : sparseOrMedianFixtureSpilled ||
        (spilledAnalysisFraction > DUCKDB_SPILL_WARN_ANALYSIS_FRACTION &&
          sustainedMinutes >= DUCKDB_SPILL_WARN_MINUTES)
      ? "warn"
      : "ok";

  return {
    signal: "duckdb-spill",
    severity,
    identity: alertIdentity,
    sparseOrMedianFixtureSpilled,
    spilledAnalysisFraction,
    warnAnalysisFractionThreshold: DUCKDB_SPILL_WARN_ANALYSIS_FRACTION,
    sustainedMinutes,
    warnSustainedMinutes: DUCKDB_SPILL_WARN_MINUTES,
    spillCapOrFilesystemError,
    sampleCount: null,
  };
}

// -- Cgroup memory: warn >75% for 15 minutes; page >=85% or OOM. ------------

export const CGROUP_MEMORY_WARN_FRACTION = 0.75;
export const CGROUP_MEMORY_WARN_MINUTES = 15;
export const CGROUP_MEMORY_PAGE_FRACTION = 0.85;

export type CgroupMemoryAlertInput = {
  usedFraction: number;
  sustainedMinutes: number;
  oomOccurred: boolean;
};

export type CgroupMemoryAlertResult = {
  signal: "cgroup-memory";
  severity: AlertSeverity;
  identity: AlertIdentity;
  usedFraction: number;
  warnThreshold: number;
  pageThreshold: number;
  sustainedMinutes: number;
  warnSustainedMinutes: number;
  oomOccurred: boolean;
  sampleCount: null;
};

export function evaluateCgroupMemoryAlert(
  identity: AlertIdentity,
  input: CgroupMemoryAlertInput,
): CgroupMemoryAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const usedFraction = unitFraction(
    input.usedFraction,
    "cgroup memory used fraction",
  );
  const sustainedMinutes = nonnegativeFinite(
    input.sustainedMinutes,
    "cgroup memory sustained minutes",
  );
  const oomOccurred = requireBoolean(
    input.oomOccurred,
    "cgroup memory OOM flag",
  );

  const severity: AlertSeverity =
    oomOccurred || usedFraction >= CGROUP_MEMORY_PAGE_FRACTION
      ? "page"
      : usedFraction > CGROUP_MEMORY_WARN_FRACTION &&
          sustainedMinutes >= CGROUP_MEMORY_WARN_MINUTES
        ? "warn"
        : "ok";

  return {
    signal: "cgroup-memory",
    severity,
    identity: alertIdentity,
    usedFraction,
    warnThreshold: CGROUP_MEMORY_WARN_FRACTION,
    pageThreshold: CGROUP_MEMORY_PAGE_FRACTION,
    sustainedMinutes,
    warnSustainedMinutes: CGROUP_MEMORY_WARN_MINUTES,
    oomOccurred,
    sampleCount: null,
  };
}

// -- Process RSS: warn >75% for 15 minutes; page >=85%. ---------------------

export const PROCESS_RSS_WARN_FRACTION = 0.75;
export const PROCESS_RSS_WARN_MINUTES = 15;
export const PROCESS_RSS_PAGE_FRACTION = 0.85;

export type ProcessRssAlertInput = {
  usedFraction: number;
  sustainedMinutes: number;
};

export type ProcessRssAlertResult = {
  signal: "process-rss";
  severity: AlertSeverity;
  identity: AlertIdentity;
  usedFraction: number;
  warnThreshold: number;
  pageThreshold: number;
  sustainedMinutes: number;
  warnSustainedMinutes: number;
  sampleCount: null;
};

export function evaluateProcessRssAlert(
  identity: AlertIdentity,
  input: ProcessRssAlertInput,
): ProcessRssAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const usedFraction = unitFraction(
    input.usedFraction,
    "process RSS used fraction",
  );
  const sustainedMinutes = nonnegativeFinite(
    input.sustainedMinutes,
    "process RSS sustained minutes",
  );

  const severity: AlertSeverity =
    usedFraction >= PROCESS_RSS_PAGE_FRACTION
      ? "page"
      : usedFraction > PROCESS_RSS_WARN_FRACTION &&
          sustainedMinutes >= PROCESS_RSS_WARN_MINUTES
        ? "warn"
        : "ok";

  return {
    signal: "process-rss",
    severity,
    identity: alertIdentity,
    usedFraction,
    warnThreshold: PROCESS_RSS_WARN_FRACTION,
    pageThreshold: PROCESS_RSS_PAGE_FRACTION,
    sustainedMinutes,
    warnSustainedMinutes: PROCESS_RSS_WARN_MINUTES,
    sampleCount: null,
  };
}

// -- Volume free: warn <30% free; page <25% free. ---------------------------

export const VOLUME_FREE_WARN_FRACTION = 0.3;
export const VOLUME_FREE_PAGE_FRACTION = 0.25;

export type VolumeFreeAlertInput = {
  freeFraction: number;
};

export type VolumeFreeAlertResult = {
  signal: "volume-free";
  severity: AlertSeverity;
  identity: AlertIdentity;
  freeFraction: number;
  warnThreshold: number;
  pageThreshold: number;
  sampleCount: null;
};

export function evaluateVolumeFreeAlert(
  identity: AlertIdentity,
  input: VolumeFreeAlertInput,
): VolumeFreeAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const freeFraction = unitFraction(
    input.freeFraction,
    "volume free fraction",
  );

  const severity: AlertSeverity =
    freeFraction < VOLUME_FREE_PAGE_FRACTION
      ? "page"
      : freeFraction < VOLUME_FREE_WARN_FRACTION
        ? "warn"
        : "ok";

  return {
    signal: "volume-free",
    severity,
    identity: alertIdentity,
    freeFraction,
    warnThreshold: VOLUME_FREE_WARN_FRACTION,
    pageThreshold: VOLUME_FREE_PAGE_FRACTION,
    sampleCount: null,
  };
}

// -- Status pointer poll: warn >=3 consecutive failures; page a snapshot ----
// -- reaching a public overdue/delayed transition. --------------------------

export const STATUS_POINTER_POLL_WARN_CONSECUTIVE_FAILURES = 3;

export type StatusPointerPollPublicTransition = "none" | "overdue" | "delayed";

const STATUS_POINTER_POLL_PUBLIC_TRANSITIONS: ReadonlySet<StatusPointerPollPublicTransition> =
  new Set(["none", "overdue", "delayed"]);

export type StatusPointerPollAlertInput = {
  consecutiveFailures: number;
  publicTransition: StatusPointerPollPublicTransition;
};

export type StatusPointerPollAlertResult = {
  signal: "status-pointer-poll";
  severity: AlertSeverity;
  identity: AlertIdentity;
  consecutiveFailures: number;
  warnThreshold: number;
  publicTransition: StatusPointerPollPublicTransition;
  sampleCount: null;
};

export function evaluateStatusPointerPollAlert(
  identity: AlertIdentity,
  input: StatusPointerPollAlertInput,
): StatusPointerPollAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const consecutiveFailures = nonnegativeSafeInteger(
    input.consecutiveFailures,
    "status pointer poll consecutive failures",
  );
  if (!STATUS_POINTER_POLL_PUBLIC_TRANSITIONS.has(input.publicTransition)) {
    throw serviceLevelError(
      "Status pointer poll public transition must be none, overdue, or delayed.",
    );
  }

  const severity: AlertSeverity =
    input.publicTransition !== "none"
      ? "page"
      : consecutiveFailures >= STATUS_POINTER_POLL_WARN_CONSECUTIVE_FAILURES
        ? "warn"
        : "ok";

  return {
    signal: "status-pointer-poll",
    severity,
    identity: alertIdentity,
    consecutiveFailures,
    warnThreshold: STATUS_POINTER_POLL_WARN_CONSECUTIVE_FAILURES,
    publicTransition: input.publicTransition,
    sampleCount: null,
  };
}

// -- Known refresh failure: immediate warning and page. ---------------------

export type KnownRefreshFailureAlertInput = {
  occurred: boolean;
};

export type KnownRefreshFailureAlertResult = {
  signal: "known-refresh-failure";
  severity: AlertSeverity;
  identity: AlertIdentity;
  occurred: boolean;
  sampleCount: null;
};

export function evaluateKnownRefreshFailureAlert(
  identity: AlertIdentity,
  input: KnownRefreshFailureAlertInput,
): KnownRefreshFailureAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const occurred = requireBoolean(
    input.occurred,
    "known refresh failure occurred flag",
  );

  return {
    signal: "known-refresh-failure",
    // A known refresh failure pages immediately; the warning is implied by
    // the page, so there is no separate warn-only state for this signal.
    severity: occurred ? "page" : "ok",
    identity: alertIdentity,
    occurred,
    sampleCount: null,
  };
}

// -- Refresh duration: warn >24 hours; page >48 hours. ----------------------

export const REFRESH_DURATION_WARN_HOURS = 24;
export const REFRESH_DURATION_PAGE_HOURS = 48;

export type RefreshDurationAlertInput = {
  durationHours: number;
};

export type RefreshDurationAlertResult = {
  signal: "refresh-duration";
  severity: AlertSeverity;
  identity: AlertIdentity;
  durationHours: number;
  warnThreshold: number;
  pageThreshold: number;
  sampleCount: null;
};

export function evaluateRefreshDurationAlert(
  identity: AlertIdentity,
  input: RefreshDurationAlertInput,
): RefreshDurationAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const durationHours = nonnegativeFinite(
    input.durationHours,
    "refresh duration hours",
  );

  const severity: AlertSeverity =
    durationHours > REFRESH_DURATION_PAGE_HOURS
      ? "page"
      : durationHours > REFRESH_DURATION_WARN_HOURS
        ? "warn"
        : "ok";

  return {
    signal: "refresh-duration",
    severity,
    identity: alertIdentity,
    durationHours,
    warnThreshold: REFRESH_DURATION_WARN_HOURS,
    pageThreshold: REFRESH_DURATION_PAGE_HOURS,
    sampleCount: null,
  };
}

// -- Monthly error budget: warn >=50% consumed; page >=80% consumed. --------

export type MonthlyErrorBudgetAlertInput = {
  consumedFraction: number;
};

export type MonthlyErrorBudgetAlertResult = {
  signal: "monthly-error-budget";
  severity: AlertSeverity;
  identity: AlertIdentity;
  consumedFraction: number;
  warnThreshold: number;
  pageThreshold: number;
  sampleCount: null;
};

export function evaluateMonthlyErrorBudgetAlert(
  identity: AlertIdentity,
  input: MonthlyErrorBudgetAlertInput,
): MonthlyErrorBudgetAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  // A null/undefined consumedFraction (an unmeasured error budget) is
  // invalid input for this alert: callers must surface that state
  // separately rather than passing it through as a number.
  const consumedFraction = nonnegativeFinite(
    input.consumedFraction,
    "monthly error budget consumed fraction",
  );

  const severity: AlertSeverity =
    consumedFraction >= ERROR_BUDGET_PAGE_CONSUMED_FRACTION
      ? "page"
      : consumedFraction >= ERROR_BUDGET_WARN_CONSUMED_FRACTION
        ? "warn"
        : "ok";

  return {
    signal: "monthly-error-budget",
    severity,
    identity: alertIdentity,
    consumedFraction,
    warnThreshold: ERROR_BUDGET_WARN_CONSUMED_FRACTION,
    pageThreshold: ERROR_BUDGET_PAGE_CONSUMED_FRACTION,
    sampleCount: null,
  };
}

// -- Monthly cost forecast: warn >$40; page >$50 without an approved --------
// -- architecture decision. --------------------------------------------------

export const MONTHLY_COST_FORECAST_WARN_USD = 40;
export const MONTHLY_COST_FORECAST_PAGE_USD = 50;

export type MonthlyCostForecastAlertInput = {
  forecastUsd: number;
  architectureDecisionApproved: boolean;
};

export type MonthlyCostForecastAlertResult = {
  signal: "monthly-cost-forecast";
  severity: AlertSeverity;
  identity: AlertIdentity;
  forecastUsd: number;
  warnThreshold: number;
  pageThreshold: number;
  architectureDecisionApproved: boolean;
  sampleCount: null;
};

export function evaluateMonthlyCostForecastAlert(
  identity: AlertIdentity,
  input: MonthlyCostForecastAlertInput,
): MonthlyCostForecastAlertResult {
  const alertIdentity = requireAlertIdentity(identity);
  const forecastUsd = nonnegativeFinite(
    input.forecastUsd,
    "monthly cost forecast USD",
  );
  const architectureDecisionApproved = requireBoolean(
    input.architectureDecisionApproved,
    "monthly cost forecast architecture-decision-approved flag",
  );

  const severity: AlertSeverity =
    forecastUsd > MONTHLY_COST_FORECAST_PAGE_USD &&
    !architectureDecisionApproved
      ? "page"
      : forecastUsd > MONTHLY_COST_FORECAST_WARN_USD
        ? "warn"
        : "ok";

  return {
    signal: "monthly-cost-forecast",
    severity,
    identity: alertIdentity,
    forecastUsd,
    warnThreshold: MONTHLY_COST_FORECAST_WARN_USD,
    pageThreshold: MONTHLY_COST_FORECAST_PAGE_USD,
    architectureDecisionApproved,
    sampleCount: null,
  };
}
