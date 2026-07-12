import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createPlaywrightBrowserLabDriver,
  runBrowserLab,
  validateBrowserLabPlan,
} from "../../src/promotion/browser-lab-runner";

class BrowserLabCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserLabCliError";
  }
}

void main().catch((error: unknown) => {
  const code = errorCode(error);
  const message =
    error instanceof Error
      ? error.message
      : "Browser-lab run failed with an unknown error.";
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
  const plan = validateBrowserLabPlan(parseJson(planBytes, "browser-lab plan"));

  const driver = createPlaywrightBrowserLabDriver();
  try {
    // This report is raw measurement evidence only: it never claims
    // candidate acceptance. Acceptance is decided separately by
    // evaluatePerformanceGates against the thresholds it emits.
    const report = await runBrowserLab(driver, plan);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await driver.dispose();
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new BrowserLabCliError(
      "BROWSER_LAB_PLAN_UNREADABLE",
      `${label} is not valid JSON.`,
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new BrowserLabCliError(
      "BROWSER_LAB_CLI_ARGUMENT_INVALID",
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
  return "BROWSER_LAB_RUN_FAILED";
}
