import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const FLYCTL_IMAGE =
  "flyio/flyctl:v0.4.69@" +
  "sha256:53c7237f41861a6c8498232eb9f792d6685e070c7c3106ec82bbcb11d5b997b4";

describe("production deployment configuration", () => {
  it("declares the accepted single-Machine Fly topology", async () => {
    const validation = await runFlyConfig(["config", "validate", "--strict"]);
    expect(validation.stdout).toContain("Configuration is valid");

    const { stdout } = await runFlyConfig(["config", "show", "--local"]);
    const config = JSON.parse(stdout) as Record<string, unknown>;

    expect(config).toMatchObject({
      app: "huangyingting-hs-tracker",
      primary_region: "sin",
      kill_signal: "SIGTERM",
      kill_timeout: "30s",
      build: { dockerfile: "Dockerfile" },
      deploy: {
        strategy: "rolling",
        max_unavailable: 1,
        wait_timeout: "20m0s",
      },
      env: {
        HOSTNAME: "0.0.0.0",
        PORT: "3000",
        HS_TRACKER_RUNTIME_MODE: "release",
        HS_TRACKER_RELEASE_VOLUME_PATH: "/data/releases",
        HS_TRACKER_RELEASE_S3_REGION: "auto",
        HS_TRACKER_RELEASE_S3_ENDPOINT: "https://t3.storage.dev",
        HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE: "false",
      },
      http_service: {
        internal_port: 3000,
        force_https: true,
        auto_stop_machines: false,
        auto_start_machines: false,
        min_machines_running: 1,
        concurrency: {
          type: "requests",
          soft_limit: 20,
          hard_limit: 32,
        },
        tls_options: {
          alpn: ["h2", "http/1.1"],
          versions: ["TLSv1.2", "TLSv1.3"],
        },
        checks: [
          {
            method: "GET",
            path: "/healthz",
            interval: "15s",
            timeout: "3s",
            grace_period: "1m0s",
            headers: { "X-Forwarded-Proto": "https" },
          },
        ],
      },
      mounts: [
        {
          source: "hs_tracker_releases",
          destination: "/data",
          initial_size: "50gb",
          snapshot_retention: 5,
        },
      ],
      restart: [{ policy: "on-failure", retries: 10 }],
      vm: [{ size: "shared-cpu-2x", memory: "2gb" }],
    });
    expect(config.env).toEqual({
      HOSTNAME: "0.0.0.0",
      HS_TRACKER_RELEASE_S3_ENDPOINT: "https://t3.storage.dev",
      HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE: "false",
      HS_TRACKER_RELEASE_S3_REGION: "auto",
      HS_TRACKER_RELEASE_VOLUME_PATH: "/data/releases",
      HS_TRACKER_RUNTIME_MODE: "release",
      PORT: "3000",
    });
  }, 120_000);
});

function runFlyConfig(arguments_: readonly string[]) {
  const projectPath = resolve(".");
  return execFileAsync(
    "docker",
    [
      "run",
      "--rm",
      "--env",
      "FLY_API_TOKEN=fo1_local-config-validation",
      "--volume",
      `${projectPath}:/workspace:ro`,
      "--workdir",
      "/workspace",
      FLYCTL_IMAGE,
      ...arguments_,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}
