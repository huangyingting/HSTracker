import { parseArgs } from "node:util";

import { loadPromotionEvaluation } from "../../src/promotion/promotion-acceptance";

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
  const { report, retainedEvidence } = await loadPromotionEvaluation(
    values.input,
    process.cwd(),
  );
  process.stdout.write(
    `${JSON.stringify({ ...report, retainedEvidence }, null, 2)}\n`,
  );
  if (report.status !== "accepted") {
    process.exitCode = 1;
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
