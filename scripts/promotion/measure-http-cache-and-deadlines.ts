import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

const REPO_ROOT = process.cwd();
const DEFAULT_BASE_URL = "http://127.0.0.1:3200";
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
      "base-url": { type: "string" },
      "out-dir": { type: "string" },
      evidence: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const baseUrl = (values["base-url"] ?? DEFAULT_BASE_URL).replace(/\/$/u, "");
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const evidencePath = values.evidence ?? DEFAULT_EVIDENCE;

  const windowStartedAt = utcNow();
  const cacheObservations = await measureCache(baseUrl);
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
    baseUrl,
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
    measurementClass: "candidate",
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

async function measureCache(baseUrl: string): Promise<CacheObservation[]> {
  return [
    await measureCacheRoute(
      baseUrl,
      "current-analysis",
      "/api/v1/analyses/current",
      CURRENT_MANIFEST_CACHE_CONTROL,
    ),
    await measureCacheRoute(
      baseUrl,
      "candidate-markets (immutable)",
      "/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121",
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

  let reason: string | null = null;
  if (first.status !== 200) {
    reason = `expected 200, received ${first.status}`;
  } else if (etag === null || etag.length === 0) {
    reason = "missing ETag";
  } else if (cacheControl !== expectedCacheControl) {
    reason = `Cache-Control mismatch: ${cacheControl ?? "none"}`;
  } else if (revalidationStatus !== 304) {
    reason = `expected 304 on If-None-Match, received ${revalidationStatus}`;
  }

  return {
    label,
    path,
    status: first.status,
    etag,
    cacheControl,
    expectedCacheControl,
    revalidationStatus,
    passed: reason === null,
    reason,
  };
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
