import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createPlaywrightBrowserLabDriver,
  runBrowserLab,
  validateBrowserLabPlan,
} from "../../src/promotion/browser-lab-runner";
import {
  createAnonymousSourcePacedHttpExecutor,
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
  type TradeExplorerQueryMeasurementInput,
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
      tradeExplorer: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const [
    browserBytes,
    originBytes,
    loadBytes,
    lifecycleBytes,
    tradeExplorerBytes,
  ] =
    await Promise.all([
      readFile(required(values.browserPlan, "browser-plan")),
      readFile(required(values.originPlan, "origin-plan")),
      readFile(required(values.loadPlan, "load-plan")),
      readFile(required(values.lifecycle, "lifecycle")),
      readFile(required(values.tradeExplorer, "trade-explorer")),
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
  const tradeExplorer = parseTradeExplorerEvidence(
    parseJson(tradeExplorerBytes, "Trade Explorer evidence"),
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
  const originReport = await runOriginBenchmark(
    originPlan,
    createAnonymousSourcePacedHttpExecutor(executor),
  );
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
    originCapabilities: originReport.capabilities,
    originBenchmarks: [...originReport.originBenchmarks],
    tradeExplorer: {
      ...tradeExplorer.measurements,
      benchmarkQueries: originReport.attestation.tradeExplorerBenchmarkQueries,
    },
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
        tradeExplorer,
      },
      null,
      2,
    )}\n`,
  );
}

function parseTradeExplorerEvidence(
  value: unknown,
  measurementClass: "candidate" | "local-smoke",
  identity: PerformanceMeasurementIdentity,
): {
  schemaVersion: "trade-explorer-measurement-v1";
  measuredAt: string;
  measurements: { queries: TradeExplorerQueryMeasurementInput[] };
} {
  const evidence = object(value, "Trade Explorer evidence");
  if (evidence.schemaVersion !== "trade-explorer-measurement-v1") {
    throw new PerformanceCandidateCliError(
      "Trade Explorer evidence schemaVersion must be trade-explorer-measurement-v1.",
    );
  }
  if (evidence.measurementClass !== measurementClass) {
    throw new PerformanceCandidateCliError(
      "Trade Explorer evidence measurementClass does not match the plans.",
    );
  }
  assertIdentity(
    object(evidence.identity, "Trade Explorer identity"),
    identity,
  );
  if (!Array.isArray(evidence.queries)) {
    throw new PerformanceCandidateCliError(
      "Trade Explorer evidence queries must be an array.",
    );
  }
  return {
    schemaVersion: "trade-explorer-measurement-v1",
    measuredAt: utcTimestamp(
      evidence.measuredAt,
      "Trade Explorer measuredAt",
    ),
    measurements: {
      queries: evidence.queries.map((query, index) => {
        const candidate = object(
          query,
          `Trade Explorer query ${index + 1}`,
        );
        const productRole = candidate.productRole;
        if (
          productRole !== "sparse" &&
          productRole !== "median" &&
          productRole !== "upper-quartile" &&
          productRole !== "maximum-row"
        ) {
          throw new PerformanceCandidateCliError(
            `Trade Explorer query ${index + 1} productRole is unsupported.`,
          );
        }
        return {
          productRole,
          benchmarkQuery: parseTradeExplorerBenchmarkQuery(
            candidate.benchmarkQuery,
            index,
          ),
          scanRows: nonnegativeSafeInteger(
            candidate.scanRows,
            `Trade Explorer query ${index + 1} scanRows`,
          ),
          resultRows: nonnegativeSafeInteger(
            candidate.resultRows,
            `Trade Explorer query ${index + 1} resultRows`,
          ),
          resultBytes: nonnegativeSafeInteger(
            candidate.resultBytes,
            `Trade Explorer query ${index + 1} resultBytes`,
          ),
          exportBytes: nonnegativeSafeInteger(
            candidate.exportBytes,
            `Trade Explorer query ${index + 1} exportBytes`,
          ),
          peakMemoryBytes: nonnegativeSafeInteger(
            candidate.peakMemoryBytes,
            `Trade Explorer query ${index + 1} peakMemoryBytes`,
          ),
          peakSpillBytes: nonnegativeSafeInteger(
            candidate.peakSpillBytes,
            `Trade Explorer query ${index + 1} peakSpillBytes`,
          ),
          queueWaitMs: nonnegativeNumber(
            candidate.queueWaitMs,
            `Trade Explorer query ${index + 1} queueWaitMs`,
          ),
          executionMs: positiveNumber(
            candidate.executionMs,
            `Trade Explorer query ${index + 1} executionMs`,
          ),
          cancellationReleaseMs: nonnegativeNumber(
            candidate.cancellationReleaseMs,
            `Trade Explorer query ${index + 1} cancellationReleaseMs`,
          ),
          cancellationReleased: boolean(
            candidate.cancellationReleased,
            `Trade Explorer query ${index + 1} cancellationReleased`,
          ),
          cacheUnpoisoned: boolean(
            candidate.cacheUnpoisoned,
            `Trade Explorer query ${index + 1} cacheUnpoisoned`,
          ),
          queueUnpoisoned: boolean(
            candidate.queueUnpoisoned,
            `Trade Explorer query ${index + 1} queueUnpoisoned`,
          ),
          subsequentRequestSucceeded: boolean(
            candidate.subsequentRequestSucceeded,
            `Trade Explorer query ${index + 1} subsequentRequestSucceeded`,
          ),
        };
      }),
    },
  };
}

function parseTradeExplorerBenchmarkQuery(
  value: unknown,
  index: number,
): TradeExplorerQueryMeasurementInput["benchmarkQuery"] {
  const query = object(
    value,
    `Trade Explorer query ${index + 1} benchmarkQuery`,
  );
  if (
    query.shape !== "finalized-trend-v1" ||
    !Array.isArray(query.measures) ||
    query.measures.length !== 2 ||
    query.measures[0] !== "TRADE_VALUE_USD" ||
    query.measures[1] !== "RECORDED_FLOW_COUNT"
  ) {
    throw new PerformanceCandidateCliError(
      `Trade Explorer query ${index + 1} benchmarkQuery shape or measures are invalid.`,
    );
  }
  const exportEconomyCode = code(
    query.exportEconomyCode,
    /^\d{1,3}$/u,
    `Trade Explorer query ${index + 1} exportEconomyCode`,
  );
  const importEconomyCode = code(
    query.importEconomyCode,
    /^\d{1,3}$/u,
    `Trade Explorer query ${index + 1} importEconomyCode`,
  );
  const hsProductCode = code(
    query.hsProductCode,
    /^\d{6}$/u,
    `Trade Explorer query ${index + 1} hsProductCode`,
  );
  return {
    shape: "finalized-trend-v1",
    measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
    exportEconomyCode,
    importEconomyCode,
    hsProductCode,
  };
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
  const parsedMeasurements: LifecycleMeasurementInput = {
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
  };
  if (
    measurementClass === "candidate" &&
    [
      parsedMeasurements.restartToReadyMs,
      parsedMeasurements.coldHydrationToReadyMs,
      parsedMeasurements.rollbackToReadyMs,
      parsedMeasurements.deployInterruptionMs,
      parsedMeasurements.recoveryTimeMs,
    ].some((duration) => duration === 0)
  ) {
    throw new PerformanceCandidateCliError(
      "Candidate lifecycle evidence requires positive measured durations; zero placeholders are forbidden.",
    );
  }
  return {
    schemaVersion: "lifecycle-measurement-v1",
    measuredAt: utcTimestamp(evidence.measuredAt, "lifecycle measuredAt"),
    measurements: parsedMeasurements,
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

function positiveNumber(value: unknown, label: string): number {
  const parsed = nonnegativeNumber(value, label);
  if (parsed === 0) {
    throw new PerformanceCandidateCliError(
      `${label} must be a finite positive number.`,
    );
  }
  return parsed;
}

function code(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PerformanceCandidateCliError(`${label} is malformed.`);
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

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new PerformanceCandidateCliError(`${label} must be a boolean.`);
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
