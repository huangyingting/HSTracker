import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  BROWSER_LAUNCH_MATRIX_LIMITS,
  browserLaunchMatrixContextKey,
  REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS,
} from "../../src/promotion/browser-launch-matrix";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import {
  REQUIRED_GATES,
  type PromotionIdentity,
} from "../../src/promotion/promotion-report";
import {
  MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  MARKET_ANALYSIS_ANNUAL_FAILURE_CASES,
  MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  MARKET_ANALYSIS_DURABLE_JOURNEY_CASES,
  MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES,
  RECENT_MOMENTUM_LAUNCH_STATES,
} from "../../tests/support/market-analysis-launch-matrix";
import {
  ANALYST_NEED_ACCEPTANCE_SCENARIOS,
  ANALYST_NEEDS_TRACEABILITY,
} from "../../tests/support/market-analysis-analyst-needs";
import { MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS } from "../../tests/support/market-analysis-production-boundary";

const REPO_ROOT = process.cwd();
const DEFAULT_GATES_DIR = "reports/promotion/candidate/gates";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_EVIDENCE =
  "reports/promotion/candidate/evidence/market-analysis-launch-readiness.json";
const PRODUCT_CONTRACT_VERSION = "market-analysis-v1";
const LAUNCH_EVIDENCE_ID_PATTERN =
  /\[launch-evidence:([a-z0-9]+(?:-[a-z0-9]+)*)\]/gu;
const ROLLBACK_IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ROLLBACK_DEPLOYMENT_FIELDS = [
  "analysisBuildId",
  "productSearchBuildId",
  "artifactSha256",
] as const;
const MARKET_ANALYSIS_CONSTITUENT_RECIPES = [
  "candidate-market-v1",
  "trade-trend-v1",
  "supplier-competition-v1",
] as const;

const REQUIRED_GATE_IDS = REQUIRED_GATES.filter(
  (gate) => gate !== "market-analysis-launch",
);

class MarketAnalysisLaunchEvidenceError extends Error {
  readonly code = "MARKET_ANALYSIS_LAUNCH_EVIDENCE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "MarketAnalysisLaunchEvidenceError";
  }
}

type RetainedArtifact = {
  path: string;
  bytes: number;
  sha256: string;
  value: Record<string, unknown>;
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Market Analysis launch evidence failed for an unknown reason.";
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code:
          error instanceof MarketAnalysisLaunchEvidenceError
            ? error.code
            : "MARKET_ANALYSIS_LAUNCH_EVIDENCE_FAILED",
        message,
      },
    })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "origin-report": { type: "string" },
      "browser-report": { type: "string" },
      "target-load-report": { type: "string" },
      "lifecycle-report": { type: "string" },
      "accessibility-report": { type: "string" },
      "contract-report": { type: "string" },
      "gates-dir": { type: "string" },
      "out-dir": { type: "string" },
      evidence: { type: "string" },
      "measured-at": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const configArtifact = await readArtifact(
    required(values.config, "config"),
    "candidate config",
  );
  const identity = parseCandidateConfig(configArtifact.value);
  const originArtifact = await readArtifact(
    required(values["origin-report"], "origin-report"),
    "origin benchmark report",
  );
  const browserArtifact = await readArtifact(
    required(values["browser-report"], "browser-report"),
    "browser-lab report",
  );
  const targetLoadArtifact = await readArtifact(
    required(values["target-load-report"], "target-load-report"),
    "target-load report",
  );
  const lifecycleArtifact = await readArtifact(
    required(values["lifecycle-report"], "lifecycle-report"),
    "lifecycle report",
  );
  const accessibilityArtifact = await readArtifact(
    required(values["accessibility-report"], "accessibility-report"),
    "accessibility Playwright report",
  );
  const contractArtifact = await readArtifact(
    required(values["contract-report"], "contract-report"),
    "contract Vitest report",
  );

  const gatesDir = values["gates-dir"] ?? DEFAULT_GATES_DIR;
  const gateArtifacts = await Promise.all(
    REQUIRED_GATE_IDS.map((gate) =>
      readArtifact(`${gatesDir}/${gate}.json`, `${gate} gate report`),
    ),
  );
  for (const [index, gate] of REQUIRED_GATE_IDS.entries()) {
    verifyAcceptedGate(gateArtifacts[index]!, gate, identity);
  }

  const analystNeedScenarios = verifyPlaywrightReport(
    accessibilityArtifact.value,
    ANALYST_NEED_ACCEPTANCE_SCENARIOS,
  );
  const analystNeeds = await measureAnalystNeeds(analystNeedScenarios);
  const accessibility = verifyPlaywrightReport(
    accessibilityArtifact.value,
    MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  );
  const annualResultInvariance = verifyPlaywrightReport(
    accessibilityArtifact.value,
    [
      MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
      ...MARKET_ANALYSIS_ANNUAL_FAILURE_CASES,
    ],
  );
  const durableJourneys = verifyPlaywrightReport(
    accessibilityArtifact.value,
    MARKET_ANALYSIS_DURABLE_JOURNEY_CASES,
  );
  const contracts = verifyVitestReport(
    contractArtifact.value,
    MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES,
  );
  const originBenchmarks = verifyOriginReport(originArtifact.value, identity);
  const browserLab = verifyBrowserReport(browserArtifact.value, identity);
  const targetLoad = verifyTargetLoadReport(
    targetLoadArtifact.value,
    identity,
  );
  const rollback = verifyLifecycleReport(lifecycleArtifact.value, identity);
  const measuredAt = utcTimestamp(
    values["measured-at"] ?? new Date().toISOString(),
    "measured-at",
  );

  const sourceArtifacts = uniqueArtifacts([
    configArtifact,
    originArtifact,
    browserArtifact,
    targetLoadArtifact,
    lifecycleArtifact,
    accessibilityArtifact,
    contractArtifact,
    ...gateArtifacts,
  ]);
  const evidence = {
    schemaVersion: "market-analysis-launch-readiness-evidence-v1",
    measurementClass: "candidate",
    status: "accepted",
    measuredAt,
    identity,
    productContract: {
      schemaVersion: PRODUCT_CONTRACT_VERSION,
      route:
        "GET|HEAD /api/v1/analyses/{analysisBuildId}/market-analysis?exporter={code}&product={hs12}&market={code}",
      activeDeploymentPairingId: identity.deploymentPairingId,
      activeAnalysisBuildId: identity.analysisBuildId,
      activeArtifactSha256: identity.artifactSha256,
    },
    analystNeeds,
    accessibility: {
      status: "accepted",
      cases: accessibility,
      report: artifactReference(accessibilityArtifact),
    },
    durableJourneys: {
      status: "accepted",
      cases: durableJourneys,
      report: artifactReference(accessibilityArtifact),
    },
    annualResultInvariance: {
      status: "accepted",
      cases: annualResultInvariance,
      coveredMonthlyStates: RECENT_MOMENTUM_LAUNCH_STATES.map((state) => ({
        coverageState: state.coverageState,
        signalState: state.signalState,
        reasonCodes: state.reasonCodes,
      })),
      report: artifactReference(accessibilityArtifact),
    },
    performance: {
      status: "accepted",
      originBenchmarks,
      browserLab: browserLab.products,
      browserLaunchMatrix: browserLab.launchMatrix,
      targetLoad,
      reports: {
        origin: artifactReference(originArtifact),
        browser: artifactReference(browserArtifact),
        targetLoad: artifactReference(targetLoadArtifact),
      },
    },
    replay: {
      status: "accepted",
      current: requiredContract(contracts, "current-and-retired-replay"),
      retained: requiredContract(contracts, "retained-replay"),
      retired: requiredContract(contracts, "current-and-retired-replay"),
      report: artifactReference(contractArtifact),
    },
    startupSmoke: {
      status: "accepted",
      contract: requiredContract(contracts, "startup-smoke"),
      gate: artifactReference(
        gateArtifacts[REQUIRED_GATE_IDS.indexOf(
          "external-smoke-and-observability",
        )]!,
      ),
    },
    rollback: {
      status: "accepted",
      productContractVersion: PRODUCT_CONTRACT_VERSION,
      contract: requiredContract(contracts, "rollback"),
      drill: rollback,
      workspaceCases: durableJourneys,
      report: artifactReference(lifecycleArtifact),
    },
    sourceArtifacts: sourceArtifacts.map(artifactReference),
  };

  const evidencePath = values.evidence ?? DEFAULT_EVIDENCE;
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeReport(evidencePath, evidenceBytes);

  const retainedArtifacts = uniqueReferences([
    ...sourceArtifacts.map(artifactReference),
    {
      path: evidencePath,
      bytes: evidenceBytes.byteLength,
      sha256: sha256(evidenceBytes),
    },
  ]);
  const windowStartedAt = earliestTimestamp([
    measuredAt,
    ...gateArtifacts.map((artifact) =>
      optionalTimestamp(artifact.value.measuredAt) ?? measuredAt,
    ),
  ]);
  const windowEndedAt = latestTimestamp([
    measuredAt,
    ...gateArtifacts.map((artifact) =>
      optionalTimestamp(artifact.value.measuredAt) ?? measuredAt,
    ),
  ]);
  const checkSet = {
    schemaVersion: "gate-checks-v1",
    gate: "market-analysis-launch",
    measurementClass: "candidate",
    measuredAt,
    windowStartedAt,
    windowEndedAt,
    sampleCount:
      ANALYST_NEEDS_TRACEABILITY.length +
      analystNeedScenarios.length +
      accessibility.length +
      annualResultInvariance.length +
      durableJourneys.length +
      originBenchmarks.length +
      browserLab.products.reduce(
        (total, product) => total + product.trials.length,
        0,
      ) +
      browserLab.launchMatrix.trials.length +
      contracts.length,
    checks: [
      { name: "product-contract", status: "accepted" },
      { name: "analyst-needs", status: "accepted" },
      { name: "accessibility", status: "accepted" },
      { name: "annual-result-invariance", status: "accepted" },
      { name: "performance", status: "accepted" },
      { name: "retained-replay", status: "accepted" },
      { name: "startup-smoke", status: "accepted" },
      { name: "rollback", status: "accepted" },
    ],
    additionalRetainedLogs: retainedArtifacts.map(({ path, sha256 }) => ({
      path,
      sha256,
    })),
  };
  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR;
  const outPath = `${outDir}/market-analysis-launch.checks.json`;
  await writeReport(
    outPath,
    Buffer.from(`${JSON.stringify(checkSet, null, 2)}\n`),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "market-analysis-launch-measurement-report-v1",
        status: "accepted",
        out: outPath,
        evidence: evidencePath,
        productContractVersion: PRODUCT_CONTRACT_VERSION,
        activeDeploymentPairingId: identity.deploymentPairingId,
        analystNeeds: analystNeeds.counts,
        analystNeedScenarios: analystNeedScenarios.length,
        accessibilityCases: accessibility.length,
        durableJourneyCases: durableJourneys.length,
        recentMomentumStates: RECENT_MOMENTUM_LAUNCH_STATES.length,
        originBenchmarkCases: originBenchmarks.length,
        browserTrials: browserLab.products.reduce(
          (total, product) => total + product.trials.length,
          0,
        ),
        browserLaunchMatrixContexts: browserLab.launchMatrix.trials.length,
      },
      null,
      2,
    )}\n`,
  );
}

async function measureAnalystNeeds(
  acceptedScenarios: readonly { id: string; status: string }[],
) {
  const counts = { DIRECT: 0, BOUNDED: 0, OUTSIDE: 0 };
  const expectedIds = Array.from(
    { length: 20 },
    (_, index) => `AQ-${String(index + 1).padStart(2, "0")}`,
  );
  const ids = ANALYST_NEEDS_TRACEABILITY.map((row) => row.id).sort();
  const acceptedScenarioIds = new Set(
    acceptedScenarios
      .filter((scenario) => scenario.status === "accepted")
      .map((scenario) => scenario.id),
  );
  if (
    ANALYST_NEEDS_TRACEABILITY.length !== 20 ||
    new Set(ids).size !== 20 ||
    ids.some((id, index) => id !== expectedIds[index])
  ) {
    throw invalid("Analyst-needs evidence must preserve exactly AQ-01..AQ-20.");
  }
  for (const row of ANALYST_NEEDS_TRACEABILITY) {
    counts[row.coverage] += 1;
    if (
      row.need.trim().length === 0 ||
      row.limitation.trim().length === 0 ||
      row.capabilities.length === 0 ||
      row.scenarioIds.length === 0 ||
      row.scenarioIds.some(
        (scenarioId) => !acceptedScenarioIds.has(scenarioId),
      )
    ) {
      throw invalid(`Analyst-needs row ${row.id} is incomplete.`);
    }
  }
  if (
    counts.DIRECT !== 10 ||
    counts.BOUNDED !== 5 ||
    counts.OUTSIDE !== 5
  ) {
    throw invalid("Analyst-needs coverage must remain exactly 10/5/5.");
  }

  const sourcePaths = await sourceFiles(resolve(REPO_ROOT, "src"));
  const violations: string[] = [];
  for (const path of sourcePaths) {
    const source = await readFile(path, "utf8");
    if (
      /market-analysis-analyst-needs/u.test(source) ||
      MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS.some((pattern) =>
        pattern.test(source),
      )
    ) {
      violations.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  if (violations.length > 0) {
    throw invalid(
      `Analyst-question machinery leaked into production source: ${violations.join(", ")}.`,
    );
  }
  return {
    status: "accepted",
    counts,
    productionSourceFilesScanned: sourcePaths.length,
    productionLeakageViolations: violations,
    scenarios: acceptedScenarios,
    rows: ANALYST_NEEDS_TRACEABILITY,
  };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested
    .flat()
    .filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

function verifyOriginReport(
  value: Record<string, unknown>,
  identity: PromotionIdentity,
) {
  schema(value, "origin-benchmark-report-v1", "origin benchmark report");
  candidateMeasurement(value, "origin benchmark report");
  verifyPerformanceIdentity(value.identity, identity, "origin benchmark report");
  const benchmarks = array(value.originBenchmarks, "origin benchmarks").map(
    (entry, index) => object(entry, `origin benchmark ${index + 1}`),
  );
  const result: Record<string, unknown>[] = [];
  for (const operation of [
    "market-analysis-uncached",
    "market-analysis-process-hit",
  ]) {
    for (const productRole of [
      "sparse",
      "median",
      "upper-quartile",
      "maximum-row",
    ]) {
      const matches = benchmarks.filter(
        (benchmark) =>
          benchmark.operation === operation &&
          benchmark.productRole === productRole,
      );
      if (matches.length !== 1) {
        throw invalid(
          `Origin report requires exactly one ${operation}/${productRole} result.`,
        );
      }
      const benchmark = matches[0]!;
      const limits =
        operation === "market-analysis-uncached"
          ? { p95Ms: 2_500, p99Ms: 5_000, maximumRouteMs: 12_000 }
          : { p95Ms: 100, p99Ms: 250, maximumRouteMs: 2_000 };
      const p95Ms = nonnegativeNumber(benchmark.p95Ms, "origin p95");
      const p99Ms = nonnegativeNumber(benchmark.p99Ms, "origin p99");
      const maximumRouteMs = nonnegativeNumber(
        benchmark.maximumRouteMs,
        "origin maximum route time",
      );
      const resultBytes = positiveNumber(
        benchmark.payloadBytes,
        "origin result bytes",
      );
      const compressedResultBytes = positiveNumber(
        benchmark.compressedPayloadBytes,
        "origin compressed result bytes",
      );
      if (
        positiveNumber(benchmark.warmupSamples, "origin warmup samples") < 5 ||
        positiveNumber(benchmark.timedSamples, "origin timed samples") < 100 ||
        benchmark.cacheStatesVerified !== true ||
        benchmark.errors !== 0 ||
        benchmark.timeouts !== 0 ||
        p95Ms > limits.p95Ms ||
        p99Ms > limits.p99Ms ||
        maximumRouteMs > limits.maximumRouteMs ||
        compressedResultBytes > 300 * 1024
      ) {
        throw invalid(
          `${operation}/${productRole} does not preserve the accepted benchmark profile.`,
        );
      }
      if (resultBytes >= 1024 * 1024) {
        throw invalid(
          `${operation}/${productRole} Market Analysis result must remain below 1048576 bytes.`,
        );
      }
      result.push({
        operation,
        productRole,
        warmupSamples: benchmark.warmupSamples,
        timedSamples: benchmark.timedSamples,
        p50Ms: nonnegativeNumber(benchmark.p50Ms, "origin p50"),
        p75Ms: nonnegativeNumber(benchmark.p75Ms, "origin p75"),
        p95Ms,
        p99Ms,
        maximumRouteMs,
        resultBytes,
        compressedResultBytes,
      });
    }
  }
  return result;
}

function verifyBrowserReport(
  value: Record<string, unknown>,
  identity: PromotionIdentity,
) {
  schema(value, "browser-lab-report-v1", "browser-lab report");
  candidateMeasurement(value, "browser-lab report");
  verifyPerformanceIdentity(value.identity, identity, "browser-lab report");
  const products = object(value.products, "browser-lab products");
  const verifiedProducts = (["median", "maximum-row"] as const).map((productRole) => {
    const product = object(
      products[productRole],
      `browser-lab ${productRole} product`,
    );
    const trials = array(
      product.trials,
      `browser-lab ${productRole} trials`,
    ).map((entry, index) => {
      const trial = object(entry, `${productRole} browser trial ${index + 1}`);
      const metrics = object(
        trial.metrics,
        `${productRole} browser trial ${index + 1} metrics`,
      );
      const diagnostics = object(
        trial.diagnostics,
        `${productRole} browser trial ${index + 1} diagnostics`,
      );
      if (
        trial.status !== "measured" ||
        array(trial.violations, "browser trial violations").length !== 0
      ) {
        throw invalid(`${productRole} browser trial ${index + 1} failed.`);
      }
      return {
        trialIndex: trial.trialIndex,
        marketAnalysisToCompleteMs: positiveNumber(
          metrics.marketAnalysisToCompleteMs,
          "Market Analysis completion time",
        ),
        marketAnalysisOpenInteractionToNextPaintMs: nonnegativeNumber(
          diagnostics.marketAnalysisOpenInteractionToNextPaintMs,
          "Market Analysis interaction latency",
        ),
      };
    });
    if (
      positiveNumber(product.measuredTrialCount, "measured browser trials") <
        5 ||
      product.failedTrialCount !== 0 ||
      trials.length < 5
    ) {
      throw invalid(
        `${productRole} browser evidence requires at least five successful trials.`,
      );
    }
    return { productRole, trials };
  });
  const launchMatrix = object(
    value.launchMatrix,
    "browser launch matrix",
  );
  const observedContexts = new Set<string>();
  const matrixTrials = array(
    launchMatrix.trials,
    "browser launch matrix trials",
  ).map((entry, index) => {
    const trial = object(entry, `browser launch matrix trial ${index + 1}`);
    const locale = trial.locale;
    if (locale !== "en" && locale !== "zh-Hans") {
      throw invalid(`Browser launch matrix trial ${index + 1} has an invalid locale.`);
    }
    const viewport = object(
      trial.viewport,
      `browser launch matrix trial ${index + 1} viewport`,
    );
    const width = positiveNumber(
      viewport.width,
      `browser launch matrix trial ${index + 1} viewport width`,
    );
    const height = positiveNumber(
      viewport.height,
      `browser launch matrix trial ${index + 1} viewport height`,
    );
    const context = browserLaunchMatrixContextKey(locale, { width, height });
    if (observedContexts.has(context)) {
      throw invalid(`Browser launch matrix context ${context} is duplicated.`);
    }
    observedContexts.add(context);
    const outcome = object(
      trial.outcome,
      `browser launch matrix trial ${index + 1} outcome`,
    );
    if (
      outcome.status !== "measured" ||
      array(
        outcome.violations,
        `browser launch matrix trial ${index + 1} violations`,
      ).length !== 0
    ) {
      throw invalid(`Browser launch matrix trial ${context} failed.`);
    }
    const metrics = object(
      outcome.metrics,
      `browser launch matrix trial ${index + 1} metrics`,
    );
    const lcpMs = nonnegativeNumber(
      metrics.lcpMs,
      `browser launch matrix trial ${context} LCP`,
    );
    const interactionToNextPaintMs = nonnegativeNumber(
      metrics.interactionToNextPaintMs,
      `browser launch matrix trial ${context} interaction latency`,
    );
    if (
      lcpMs > BROWSER_LAUNCH_MATRIX_LIMITS.lcpMs ||
      interactionToNextPaintMs >
        BROWSER_LAUNCH_MATRIX_LIMITS.interactionToNextPaintMs
    ) {
      throw invalid(`Browser launch matrix trial ${context} misses its LCP or INP target.`);
    }
    return { locale, viewport: { width, height }, lcpMs, interactionToNextPaintMs };
  });
  if (
    launchMatrix.failedTrialCount !== 0 ||
    launchMatrix.measuredTrialCount !==
      REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS.length ||
    matrixTrials.length !== REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS.length ||
    REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS.some(
      (context) => !observedContexts.has(context),
    )
  ) {
    throw invalid(
      "Browser launch matrix must contain successful evidence for both locales and all five target viewports.",
    );
  }
  return {
    products: verifiedProducts,
    launchMatrix: {
      productRole: launchMatrix.productRole,
      trials: matrixTrials,
    },
  };
}

function verifyTargetLoadReport(
  value: Record<string, unknown>,
  identity: PromotionIdentity,
) {
  schema(value, "mixed-load-report-v1", "target-load report");
  candidateMeasurement(value, "target-load report");
  verifyPerformanceIdentity(value.identity, identity, "target-load report");
  const target = object(value.targetLoad, "target-load measurements");
  const routeMix = object(target.routeMix, "target-load route mix");
  if (
    target.includesMarketAnalysis !== true ||
    target.includesTradeExplorer !== true ||
    target.includesMaximumRowProduct !== true ||
    target.cacheStatesVerified !== true ||
    target.queueRejections !== 0 ||
    target.unretryableErrors !== 0 ||
    target.timeouts !== 0 ||
    target.sessions !== 20 ||
    target.sustainedRequestsPerSecond !== 4 ||
    target.sustainedSeconds !== 600 ||
    target.analysisHotKeyFraction !== 0.8 ||
    target.analysisUncachedKeyFraction !== 0.2 ||
    target.burstRequestsPerSecond !== 10 ||
    target.burstSeconds !== 30 ||
    target.coordinatedDistinctKeys !== 4 ||
    target.coordinatedBurstIntervalSeconds !== 60 ||
    routeMix.currentManifest !== 0.1 ||
    routeMix.search !== 0.25 ||
    routeMix.analysis !== 0.55 ||
    routeMix.csv !== 0.1
  ) {
    throw invalid(
      "Target-load report does not preserve the accepted 20-session, 4-rps, 10-minute, 10/25/55/10 workload, 80/20 analysis keys, and coordinated burst shape with Market Analysis.",
    );
  }
  return target;
}

function verifyLifecycleReport(
  value: Record<string, unknown>,
  identity: PromotionIdentity,
) {
  schema(value, "lifecycle-drill-report-v1", "lifecycle report");
  candidateMeasurement(value, "lifecycle report");
  verifyIdentity(value.identity, identity, "lifecycle report");
  const rollback = object(
    object(value.drills, "lifecycle drills").rollback,
    "rollback drill",
  );
  const measuredMs = positiveNumber(
    rollback.measuredMs,
    "rollback measured time",
  );
  const limitMs = positiveNumber(rollback.limitMs, "rollback time limit");
  if (rollback.status !== "accepted" || measuredMs > limitMs) {
    throw invalid("Lifecycle report does not contain an accepted rollback.");
  }

  const images = object(rollback.applicationImages, "rollback application images");
  const beforeImage = rollbackImage(images.before, "before rollback image");
  const successorImage = rollbackImage(
    images.successor,
    "successor rollback image",
  );
  const restoredImage = rollbackImage(
    images.restored,
    "restored rollback image",
  );
  if (
    restoredImage.digest !== beforeImage.digest ||
    restoredImage.buildId !== beforeImage.buildId ||
    successorImage.digest === beforeImage.digest ||
    successorImage.buildId === beforeImage.buildId ||
    successorImage.buildId !== identity.buildId
  ) {
    throw invalid(
      "Rollback application-image proof must restore the exact prior digest and build after serving the distinct candidate image.",
    );
  }

  const deployments = object(
    rollback.deployments,
    "rollback release deployments",
  );
  const beforeDeployment = rollbackDeployment(
    deployments.before,
    "before rollback deployment",
  );
  const successorDeployment = rollbackDeployment(
    deployments.successor,
    "successor rollback deployment",
  );
  const restoredDeployment = rollbackDeployment(
    deployments.restored,
    "restored rollback deployment",
  );
  for (const field of ROLLBACK_DEPLOYMENT_FIELDS) {
    if (restoredDeployment[field] !== beforeDeployment[field]) {
      throw invalid(
        `Rollback restored deployment ${field} does not match the prior deployment.`,
      );
    }
    if (successorDeployment[field] !== identity[field]) {
      throw invalid(
        `Rollback successor deployment ${field} does not match the candidate identity.`,
      );
    }
  }
  if (
    successorDeployment.deploymentPairingId !== identity.deploymentPairingId
  ) {
    throw invalid(
      "Rollback successor deployment pairing does not match the candidate identity.",
    );
  }
  if (
    successorDeployment.sourceStatusSnapshotId !==
    identity.sourceStatusSnapshotId
  ) {
    throw invalid(
      "Rollback successor Source Freshness Status does not match the candidate identity.",
    );
  }
  if (
    restoredDeployment.deploymentPairingId ===
      beforeDeployment.deploymentPairingId ||
    restoredDeployment.deploymentPairingId ===
      successorDeployment.deploymentPairingId
  ) {
    throw invalid(
      "Rollback must publish a distinct deployment pairing for the restored release.",
    );
  }
  if (
    restoredDeployment.sourceStatusSnapshotId ===
      beforeDeployment.sourceStatusSnapshotId ||
    restoredDeployment.sourceStatusSnapshotId ===
      successorDeployment.sourceStatusSnapshotId
  ) {
    throw invalid(
      "Rollback must publish a distinct Source Freshness Status for the restored deployment.",
    );
  }
  if (
    successorDeployment.deploymentPairingId ===
    beforeDeployment.deploymentPairingId
  ) {
    throw invalid(
      "Rollback proof requires distinct prior and successor deployment pairings.",
    );
  }

  const productContract = object(
    rollback.restoredProductContract,
    "restored Market Analysis product contract",
  );
  const constituentRecipes = array(
    productContract.constituentRecipes,
    "restored Market Analysis constituent recipes",
  ).map((recipe, index) =>
    nonemptyString(recipe, `restored constituent recipe ${index + 1}`),
  );
  if (
    productContract.status !== "accepted" ||
    productContract.schemaVersion !== PRODUCT_CONTRACT_VERSION ||
    productContract.candidateMarketStatus !== 200 ||
    productContract.marketAnalysisStatus !== 200 ||
    productContract.deploymentPairingId !==
      restoredDeployment.deploymentPairingId ||
    productContract.analysisBuildId !== restoredDeployment.analysisBuildId ||
    constituentRecipes.length !== MARKET_ANALYSIS_CONSTITUENT_RECIPES.length ||
    MARKET_ANALYSIS_CONSTITUENT_RECIPES.some(
      (recipe) => !constituentRecipes.includes(recipe),
    )
  ) {
    throw invalid(
      "Rollback proof does not restore the complete market-analysis-v1 product contract.",
    );
  }

  const restoredDeploymentActivation = object(
    rollback.restoredDeploymentActivation,
    "restored deployment activation",
  );
  if (
    restoredDeploymentActivation.deploymentActivationMode !== "current" ||
    restoredDeploymentActivation.rollbackActive !== true ||
    restoredDeploymentActivation.sourceStatusSnapshotId !==
      restoredDeployment.sourceStatusSnapshotId
  ) {
    throw invalid(
      "Rollback proof does not preserve the restored deployment activation and Source Freshness Status.",
    );
  }

  return {
    status: "accepted",
    measuredMs,
    limitMs,
    method: nonemptyString(rollback.method, "rollback method"),
    applicationImages: {
      before: beforeImage,
      successor: successorImage,
      restored: restoredImage,
    },
    deployments: {
      before: beforeDeployment,
      successor: successorDeployment,
      restored: restoredDeployment,
    },
    restoredProductContract: {
      status: "accepted",
      schemaVersion: PRODUCT_CONTRACT_VERSION,
      candidateMarketStatus: 200,
      marketAnalysisStatus: 200,
      deploymentPairingId: restoredDeployment.deploymentPairingId,
      analysisBuildId: restoredDeployment.analysisBuildId,
      constituentRecipes,
    },
    restoredDeploymentActivation: {
      deploymentActivationMode: "current",
      rollbackActive: true,
      sourceStatusSnapshotId: restoredDeployment.sourceStatusSnapshotId,
    },
  };
}

function rollbackImage(value: unknown, label: string) {
  const image = object(value, label);
  const digest = nonemptyString(image.digest, `${label} digest`);
  if (!ROLLBACK_IMAGE_DIGEST.test(digest)) {
    throw invalid(`${label} digest must be an immutable SHA-256 image digest.`);
  }
  return {
    digest,
    buildId: nonemptyString(image.buildId, `${label} buildId`),
  };
}

function rollbackDeployment(value: unknown, label: string) {
  const deployment = object(value, label);
  return {
    deploymentPairingId: nonemptyString(
      deployment.deploymentPairingId,
      `${label} deploymentPairingId`,
    ),
    analysisBuildId: nonemptyString(
      deployment.analysisBuildId,
      `${label} analysisBuildId`,
    ),
    productSearchBuildId: nonemptyString(
      deployment.productSearchBuildId,
      `${label} productSearchBuildId`,
    ),
    artifactSha256: nonemptyString(
      deployment.artifactSha256,
      `${label} artifactSha256`,
    ),
    sourceStatusSnapshotId: nonemptyString(
      deployment.sourceStatusSnapshotId,
      `${label} sourceStatusSnapshotId`,
    ),
  };
}

function verifyAcceptedGate(
  artifact: RetainedArtifact,
  gate: (typeof REQUIRED_GATE_IDS)[number],
  identity: PromotionIdentity,
): void {
  const report = artifact.value;
  schema(report, `${gate}-report-v1`, `${gate} gate report`);
  if (
    report.gate !== gate ||
    report.status !== "accepted" ||
    report.measurementClass !== "candidate"
  ) {
    throw invalid(`${gate} gate report is not accepted candidate evidence.`);
  }
  verifyIdentity(report.identity, identity, `${gate} gate report`);

  const observedChecks = new Set<string>();
  for (const [index, value] of array(
    report.checks,
    `${gate} gate checks`,
  ).entries()) {
    const check = object(value, `${gate} gate check ${index + 1}`);
    const name = nonemptyString(check.name, `${gate} gate check name`);
    if (check.status !== "accepted" || observedChecks.has(name)) {
      throw invalid(
        `${gate} gate check ${name} is not uniquely accepted candidate evidence.`,
      );
    }
    observedChecks.add(name);
  }
  for (const name of PROMOTION_GATE_REQUIRED_CHECKS[gate]) {
    if (!observedChecks.has(name)) {
      throw invalid(`${gate} gate report is missing required check ${name}.`);
    }
  }
}

function verifyVitestReport(
  value: Record<string, unknown>,
  requiredTests: readonly { id: string; title: string }[],
) {
  const observed = new Map<string, boolean>();
  for (const result of array(value.testResults, "Vitest test results")) {
    const testFile = object(result, "Vitest test file");
    for (const assertion of array(
      testFile.assertionResults,
      "Vitest assertion results",
    )) {
      const test = object(assertion, "Vitest assertion");
      const title =
        typeof test.fullName === "string"
          ? test.fullName
          : typeof test.title === "string"
            ? test.title
            : "";
      const passed = test.status === "passed" || test.status === "pass";
      for (const id of launchEvidenceIds(title)) {
        recordLaunchEvidenceOutcome(observed, id, passed);
      }
    }
  }
  return requiredTests.map((requiredTest) => {
    if (observed.get(requiredTest.id) !== true) {
      throw invalid(
        `Required contract test did not pass exactly once: ${requiredTest.id}.`,
      );
    }
    return {
      id: requiredTest.id,
      title: requiredTest.title,
      status: "accepted",
    };
  });
}

function verifyPlaywrightReport(
  value: Record<string, unknown>,
  requiredTests: readonly { id: string; title: string }[],
) {
  const observed = new Map<string, boolean>();
  collectPlaywrightSpecs(value, observed);
  return requiredTests.map((requiredTest) => {
    if (observed.get(requiredTest.id) !== true) {
      throw invalid(
        `Required browser test did not pass exactly once: ${requiredTest.id}.`,
      );
    }
    return {
      id: requiredTest.id,
      title: requiredTest.title,
      status: "accepted",
    };
  });
}

function collectPlaywrightSpecs(
  value: unknown,
  observed: Map<string, boolean>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlaywrightSpecs(item, observed);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.specs)) {
    for (const rawSpec of record.specs) {
      const spec = object(rawSpec, "Playwright spec");
      if (typeof spec.title !== "string") {
        continue;
      }
      const tests = array(spec.tests, "Playwright spec tests");
      const passed =
        spec.ok === true &&
        tests.length > 0 &&
        tests.every((rawTest) => {
          const test = object(rawTest, "Playwright test");
          const results = array(test.results, "Playwright test results");
          const final = results.at(-1);
          return (
            test.status === "expected" &&
            final !== undefined &&
            object(final, "Playwright final result").status === "passed"
          );
        });
      for (const id of launchEvidenceIds(spec.title)) {
        recordLaunchEvidenceOutcome(observed, id, passed);
      }
    }
  }

  for (const nested of Object.values(record)) {
    collectPlaywrightSpecs(nested, observed);
  }
}

function launchEvidenceIds(title: string): string[] {
  return [...title.matchAll(LAUNCH_EVIDENCE_ID_PATTERN)].map(
    (match) => match[1]!,
  );
}

function recordLaunchEvidenceOutcome(
  observed: Map<string, boolean>,
  id: string,
  passed: boolean,
): void {
  observed.set(id, !observed.has(id) && passed);
}

function requiredContract(
  contracts: readonly { id: string; title: string; status: string }[],
  id: string,
) {
  const contract = contracts.find((candidate) => candidate.id === id);
  if (contract === undefined) {
    throw invalid(`Required contract evidence ${id} is missing.`);
  }
  return contract;
}

function parseCandidateConfig(value: Record<string, unknown>) {
  schema(value, "promotion-candidate-config-v1", "candidate config");
  return parseIdentity(value.identity, "candidate config identity");
}

const IDENTITY_FIELDS = [
  "fixtureManifestSha256",
  "buildId",
  "baciRelease",
  "analysisBuildId",
  "productSearchBuildId",
  "artifactSha256",
  "deploymentPairingId",
  "sourceStatusSnapshotId",
  "machineId",
  "machineClass",
  "region",
] as const;

const PERFORMANCE_IDENTITY_FIELDS = [
  "fixtureManifestSha256",
  "buildId",
  "baciRelease",
  "analysisBuildId",
  "productSearchBuildId",
  "artifactSha256",
  "machineId",
  "machineClass",
  "region",
] as const;

function parseIdentity(value: unknown, label: string): PromotionIdentity {
  const input = object(value, label);
  const output = {} as Record<string, string>;
  for (const field of IDENTITY_FIELDS) {
    output[field] = nonemptyString(input[field], `${label} ${field}`);
  }
  return output as PromotionIdentity;
}

function verifyIdentity(
  value: unknown,
  expected: PromotionIdentity,
  label: string,
): void {
  const actual = parseIdentity(value, `${label} identity`);
  for (const field of IDENTITY_FIELDS) {
    if (actual[field] !== expected[field]) {
      throw invalid(`${label} ${field} does not match the candidate identity.`);
    }
  }
}

function verifyPerformanceIdentity(
  value: unknown,
  expected: PromotionIdentity,
  label: string,
): void {
  const actual = object(value, `${label} identity`);
  for (const field of PERFORMANCE_IDENTITY_FIELDS) {
    if (actual[field] !== expected[field]) {
      throw invalid(`${label} ${field} does not match the candidate identity.`);
    }
  }
}

function candidateMeasurement(
  value: Record<string, unknown>,
  label: string,
): void {
  if (
    value.measurementClass !== "candidate" ||
    (value.status !== undefined && value.status !== "measurement-complete")
  ) {
    throw invalid(`${label} must be completed candidate evidence.`);
  }
}

async function readArtifact(
  path: string,
  label: string,
): Promise<RetainedArtifact> {
  if (
    !path.startsWith("reports/") ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    throw invalid(`${label} path must be reports-relative.`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(join(REPO_ROOT, path));
  } catch {
    throw invalid(`${label} could not be read at ${path}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalid(`${label} is not valid JSON.`);
  }
  return {
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    value: object(value, label),
  };
}

async function writeReport(path: string, bytes: Buffer): Promise<void> {
  if (
    !path.startsWith("reports/") ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    throw invalid("Output paths must be reports-relative.");
  }
  const absolute = join(REPO_ROOT, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
}

function artifactReference(artifact: {
  path: string;
  bytes: number;
  sha256: string;
}) {
  return {
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  };
}

function uniqueArtifacts(
  artifacts: readonly RetainedArtifact[],
): RetainedArtifact[] {
  const result = new Map<string, RetainedArtifact>();
  for (const artifact of artifacts) {
    result.set(artifact.path, artifact);
  }
  return [...result.values()];
}

function uniqueReferences<
  Reference extends { path: string; bytes: number; sha256: string },
>(references: readonly Reference[]): Reference[] {
  const result = new Map<string, Reference>();
  for (const reference of references) {
    result.set(reference.path, reference);
  }
  return [...result.values()];
}

function schema(
  value: Record<string, unknown>,
  expected: string,
  label: string,
): void {
  if (value.schemaVersion !== expected) {
    throw invalid(`${label} schemaVersion must be ${expected}.`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalid(`${label} must be an array.`);
  }
  return value;
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw invalid(`--${label} is required.`);
  }
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${label} must be a nonempty string.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${label} must be a positive finite number.`);
  }
  return value;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalid(`${label} must be a nonnegative finite number.`);
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return utcSecondTimestamp(value);
}

function utcTimestamp(value: string, label: string): string {
  const timestamp = optionalTimestamp(value);
  if (timestamp === null) {
    throw invalid(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function earliestTimestamp(values: readonly string[]): string {
  return utcSecondTimestamp(
    Math.min(...values.map((value) => Date.parse(value))),
  );
}

function latestTimestamp(values: readonly string[]): string {
  return utcSecondTimestamp(
    Math.max(...values.map((value) => Date.parse(value))),
  );
}

function utcSecondTimestamp(value: string | number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function invalid(message: string): MarketAnalysisLaunchEvidenceError {
  return new MarketAnalysisLaunchEvidenceError(message);
}
