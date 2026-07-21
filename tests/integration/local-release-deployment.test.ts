import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { promoteAcceptedReleaseCandidateToLocalStore } from "../support/local-release-deployment";

const execFileAsync = promisify(execFile);
const IMAGE = `hs-tracker-local-release-test:${randomUUID()}`;
const VOLUME = `hs-tracker-local-release-volume-${randomUUID()}`;
const BUILD_ID = "local-release-integration-v1";

describe("local single-host release deployment", () => {
  let containerId: string | undefined;
  let origin: string;
  let objectStoreDirectory: string;
  let candidateRoot: string;

  beforeAll(async () => {
    objectStoreDirectory = await mkdtemp(
      join(tmpdir(), "hs-tracker-local-objectstore-"),
    );
    candidateRoot = await mkdtemp(join(tmpdir(), "hs-tracker-local-candidate-"));

    await promoteAcceptedReleaseCandidateToLocalStore({
      root: candidateRoot,
      label: "local",
      objectStoreDirectory,
      activatedAt: "2026-07-12T02:00:00Z",
      candidateOptions: { baciRelease: "V202601" },
    });
    // Hosted runners and the image's non-root process use different UIDs.
    await chmod(objectStoreDirectory, 0o755);
    await execFileAsync("docker", ["volume", "create", VOLUME]);

    await execFileAsync(
      "docker",
      ["build", "--build-arg", `APP_BUILD_ID=${BUILD_ID}`, "--tag", IMAGE, "."],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    containerId = await runContainer();
    origin = await publishedOrigin(containerId);
    await waitForHealth(origin);
  }, 240_000);

  afterAll(async () => {
    if (containerId !== undefined) {
      await execFileAsync("docker", ["rm", "--force", containerId]).catch(
        () => undefined,
      );
    }
    await execFileAsync("docker", ["image", "rm", "--force", IMAGE]).catch(
      () => undefined,
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
      buildId: BUILD_ID,
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

  async function runContainer(): Promise<string> {
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
      IMAGE,
    ]);
    return started.stdout.trim();
  }
});

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
