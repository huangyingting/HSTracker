import { parseArgs } from "node:util";

import {
  OpportunityIndexBuildError,
  buildOpportunityIndex,
} from "./opportunity-index";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "analysis-artifact": { type: "string" },
      workspace: { type: "string" },
      report: { type: "string" },
      "build-git-sha": { type: "string" },
      "built-at": { type: "string" },
      "only-exporters": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const onlyExporters = values["only-exporters"];
  const outcome = await buildOpportunityIndex({
    analysisArtifactPath: requiredOption(
      values["analysis-artifact"],
      "analysis-artifact",
    ),
    workspacePath: requiredOption(values.workspace, "workspace"),
    reportPath: requiredOption(values.report, "report"),
    buildGitSha: requiredOption(values["build-git-sha"], "build-git-sha"),
    builtAt: requiredOption(values["built-at"], "built-at"),
    onlyExporterCodes:
      onlyExporters === undefined
        ? undefined
        : onlyExporters
            .split(",")
            .map((code) => Number(code.trim()))
            .filter((code) => Number.isInteger(code)),
    onProgress: (progress) => {
      process.stderr.write(
        `${JSON.stringify({
          completed: progress.completedExporters,
          total: progress.totalExporters,
          exporter: progress.exporterCode,
          cohortRows: progress.cohortRows,
          cumulativeRows: progress.cumulativeRows,
          elapsedMs: progress.elapsedMs,
          rssMb: Math.round(progress.rssBytes / (1024 * 1024)),
        })}\n`,
      );
    },
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new OpportunityIndexBuildError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

void main().catch((error: unknown) => {
  if (error instanceof OpportunityIndexBuildError) {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      })}\n`,
    );
  } else {
    console.error("Opportunity Index build failed unexpectedly", error);
  }
  process.exitCode = 1;
});
