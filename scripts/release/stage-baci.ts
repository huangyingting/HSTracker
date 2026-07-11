import { parseArgs } from "node:util";

import {
  BaciStagingError,
  stageBaciRelease,
} from "./baci-source-staging";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      descriptor: { type: "string" },
      approval: { type: "string" },
      archive: { type: "string" },
      workspace: { type: "string" },
      report: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const descriptorPath = requiredOption(values.descriptor, "descriptor");
  const approvalPath = requiredOption(values.approval, "approval");
  const workspacePath = requiredOption(values.workspace, "workspace");
  const reportPath = requiredOption(values.report, "report");
  const outcome = await stageBaciRelease({
    descriptorPath,
    approvalPath,
    archivePath: values.archive,
    workspacePath,
    reportPath,
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new BaciStagingError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

void main().catch((error: unknown) => {
  if (error instanceof BaciStagingError) {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      })}\n`,
    );
  } else {
    console.error("BACI source staging failed unexpectedly", error);
  }
  process.exitCode = 1;
});
