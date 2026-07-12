import { parseArgs } from "node:util";

import {
  buildProductCatalogArtifact,
  ProductCatalogBuildError,
} from "./product-catalog-artifact";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "staging-manifest": { type: "string" },
      translations: { type: "string" },
      aliases: { type: "string" },
      "traditional-to-simplified": { type: "string" },
      "review-manifest": { type: "string" },
      workspace: { type: "string" },
      report: { type: "string" },
      "pipeline-git-sha": { type: "string" },
      "built-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const outcome = await buildProductCatalogArtifact({
    stagingManifestPath: required(values["staging-manifest"], "staging-manifest"),
    translationsPath: required(values.translations, "translations"),
    aliasesPath: required(values.aliases, "aliases"),
    traditionalToSimplifiedPath: required(
      values["traditional-to-simplified"],
      "traditional-to-simplified",
    ),
    reviewManifestPath: required(
      values["review-manifest"],
      "review-manifest",
    ),
    workspacePath: required(values.workspace, "workspace"),
    reportPath: required(values.report, "report"),
    pipelineGitSha: required(values["pipeline-git-sha"], "pipeline-git-sha"),
    builtAt: required(values["built-at"], "built-at"),
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new ProductCatalogBuildError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

void main().catch((error: unknown) => {
  if (error instanceof ProductCatalogBuildError) {
    process.stderr.write(
      `${JSON.stringify({
        error: { code: error.code, message: error.message },
      })}\n`,
    );
  } else {
    console.error("Product catalog build failed unexpectedly", error);
  }
  process.exitCode = 1;
});
