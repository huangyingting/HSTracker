import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import type { PromotionIdentity } from "../../src/promotion/promotion-report";
import {
  MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES,
} from "../support/market-analysis-launch-matrix";

const execute = promisify(execFile);
const workspaces: string[] = [];

const IDENTITY: PromotionIdentity = {
  fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
  buildId: "market-analysis-launch-candidate",
  baciRelease: "V202601",
  analysisBuildId: "analysis-build-v1-1111111111111111",
  productSearchBuildId: "product-search-v1-2222222222222222",
  artifactSha256: "a".repeat(64),
  deploymentPairingId: "deployment-pairing-v1-3333333333333333",
  sourceStatusSnapshotId: "source-status-v1-4444444444444444",
  machineId: "launch-test-machine",
  machineClass: "launch-test-class",
  region: "loc",
};

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Market Analysis launch evidence command", () => {
  it("archives the exact product, traceability, accessibility, performance, replay, startup, and rollback evidence", async () => {
    const fixture = await writeFixtureReports();

    const { stdout } = await execute(
      join("node_modules", ".bin", "tsx"),
      [
        "scripts/promotion/measure-market-analysis-launch.ts",
        ...fixture.arguments,
        "--measured-at",
        "2026-07-19T01:00:00Z",
      ],
      { cwd: process.cwd() },
    );

    const summary = JSON.parse(stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      status: "accepted",
      productContractVersion: "market-analysis-v1",
      activeDeploymentPairingId: IDENTITY.deploymentPairingId,
      analystNeeds: { DIRECT: 10, BOUNDED: 5, OUTSIDE: 5 },
      accessibilityCases: 5,
      recentMomentumStates: 11,
      originBenchmarkCases: 8,
      browserTrials: 10,
    });

    const evidence = JSON.parse(
      await readFile(fixture.evidencePath, "utf8"),
    ) as {
      analystNeeds: { rows: unknown[] };
      performance: { originBenchmarks: unknown[] };
      annualResultInvariance: { coveredMonthlyStates: unknown[] };
    };
    expect(evidence).toMatchObject({
      schemaVersion: "market-analysis-launch-readiness-evidence-v1",
      measurementClass: "candidate",
      status: "accepted",
      identity: IDENTITY,
      productContract: {
        schemaVersion: "market-analysis-v1",
        activeDeploymentPairingId: IDENTITY.deploymentPairingId,
      },
      analystNeeds: {
        status: "accepted",
        counts: { DIRECT: 10, BOUNDED: 5, OUTSIDE: 5 },
        productionLeakageViolations: [],
      },
      accessibility: { status: "accepted" },
      annualResultInvariance: { status: "accepted" },
      performance: { status: "accepted" },
      replay: { status: "accepted" },
      startupSmoke: { status: "accepted" },
      rollback: { status: "accepted" },
    });
    expect(evidence.analystNeeds.rows).toHaveLength(20);
    expect(evidence.performance.originBenchmarks).toHaveLength(8);
    expect(evidence.annualResultInvariance.coveredMonthlyStates).toHaveLength(
      11,
    );

    const checks = JSON.parse(
      await readFile(fixture.checksPath, "utf8"),
    ) as {
      additionalRetainedLogs: Array<{
        path: string;
        sha256: string;
      }>;
    };
    expect(checks).toMatchObject({
      schemaVersion: "gate-checks-v1",
      gate: "market-analysis-launch",
      measurementClass: "candidate",
      checks: expect.arrayContaining([
        { name: "product-contract", status: "accepted" },
        { name: "annual-result-invariance", status: "accepted" },
        { name: "retained-replay", status: "accepted" },
        { name: "rollback", status: "accepted" },
      ]),
    });
    expect(checks.additionalRetainedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: fixture.evidenceRelativePath,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      ]),
    );
  }, 30_000);

  it("fails closed when the accepted load profile omits Market Analysis", async () => {
    const fixture = await writeFixtureReports({ includesMarketAnalysis: false });

    await expect(
      execute(
        join("node_modules", ".bin", "tsx"),
        [
          "scripts/promotion/measure-market-analysis-launch.ts",
          ...fixture.arguments,
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Target-load report does not preserve the accepted 10-minute 10/25/55/10 workload with Market Analysis.",
      ),
    });
  }, 30_000);
});

async function writeFixtureReports(
  options: { includesMarketAnalysis?: boolean } = {},
) {
  const workspace = await mkdtemp(
    join(process.cwd(), "reports", "promotion", "launch-command-"),
  );
  workspaces.push(workspace);
  const gatesDirectory = join(workspace, "gates");
  const checksDirectory = join(workspace, "checks");
  const evidenceDirectory = join(workspace, "evidence");
  await Promise.all([
    mkdir(gatesDirectory, { recursive: true }),
    mkdir(checksDirectory, { recursive: true }),
    mkdir(evidenceDirectory, { recursive: true }),
  ]);

  const paths = {
    config: join(workspace, "config.json"),
    origin: join(workspace, "origin.json"),
    browser: join(workspace, "browser.json"),
    targetLoad: join(workspace, "target-load.json"),
    lifecycle: join(workspace, "lifecycle.json"),
    accessibility: join(workspace, "accessibility.json"),
    contracts: join(workspace, "contracts.json"),
  };
  await writeJson(paths.config, {
    schemaVersion: "promotion-candidate-config-v1",
    identity: IDENTITY,
    toolVersions: {
      node: "24.17.0",
      npm: "11.13.0",
      next: "16.2.10",
      duckdb: "1.5.4-r.1",
      playwright: "1.61.1",
    },
  });
  await writeJson(paths.origin, originReport());
  await writeJson(paths.browser, browserReport());
  await writeJson(
    paths.targetLoad,
    targetLoadReport(options.includesMarketAnalysis ?? true),
  );
  await writeJson(paths.lifecycle, {
    schemaVersion: "lifecycle-drill-report-v1",
    measurementClass: "candidate",
    identity: IDENTITY,
    measuredAt: "2026-07-19T00:40:00Z",
    drills: {
      rollback: {
        measuredMs: 12_345,
        limitMs: 900_000,
        status: "accepted",
        method: "Distinct accepted release rollback and restart.",
      },
    },
  });
  await writeJson(paths.accessibility, playwrightReport());
  await writeJson(paths.contracts, vitestReport());

  for (const gate of [
    "origin-benchmarks",
    "browser-lab",
    "target-load",
    "external-smoke-and-observability",
    "lifecycle-and-recovery",
  ]) {
    await writeJson(join(gatesDirectory, `${gate}.json`), {
      schemaVersion: `${gate}-report-v1`,
      gate,
      measurementClass: "candidate",
      status: "accepted",
      identity: IDENTITY,
      measuredAt: "2026-07-19T00:50:00Z",
      checks: [{ name: "fixture-check", status: "accepted" }],
      retainedLogDigests: [],
    });
  }

  const relativePath = (path: string) => relative(process.cwd(), path);
  const evidencePath = join(
    evidenceDirectory,
    "market-analysis-launch-readiness.json",
  );
  const checksPath = join(
    checksDirectory,
    "market-analysis-launch.checks.json",
  );
  return {
    arguments: [
      "--config",
      relativePath(paths.config),
      "--origin-report",
      relativePath(paths.origin),
      "--browser-report",
      relativePath(paths.browser),
      "--target-load-report",
      relativePath(paths.targetLoad),
      "--lifecycle-report",
      relativePath(paths.lifecycle),
      "--accessibility-report",
      relativePath(paths.accessibility),
      "--contract-report",
      relativePath(paths.contracts),
      "--gates-dir",
      relativePath(gatesDirectory),
      "--out-dir",
      relativePath(checksDirectory),
      "--evidence",
      relativePath(evidencePath),
    ],
    evidencePath,
    evidenceRelativePath: relativePath(evidencePath),
    checksPath,
  };
}

function originReport() {
  return {
    schemaVersion: "origin-benchmark-report-v1",
    measurementClass: "candidate",
    status: "measurement-complete",
    identity: performanceIdentity(),
    originBenchmarks: [
      "market-analysis-uncached",
      "market-analysis-process-hit",
    ].flatMap((operation) =>
      ["sparse", "median", "upper-quartile", "maximum-row"].map(
        (productRole) => ({
          operation,
          productRole,
          warmupSamples: 5,
          timedSamples: 100,
          p50Ms: 10,
          p75Ms: 12,
          p95Ms: 20,
          p99Ms: 25,
          maximumRouteMs: 30,
          cacheStatesVerified: true,
          errors: 0,
          timeouts: 0,
          payloadBytes: 4_096,
          compressedPayloadBytes: 1_024,
        }),
      ),
    ),
  };
}

function browserReport() {
  const product = (productRole: "median" | "maximum-row") => ({
    productRole,
    trials: Array.from({ length: 5 }, (_, trialIndex) => ({
      trialIndex,
      productRole,
      status: "measured",
      metrics: { marketAnalysisToCompleteMs: 500 + trialIndex },
      diagnostics: {
        marketAnalysisOpenInteractionToNextPaintMs: 50 + trialIndex,
      },
      violations: [],
    })),
    measuredTrialCount: 5,
    failedTrialCount: 0,
  });
  return {
    schemaVersion: "browser-lab-report-v1",
    measurementClass: "candidate",
    identity: performanceIdentity(),
    products: {
      median: product("median"),
      "maximum-row": product("maximum-row"),
    },
  };
}

function targetLoadReport(includesMarketAnalysis: boolean) {
  return {
    schemaVersion: "mixed-load-report-v1",
    measurementClass: "candidate",
    status: "measurement-complete",
    identity: performanceIdentity(),
    targetLoad: {
      sessions: 50,
      sustainedRequestsPerSecond: 3,
      sustainedSeconds: 600,
      routeMix: {
        currentManifest: 0.1,
        search: 0.25,
        analysis: 0.55,
        csv: 0.1,
      },
      includesMaximumRowProduct: true,
      includesTradeExplorer: true,
      includesMarketAnalysis,
      cacheStatesVerified: true,
      queueRejections: 0,
      unretryableErrors: 0,
      timeouts: 0,
    },
  };
}

function playwrightReport() {
  const cases = [
    ...MARKET_ANALYSIS_ACCESSIBILITY_CASES,
    MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  ];
  return {
    suites: [
      {
        specs: cases.map(({ title }) => ({
          title,
          ok: true,
          tests: [
            {
              status: "expected",
              results: [{ status: "passed" }],
            },
          ],
        })),
      },
    ],
  };
}

function vitestReport() {
  return {
    testResults: [
      {
        assertionResults: MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES.map(
          ({ title }) => ({
            fullName: `launch contracts ${title}`,
            status: "passed",
          }),
        ),
      },
    ],
  };
}

function performanceIdentity() {
  return {
    fixtureManifestSha256: IDENTITY.fixtureManifestSha256,
    buildId: IDENTITY.buildId,
    baciRelease: IDENTITY.baciRelease,
    analysisBuildId: IDENTITY.analysisBuildId,
    productSearchBuildId: IDENTITY.productSearchBuildId,
    artifactSha256: IDENTITY.artifactSha256,
    machineId: IDENTITY.machineId,
    machineClass: IDENTITY.machineClass,
    region: IDENTITY.region,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
