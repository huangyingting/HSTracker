import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

type ComposeConfig = {
  name: string;
  services: Record<
    string,
    {
      environment?: Record<string, string>;
      ports?: readonly {
        host_ip?: string;
        target?: number;
        published?: string;
      }[];
      volumes?: readonly {
        type?: string;
        target?: string;
        read_only?: boolean;
      }[];
      depends_on?: Record<string, { condition?: string }>;
      restart?: string;
    }
  >;
  volumes?: Record<string, unknown>;
};

describe("local single-host deployment configuration", () => {
  it("declares the accepted local single-host topology (ADR-0004)", async () => {
    const config = await composeConfig();
    const app = config.services["hs-tracker"];
    expect(app).toBeDefined();

    // Release mode against the local filesystem release object store and volume.
    expect(app.environment).toMatchObject({
      HS_TRACKER_MACHINE_CLASS: "local",
      HS_TRACKER_RUNTIME_MODE: "release",
      HS_TRACKER_RELEASE_VOLUME_PATH: "/data/releases",
      HS_TRACKER_RELEASE_OBJECT_STORE: "filesystem",
      HS_TRACKER_RELEASE_FILESYSTEM_PATH: "/objectstore",
      HS_TRACKER_OPERATIONAL_DRIVER: "postgres",
    });
    // No hosted object-storage or write credentials are configured locally.
    for (const key of Object.keys(app.environment ?? {})) {
      expect(key).not.toMatch(/^HS_TRACKER_RELEASE_S3_/u);
      expect(key).not.toMatch(/^HS_TRACKER_RELEASE_WRITE_/u);
    }
    // The operational plane is a locally managed PostgreSQL reachable in-network.
    expect(app.environment?.HS_TRACKER_OPERATIONAL_PG_URL).toContain(
      "postgres:5432/hstracker",
    );

    // Reachable only over loopback; never published on 0.0.0.0.
    expect(app.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 3000 }),
    ]);

    // Private release bucket is a local directory mounted read-only; the
    // serving volume is a named volume hydrated on startup.
    const objectStoreMount = app.volumes?.find(
      (volume) => volume.target === "/objectstore",
    );
    expect(objectStoreMount).toMatchObject({ type: "bind", read_only: true });
    const releaseVolumeMount = app.volumes?.find(
      (volume) => volume.target === "/data",
    );
    expect(releaseVolumeMount).toMatchObject({ type: "volume" });

    // The app only starts once the operational store is healthy, and both
    // services restart only on failure.
    expect(app.depends_on?.postgres?.condition).toBe("service_healthy");
    expect(app.restart).toBe("on-failure");

    const postgres = config.services.postgres;
    expect(postgres.restart).toBe("on-failure");
    // PostgreSQL is bound to loopback on the host only.
    expect(postgres.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 5432 }),
    ]);

    expect(Object.keys(config.volumes ?? {})).toEqual(
      expect.arrayContaining(["hs_tracker_releases", "hs_tracker_operational"]),
    );
  });
});

async function composeConfig(): Promise<ComposeConfig> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-f", "docker-compose.local.yml", "config", "--format", "json"],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as ComposeConfig;
}
