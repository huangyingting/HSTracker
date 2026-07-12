import { nonnegativeSafeInteger } from "../deployment/value-validation";
import {
  evaluateMonthlyErrorBudget,
  evaluateProbeSli,
  evaluateRequestSli,
  type ProbeInterval,
  type ProbeMeasurementWindow,
  type RequestOutcomeSample,
  type RouteObservationIdentity,
} from "./service-levels";

const REQUIRED_ALERT_SIGNALS = [
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
] as const;

export type ObservabilityAlertSignal =
  (typeof REQUIRED_ALERT_SIGNALS)[number];

export type ObservabilityAlertResult = {
  signal: ObservabilityAlertSignal;
  severity: "ok" | "warn" | "page";
  identity: {
    analysisBuildId: string;
    baciRelease: string;
  };
  sampleCount: number | null;
};

export type ServiceLevelReportInput = {
  schemaVersion: "production-service-level-input-v1";
  measuredAt: string;
  identity: {
    analysisBuildId: string;
    baciRelease: string;
    fixtureManifestSha256: string;
    smokeAnalysisKey: string;
  };
  requestWindows: {
    identity: RouteObservationIdentity;
    samples: RequestOutcomeSample[];
  }[];
  probeIntervals: ProbeInterval[];
  probeWindow: ProbeMeasurementWindow;
  alerts: ObservabilityAlertResult[];
};

export class ServiceLevelReportInputError extends Error {
  readonly code = "SERVICE_LEVEL_REPORT_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ServiceLevelReportInputError";
  }
}

export function evaluateServiceLevelReport(
  input: ServiceLevelReportInput,
) {
  if (input.schemaVersion !== "production-service-level-input-v1") {
    throw new ServiceLevelReportInputError(
      "Service-level input schema is incompatible.",
    );
  }
  const measuredAt = utcTimestamp(
    input.measuredAt,
    "service-level measuredAt",
  );
  const identity = {
    analysisBuildId: nonemptyString(
      input.identity.analysisBuildId,
      "analysis build ID",
    ),
    baciRelease: baciRelease(input.identity.baciRelease),
    fixtureManifestSha256: sha256(
      input.identity.fixtureManifestSha256,
      "fixture manifest SHA-256",
    ),
    smokeAnalysisKey: nonemptyString(
      input.identity.smokeAnalysisKey,
      "smoke analysis key",
    ),
  };
  const requestWindows = input.requestWindows.map((window) => {
    assertWindowIdentity(
      window.identity.analysisBuildId,
      window.identity.baciRelease,
      identity,
      "Request window",
    );
    return evaluateRequestSli(window.identity, window.samples);
  });
  const requestSli = requestWindows.reduce(
    (aggregate, window) => ({
      sampleCount: aggregate.sampleCount + window.sampleCount,
      eligibleCount: aggregate.eligibleCount + window.eligibleCount,
      successfulCount:
        aggregate.successfulCount + window.successfulCount,
      failedCount: aggregate.failedCount + window.failedCount,
      excludedCount: aggregate.excludedCount + window.excludedCount,
    }),
    {
      sampleCount: 0,
      eligibleCount: 0,
      successfulCount: 0,
      failedCount: 0,
      excludedCount: 0,
    },
  );
  const requestMeasurable = requestSli.eligibleCount > 0;
  const requestSuccessFraction = requestMeasurable
    ? requestSli.successfulCount / requestSli.eligibleCount
    : null;
  const requestErrorBudget = evaluateMonthlyErrorBudget({
    eligibleCount: requestSli.eligibleCount,
    failedCount: requestSli.failedCount,
  });

  for (const interval of input.probeIntervals) {
    assertWindowIdentity(
      interval.analysisBuildId,
      interval.baciRelease,
      identity,
      "Probe interval",
    );
  }
  const probeSli = evaluateProbeSli(
    {
      analysisBuildId: identity.analysisBuildId,
      baciRelease: identity.baciRelease,
      fixtureManifestSha256: identity.fixtureManifestSha256,
      smokeAnalysisKey: identity.smokeAnalysisKey,
    },
    input.probeIntervals,
    input.probeWindow,
  );
  const probeErrorBudget = evaluateMonthlyErrorBudget({
    eligibleCount: probeSli.sampleCount,
    failedCount: probeSli.failedCount,
  });
  const alerts = evaluateAlerts(input.alerts, identity);
  const status =
    requestMeasurable &&
    requestSuccessFraction !== null &&
    requestSuccessFraction >= 0.995 &&
    probeSli.measurable &&
    probeSli.successFraction !== null &&
    probeSli.successFraction >= 0.995 &&
    requestErrorBudget.status === "ok" &&
    probeErrorBudget.status === "ok" &&
    alerts.status === "accepted"
      ? ("accepted" as const)
      : ("blocked" as const);

  return {
    schemaVersion: "production-service-level-report-v1" as const,
    measuredAt,
    status,
    identity,
    requestSli: {
      ...requestSli,
      measurable: requestMeasurable,
      successFraction: requestSuccessFraction,
      windows: requestWindows,
    },
    probeSli,
    requestErrorBudget,
    probeErrorBudget,
    alerts,
  };
}

function evaluateAlerts(
  input: ObservabilityAlertResult[],
  identity: ServiceLevelReportInput["identity"],
) {
  const bySignal = new Map<
    ObservabilityAlertSignal,
    ObservabilityAlertResult
  >();
  for (const alert of input) {
    if (!isAlertSignal(alert.signal)) {
      throw new ServiceLevelReportInputError(
        `Unsupported observability alert result ${String(alert.signal)}.`,
      );
    }
    if (bySignal.has(alert.signal)) {
      throw new ServiceLevelReportInputError(
        `Duplicate observability alert result for ${alert.signal}.`,
      );
    }
    assertWindowIdentity(
      alert.identity.analysisBuildId,
      alert.identity.baciRelease,
      identity,
      `${alert.signal} alert`,
    );
    if (
      alert.severity !== "ok" &&
      alert.severity !== "warn" &&
      alert.severity !== "page"
    ) {
      throw new ServiceLevelReportInputError(
        `${alert.signal} alert severity is unsupported.`,
      );
    }
    if (alert.sampleCount !== null) {
      nonnegativeSafeInteger(
        alert.sampleCount,
        `${alert.signal} alert sample count`,
        serviceLevelReportError,
      );
    }
    bySignal.set(alert.signal, alert);
  }

  const results = REQUIRED_ALERT_SIGNALS.map((signal) => {
    const alert = bySignal.get(signal);
    if (alert === undefined) {
      throw new ServiceLevelReportInputError(
        `Missing observability alert result for ${signal}.`,
      );
    }
    return alert;
  });
  if (bySignal.size !== REQUIRED_ALERT_SIGNALS.length) {
    throw new ServiceLevelReportInputError(
      "Service-level input contains unsupported alert evidence.",
    );
  }
  const warningCount = results.filter(
    (alert) => alert.severity === "warn",
  ).length;
  const pageCount = results.filter(
    (alert) => alert.severity === "page",
  ).length;
  return {
    status:
      warningCount === 0 && pageCount === 0
        ? ("accepted" as const)
        : ("blocked" as const),
    count: results.length,
    warningCount,
    pageCount,
    results,
  };
}

function assertWindowIdentity(
  analysisBuildId: string,
  baciReleaseValue: string,
  expected: ServiceLevelReportInput["identity"],
  label: string,
): void {
  if (
    analysisBuildId !== expected.analysisBuildId ||
    baciReleaseValue !== expected.baciRelease
  ) {
    throw new ServiceLevelReportInputError(
      `${label} identity does not match the service-level report.`,
    );
  }
}

function sha256(value: string, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new ServiceLevelReportInputError(
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function isAlertSignal(
  value: string,
): value is ObservabilityAlertSignal {
  return (REQUIRED_ALERT_SIGNALS as readonly string[]).includes(value);
}

function baciRelease(value: string): string {
  if (!/^V\d{6}$/u.test(value)) {
    throw new ServiceLevelReportInputError(
      "BACI Release must use VYYYYMM.",
    );
  }
  return value;
}

function nonemptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceLevelReportInputError(
      `${label} must be a nonempty string.`,
    );
  }
  return value;
}

function utcTimestamp(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ServiceLevelReportInputError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function serviceLevelReportError(
  message: string,
): ServiceLevelReportInputError {
  return new ServiceLevelReportInputError(message);
}
