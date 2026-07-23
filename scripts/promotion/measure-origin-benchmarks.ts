import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  evaluateOriginBenchmarks,
  type OriginBenchmarkCapabilities,
  type OriginBenchmarkInput,
} from "../../src/promotion/performance-gates";
import type { PromotionEvidenceStatus } from "../../src/promotion/promotion-report";

const REPO_ROOT = process.cwd();
const DEFAULT_REPORT = "reports/promotion/candidate/origin-report.json";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_TRADE_EXPLORER =
  "reports/promotion/candidate/evidence/trade-explorer-measurement.json";

const TRADE_EXPLORER_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "review-required",
  "blocked",
]);

class OriginMeasurementError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OriginMeasurementError";
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof OriginMeasurementError
      ? error.code
      : "ORIGIN_MEASUREMENT_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Origin-benchmark measurement failed with an unknown error.";
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      "out-dir": { type: "string" },
      "trade-explorer": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const reportPath = values.report ?? DEFAULT_REPORT;
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const tradeExplorerPath =
    values["trade-explorer"] ?? DEFAULT_TRADE_EXPLORER;

  const reportBytes = await readFile(join(REPO_ROOT, reportPath));
  const report = object(
    parseJson(reportBytes, `origin report ${reportPath}`),
    "origin report",
  );
  if (report.measurementClass !== "candidate") {
    throw new OriginMeasurementError(
      "ORIGIN_MEASUREMENT_CLASS",
      "Origin report must be a candidate-class measurement.",
    );
  }
  if (!Array.isArray(report.originBenchmarks)) {
    throw new OriginMeasurementError(
      "ORIGIN_REPORT_INVALID",
      "Origin report is missing its originBenchmarks array.",
    );
  }
  const cacheViolations = Array.isArray(report.cacheViolations)
    ? report.cacheViolations.length
    : Number.NaN;
  const firstFailure = report.firstFailure ?? null;
  const meetsSampleSize = report.meetsAcceptanceEvidenceSampleSize === true;
  const capabilities = readCapabilities(report.capabilities);
  const attestationCapabilities = readCapabilities(
    object(report.attestation, "origin attestation").capabilities,
  );
  if (
    capabilities.recentTradeMomentum !==
      attestationCapabilities.recentTradeMomentum ||
    capabilities.opportunityDiscovery !==
      attestationCapabilities.opportunityDiscovery
  ) {
    throw new OriginMeasurementError(
      "ORIGIN_REPORT_INVALID",
      "Origin report capabilities do not match its runtime attestation.",
    );
  }

  // representative-fixtures: the benchmark set must genuinely cover every
  // required singleton and product-role fixture. evaluateOriginBenchmarks
  // throws if the set is incomplete or unsupported, so a successful evaluation
  // with adequate sample sizes is the honest verdict.
  let evaluation: ReturnType<typeof evaluateOriginBenchmarks> | null = null;
  let coverageError: string | null = null;
  try {
    evaluation = evaluateOriginBenchmarks(
      report.originBenchmarks as OriginBenchmarkInput[],
      capabilities,
    );
  } catch (error) {
    coverageError = error instanceof Error ? error.message : "unknown error";
  }

  const representativeStatus: PromotionEvidenceStatus =
    evaluation !== null && meetsSampleSize ? "accepted" : "blocked";

  // origin-thresholds: every benchmark must meet its latency, payload, and
  // error thresholds, and the measurement must be free of HTTP failures and
  // cache-state violations.
  const originThresholdsStatus: PromotionEvidenceStatus =
    evaluation !== null &&
    evaluation.status === "accepted" &&
    firstFailure === null &&
    cacheViolations === 0
      ? "accepted"
      : evaluation !== null && evaluation.status === "review-required"
        ? "review-required"
        : "blocked";

  // trade-explorer-budgets: consume the genuine in-process trade-explorer
  // resource + cancellation measurement, when present, and adopt its verdict.
  // Absent that evidence, the check honestly remains review-required.
  const tradeExplorer = await readTradeExplorerMeasurement(tradeExplorerPath);

  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "origin-benchmarks",
    measurementClass: "candidate",
    measuredAt: utcOrNow(report.generatedAt),
    windowStartedAt: utcOrNow(report.generatedAt),
    windowEndedAt: utcOrNow(report.generatedAt),
    sampleCount:
      evaluation?.benchmarkCount ?? report.originBenchmarks.length,
    checks: [
      {
        name: "representative-fixtures",
        status: representativeStatus,
        detail:
          coverageError === null
            ? `${evaluation?.benchmarkCount ?? 0} benchmarks cover all required singleton and product-role fixtures; sample sizes ${meetsSampleSize ? "meet" : "do not meet"} the acceptance minimum.`
            : `Benchmark coverage incomplete: ${coverageError}`,
      },
      {
        name: "origin-thresholds",
        status: originThresholdsStatus,
        detail:
          evaluation === null
            ? "Origin benchmarks could not be evaluated."
            : `Combined benchmark status ${evaluation.status}; firstFailure=${firstFailure === null ? "none" : "present"}; cacheViolations=${cacheViolations}.`,
      },
      {
        // The trade-explorer resource budget (peak memory/spill, cancellation
        // release, cache/queue un-poisoning) is measured in-process by the
        // trade-explorer harness; its genuine verdict is adopted here.
        name: "trade-explorer-budgets",
        status: tradeExplorer.status,
        detail: tradeExplorer.detail,
      },
    ],
    additionalRetainedLogs: [
      {
        path: reportPath,
        sha256: sha256(reportBytes),
      },
      ...(tradeExplorer.retainedLog === null
        ? []
        : [tradeExplorer.retainedLog]),
    ],
  };

  const outPath = `${outDir}/origin-benchmarks.checks.json`;
  await writeFile(
    join(REPO_ROOT, outPath),
    `${JSON.stringify(checkSet, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "origin-benchmarks-measurement-report-v1",
        out: outPath,
        representativeFixtures: representativeStatus,
        originThresholds: originThresholdsStatus,
        tradeExplorerBudgets: tradeExplorer.status,
        benchmarkCount: evaluation?.benchmarkCount ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

function readCapabilities(value: unknown): OriginBenchmarkCapabilities {
  const capabilities = object(value, "origin capabilities");
  if (
    typeof capabilities.recentTradeMomentum !== "boolean" ||
    typeof capabilities.opportunityDiscovery !== "boolean"
  ) {
    throw new OriginMeasurementError(
      "ORIGIN_REPORT_INVALID",
      "Origin capabilities must explicitly declare Recent Trade Momentum and Opportunity Discovery availability.",
    );
  }
  return {
    recentTradeMomentum: capabilities.recentTradeMomentum,
    opportunityDiscovery: capabilities.opportunityDiscovery,
  };
}

interface TradeExplorerVerdict {
  status: PromotionEvidenceStatus;
  detail: string;
  retainedLog: { path: string; sha256: string } | null;
}

async function readTradeExplorerMeasurement(
  path: string,
): Promise<TradeExplorerVerdict> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(REPO_ROOT, path));
  } catch {
    return {
      status: "review-required",
      detail:
        "Pending the in-process trade-explorer resource harness (run promotion:measure-trade-explorer).",
      retainedLog: null,
    };
  }
  const measurement = object(
    parseJson(bytes, `trade-explorer measurement ${path}`),
    "trade-explorer measurement",
  );
  if (measurement.schemaVersion !== "trade-explorer-measurement-v1") {
    throw new OriginMeasurementError(
      "TRADE_EXPLORER_MEASUREMENT_INVALID",
      "Trade-explorer measurement has an unexpected schema version.",
    );
  }
  const status = measurement.status;
  if (typeof status !== "string" || !TRADE_EXPLORER_STATUSES.has(status)) {
    throw new OriginMeasurementError(
      "TRADE_EXPLORER_MEASUREMENT_INVALID",
      "Trade-explorer measurement is missing a valid status.",
    );
  }
  const reasons = Array.isArray(measurement.reasons)
    ? (measurement.reasons as unknown[]).filter(
        (reason): reason is string => typeof reason === "string",
      )
    : [];
  const detail =
    status === "accepted"
      ? "In-process trade-explorer harness accepted: resource budgets, cancellation release, and cache/queue integrity all within limits."
      : `In-process trade-explorer harness ${status}: ${reasons.length > 0 ? reasons.join("; ") : "see retained measurement."}`;
  return {
    status: status as PromotionEvidenceStatus,
    detail,
    retainedLog: { path, sha256: sha256(bytes) },
  };
}

function utcOrNow(value: unknown): string {  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  ) {
    return value;
  }
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OriginMeasurementError(
      "ORIGIN_REPORT_INVALID",
      `${label} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new OriginMeasurementError(
      "ORIGIN_REPORT_INVALID",
      `${label} is not valid JSON.`,
    );
  }
}
