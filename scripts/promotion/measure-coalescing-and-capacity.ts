import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  createFixtureApplicationRuntime,
  type ApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import type {
  AnalysisExecutionOptions,
  AnalysisOutcome,
  AnalysisRequest,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import { RUNTIME_RESOURCE_POLICY } from "../../src/runtime-resource-policy";
import type { PromotionEvidenceStatus } from "../../src/promotion/promotion-report";

const REPO_ROOT = process.cwd();
const ANALYSIS_BUILD_ID = "acceptance-fixtures-v1";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_EVIDENCE =
  "reports/promotion/candidate/evidence/coalescing-and-capacity-measurement.json";

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Coalescing-and-capacity drill failed.";
  process.stderr.write(
    `${JSON.stringify({ error: { code: "COALESCING_CAPACITY_DRILL_FAILED", message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "out-dir": { type: "string" },
      evidence: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const evidencePath = values.evidence ?? DEFAULT_EVIDENCE;

  const windowStartedAt = utcNow();
  const coalescing = await measureCoalescing();
  const capacity = await measureCapacity();
  const windowEndedAt = utcNow();

  const coalescingStatus: PromotionEvidenceStatus =
    coalescing.singleComputation &&
    coalescing.allResultsIdentical &&
    coalescing.allSucceeded
      ? "accepted"
      : "blocked";

  const capacityStatus: PromotionEvidenceStatus =
    capacity.queueFullRejected &&
    capacity.queueTimeoutRejected &&
    capacity.admittedRecovered &&
    capacity.recoveredAfterTimeout
      ? "accepted"
      : "blocked";

  const evidence = {
    schemaVersion: "coalescing-and-capacity-measurement-v1",
    analysisBuildId: ANALYSIS_BUILD_ID,
    measuredAt: windowStartedAt,
    policy: {
      maxConcurrentAnalyses: RUNTIME_RESOURCE_POLICY.maxConcurrentAnalyses,
      maxQueuedAnalyses: RUNTIME_RESOURCE_POLICY.maxQueuedAnalyses,
      queueWaitTimeoutMs: RUNTIME_RESOURCE_POLICY.queueWaitTimeoutMs,
    },
    coalescing,
    capacity,
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await mkdir(dirname(join(REPO_ROOT, evidencePath)), { recursive: true });
  await writeFile(join(REPO_ROOT, evidencePath), evidenceBytes);

  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "coalescing-and-capacity",
    measurementClass: "candidate",
    measuredAt: windowStartedAt,
    windowStartedAt,
    windowEndedAt,
    sampleCount: coalescing.requestCount + capacity.admittedCount + 2,
    checks: [
      {
        name: "coalescing",
        status: coalescingStatus,
        detail: `${coalescing.requestCount} identical requests collapsed to ${coalescing.computations} computation(s); results identical=${coalescing.allResultsIdentical}, all succeeded=${coalescing.allSucceeded}.`,
      },
      {
        name: "capacity",
        status: capacityStatus,
        detail: `Queue-full rejection observed=${capacity.queueFullRejected} (${capacity.admittedCount} admitted at policy limit); queue-timeout rejection observed=${capacity.queueTimeoutRejected}; admitted requests recovered=${capacity.admittedRecovered}; post-timeout replacement succeeded=${capacity.recoveredAfterTimeout}.`,
      },
    ],
    additionalRetainedLogs: [
      {
        path: evidencePath,
        sha256: sha256(evidenceBytes),
      },
    ],
  };

  const outPath = `${outDir}/coalescing-and-capacity.checks.json`;
  await mkdir(dirname(join(REPO_ROOT, outPath)), { recursive: true });
  await writeFile(
    join(REPO_ROOT, outPath),
    `${JSON.stringify(checkSet, null, 2)}\n`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "coalescing-and-capacity-measurement-report-v1",
        out: outPath,
        coalescing: coalescingStatus,
        capacity: capacityStatus,
        evidence: evidencePath,
      },
      null,
      2,
    )}\n`,
  );
}

interface CoalescingMeasurement {
  requestCount: number;
  computations: number;
  singleComputation: boolean;
  allResultsIdentical: boolean;
  allSucceeded: boolean;
}

async function measureCoalescing(): Promise<CoalescingMeasurement> {
  const fixture = createFixtureApplicationRuntime();
  const gate = deferred<void>();
  let computations = 0;
  const inner = interceptCandidate(fixture, async (request, options) => {
    computations += 1;
    await gate.promise;
    return fixture.tradeAnalytics.execute(request, options);
  });
  const runtime = createBoundedApplicationRuntime(inner);

  const requestCount = 10;
  const pending = Array.from({ length: requestCount }, () =>
    runtime.tradeAnalytics.execute(candidateRequest("010121")),
  );
  await Promise.resolve();
  const singleComputation = computations === 1;

  gate.resolve();
  const results = await Promise.all(pending);
  const allResultsIdentical = results.every(
    (result) => result === results[0],
  );
  const allSucceeded = results.every((result) => result.state === "success");

  return {
    requestCount,
    computations,
    singleComputation,
    allResultsIdentical,
    allSucceeded,
  };
}

interface CapacityMeasurement {
  admittedCount: number;
  queueFullRejected: boolean;
  queueFullReason: string | null;
  queueTimeoutRejected: boolean;
  queueTimeoutReason: string | null;
  admittedRecovered: boolean;
  recoveredAfterTimeout: boolean;
}

async function measureCapacity(): Promise<CapacityMeasurement> {
  const admittedCount =
    RUNTIME_RESOURCE_POLICY.maxConcurrentAnalyses +
    RUNTIME_RESOURCE_POLICY.maxQueuedAnalyses;

  // A real, successful Candidate Market outcome the interceptors return for
  // every admitted computation, so admission control is exercised with
  // genuine results while distinct product codes defeat request coalescing.
  const expected = await createFixtureApplicationRuntime().tradeAnalytics.execute(
    candidateRequest("010121"),
  );
  if (expected.state !== "success") {
    throw new Error("Capacity baseline Candidate Market query did not succeed.");
  }

  // queue-full: saturate concurrency + queue with distinct requests, then the
  // next distinct request must be rejected at admission.
  const fullFixture = createFixtureApplicationRuntime();
  const fullGate = deferred<void>();
  const fullInner = interceptCandidate(fullFixture, async () => {
    await fullGate.promise;
    return expected;
  });
  const fullRuntime = createBoundedApplicationRuntime(fullInner);

  const admitted = Array.from({ length: admittedCount }, (_, index) =>
    fullRuntime.tradeAnalytics.execute(candidateRequest(productCode(index))),
  );
  await Promise.resolve();
  await Promise.resolve();
  const rejected = await fullRuntime.tradeAnalytics.execute(
    candidateRequest(productCode(admittedCount)),
  );
  const queueFullRejected =
    rejected.state === "capacity" &&
    rejected.error.code === "ANALYSIS_CAPACITY_EXCEEDED" &&
    rejected.error.reason === "queue-full";
  const queueFullReason =
    rejected.state === "capacity" ? rejected.error.reason : null;

  fullGate.resolve();
  const admittedOutcomes = await Promise.all(admitted);
  const admittedRecovered = admittedOutcomes.every(
    (outcome) => outcome.state === "success",
  );

  // queue-timeout: a single-slot runtime with a tight queue-wait deadline must
  // reject a waiter that cannot be admitted before the deadline elapses.
  const timeoutFixture = createFixtureApplicationRuntime();
  const timeoutGate = deferred<void>();
  const timeoutInner = interceptCandidate(timeoutFixture, async (request) => {
    if (request.recipe === "candidate-market-v1" && request.productCode === "010121") {
      await timeoutGate.promise;
    }
    return expected;
  });
  const timeoutRuntime = createBoundedApplicationRuntime(timeoutInner, {
    maxConcurrentAnalyses: 1,
    maxQueuedAnalyses: 1,
    queueWaitTimeoutMs: 10,
  });

  const holder = timeoutRuntime.tradeAnalytics.execute(
    candidateRequest("010121"),
  );
  const timedOut = await timeoutRuntime.tradeAnalytics.execute(
    candidateRequest(productCode(1)),
  );
  const queueTimeoutRejected =
    timedOut.state === "capacity" &&
    timedOut.error.code === "ANALYSIS_CAPACITY_EXCEEDED" &&
    timedOut.error.reason === "queue-timeout";
  const queueTimeoutReason =
    timedOut.state === "capacity" ? timedOut.error.reason : null;

  const replacement = timeoutRuntime.tradeAnalytics.execute(
    candidateRequest(productCode(2)),
  );
  timeoutGate.resolve();
  const [holderOutcome, replacementOutcome] = await Promise.all([
    holder,
    replacement,
  ]);
  const recoveredAfterTimeout =
    holderOutcome.state === "success" && replacementOutcome.state === "success";

  return {
    admittedCount,
    queueFullRejected,
    queueFullReason,
    queueTimeoutRejected,
    queueTimeoutReason,
    admittedRecovered,
    recoveredAfterTimeout,
  };
}

function interceptCandidate(
  runtime: ApplicationRuntime,
  execute: (
    request: AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ) => Promise<AnalysisOutcome<AnalysisRequest["recipe"]>>,
): ApplicationRuntime {
  return {
    ...runtime,
    tradeAnalytics: {
      execute<Request extends AnalysisRequest>(
        request: Request,
        options?: AnalysisExecutionOptions,
      ): Promise<AnalysisOutcome<Request["recipe"]>> {
        if (request.recipe !== "candidate-market-v1") {
          return runtime.tradeAnalytics.execute(request, options);
        }
        return execute(request, options) as Promise<
          AnalysisOutcome<Request["recipe"]>
        >;
      },
    },
  };
}

function candidateRequest(code: string): AnalysisRequest {
  return {
    recipe: "candidate-market-v1",
    analysisBuildId: ANALYSIS_BUILD_ID,
    exporterCode: "156",
    productCode: code,
  } as unknown as AnalysisRequest;
}

function productCode(index: number): string {
  return String(index).padStart(6, "0");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
