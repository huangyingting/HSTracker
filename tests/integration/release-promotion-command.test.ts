import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";

const execFileAsync = promisify(execFile);
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) =>
      rm(workspace, { recursive: true, force: true }),
    ),
  );
});

describe("release promotion command", () => {
  it("requires accepted promotion evidence before object-store access", async () => {
    const repositoryRoot = process.cwd();
    const command = execFileAsync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [
        join(repositoryRoot, "scripts/release/promote-release.ts"),
        "--analysis-directory",
        "/not-read-before-gate",
        "--product-catalog-directory",
        "/not-read-before-gate",
        "--activated-at",
        "2026-07-12T02:00:00Z",
      ],
      {
        cwd: repositoryRoot,
        env: process.env,
      },
    );

    await expect(command).rejects.toMatchObject({
      stderr: expect.stringContaining("--promotion-input is required"),
    });
  });

  it("rejects blocked promotion evidence before candidate or object-store access", async () => {
    const repositoryRoot = process.cwd();
    const workspace = await mkdtemp(
      join(tmpdir(), "hs-tracker-promotion-command-"),
    );
    workspaces.push(workspace);
    const promotionInput = await writeBlockedPromotionInput(workspace);
    const command = execFileAsync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [
        join(repositoryRoot, "scripts/release/promote-release.ts"),
        "--analysis-directory",
        "/not-read-before-gate",
        "--product-catalog-directory",
        "/not-read-before-gate",
        "--promotion-input",
        promotionInput,
        "--activated-at",
        "2026-07-12T02:00:00Z",
      ],
      {
        cwd: workspace,
        env: process.env,
      },
    );

    await expect(command).rejects.toMatchObject({
      stderr: expect.stringContaining("PROMOTION_NOT_ACCEPTED"),
    });
  });
});

async function writeBlockedPromotionInput(
  workspace: string,
): Promise<string> {
  const identity = {
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    buildId: "blocked-build",
    baciRelease: "V202601",
    analysisBuildId: "blocked-analysis",
    productSearchBuildId: "blocked-search",
    artifactSha256: "b".repeat(64),
    deploymentPairingId: "blocked-pairing",
    sourceStatusSnapshotId: "blocked-source-status",
    machineId: "blocked-machine",
    machineClass: "shared-cpu-2x",
    region: "sin",
  };
  const evidence = [];
  for (const [gate, requiredChecks] of Object.entries(
    PROMOTION_GATE_REQUIRED_CHECKS,
  )) {
    const status = gate === "target-load" ? "blocked" : "accepted";
    const relativePath = `reports/promotion/${gate}.json`;
    const bytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: `${gate}-report-v1`,
        gate,
        measurementClass: "candidate",
        status,
        identity,
        checks: requiredChecks.map((name, index) => ({
          name,
          status: index === 0 ? status : "accepted",
        })),
      })}\n`,
    );
    const reportSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    await mkdir(join(workspace, "reports/promotion"), {
      recursive: true,
    });
    await writeFile(join(workspace, relativePath), bytes);
    evidence.push({
      gate,
      schemaVersion: `${gate}-report-v1`,
      status,
      identity,
      reportSha256,
      measuredAt: "2026-07-12T15:30:00Z",
      windowStartedAt: "2026-07-12T15:00:00Z",
      windowEndedAt: "2026-07-12T15:30:00Z",
      sampleCount: 100,
      retainedLogs: [relativePath],
      attempts: [
        {
          attemptedAt: "2026-07-12T15:30:00Z",
          status,
          logSha256: reportSha256,
        },
      ],
    });
  }
  const inputPath = join(workspace, "promotion-input.json");
  await writeFile(
    inputPath,
    `${JSON.stringify({
      schemaVersion: "production-promotion-input-v1",
      evaluatedAt: "2026-07-12T16:00:00Z",
      identity,
      toolVersions: {
        node: "24.17.0",
        npm: "11.13.0",
        next: "16.2.10",
        duckdb: "1.5.4-r.1",
        playwright: "1.61.1",
      },
      evidence,
    })}\n`,
  );
  return inputPath;
}
