import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import {
  ROUTE_DEADLINE_MS,
  createRequestDeadline,
  createSynchronousRequestDeadline,
  isRequestDeadlineExceededError,
} from "../../src/runtime/request-deadline";
import type { PromotionEvidenceStatus } from "../../src/promotion/promotion-report";
import {
  parseOriginBenchmarkPlan,
  type OriginBenchmarkPlan,
} from "../../src/promotion/http-performance-runner";

const REPO_ROOT = process.cwd();
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_EVIDENCE =
  "reports/promotion/candidate/evidence/http-cache-and-deadlines-evidence.json";

const CURRENT_MANIFEST_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, must-revalidate";
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";

interface CacheObservation {
  label: string;
  path: string;
  status: number;
  etag: string | null;
  cacheControl: string | null;
  expectedCacheControl: string;
  revalidationStatus: number;
  headStatus: number;
  headEtag: string | null;
  headCacheControl: string | null;
  headBodyBytes: number;
  passed: boolean;
  reason: string | null;
}

interface DeadlineObservation {
  label: string;
  passed: boolean;
  detail: string;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "HTTP-cache drill failed.";
  process.stderr.write(
    `${JSON.stringify({ error: { code: "HTTP_CACHE_DRILL_FAILED", message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "origin-plan": { type: "string" },
      "out-dir": { type: "string" },
      evidence: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const originPlanPath = required(
    values["origin-plan"],
    "--origin-plan is required.",
  );
  const originPlanBytes = await readFile(join(REPO_ROOT, originPlanPath));
  const originPlan = parseOriginBenchmarkPlan(
    parseJson(originPlanBytes, `origin plan ${originPlanPath}`),
  );
  const cachePlan = resolveCachePlan(originPlan);
  const baseUrl = originPlan.origin;
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const evidencePath = values.evidence ?? DEFAULT_EVIDENCE;

  const windowStartedAt = utcNow();
  const cacheObservations = await measureCache(baseUrl, cachePlan);
  const deadlineObservations = await measureDeadlines();
  const windowEndedAt = utcNow();

  const httpCacheStatus: PromotionEvidenceStatus = cacheObservations.every(
    (observation) => observation.passed,
  )
    ? "accepted"
    : "blocked";
  const deadlinesStatus: PromotionEvidenceStatus = deadlineObservations.every(
    (observation) => observation.passed,
  )
    ? "accepted"
    : "blocked";

  const evidence = {
    schemaVersion: "http-cache-and-deadlines-evidence-v1",
    measurementClass: originPlan.measurementClass,
    identity: originPlan.identity,
    baseUrl,
    originPlan: {
      path: originPlanPath,
      sha256: sha256(originPlanBytes),
    },
    windowStartedAt,
    windowEndedAt,
    cacheObservations,
    deadlineObservations,
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const absoluteEvidence = join(REPO_ROOT, evidencePath);
  await mkdir(dirname(absoluteEvidence), { recursive: true });
  await writeFile(absoluteEvidence, evidenceBytes);

  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "http-cache-and-deadlines",
    measurementClass: originPlan.measurementClass,
    measuredAt: windowEndedAt,
    windowStartedAt,
    windowEndedAt,
    sampleCount: cacheObservations.length + deadlineObservations.length,
    checks: [
      {
        name: "http-cache",
        status: httpCacheStatus,
        detail: cacheObservations
          .map(
            (observation) =>
              `${observation.label}: ${observation.passed ? "ok" : (observation.reason ?? "failed")}`,
          )
          .join("; "),
      },
      {
        name: "deadlines",
        status: deadlinesStatus,
        detail: deadlineObservations
          .map(
            (observation) =>
              `${observation.label}: ${observation.passed ? "ok" : observation.detail}`,
          )
          .join("; "),
      },
    ],
    additionalRetainedLogs: [
      {
        path: evidencePath,
        sha256: sha256(evidenceBytes),
      },
      {
        path: originPlanPath,
        sha256: sha256(originPlanBytes),
      },
    ],
  };

  const outPath = `${outDir}/http-cache-and-deadlines.checks.json`;
  const absoluteOut = join(REPO_ROOT, outPath);
  await mkdir(dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, `${JSON.stringify(checkSet, null, 2)}\n`);

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "http-cache-and-deadlines-measurement-report-v1",
        out: outPath,
        httpCache: httpCacheStatus,
        deadlines: deadlinesStatus,
      },
      null,
      2,
    )}\n`,
  );
}

type CachePlan = {
  currentManifest: string;
  candidateMarkets: string;
  marketAnalysis: string;
};

function resolveCachePlan(plan: OriginBenchmarkPlan): CachePlan {
  return {
    currentManifest: requiredBenchmarkPath(
      plan,
      "current-manifest",
      undefined,
    ),
    candidateMarkets: requiredBenchmarkPath(
      plan,
      "candidate-analysis-process-hit",
      "maximum-row",
    ),
    marketAnalysis: requiredBenchmarkPath(
      plan,
      "market-analysis-process-hit",
      "maximum-row",
    ),
  };
}

function requiredBenchmarkPath(
  plan: OriginBenchmarkPlan,
  operation: string,
  productRole: string | undefined,
): string {
  const matches = plan.requests.filter(
    (request) =>
      request.operation === operation && request.productRole === productRole,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Origin plan must contain exactly one ${operation}:${productRole ?? "all"} request.`,
    );
  }
  return matches[0]!.request.path;
}

async function measureCache(
  baseUrl: string,
  plan: CachePlan,
): Promise<CacheObservation[]> {
  return [
    await measureCacheRoute(
      baseUrl,
      "current-analysis",
      plan.currentManifest,
      CURRENT_MANIFEST_CACHE_CONTROL,
    ),
    await measureCacheRoute(
      baseUrl,
      "candidate-markets (immutable)",
      plan.candidateMarkets,
      IMMUTABLE_CACHE_CONTROL,
    ),
    await measureCacheRoute(
      baseUrl,
      "market-analysis (immutable)",
      plan.marketAnalysis,
      IMMUTABLE_CACHE_CONTROL,
    ),
  ];
}

async function measureCacheRoute(
  baseUrl: string,
  label: string,
  path: string,
  expectedCacheControl: string,
): Promise<CacheObservation> {
  const first = await fetch(`${baseUrl}${path}`, { redirect: "error" });
  await first.arrayBuffer();
  const etag = first.headers.get("etag");
  const cacheControl = first.headers.get("cache-control");

  let revalidationStatus = 0;
  if (etag !== null) {
    const revalidated = await fetch(`${baseUrl}${path}`, {
      redirect: "error",
      headers: { "If-None-Match": etag },
    });
    await revalidated.arrayBuffer();
    revalidationStatus = revalidated.status;
  }
  const head = await fetch(`${baseUrl}${path}`, {
    method: "HEAD",
    redirect: "error",
  });
  const headBodyBytes = (await head.arrayBuffer()).byteLength;
  const headEtag = head.headers.get("etag");
  const headCacheControl = head.headers.get("cache-control");

  let reason: string | null = null;
  if (first.status !== 200) {
    reason = `expected 200, received ${first.status}`;
  } else if (etag === null || etag.length === 0) {
    reason = "missing ETag";
  } else if (cacheControl !== expectedCacheControl) {
    reason = `Cache-Control mismatch: ${cacheControl ?? "none"}`;
  } else if (revalidationStatus !== 304) {
    reason = `expected 304 on If-None-Match, received ${revalidationStatus}`;
  } else if (head.status !== 200) {
    reason = `expected 200 for HEAD, received ${head.status}`;
  } else if (headEtag !== etag) {
    reason = `HEAD ETag mismatch: ${headEtag ?? "none"}`;
  } else if (headCacheControl !== expectedCacheControl) {
    reason = `HEAD Cache-Control mismatch: ${headCacheControl ?? "none"}`;
  } else if (headBodyBytes !== 0) {
    reason = `HEAD returned ${headBodyBytes} body bytes`;
  }

  return {
    label,
    path,
    status: first.status,
    etag,
    cacheControl,
    expectedCacheControl,
    revalidationStatus,
    headStatus: head.status,
    headEtag,
    headCacheControl,
    headBodyBytes,
    passed: reason === null,
    reason,
  };
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function measureDeadlines(): Promise<DeadlineObservation[]> {
  const observations: DeadlineObservation[] = [];

  // A. The deadline timer aborts the derived signal with a 503
  //    RequestDeadlineExceededError once the timeout elapses.
  {
    const requestController = new AbortController();
    const deadlineMs = 60;
    const startedAt = performance.now();
    const deadline = createRequestDeadline(
      requestController.signal,
      deadlineMs,
    );
    const reason = await abortReason(deadline.signal, deadlineMs + 1_000);
    const elapsedMs = performance.now() - startedAt;
    deadline.dispose();
    const branded = isRequestDeadlineExceededError(reason);
    const status = (reason as { status?: unknown } | null)?.status;
    const code = (reason as { code?: unknown } | null)?.code;
    const timely = elapsedMs >= deadlineMs && elapsedMs < deadlineMs + 1_000;
    const passed =
      branded &&
      status === 503 &&
      code === "REQUEST_DEADLINE_EXCEEDED" &&
      timely;
    observations.push({
      label: "deadline-timer-abort",
      passed,
      detail: `branded=${branded} status=${String(status)} code=${String(code)} elapsedMs=${elapsedMs.toFixed(1)}`,
    });
  }

  // B. An upstream request abort propagates its own reason (not the deadline
  //    error) and the deadline timer is disposed without firing.
  {
    const requestController = new AbortController();
    const deadline = createRequestDeadline(requestController.signal, 10_000);
    const clientReason = new Error("client-cancelled");
    requestController.abort(clientReason);
    const reason = await abortReason(deadline.signal, 1_000);
    deadline.dispose();
    const passed =
      reason === clientReason && !isRequestDeadlineExceededError(reason);
    observations.push({
      label: "request-abort-propagation",
      passed,
      detail: `propagatedClientReason=${reason === clientReason}`,
    });
  }

  // C. The synchronous deadline reports elapsed only after its timeout.
  {
    const sync = createSynchronousRequestDeadline(40);
    const immediate = sync.hasElapsed();
    await delay(80);
    const afterTimeout = sync.hasElapsed();
    const passed = !immediate && afterTimeout;
    observations.push({
      label: "synchronous-deadline",
      passed,
      detail: `immediate=${immediate} afterTimeout=${afterTimeout}`,
    });
  }

  // D. Every route deadline is a positive integer budget.
  {
    const invalid = Object.entries(ROUTE_DEADLINE_MS).filter(
      ([, value]) => !Number.isSafeInteger(value) || value <= 0,
    );
    observations.push({
      label: "route-deadline-table",
      passed: invalid.length === 0,
      detail:
        invalid.length === 0
          ? `${Object.keys(ROUTE_DEADLINE_MS).length} route deadlines are positive integers`
          : `invalid: ${invalid.map(([key]) => key).join(",")}`,
    });
  }

  return observations;
}

function abortReason(signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  if (signal.aborted) {
    return Promise.resolve(signal.reason);
  }
  return new Promise((resolve) => {
    const guard = setTimeout(() => {
      resolve(new Error("abort-not-observed"));
    }, timeoutMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(guard);
        resolve(signal.reason);
      },
      { once: true },
    );
  });
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
