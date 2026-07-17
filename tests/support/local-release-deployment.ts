import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import type { PublishedDeployment } from "../../src/release/release-publication";
import { writeAcceptedReleaseCandidate } from "./release-candidate";

const execFileAsync = promisify(execFile);

export type PromotedReleaseCandidate = {
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
};

/**
 * Writes a structurally complete, fully-accepted promotion input for a release
 * candidate. Used only by mechanics tests to exercise the local promotion,
 * rollback, hydration, and serving path; it is not a substitute for the real
 * promotion gate evidence that Slice 16 (#30) produces.
 */
export async function writeAcceptedPromotionInput(
  root: string,
  label: string,
  candidate: PromotedReleaseCandidate,
): Promise<string> {
  const [analysisManifest, catalogManifest] = await Promise.all([
    readFile(
      join(candidate.analysisDirectoryPath, "artifact-manifest.json"),
      "utf8",
    ).then(
      (value) =>
        JSON.parse(value) as {
          baciRelease: string;
          artifact: { sha256: string };
        },
    ),
    readFile(
      join(candidate.productCatalogDirectoryPath, "catalog-manifest.json"),
      "utf8",
    ).then((value) => JSON.parse(value) as { productSearchBuildId: string }),
  ]);
  const identity = {
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    buildId: `local-release-${label}`,
    baciRelease: analysisManifest.baciRelease,
    analysisBuildId: `analysis-${label}`,
    productSearchBuildId: catalogManifest.productSearchBuildId,
    artifactSha256: analysisManifest.artifact.sha256,
    deploymentPairingId: `deployment-${label}`,
    sourceStatusSnapshotId: `source-status-${label}`,
    machineId: `machine-${label}`,
    machineClass: "local",
    region: "loc",
  };
  const evidence = [];
  for (const [gate, requiredChecks] of Object.entries(
    PROMOTION_GATE_REQUIRED_CHECKS,
  )) {
    const relativePath = `reports/promotion/${label}/${gate}.json`;
    const reportBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: `${gate}-report-v1`,
        gate,
        measurementClass: "candidate",
        status: "accepted",
        identity,
        checks: requiredChecks.map((name) => ({ name, status: "accepted" })),
      })}\n`,
    );
    const reportSha256 = createHash("sha256").update(reportBytes).digest("hex");
    await mkdir(join(root, "reports/promotion", label), { recursive: true });
    await writeFile(join(root, relativePath), reportBytes);
    evidence.push({
      gate,
      schemaVersion: `${gate}-report-v1`,
      status: "accepted",
      identity,
      reportSha256,
      measuredAt: "2026-07-12T01:30:00Z",
      windowStartedAt: "2026-07-12T01:00:00Z",
      windowEndedAt: "2026-07-12T01:30:00Z",
      sampleCount: 100,
      retainedLogs: [relativePath],
      attempts: [
        {
          attemptedAt: "2026-07-12T01:30:00Z",
          status: "accepted",
          logSha256: reportSha256,
        },
      ],
    });
  }
  const inputPath = join(root, `promotion-${label}.json`);
  await writeFile(
    inputPath,
    `${JSON.stringify({
      schemaVersion: "production-promotion-input-v1",
      evaluatedAt: "2026-07-12T01:45:00Z",
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

/**
 * Promotes a freshly-written accepted release candidate into the filesystem
 * release object store rooted at `objectStoreDirectory`, returning the
 * candidate paths and the published deployment.
 */
export async function promoteAcceptedReleaseCandidateToLocalStore(options: {
  root: string;
  label: string;
  objectStoreDirectory: string;
  activatedAt: string;
  candidateOptions?: Parameters<typeof writeAcceptedReleaseCandidate>[1];
}): Promise<{
  candidate: PromotedReleaseCandidate;
  deployment: PublishedDeployment;
}> {
  const candidate = await writeAcceptedReleaseCandidate(
    join(options.root, options.label),
    options.candidateOptions,
  );
  const promotionInput = await writeAcceptedPromotionInput(
    options.root,
    options.label,
    candidate,
  );
  const environment = {
    ...process.env,
    HS_TRACKER_RELEASE_OBJECT_STORE: "filesystem",
    HS_TRACKER_RELEASE_FILESYSTEM_PATH: options.objectStoreDirectory,
  };
  const repositoryRoot = process.cwd();
  const result = await execFileAsync(
    join(repositoryRoot, "node_modules", ".bin", "tsx"),
    [
      join(repositoryRoot, "scripts/release/promote-release.ts"),
      "--analysis-directory",
      candidate.analysisDirectoryPath,
      "--product-catalog-directory",
      candidate.productCatalogDirectoryPath,
      "--activated-at",
      options.activatedAt,
      "--promotion-input",
      promotionInput,
    ],
    { cwd: options.root, env: environment, maxBuffer: 10 * 1024 * 1024 },
  );
  return {
    candidate,
    deployment: JSON.parse(result.stdout) as PublishedDeployment,
  };
}
