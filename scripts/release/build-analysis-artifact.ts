import { parseArgs } from "node:util";

import {
  AnalysisArtifactBuildError,
  buildAnalysisArtifact,
} from "./analysis-artifact";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "staging-manifest": { type: "string" },
      workspace: { type: "string" },
      report: { type: "string" },
      "pipeline-git-sha": { type: "string" },
      "built-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const outcome = await buildAnalysisArtifact({
    stagingManifestPath: requiredOption(
      values["staging-manifest"],
      "staging-manifest",
    ),
    workspacePath: requiredOption(values.workspace, "workspace"),
    reportPath: requiredOption(values.report, "report"),
    pipelineGitSha: requiredOption(
      values["pipeline-git-sha"],
      "pipeline-git-sha",
    ),
    builtAt: requiredOption(values["built-at"], "built-at"),
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new AnalysisArtifactBuildError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

void main().catch((error: unknown) => {
  if (error instanceof AnalysisArtifactBuildError) {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      })}\n`,
    );
  } else {
    console.error("Analysis artifact build failed unexpectedly", error);
  }
  process.exitCode = 1;
});
