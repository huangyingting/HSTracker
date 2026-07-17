import { parseArgs } from "node:util";

import {
  recentTradeMomentumFixtureVintageA,
  recentTradeMomentumFixtureVintageB,
} from "../../fixtures/recent-trade-momentum/v1/synthetic-oracle";
import { buildRecentTradeMomentumPackage } from "./recent-trade-momentum-package";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string" },
      workspace: { type: "string" },
      report: { type: "string" },
      "built-at": { type: "string" },
      "build-git-sha": { type: "string" },
      "shadow-vintages": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const fixtureName = values.fixture ?? "synthetic-a";
  const sourceVintage =
    fixtureName === "synthetic-a"
      ? recentTradeMomentumFixtureVintageA
      : fixtureName === "synthetic-b"
        ? recentTradeMomentumFixtureVintageB
        : null;
  if (sourceVintage === null) {
    throw new Error(`Unsupported recent-trade-momentum fixture ${fixtureName}.`);
  }
  const outcome = await buildRecentTradeMomentumPackage({
    sourceVintage,
    workspacePath: requiredOption(values.workspace, "workspace"),
    reportPath: requiredOption(values.report, "report"),
    builtAt: requiredOption(values["built-at"], "built-at"),
    buildGitSha: requiredOption(values["build-git-sha"], "build-git-sha"),
    shadowVintagesPassed: Number(values["shadow-vintages"] ?? 3),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: outcome.status,
      packageIdentity: outcome.datasetPackage.identity,
      artifactPath: outcome.artifactPath,
      reportPath: outcome.reportPath,
    })}\n`,
  );
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error("Recent Trade Momentum package build failed", error);
  process.exitCode = 1;
});
