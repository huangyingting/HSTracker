import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { parseOriginBenchmarkPlan } from "../../src/promotion/http-performance-runner";
import { REQUIRED_PRODUCT_ROLES } from "../../src/promotion/performance-gates";
import { resolveFixtureCurrentAnalysisManifest } from "../../src/release/fixture-current-analysis";
import { RUNTIME_PROBE_CACHE_PARTITION_HEADER } from "../../src/runtime/runtime-metrics";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("builds a manifest-bound candidate origin plan for every representative role", async () => {
  const manifest = resolveFixtureCurrentAnalysisManifest();
  const plan = await buildPlan(manifest, "NL");
  const marketAnalysisRequests = plan.requests.filter((request) =>
    request.operation.startsWith("market-analysis-"),
  );

  expect(plan.schemaVersion).toBe("origin-benchmark-plan-v2");
  expect(plan.requests).toHaveLength(99);
  expect(plan.capabilities).toEqual({
    recentTradeMomentum: true,
    opportunityDiscovery: true,
  });
  expect(
    marketAnalysisRequests.map((request) => [
      request.operation,
      request.productRole,
    ]),
  ).toEqual(
    REQUIRED_PRODUCT_ROLES.flatMap((role) => [
      ["market-analysis-uncached", role],
      ["market-analysis-process-hit", role],
    ]),
  );
  for (const request of marketAnalysisRequests) {
    const benchmark = manifest.benchmarkQueries.find(
      (candidate) => candidate.role === request.productRole,
    );
    expect(benchmark).toBeDefined();
    const url = new URL(request.request.path, plan.origin);
    expect(url.pathname).toBe(
      `/api/v1/analyses/${manifest.analysisBuildId}/market-analysis`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      exporter: benchmark!.exporterCode,
      product: benchmark!.productCode,
      market: "528",
    });
    for (const sample of request.sampleRequests ?? []) {
      expect(
        sample.request.headers?.[RUNTIME_PROBE_CACHE_PARTITION_HEADER],
      ).toBe(sample.semanticKey);
    }
  }
});

it("omits optional origin cases only when the current manifest declares them unavailable", async () => {
  const manifest = resolveFixtureCurrentAnalysisManifest();
  const plan = await buildPlan(
    {
      ...manifest,
      recommendation: {
        ...manifest.recommendation,
        recentTradeMomentum: null,
        opportunityDiscovery: null,
      },
    },
    null,
  );

  expect(plan.requests).toHaveLength(91);
  expect(plan.capabilities).toEqual({
    recentTradeMomentum: false,
    opportunityDiscovery: false,
  });
  expect(
    plan.requests.some(
      (request) =>
        request.operation === "recent-trade-momentum-uncached" ||
        request.operation === "opportunity-feed-uncached",
    ),
  ).toBe(false);
  expect(
    plan.requests.filter((request) =>
      request.operation.startsWith("market-analysis-"),
    ),
  ).toHaveLength(8);
});

async function buildPlan(
  manifest: unknown,
  recentTradeMomentumReporter: string | null,
) {
  const root = await mkdtemp(join(tmpdir(), "hs-tracker-origin-plan-"));
  temporaryDirectories.push(root);
  const out = join(root, "origin-plan.json");
  const config = join(root, "origin-config.json");
  const currentManifest = join(root, "current-manifest.json");
  await Promise.all([
    writeFile(
      config,
      JSON.stringify({
        schemaVersion: "candidate-origin-plan-config-v1",
        origin: "https://127.0.0.1:3443",
        deployment: {
          buildId: "candidate-commit-sha",
          machineId: "candidate-local-01",
          machineClass: "local",
          region: "loc",
        },
        marketByRole: {
          sparse: "528",
          median: "528",
          "upper-quartile": "528",
          "maximum-row": "528",
        },
        recentTradeMomentumReporter,
      }),
    ),
    writeFile(currentManifest, JSON.stringify(manifest)),
  ]);

  await execFileAsync(
    resolve("node_modules/.bin/tsx"),
    [
      "scripts/promotion/build-candidate-origin-plan.ts",
      "--config",
      config,
      "--manifest",
      currentManifest,
      "--out",
      out,
    ],
    { cwd: process.cwd() },
  );

  return parseOriginBenchmarkPlan(JSON.parse(await readFile(out, "utf8")));
}
