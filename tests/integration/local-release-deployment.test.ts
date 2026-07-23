import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PublishedDeployment } from "../../src/release/release-publication";
import {
  promoteAcceptedReleaseCandidateToLocalStore,
  rollbackLocalReleaseStore,
} from "../support/local-release-deployment";

const execFileAsync = promisify(execFile);
const BASELINE_IMAGE = `hs-tracker-local-release-baseline:${randomUUID()}`;
const SUCCESSOR_IMAGE = `hs-tracker-local-release-successor:${randomUUID()}`;
const VOLUME = `hs-tracker-local-release-volume-${randomUUID()}`;
const BASELINE_BUILD_ID = "local-release-baseline-v1";
const SUCCESSOR_BUILD_ID = "local-release-successor-v1";

describe("local single-host release deployment", () => {
  let containerId: string | undefined;
  let origin: string;
  let objectStoreDirectory: string;
  let candidateRoot: string;
  let baselineDeployment: PublishedDeployment;

  beforeAll(async () => {
    objectStoreDirectory = await mkdtemp(
      join(tmpdir(), "hs-tracker-local-objectstore-"),
    );
    candidateRoot = await mkdtemp(join(tmpdir(), "hs-tracker-local-candidate-"));

    ({ deployment: baselineDeployment } =
      await promoteAcceptedReleaseCandidateToLocalStore({
      root: candidateRoot,
      label: "baseline",
      objectStoreDirectory,
      activatedAt: "2026-07-12T02:00:00Z",
      candidateOptions: { baciRelease: "V202601" },
      }));
    // Hosted runners and the image's non-root process use different UIDs.
    await chmod(objectStoreDirectory, 0o755);
    await execFileAsync("docker", ["volume", "create", VOLUME]);

    for (const [image, buildId] of [
      [BASELINE_IMAGE, BASELINE_BUILD_ID],
      [SUCCESSOR_IMAGE, SUCCESSOR_BUILD_ID],
    ] as const) {
      await execFileAsync(
        "docker",
        [
          "build",
          "--build-arg",
          `APP_BUILD_ID=${buildId}`,
          "--tag",
          image,
          ".",
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
    }
    containerId = await runContainer(BASELINE_IMAGE);
    origin = await publishedOrigin(containerId);
    await waitForHealth(origin);
  }, 360_000);

  afterAll(async () => {
    if (containerId !== undefined) {
      await execFileAsync("docker", ["rm", "--force", containerId]).catch(
        () => undefined,
      );
    }
    await Promise.all(
      [BASELINE_IMAGE, SUCCESSOR_IMAGE].map((image) =>
        execFileAsync("docker", ["image", "rm", "--force", image]).catch(
          () => undefined,
        ),
      ),
    );
    await execFileAsync("docker", ["volume", "rm", "--force", VOLUME]).catch(
      () => undefined,
    );
    for (const directory of [objectStoreDirectory, candidateRoot]) {
      if (directory !== undefined) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("serves the promoted release over loopback as a non-root process", async () => {
    const [health, current, metrics, processUser] = await Promise.all([
      fetch(`${origin}/healthz`),
      fetch(`${origin}/api/v1/analyses/current`),
      fetch(`${origin}/metrics`),
      execFileAsync("docker", [
        "exec",
        containerId as string,
        "sh",
        "-c",
        "awk '/^Uid:/ { print $2 }' /proc/1/status",
      ]),
    ]);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      buildId: BASELINE_BUILD_ID,
    });
    expect(health.headers.get("X-HS-Tracker-Machine-Class")).toBe("local");

    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      source: { baciRelease: "V202601" },
    });

    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain("hs_tracker_http_requests_total");

    expect(processUser.stdout.trim()).toBe("1000");
  });

  it("re-hydrates the served release from the volume after a restart", async () => {
    await execFileAsync("docker", ["restart", "--time", "1", containerId as string]);
    origin = await publishedOrigin(containerId as string);
    await waitForHealth(origin);

    const current = await fetch(`${origin}/api/v1/analyses/current`);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      source: { baciRelease: "V202601" },
    });
  }, 120_000);

  it("[launch-evidence:rollback] restores the prior application image and accepted Market Analysis deployment atomically", async () => {
    const baselineImageDigest = await imageDigest(BASELINE_IMAGE);
    const successorImageDigest = await imageDigest(SUCCESSOR_IMAGE);
    expect(successorImageDigest).not.toBe(baselineImageDigest);
    const baselineRuntime = await expectRuntimeDeployment(
      origin,
      BASELINE_BUILD_ID,
      baselineDeployment,
    );

    const { deployment: successor } =
      await promoteAcceptedReleaseCandidateToLocalStore({
        root: candidateRoot,
        label: "successor",
        objectStoreDirectory,
        activatedAt: "2026-07-12T03:00:00Z",
        candidateOptions: {
          baciRelease: "V202601",
          analysisArtifactBuildId:
            "candidate-market-artifact-v1-7272727272727272",
        },
      });
    expect(successor.analysisBuildId).not.toBe(
      baselineDeployment.analysisBuildId,
    );
    expect(successor.previousDeploymentPairingId).toBe(
      baselineDeployment.deploymentPairingId,
    );

    await replaceContainer(SUCCESSOR_IMAGE);
    const successorRuntime = await expectRuntimeDeployment(
      origin,
      SUCCESSOR_BUILD_ID,
      successor,
    );
    expect(runtimeAnalyticalReleaseIdentity(successorRuntime)).not.toEqual(
      runtimeAnalyticalReleaseIdentity(baselineRuntime),
    );
    await expectCurrentMarketAnalysis(origin, successor.analysisBuildId);

    const rolledBack = await rollbackLocalReleaseStore({
      root: candidateRoot,
      objectStoreDirectory,
      activatedAt: "2026-07-12T04:00:00Z",
    });
    expect(rolledBack).toMatchObject({
      analysisBuildId: baselineDeployment.analysisBuildId,
      productSearchBuildId: baselineDeployment.productSearchBuildId,
      previousDeploymentPairingId: successor.deploymentPairingId,
      sourceStatusFallback: {
        rollbackActive: true,
      },
    });
    expect(rolledBack.deploymentPairingId).not.toBe(
      baselineDeployment.deploymentPairingId,
    );
    expect(rolledBack.deploymentPairingId).not.toBe(
      successor.deploymentPairingId,
    );

    await replaceContainer(BASELINE_IMAGE);
    expect(await imageDigest(BASELINE_IMAGE)).toBe(baselineImageDigest);
    const restoredBaseline = await expectRuntimeDeployment(
      origin,
      BASELINE_BUILD_ID,
      rolledBack,
    );
    expect(runtimeAnalyticalReleaseIdentity(restoredBaseline)).toEqual(
      runtimeAnalyticalReleaseIdentity(baselineRuntime),
    );
    expect(restoredBaseline.deploymentPairingId).not.toBe(
      baselineRuntime.deploymentPairingId,
    );
    expect(restoredBaseline.sourceStatusSnapshotId).toBe(
      rolledBack.sourceStatusFallback.sourceStatusSnapshotId,
    );
    expect(rolledBack.sourceStatusFallback.rollbackActive).toBe(true);
    await expectCurrentMarketAnalysis(origin, baselineDeployment.analysisBuildId);
    const shell = await fetch(origin);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Export Market Workspace");

    const restoredSuccessor = await rollbackLocalReleaseStore({
      root: candidateRoot,
      objectStoreDirectory,
      activatedAt: "2026-07-12T05:00:00Z",
    });
    expect(restoredSuccessor).toMatchObject({
      analysisBuildId: successor.analysisBuildId,
      productSearchBuildId: successor.productSearchBuildId,
      previousDeploymentPairingId: rolledBack.deploymentPairingId,
      sourceStatusFallback: { rollbackActive: true },
    });
    expect(restoredSuccessor.deploymentPairingId).not.toBe(
      successor.deploymentPairingId,
    );

    await replaceContainer(SUCCESSOR_IMAGE);
    expect(await imageDigest(SUCCESSOR_IMAGE)).toBe(successorImageDigest);
    const candidateRuntime = await expectRuntimeDeployment(
      origin,
      SUCCESSOR_BUILD_ID,
      restoredSuccessor,
    );
    expect(runtimeAnalyticalReleaseIdentity(candidateRuntime)).toEqual(
      runtimeAnalyticalReleaseIdentity(successorRuntime),
    );
    expect(candidateRuntime.sourceStatusSnapshotId).toBe(
      restoredSuccessor.sourceStatusFallback.sourceStatusSnapshotId,
    );
    await expectCurrentMarketAnalysis(origin, successor.analysisBuildId);
  }, 240_000);

  async function replaceContainer(image: string): Promise<void> {
    if (containerId !== undefined) {
      await execFileAsync("docker", ["rm", "--force", containerId]);
    }
    containerId = await runContainer(image);
    origin = await publishedOrigin(containerId);
    await waitForHealth(origin);
  }

  async function runContainer(image: string): Promise<string> {
    const started = await execFileAsync("docker", [
      "run",
      "--detach",
      "--env",
      "HS_TRACKER_RUNTIME_MODE=release",
      "--env",
      "HS_TRACKER_RELEASE_OBJECT_STORE=filesystem",
      "--env",
      "HS_TRACKER_RELEASE_FILESYSTEM_PATH=/objectstore",
      "--env",
      "HS_TRACKER_MACHINE_CLASS=local",
      "--volume",
      `${objectStoreDirectory}:/objectstore:ro`,
      "--volume",
      `${VOLUME}:/data`,
      "--publish",
      "127.0.0.1::3000",
      image,
    ]);
    return started.stdout.trim();
  }
});

async function imageDigest(image: string): Promise<string> {
  const inspected = await execFileAsync("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  return inspected.stdout.trim();
}

type RuntimeDeploymentIdentity = {
  buildId: string;
  deploymentPairingId: string;
  analysisBuildId: string;
  productSearchBuildId: string;
  artifactSha256: string;
  sourceStatusSnapshotId: string;
  deploymentActivationMode: string;
};

async function expectRuntimeDeployment(
  origin: string,
  buildId: string,
  deployment: PublishedDeployment,
): Promise<RuntimeDeploymentIdentity> {
  const health = await fetch(`${origin}/healthz`);
  expect(health.status).toBe(200);
  const value = (await health.json()) as {
    status: string;
    buildId: string;
    activation: { mode: string };
    deployment: {
      deploymentPairingId: string;
      analysisBuildId: string;
      productSearchBuildId: string;
    };
    analysisArtifact: { sha256: string };
    freshness: { sourceStatusSnapshotId: string };
  };
  expect(value).toMatchObject({
    status: "ok",
    buildId,
    activation: { mode: "CURRENT" },
    deployment: {
      deploymentPairingId: deployment.deploymentPairingId,
      analysisBuildId: deployment.analysisBuildId,
      productSearchBuildId: deployment.productSearchBuildId,
    },
    freshness: {
      sourceStatusSnapshotId:
        deployment.sourceStatusFallback.sourceStatusSnapshotId,
    },
  });
  return {
    buildId: value.buildId,
    deploymentPairingId: value.deployment.deploymentPairingId,
    analysisBuildId: value.deployment.analysisBuildId,
    productSearchBuildId: value.deployment.productSearchBuildId,
    artifactSha256: value.analysisArtifact.sha256,
    sourceStatusSnapshotId: value.freshness.sourceStatusSnapshotId,
    deploymentActivationMode: value.activation.mode,
  };
}

function runtimeAnalyticalReleaseIdentity(
  identity: RuntimeDeploymentIdentity,
) {
  return {
    buildId: identity.buildId,
    analysisBuildId: identity.analysisBuildId,
    productSearchBuildId: identity.productSearchBuildId,
    artifactSha256: identity.artifactSha256,
    deploymentActivationMode: identity.deploymentActivationMode,
  };
}

async function expectCurrentMarketAnalysis(
  origin: string,
  expectedAnalysisBuildId: string,
): Promise<void> {
  const current = await fetch(`${origin}/api/v1/analyses/current`);
  expect(current.status).toBe(200);
  const manifest = (await current.json()) as {
    analysisBuildId: string;
    benchmarkQueries: readonly {
      role: string;
      exporterCode: string;
      productCode: string;
    }[];
  };
  expect(manifest.analysisBuildId).toBe(expectedAnalysisBuildId);
  const benchmark = manifest.benchmarkQueries.find(
    ({ role }) => role === "maximum-row",
  );
  expect(benchmark).toBeDefined();

  const candidates = await fetch(
    `${origin}/api/v1/analyses/${expectedAnalysisBuildId}/candidate-markets?exporter=${benchmark!.exporterCode}&product=${benchmark!.productCode}`,
  );
  expect(candidates.status).toBe(200);
  const candidateResult = (await candidates.json()) as {
    candidates: readonly { economy: { code: string } }[];
  };
  const marketCode = candidateResult.candidates[0]?.economy.code;
  expect(marketCode).toBeDefined();

  const marketAnalysis = await fetch(
    `${origin}/api/v1/analyses/${expectedAnalysisBuildId}/market-analysis?exporter=${benchmark!.exporterCode}&product=${benchmark!.productCode}&market=${marketCode}`,
  );
  expect(marketAnalysis.status).toBe(200);
  await expect(marketAnalysis.json()).resolves.toMatchObject({
    schemaVersion: "market-analysis-v1",
    context: { analysisBuildId: expectedAnalysisBuildId },
    constituentAnalyses: [
      { recipe: "candidate-market-v1" },
      { recipe: "trade-trend-v1" },
      { recipe: "supplier-competition-v1" },
    ],
  });
}

async function publishedOrigin(containerId: string): Promise<string> {
  const publishedPort = await execFileAsync("docker", [
    "port",
    containerId,
    "3000/tcp",
  ]);
  return `http://${publishedPort.stdout.trim()}`;
}

async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Local release deployment did not become healthy: ${String(lastError)}`,
  );
}
