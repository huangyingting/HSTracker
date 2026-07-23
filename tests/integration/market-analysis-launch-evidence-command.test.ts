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
import {
  BROWSER_LAUNCH_MATRIX_LOCALES,
  BROWSER_LAUNCH_MATRIX_VIEWPORTS,
} from "../../src/promotion/browser-launch-matrix";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import {
  REQUIRED_GATES,
  type PromotionGateId,
  type PromotionIdentity,
} from "../../src/promotion/promotion-report";
import { ANALYST_NEED_ACCEPTANCE_SCENARIOS } from "../support/market-analysis-analyst-needs";
import {
  MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  MARKET_ANALYSIS_ANNUAL_FAILURE_CASES,
  MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  MARKET_ANALYSIS_DURABLE_JOURNEY_CASES,
  MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES,
  launchEvidenceTestTitle,
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
      analystNeedScenarios: 12,
      accessibilityCases: MARKET_ANALYSIS_ACCESSIBILITY_CASES.length,
      durableJourneyCases: MARKET_ANALYSIS_DURABLE_JOURNEY_CASES.length,
      recentMomentumStates: 11,
      originBenchmarkCases: 8,
      browserTrials: 10,
      browserLaunchMatrixContexts: 10,
    });

    const evidence = JSON.parse(
      await readFile(fixture.evidencePath, "utf8"),
    ) as {
      analystNeeds: { rows: unknown[] };
      performance: { originBenchmarks: unknown[] };
      annualResultInvariance: {
        cases: unknown[];
        coveredMonthlyStates: unknown[];
      };
      rollback: {
        drill: {
          applicationImages: {
            before: { digest: string; buildId: string };
            successor: { digest: string; buildId: string };
            restored: { digest: string; buildId: string };
          };
        };
      };
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
      durableJourneys: { status: "accepted" },
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
    expect(evidence.annualResultInvariance.cases).toHaveLength(4);
    expect(evidence.rollback.drill.applicationImages).toEqual({
      before: {
        digest: `sha256:${"b".repeat(64)}`,
        buildId: "prior-market-analysis-build",
      },
      successor: {
        digest: `sha256:${"c".repeat(64)}`,
        buildId: IDENTITY.buildId,
      },
      restored: {
        digest: `sha256:${"b".repeat(64)}`,
        buildId: "prior-market-analysis-build",
      },
    });

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
        "Target-load report does not preserve the accepted 20-session, 4-rps, 10-minute, 10/25/55/10 workload",
      ),
    });
  }, 30_000);

  it("fails closed when the accepted load profile changes its session shape", async () => {
    const fixture = await writeFixtureReports({ targetLoadSessions: 19 });

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
        "Target-load report does not preserve the accepted 20-session, 4-rps",
      ),
    });
  }, 30_000);

  it("fails closed when a Market Analysis result is exactly one MiB", async () => {
    const fixture = await writeFixtureReports({
      originPayloadBytes: 1024 * 1024,
    });

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
        "Market Analysis result must remain below 1048576 bytes",
      ),
    });
  }, 30_000);

  it("fails closed when rollback evidence omits application-image proof", async () => {
    const fixture = await writeFixtureReports({
      rollbackProof: "missing-application-images",
    });

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
        "rollback application images must be an object",
      ),
    });
  }, 30_000);

  it("fails closed when rollback evidence does not restore the prior image digest", async () => {
    const fixture = await writeFixtureReports({
      rollbackProof: "mismatched-restored-image",
    });

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
        "must restore the exact prior digest and build",
      ),
    });
  }, 30_000);

  it("fails closed when rollback reuses the prior pairing instead of publishing rollback provenance", async () => {
    const fixture = await writeFixtureReports({
      rollbackProof: "reused-restored-identity",
    });

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
        "Rollback must publish a distinct deployment pairing",
      ),
    });
  }, 30_000);

  it("fails closed when browser evidence has prose titles without stable launch IDs", async () => {
    const fixture = await writeFixtureReports({
      omitBrowserEvidenceIds: true,
    });

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
        "Required browser test did not pass exactly once: scope-context.",
      ),
    });
  }, 30_000);

  it("fails closed when a predecessor gate omits a required check", async () => {
    const fixture = await writeFixtureReports({
      incompleteGate: "http-cache-and-deadlines",
    });

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
        "http-cache-and-deadlines gate report is missing required check deadlines.",
      ),
    });
  }, 30_000);
});

async function writeFixtureReports(
  options: {
    includesMarketAnalysis?: boolean;
    incompleteGate?: PromotionGateId;
    omitBrowserEvidenceIds?: boolean;
    originPayloadBytes?: number;
    targetLoadSessions?: number;
    rollbackProof?:
      | "accepted"
      | "missing-application-images"
      | "mismatched-restored-image"
      | "reused-restored-identity";
  } = {},
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
  await writeJson(
    paths.origin,
    originReport(options.originPayloadBytes ?? 4_096),
  );
  await writeJson(paths.browser, browserReport());
  await writeJson(
    paths.targetLoad,
    targetLoadReport(
      options.includesMarketAnalysis ?? true,
      options.targetLoadSessions ?? 20,
    ),
  );
  await writeJson(
    paths.lifecycle,
    lifecycleReport(options.rollbackProof ?? "accepted"),
  );
  await writeJson(
    paths.accessibility,
    playwrightReport(!(options.omitBrowserEvidenceIds ?? false)),
  );
  await writeJson(paths.contracts, vitestReport());

  for (const gate of REQUIRED_GATES.filter(
    (candidate) => candidate !== "market-analysis-launch",
  )) {
    const requiredChecks = PROMOTION_GATE_REQUIRED_CHECKS[gate];
    await writeJson(join(gatesDirectory, `${gate}.json`), {
      schemaVersion: `${gate}-report-v1`,
      gate,
      measurementClass: "candidate",
      status: "accepted",
      identity: IDENTITY,
      measuredAt: "2026-07-19T00:50:00Z",
      checks: requiredChecks
        .slice(
          0,
          options.incompleteGate === gate
            ? Math.max(0, requiredChecks.length - 1)
            : requiredChecks.length,
        )
        .map((name) => ({ name, status: "accepted" })),
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

function originReport(payloadBytes: number) {
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
          payloadBytes,
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
    launchMatrix: {
      productRole: "median",
      trials: BROWSER_LAUNCH_MATRIX_LOCALES.flatMap((locale) =>
        BROWSER_LAUNCH_MATRIX_VIEWPORTS.map((viewport, trialIndex) => ({
          locale,
          viewport,
          outcome: {
            trialIndex,
            productRole: "median",
            status: "measured",
            metrics: {
              lcpMs: 1_200,
              interactionToNextPaintMs: 100,
            },
            violations: [],
          },
        })),
      ),
      measuredTrialCount: 10,
      failedTrialCount: 0,
    },
  };
}

function targetLoadReport(
  includesMarketAnalysis: boolean,
  sessions: number,
) {
  return {
    schemaVersion: "mixed-load-report-v1",
    measurementClass: "candidate",
    status: "measurement-complete",
    identity: performanceIdentity(),
    targetLoad: {
      sessions,
      sustainedRequestsPerSecond: 4,
      sustainedSeconds: 600,
      routeMix: {
        currentManifest: 0.1,
        search: 0.25,
        analysis: 0.55,
        csv: 0.1,
      },
      analysisHotKeyFraction: 0.8,
      analysisUncachedKeyFraction: 0.2,
      burstRequestsPerSecond: 10,
      burstSeconds: 30,
      coordinatedDistinctKeys: 4,
      coordinatedBurstIntervalSeconds: 60,
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

function lifecycleReport(
  proof:
    | "accepted"
    | "missing-application-images"
    | "mismatched-restored-image"
    | "reused-restored-identity",
) {
  const priorDeployment = {
    deploymentPairingId: "deployment-pairing-v1-5555555555555555",
    analysisBuildId: "analysis-build-v1-6666666666666666",
    productSearchBuildId: "product-search-v1-7777777777777777",
    artifactSha256: "d".repeat(64),
    sourceStatusSnapshotId: "source-status-v1-8888888888888888",
  };
  const restoredDeployment =
    proof === "reused-restored-identity"
      ? priorDeployment
      : {
          ...priorDeployment,
          deploymentPairingId: "deployment-pairing-v1-9999999999999999",
          sourceStatusSnapshotId: "source-status-v1-9999999999999999",
        };
  const applicationImages =
    proof === "missing-application-images"
      ? undefined
      : {
          before: {
            digest: `sha256:${"b".repeat(64)}`,
            buildId: "prior-market-analysis-build",
          },
          successor: {
            digest: `sha256:${"c".repeat(64)}`,
            buildId: IDENTITY.buildId,
          },
          restored: {
            digest:
              proof === "mismatched-restored-image"
                ? `sha256:${"e".repeat(64)}`
                : `sha256:${"b".repeat(64)}`,
            buildId: "prior-market-analysis-build",
          },
        };
  return {
    schemaVersion: "lifecycle-drill-report-v1",
    measurementClass: "candidate",
    identity: IDENTITY,
    measuredAt: "2026-07-19T00:40:00Z",
    drills: {
      rollback: {
        measuredMs: 12_345,
        limitMs: 900_000,
        status: "accepted",
        method:
          "Restore the prior application image and accepted deployment, then run the Market Analysis product smoke.",
        applicationImages,
        deployments: {
          before: priorDeployment,
          successor: {
            deploymentPairingId: IDENTITY.deploymentPairingId,
            analysisBuildId: IDENTITY.analysisBuildId,
            productSearchBuildId: IDENTITY.productSearchBuildId,
            artifactSha256: IDENTITY.artifactSha256,
            sourceStatusSnapshotId: IDENTITY.sourceStatusSnapshotId,
          },
          restored: restoredDeployment,
        },
        restoredProductContract: {
          status: "accepted",
          schemaVersion: "market-analysis-v1",
          candidateMarketStatus: 200,
          marketAnalysisStatus: 200,
          deploymentPairingId: restoredDeployment.deploymentPairingId,
          analysisBuildId: priorDeployment.analysisBuildId,
          constituentRecipes: [
            "candidate-market-v1",
            "trade-trend-v1",
            "supplier-competition-v1",
          ],
        },
        restoredDeploymentActivation: {
          deploymentActivationMode: "current",
          rollbackActive: true,
          sourceStatusSnapshotId: restoredDeployment.sourceStatusSnapshotId,
        },
      },
    },
  };
}

function playwrightReport(includeEvidenceIds: boolean) {
  const cases = [
    ...ANALYST_NEED_ACCEPTANCE_SCENARIOS,
    ...MARKET_ANALYSIS_ACCESSIBILITY_CASES,
    MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
    ...MARKET_ANALYSIS_ANNUAL_FAILURE_CASES,
    ...MARKET_ANALYSIS_DURABLE_JOURNEY_CASES,
  ];
  return {
    suites: [
      {
        specs: cases.map((launchCase) => ({
          title: includeEvidenceIds
            ? launchEvidenceTestTitle(launchCase)
            : launchCase.title,
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
          (launchCase) => ({
            fullName: `launch contracts ${launchEvidenceTestTitle(launchCase)}`,
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
