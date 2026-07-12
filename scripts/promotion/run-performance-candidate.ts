import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createPlaywrightBrowserLabDriver,
  runBrowserLab,
  validateBrowserLabPlan,
} from "../../src/promotion/browser-lab-runner";
import {
  createFetchHttpExecutor,
  createPrometheusMixedLoadObservationAdapter,
  parseMixedLoadPlan,
  parseOriginBenchmarkPlan,
  runMixedLoad,
  runOriginBenchmark,
} from "../../src/promotion/http-performance-runner";
import {
  evaluatePerformanceGates,
  type LifecycleMeasurementInput,
  type PerformanceMeasurementIdentity,
} from "../../src/promotion/performance-gates";

class PerformanceCandidateCliError extends Error {
  readonly code = "PERFORMANCE_CANDIDATE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PerformanceCandidateCliError";
  }
}

void main().catch((error: unknown) => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "PERFORMANCE_CANDIDATE_RUN_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Performance candidate run failed with an unknown error.";
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      browserPlan: { type: "string" },
      originPlan: { type: "string" },
      loadPlan: { type: "string" },
      lifecycle: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const [browserBytes, originBytes, loadBytes, lifecycleBytes] =
    await Promise.all([
      readFile(required(values.browserPlan, "browser-plan")),
      readFile(required(values.originPlan, "origin-plan")),
      readFile(required(values.loadPlan, "load-plan")),
      readFile(required(values.lifecycle, "lifecycle")),
    ]);
  const browserPlan = validateBrowserLabPlan(
    parseJson(browserBytes, "browser plan"),
  );
  const originPlan = parseOriginBenchmarkPlan(
    parseJson(originBytes, "origin plan"),
  );
  const loadPlan = parseMixedLoadPlan(parseJson(loadBytes, "load plan"));
  assertSameMeasurement(
    browserPlan.measurementClass,
    browserPlan.origin,
    browserPlan.identity,
    originPlan.measurementClass,
    originPlan.origin,
    originPlan.identity,
    "origin plan",
  );
  assertSameMeasurement(
    browserPlan.measurementClass,
    browserPlan.origin,
    browserPlan.identity,
    loadPlan.measurementClass,
    loadPlan.origin,
    loadPlan.identity,
    "load plan",
  );
  const lifecycle = parseLifecycleEvidence(
    parseJson(lifecycleBytes, "lifecycle evidence"),
    browserPlan.measurementClass,
    browserPlan.identity,
  );

  const browserDriver = createPlaywrightBrowserLabDriver();
  let browserReport: Awaited<ReturnType<typeof runBrowserLab>>;
  try {
    browserReport = await runBrowserLab(browserDriver, browserPlan);
  } finally {
    await browserDriver.dispose();
  }
  const executor = createFetchHttpExecutor();
  const originReport = await runOriginBenchmark(originPlan, executor);
  const loadReport = await runMixedLoad(loadPlan, executor, {
    observationAdapter: createPrometheusMixedLoadObservationAdapter(
      loadPlan.origin,
      loadPlan.identity,
    ),
  });
  const measuredAt = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
  const performance = evaluatePerformanceGates({
    measurementClass: browserPlan.measurementClass,
    measuredAt,
    identity: browserPlan.identity,
    browserLab: [
      browserReport.products.median,
      browserReport.products["maximum-row"],
    ].map((product) => ({
      productRole: product.productRole,
      trials: product.trials.flatMap((trial) =>
        trial.status === "measured" ? [trial.metrics] : [],
      ),
      failedTrialCount: product.failedTrialCount,
    })),
    originBenchmarks: [...originReport.originBenchmarks],
    targetLoad: loadReport.targetLoad,
    lifecycle: lifecycle.measurements,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "performance-candidate-evidence-v1",
        measurementClass: browserPlan.measurementClass,
        measuredAt,
        identity: browserPlan.identity,
        status: performance.status,
        performance,
        browserReport,
        originReport,
        loadReport,
        lifecycle,
      },
      null,
      2,
    )}\n`,
  );
}

function parseLifecycleEvidence(
  value: unknown,
  measurementClass: "candidate" | "local-smoke",
  identity: PerformanceMeasurementIdentity,
): {
  schemaVersion: "lifecycle-measurement-v1";
  measuredAt: string;
  measurements: LifecycleMeasurementInput;
} {
  const evidence = object(value, "lifecycle evidence");
  if (evidence.schemaVersion !== "lifecycle-measurement-v1") {
    throw new PerformanceCandidateCliError(
      "Lifecycle evidence schemaVersion must be lifecycle-measurement-v1.",
    );
  }
  if (evidence.measurementClass !== measurementClass) {
    throw new PerformanceCandidateCliError(
      "Lifecycle evidence measurementClass does not match the plans.",
    );
  }
  assertIdentity(object(evidence.identity, "lifecycle identity"), identity);
  const measurements = object(
    evidence.measurements,
    "lifecycle measurements",
  );
  return {
    schemaVersion: "lifecycle-measurement-v1",
    measuredAt: utcTimestamp(evidence.measuredAt, "lifecycle measuredAt"),
    measurements: {
      restartToReadyMs: nonnegativeNumber(
        measurements.restartToReadyMs,
        "restartToReadyMs",
      ),
      coldHydrationToReadyMs: nonnegativeNumber(
        measurements.coldHydrationToReadyMs,
        "coldHydrationToReadyMs",
      ),
      rollbackToReadyMs: nonnegativeNumber(
        measurements.rollbackToReadyMs,
        "rollbackToReadyMs",
      ),
      deployInterruptionMs: nonnegativeNumber(
        measurements.deployInterruptionMs,
        "deployInterruptionMs",
      ),
      recoveryTimeMs: nonnegativeNumber(
        measurements.recoveryTimeMs,
        "recoveryTimeMs",
      ),
      acceptedArtifactLossCount: nonnegativeSafeInteger(
        measurements.acceptedArtifactLossCount,
        "acceptedArtifactLossCount",
      ),
    },
  };
}

function assertSameMeasurement(
  measurementClass: string,
  origin: string,
  identity: PerformanceMeasurementIdentity,
  otherMeasurementClass: string,
  otherOrigin: string,
  otherIdentity: PerformanceMeasurementIdentity,
  label: string,
): void {
  if (
    otherMeasurementClass !== measurementClass ||
    otherOrigin !== origin
  ) {
    throw new PerformanceCandidateCliError(
      `${label} measurement class or origin does not match the browser plan.`,
    );
  }
  assertIdentity(otherIdentity, identity);
}

function assertIdentity(
  actual: Record<string, unknown> | PerformanceMeasurementIdentity,
  expected: PerformanceMeasurementIdentity,
): void {
  for (const field of Object.keys(expected) as Array<
    keyof PerformanceMeasurementIdentity
  >) {
    if (actual[field] !== expected[field]) {
      throw new PerformanceCandidateCliError(
        `Measurement identity ${field} does not match across evidence.`,
      );
    }
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new PerformanceCandidateCliError(`${label} is not valid JSON.`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PerformanceCandidateCliError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new PerformanceCandidateCliError(`--${name} is required.`);
  }
  return value;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PerformanceCandidateCliError(
      `${label} must be a finite nonnegative number.`,
    );
  }
  return value;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new PerformanceCandidateCliError(
      `${label} must be a nonnegative safe integer.`,
    );
  }
  return value;
}

function utcTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PerformanceCandidateCliError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}
