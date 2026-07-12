import { parseArgs } from "node:util";

import {
  buildProductTranslations,
  ProductTranslationBuildError,
} from "./product-translation-catalog";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "staging-manifest": { type: "string" },
      terminology: { type: "string" },
      corrections: { type: "string", multiple: true },
      "traditional-to-simplified": { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const outcome = await buildProductTranslations({
    stagingManifestPath: required(
      values["staging-manifest"],
      "staging-manifest",
    ),
    terminologyPath: required(values.terminology, "terminology"),
    correctionsPaths: requiredMany(values.corrections, "corrections"),
    traditionalToSimplifiedPath: required(
      values["traditional-to-simplified"],
      "traditional-to-simplified",
    ),
    outputPath: required(values.output, "output"),
    reportPath: required(values.report, "report"),
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new ProductTranslationBuildError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }

  return value;
}

function requiredMany(
  value: string[] | undefined,
  name: string,
): string[] {
  if (value === undefined || value.length === 0) {
    throw new ProductTranslationBuildError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

void main().catch((error: unknown) => {
  if (error instanceof ProductTranslationBuildError) {
    process.stderr.write(
      `${JSON.stringify({
        error: { code: error.code, message: error.message },
      })}\n`,
    );
  } else {
    console.error("Product translation build failed unexpectedly", error);
  }
  process.exitCode = 1;
});
