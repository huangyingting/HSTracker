import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { executeTradeExplorerV1 } from "../../src/domain/trade-analytics/trade-explorer-v1-adapter";
import { serializeTradeExplorerCsv } from "../../src/export/trade-explorer-csv";
import { SOURCE_FRESHNESS_STATES } from "../../src/domain/release/source-freshness";
import type { PromotionEvidenceStatus } from "../../src/promotion/promotion-report";

const REPO_ROOT = process.cwd();
const ANALYSIS_BUILD_ID = "acceptance-fixtures-v1";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_EVIDENCE =
  "reports/promotion/candidate/evidence/source-and-domain-measurement.json";
const HEX64 = /^[0-9a-f]{64}$/u;

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Source-and-domain drill failed.";
  process.stderr.write(
    `${JSON.stringify({ error: { code: "SOURCE_DOMAIN_DRILL_FAILED", message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "out-dir": { type: "string" },
      evidence: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const evidencePath = values.evidence ?? DEFAULT_EVIDENCE;

  const windowStartedAt = utcNow();
  const runtime = createFixtureApplicationRuntime();
  const snapshot = runtime.currentAnalysisSnapshot();
  const manifest = snapshot.manifest;

  const source = await verifySourceContract(runtime, manifest);
  const domain = await verifyDomainContract(runtime, manifest);
  const windowEndedAt = utcNow();

  const sourceStatus: PromotionEvidenceStatus = source.failures.length === 0
    ? "accepted"
    : "blocked";
  const domainStatus: PromotionEvidenceStatus = domain.failures.length === 0
    ? "accepted"
    : "blocked";

  const evidence = {
    schemaVersion: "source-and-domain-measurement-v1",
    analysisBuildId: manifest.analysisBuildId,
    measuredAt: windowStartedAt,
    asOf: snapshot.asOf,
    source,
    domain,
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await mkdir(dirname(join(REPO_ROOT, evidencePath)), { recursive: true });
  await writeFile(join(REPO_ROOT, evidencePath), evidenceBytes);

  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "source-and-domain",
    measurementClass: "candidate",
    measuredAt: windowStartedAt,
    windowStartedAt,
    windowEndedAt,
    sampleCount: source.assertions.length + domain.assertions.length,
    checks: [
      {
        name: "source-contract",
        status: sourceStatus,
        detail:
          source.failures.length === 0
            ? `All ${source.assertions.length} source-binding invariants hold: served BACI Release ${manifest.source.baciRelease} matches freshness ${manifest.freshness.state}, freshness round-trips, and ingest windows are coherent.`
            : `Source contract violations: ${source.failures.join("; ")}.`,
      },
      {
        name: "domain-contract",
        status: domainStatus,
        detail:
          domain.failures.length === 0
            ? `All ${domain.assertions.length} domain-consistency invariants hold: manifest identities are well-formed and an executed analysis binds its provenance to the manifest.`
            : `Domain contract violations: ${domain.failures.join("; ")}.`,
      },
    ],
    additionalRetainedLogs: [
      {
        path: evidencePath,
        sha256: sha256(evidenceBytes),
      },
    ],
  };

  const outPath = `${outDir}/source-and-domain.checks.json`;
  await mkdir(dirname(join(REPO_ROOT, outPath)), { recursive: true });
  await writeFile(
    join(REPO_ROOT, outPath),
    `${JSON.stringify(checkSet, null, 2)}\n`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "source-and-domain-measurement-report-v1",
        out: outPath,
        sourceContract: sourceStatus,
        domainContract: domainStatus,
        evidence: evidencePath,
      },
      null,
      2,
    )}\n`,
  );
}

interface ContractResult {
  assertions: string[];
  failures: string[];
}

async function verifySourceContract(
  runtime: ReturnType<typeof createFixtureApplicationRuntime>,
  manifest: ReturnType<
    ReturnType<typeof createFixtureApplicationRuntime>["currentAnalysis"]
  >,
): Promise<ContractResult> {
  const result: ContractResult = { assertions: [], failures: [] };
  const check = (name: string, ok: boolean): void => {
    result.assertions.push(name);
    if (!ok) {
      result.failures.push(name);
    }
  };

  check(
    "manifest-schema-version",
    manifest.schemaVersion === "current-analysis-manifest-v1",
  );
  check(
    "freshness-serves-deployed-release",
    manifest.freshness.servedBaciRelease === manifest.source.baciRelease,
  );

  const roundTrip = runtime.resolveFreshnessStatus(
    manifest.freshness.freshnessStatusId,
  );
  check(
    "freshness-status-round-trips",
    roundTrip !== null &&
      roundTrip.freshnessStatusId === manifest.freshness.freshnessStatusId &&
      roundTrip.servedBaciRelease === manifest.source.baciRelease,
  );

  check(
    "freshness-state-recognized",
    (SOURCE_FRESHNESS_STATES as readonly string[]).includes(
      manifest.freshness.state,
    ),
  );
  check(
    "freshness-check-not-overdue",
    manifest.freshness.state !== "CHECK_OVERDUE" &&
      Date.parse(manifest.freshness.checkOverdueAt) >
        Date.parse(manifest.freshness.checkedAt),
  );

  const { ingestedYears, finalizedCutoffYear, provisionalYear, windows } =
    manifest.source;
  check(
    "ingest-window-coherent",
    ingestedYears.start <= finalizedCutoffYear &&
      finalizedCutoffYear <= ingestedYears.end,
  );
  check(
    "provisional-year-after-finalized",
    provisionalYear >= finalizedCutoffYear &&
      provisionalYear <= ingestedYears.end,
  );
  check(
    "score-windows-within-ingest-range",
    windows.threeYear.start >= ingestedYears.start &&
      windows.tenYear.end <= ingestedYears.end &&
      windows.score.start >= ingestedYears.start &&
      windows.score.end <= ingestedYears.end,
  );
  check(
    "artifact-digest-well-formed",
    HEX64.test(manifest.source.artifact.sha256),
  );

  return result;
}

async function verifyDomainContract(
  runtime: ReturnType<typeof createFixtureApplicationRuntime>,
  manifest: ReturnType<
    ReturnType<typeof createFixtureApplicationRuntime>["currentAnalysis"]
  >,
): Promise<ContractResult> {
  const result: ContractResult = { assertions: [], failures: [] };
  const check = (name: string, ok: boolean): void => {
    result.assertions.push(name);
    if (!ok) {
      result.failures.push(name);
    }
  };

  check(
    "release-catalog-digest-well-formed",
    HEX64.test(manifest.analysisReleaseCatalogSha256),
  );

  const recommendation = manifest.recommendation;
  check(
    "recommendation-recipe-is-candidate-market",
    recommendation.recipe === "candidate-market-v1",
  );
  check(
    "recommendation-dataset-package-present",
    typeof recommendation.datasetPackageIdentity === "string" &&
      recommendation.datasetPackageIdentity.length > 0,
  );

  const declaredRecipes = [
    recommendation.tradeTrend,
    recommendation.supplierCompetition,
    recommendation.recentTradeMomentum,
    recommendation.tradeExplorer,
    recommendation.opportunityDiscovery,
  ];
  check(
    "declared-recipes-well-formed",
    declaredRecipes.every(
      (declared) =>
        declared === null ||
        (typeof declared.datasetPackageIdentity === "string" &&
          declared.datasetPackageIdentity.length > 0),
    ),
  );

  check(
    "deployment-window-current-first",
    manifest.deploymentWindow.length > 0 &&
      manifest.deploymentWindow[0]!.analysisBuildId === manifest.analysisBuildId,
  );

  // Round-trip: an executed analysis must bind its provenance and dataset
  // package to this manifest. serializeTradeExplorerCsv asserts the full
  // export-context binding and throws on any mismatch.
  let executionBound = false;
  let executionError: string | null = null;
  try {
    const benchmark = manifest.tradeExplorerBenchmarkQueries[0]!;
    const executed = await executeTradeExplorerV1(runtime.tradeAnalytics, {
      analysisBuildId: ANALYSIS_BUILD_ID,
      shape: benchmark.shape,
      dimensions: ["YEAR"],
      measures: benchmark.measures,
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: [benchmark.exportEconomyCode],
        importEconomy: [benchmark.importEconomyCode],
        hsProduct: [benchmark.hsProductCode],
      },
      sort: null,
    } as unknown as Parameters<typeof executeTradeExplorerV1>[1]);
    serializeTradeExplorerCsv({ result: executed, manifest });
    executionBound =
      executed.analysisBuildId === manifest.analysisBuildId &&
      executed.provenance.baciRelease === manifest.source.baciRelease &&
      executed.analysisReleaseCatalogSha256 ===
        manifest.analysisReleaseCatalogSha256;
  } catch (error) {
    executionError = error instanceof Error ? error.message : "unknown error";
  }
  check("executed-analysis-binds-to-manifest", executionBound);
  if (executionError !== null) {
    result.failures.push(
      `executed-analysis-binds-to-manifest (${executionError})`,
    );
  }

  return result;
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
