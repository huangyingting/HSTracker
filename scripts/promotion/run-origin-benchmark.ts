import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createAnonymousSourcePacedHttpExecutor,
  createFetchHttpExecutor,
  parseOriginBenchmarkPlan,
  runOriginBenchmark,
} from "../../src/promotion/http-performance-runner";

class OriginBenchmarkCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OriginBenchmarkCliError";
  }
}

void main().catch((error: unknown) => {
  const code = errorCode(error);
  const message =
    error instanceof Error
      ? error.message
      : "Origin-benchmark run failed with an unknown error.";
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const planPath = required(values.plan, "plan");
  const planBytes = await readFile(planPath);
  const plan = parseOriginBenchmarkPlan(
    parseJson(planBytes, "origin-benchmark plan"),
  );

  // This report is raw measurement evidence against the supplied origin
  // only: it never claims candidate acceptance, never mutates release
  // pointers, and needs no provider credentials beyond reaching the origin.
  // Acceptance is decided separately by evaluatePerformanceGates against
  // the thresholds this report feeds.
  const report = await runOriginBenchmark(
    plan,
    createAnonymousSourcePacedHttpExecutor(createFetchHttpExecutor()),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new OriginBenchmarkCliError(
      "ORIGIN_BENCHMARK_PLAN_UNREADABLE",
      `${label} is not valid JSON.`,
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new OriginBenchmarkCliError(
      "ORIGIN_BENCHMARK_CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "ORIGIN_BENCHMARK_RUN_FAILED";
}
