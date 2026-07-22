import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { resolveFixtureCurrentAnalysisManifest } from "../../src/release/fixture-current-analysis";

const execFileAsync = promisify(execFile);
const CURRENT_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, must-revalidate";
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";

it("archives immutable Market Analysis cache and conditional-request evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "hs-tracker-http-cache-"));
  const requests: Array<{ method: string; path: string }> = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push({ method: request.method ?? "GET", path });
    const currentManifest = path === "/api/v1/analyses/current";
    const etag = currentManifest ? '"current"' : '"immutable"';
    const cacheControl = currentManifest
      ? CURRENT_CACHE_CONTROL
      : IMMUTABLE_CACHE_CONTROL;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", cacheControl);
    if (request.headers["if-none-match"] === etag) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an IPv4 test server address.");
    }
    const evidence = join(root, "http-cache-evidence.json");
    const checks = join(root, "checks");
    const originPlan = await buildLocalOriginPlan(
      root,
      `http://127.0.0.1:${address.port}`,
    );
    await execFileAsync(
      resolve("node_modules/.bin/tsx"),
      [
        "scripts/promotion/measure-http-cache-and-deadlines.ts",
        "--origin-plan",
        relative(process.cwd(), originPlan),
        "--out-dir",
        relative(process.cwd(), checks),
        "--evidence",
        relative(process.cwd(), evidence),
      ],
      { cwd: process.cwd() },
    );

    const archived = JSON.parse(await readFile(evidence, "utf8")) as {
      cacheObservations: Array<{
        label: string;
        path: string;
        revalidationStatus: number;
        headStatus: number;
        headBodyBytes: number;
        passed: boolean;
      }>;
    };
    expect(archived.cacheObservations).toMatchObject([
      {
        label: "current-analysis",
        revalidationStatus: 304,
        headStatus: 200,
        headBodyBytes: 0,
        passed: true,
      },
      {
        label: "candidate-markets (immutable)",
        revalidationStatus: 304,
        headStatus: 200,
        headBodyBytes: 0,
        passed: true,
      },
      {
        label: "market-analysis (immutable)",
        path: "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528",
        revalidationStatus: 304,
        headStatus: 200,
        headBodyBytes: 0,
        passed: true,
      },
    ]);
    expect(
      requests.filter(({ path }) => path.includes("/market-analysis")),
    ).toHaveLength(3);
    expect(
      requests.some(
        ({ method, path }) =>
          method === "HEAD" && path.includes("/market-analysis"),
      ),
    ).toBe(true);
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});

async function buildLocalOriginPlan(
  root: string,
  origin: string,
): Promise<string> {
  const configPath = join(root, "origin-config.json");
  const manifestPath = join(root, "current-manifest.json");
  const planPath = join(root, "origin-plan.json");
  await Promise.all([
    writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: "candidate-origin-plan-config-v1",
        origin: "https://127.0.0.1:3443",
        deployment: {
          buildId: "cache-test-build",
          machineId: "cache-test-machine",
          machineClass: "local",
          region: "loc",
        },
        marketByRole: {
          sparse: "528",
          median: "528",
          "upper-quartile": "528",
          "maximum-row": "528",
        },
        recentTradeMomentumReporter: "NL",
      }),
    ),
    writeFile(
      manifestPath,
      JSON.stringify(resolveFixtureCurrentAnalysisManifest()),
    ),
  ]);
  await execFileAsync(
    resolve("node_modules/.bin/tsx"),
    [
      "scripts/promotion/build-candidate-origin-plan.ts",
      "--config",
      configPath,
      "--manifest",
      manifestPath,
      "--out",
      planPath,
    ],
    { cwd: process.cwd() },
  );
  const plan = JSON.parse(await readFile(planPath, "utf8")) as {
    measurementClass: string;
    origin: string;
  };
  plan.measurementClass = "local-smoke";
  plan.origin = origin;
  await writeFile(planPath, JSON.stringify(plan));
  return planPath;
}
