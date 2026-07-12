import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const IMAGE = `hs-tracker-container-test:${randomUUID()}`;

describe("production container", () => {
  let containerId: string;
  let origin: string;

  beforeAll(async () => {
    await execFileAsync(
      "docker",
      [
        "build",
        "--build-arg",
        "APP_BUILD_ID=container-integration-v1",
        "--tag",
        IMAGE,
        ".",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const started = await execFileAsync("docker", [
      "run",
      "--detach",
      "--rm",
      "--env",
      "HS_TRACKER_RUNTIME_MODE=fixture",
      "--publish",
      "127.0.0.1::3000",
      IMAGE,
    ]);
    containerId = started.stdout.trim();
    const publishedPort = await execFileAsync("docker", [
      "port",
      containerId,
      "3000/tcp",
    ]);
    origin = `http://${publishedPort.stdout.trim()}`;
    await waitForHealth(origin);
  }, 180_000);

  afterAll(async () => {
    if (containerId !== undefined) {
      await execFileAsync("docker", [
        "stop",
        "--time",
        "1",
        containerId,
      ]);
    }
    await execFileAsync("docker", ["image", "rm", "--force", IMAGE]);
  });

  it("serves health from the pinned glibc runtime as a non-root process", async () => {
    const [health, metrics, processUser, libc] = await Promise.all([
      fetch(`${origin}/healthz`),
      fetch(`${origin}/metrics`),
      execFileAsync("docker", [
        "exec",
        containerId,
        "sh",
        "-c",
        "awk '/^Uid:/ { print $2 }' /proc/1/status",
      ]),
      execFileAsync("docker", [
        "exec",
        containerId,
        "getconf",
        "GNU_LIBC_VERSION",
      ]),
    ]);

    await expect(health.json()).resolves.toEqual({
      status: "ok",
      buildId: "container-integration-v1",
    });
    expect(metrics.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(await metrics.text()).toContain(
      "hs_tracker_http_requests_total",
    );
    expect(processUser.stdout.trim()).toBe("1000");
    expect(libc.stdout.trim()).toMatch(/^glibc 2\./u);
  });

  it("passes the local production package gates", async () => {
    const { stdout } = await execFileAsync(
      resolve("node_modules/.bin/tsx"),
      [
        "scripts/deployment/check-deployment.ts",
        "--image",
        IMAGE,
        "--artifact-report",
        "reports/releases/V202601.artifact-build-report.json",
        "--catalog-report",
        "reports/releases/V202601.product-catalog-build-report.json",
        "--cost-forecast",
        "deployment/cost-forecast.json",
        "--volume-capacity-bytes",
        "53687091200",
        "--volume-free-at-peak-bytes",
        "46383198208",
        "--volume-free-after-activation-bytes",
        "51675987024",
        "--volume-observation-class",
        "projected",
        "--evaluated-at",
        "2026-07-12T14:30:00Z",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const report = JSON.parse(stdout);

    expect(report).toMatchObject({
      schemaVersion: "production-deployment-check-v1",
      evaluatedAt: "2026-07-12T14:30:00Z",
      status: "accepted",
      evidence: {
        image: {
          reference: IMAGE,
          compressedSizeMeasurement: "docker-image-save-gzip-v1",
          nodeVersion: "24.17.0",
          nativeDuckDb: "loaded",
          codeOnly: true,
        },
        artifact: { bytes: 1_002_975_232 },
        catalog: { residentBytes: 5_153_712 },
        volume: { observationClass: "projected" },
        cost: { forecastMonthlyUsd: 25.14 },
      },
      gates: {
        image: { status: "accepted" },
        artifact: { status: "accepted" },
        catalog: { status: "accepted" },
        volume: { status: "accepted" },
        cost: { status: "accepted" },
      },
    });
  }, 120_000);
});

async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // The container can accept connections only after Next.js starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Production container did not become healthy.");
}
