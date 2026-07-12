import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createFetchHttpExecutor,
  createPrometheusMixedLoadObservationAdapter,
  parseMixedLoadPlan,
  runMixedLoad,
} from "../../src/promotion/http-performance-runner";

class MixedLoadCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MixedLoadCliError";
  }
}

void main().catch((error: unknown) => {
  const code = errorCode(error);
  const message =
    error instanceof Error
      ? error.message
      : "Mixed-load run failed with an unknown error.";
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
  const plan = parseMixedLoadPlan(parseJson(planBytes, "mixed-load plan"));

  const report = await runMixedLoad(plan, createFetchHttpExecutor(), {
    observationAdapter: createPrometheusMixedLoadObservationAdapter(
      plan.origin,
      plan.identity,
    ),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new MixedLoadCliError(
      "MIXED_LOAD_PLAN_UNREADABLE",
      `${label} is not valid JSON.`,
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new MixedLoadCliError(
      "MIXED_LOAD_CLI_ARGUMENT_INVALID",
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
  return "MIXED_LOAD_RUN_FAILED";
}
