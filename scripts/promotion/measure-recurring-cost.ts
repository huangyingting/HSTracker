import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { parseRecurringCostForecast } from "../../src/deployment/cost-forecast";
import type { PromotionEvidenceStatus } from "../../src/promotion/promotion-report";

const REPO_ROOT = process.cwd();
const DEFAULT_FORECAST = "deployment/cost-forecast.local.json";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";

class RecurringCostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RecurringCostError";
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof RecurringCostError ? error.code : "RECURRING_COST_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Recurring-cost measurement failed with an unknown error.";
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      forecast: { type: "string" },
      "out-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const forecastPath = values.forecast ?? DEFAULT_FORECAST;
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;

  const forecastBytes = await readFile(join(REPO_ROOT, forecastPath));
  const forecast = parseRecurringCostForecast(
    parseJson(forecastBytes, `cost forecast ${forecastPath}`),
  );

  // Mirror the deployment cost gate: at or under the target is accepted; above
  // the review threshold with no architecture decision would block. The local
  // single-host forecast (ADR-0004) is genuinely $0, so this is accepted.
  const status: PromotionEvidenceStatus =
    forecast.forecastMonthlyUsd <= forecast.targetMonthlyUsd
      ? "accepted"
      : forecast.forecastMonthlyUsd <= forecast.reviewThresholdMonthlyUsd
        ? "review-required"
        : "blocked";

  // Retain the exact forecast bytes that were measured as gate evidence.
  const retainedForecastPath = `${outDir}/recurring-cost.cost-forecast.json`;
  const retainedForecastAbsolute = join(REPO_ROOT, retainedForecastPath);
  await mkdir(dirname(retainedForecastAbsolute), { recursive: true });
  await writeFile(retainedForecastAbsolute, forecastBytes);

  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "recurring-cost",
    measurementClass: "candidate",
    measuredAt: nowUtc(),
    windowStartedAt: forecast.checkedAt,
    windowEndedAt: forecast.checkedAt,
    sampleCount: forecast.lineItems.length,
    checks: [
      {
        name: "monthly-cost",
        status,
        detail: `Forecast ${forecast.forecastMonthlyUsd} ${forecast.currency}/month across ${forecast.lineItems.length} line items; target ${forecast.targetMonthlyUsd}, review threshold ${forecast.reviewThresholdMonthlyUsd}.`,
      },
    ],
    additionalRetainedLogs: [
      {
        path: retainedForecastPath,
        sha256: sha256(forecastBytes),
      },
    ],
  };

  const outPath = `${outDir}/recurring-cost.checks.json`;
  await writeFile(
    join(REPO_ROOT, outPath),
    `${JSON.stringify(checkSet, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "recurring-cost-measurement-report-v1",
        out: outPath,
        status,
        forecastMonthlyUsd: forecast.forecastMonthlyUsd,
        targetMonthlyUsd: forecast.targetMonthlyUsd,
      },
      null,
      2,
    )}\n`,
  );
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new RecurringCostError(
      "RECURRING_COST_INPUT_INVALID",
      `${label} is not valid JSON.`,
    );
  }
}
