import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { verifyRetainedPromotionEvidence } from "../../src/promotion/promotion-evidence";
import {
  evaluatePromotionReport,
  parsePromotionReportInput,
} from "../../src/promotion/promotion-report";

const MAX_PROMOTION_INPUT_BYTES = 8 * 1024 ** 2;

void main().catch((error: unknown) => {
  const code = stringProperty(error, "code") ?? "PROMOTION_CHECK_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Promotion check failed with an unknown error.";
  process.stderr.write(
    `${JSON.stringify({ error: { code, message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.input === undefined || values.input.length === 0) {
    throw new PromotionCheckError(
      "CLI_ARGUMENT_INVALID",
      "--input is required.",
    );
  }
  const inputBytes = await readFile(values.input);
  if (inputBytes.byteLength > MAX_PROMOTION_INPUT_BYTES) {
    throw new PromotionCheckError(
      "PROMOTION_INPUT_OVERSIZED",
      "Promotion input exceeds 8 MiB.",
    );
  }
  const input = parsePromotionReportInput(
    parseJson(inputBytes, "promotion input"),
  );
  const report = evaluatePromotionReport(input);
  const retainedEvidence = await verifyRetainedPromotionEvidence(
    input.evidence,
    process.cwd(),
  );
  process.stdout.write(
    `${JSON.stringify({ ...report, retainedEvidence }, null, 2)}\n`,
  );
  if (report.status !== "accepted") {
    process.exitCode = 1;
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new PromotionCheckError(
      "PROMOTION_INPUT_INVALID",
      `${label} is not valid JSON.`,
    );
  }
}

function stringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}

class PromotionCheckError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PromotionCheckError";
  }
}
