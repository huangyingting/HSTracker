import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { PromotionIdentity } from "../../src/promotion/promotion-report";
import {
  MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  MARKET_ANALYSIS_LAUNCH_CONTRACT_CASES,
  RECENT_MOMENTUM_LAUNCH_STATES,
} from "../../tests/support/market-analysis-launch-matrix";
import { ANALYST_NEEDS_TRACEABILITY } from "../../tests/support/market-analysis-analyst-needs";

const REPO_ROOT = process.cwd();
const DEFAULT_GATES_DIR = "reports/promotion/candidate/gates";
const DEFAULT_OUT_DIR = "reports/promotion/candidate/checks";
const DEFAULT_EVIDENCE =
  "reports/promotion/candidate/evidence/market-analysis-launch-readiness.json";
const PRODUCT_CONTRACT_VERSION = "market-analysis-v1";

const REQUIRED_GATE_IDS = [
  "origin-benchmarks",
  "browser-lab",
  "target-load",
  "external-smoke-and-observability",
  "lifecycle-and-recovery",
] as const;

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

  const analystNeeds = await measureAnalystNeeds();
  const accessibility = verifyPlaywrightReport(
    accessibilityArtifact.value,
    MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  );
  const annualResultInvariance = verifyPlaywrightReport(
    accessibilityArtifact.value,
    [MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE],
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
    annualResultInvariance: {
      status: "accepted",
      case: annualResultInvariance[0],
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
      browserLab,
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
      contract: requiredContract(contracts, "rollback"),
      drill: rollback,
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
      accessibility.length +
      annualResultInvariance.length +
      originBenchmarks.length +
      browserLab.reduce((total, product) => total + product.trials.length, 0) +
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
        accessibilityCases: accessibility.length,
        recentMomentumStates: RECENT_MOMENTUM_LAUNCH_STATES.length,
        originBenchmarkCases: originBenchmarks.length,
        browserTrials: browserLab.reduce(
          (total, product) => total + product.trials.length,
          0,
        ),
      },
      null,
      2,
    )}\n`,
  );
}

async function measureAnalystNeeds() {
  const counts = { DIRECT: 0, BOUNDED: 0, OUTSIDE: 0 };
  const expectedIds = Array.from(
    { length: 20 },
    (_, index) => `AQ-${String(index + 1).padStart(2, "0")}`,
  );
  const ids = ANALYST_NEEDS_TRACEABILITY.map((row) => row.id).sort();
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
      row.capabilities.length === 0
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
      /AQ-\d{2}/u.test(source) ||
      /market-analysis-analyst-needs/u.test(source) ||
      /AnalystQuestionId/u.test(source) ||
      /questionAnswers/u.test(source)
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
      if (
        positiveNumber(benchmark.warmupSamples, "origin warmup samples") < 5 ||
        positiveNumber(benchmark.timedSamples, "origin timed samples") < 100 ||
        benchmark.cacheStatesVerified !== true ||
        benchmark.errors !== 0 ||
        benchmark.timeouts !== 0
      ) {
        throw invalid(
          `${operation}/${productRole} does not preserve the accepted benchmark profile.`,
        );
      }
      result.push({
        operation,
        productRole,
        warmupSamples: benchmark.warmupSamples,
        timedSamples: benchmark.timedSamples,
        p50Ms: nonnegativeNumber(benchmark.p50Ms, "origin p50"),
        p75Ms: nonnegativeNumber(benchmark.p75Ms, "origin p75"),
        p95Ms: nonnegativeNumber(benchmark.p95Ms, "origin p95"),
        p99Ms: nonnegativeNumber(benchmark.p99Ms, "origin p99"),
        maximumRouteMs: nonnegativeNumber(
          benchmark.maximumRouteMs,
          "origin maximum route time",
        ),
        resultBytes: positiveNumber(
          benchmark.payloadBytes,
          "origin result bytes",
        ),
        compressedResultBytes: positiveNumber(
          benchmark.compressedPayloadBytes,
          "origin compressed result bytes",
        ),
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
  return (["median", "maximum-row"] as const).map((productRole) => {
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
    target.sustainedSeconds !== 600 ||
    routeMix.currentManifest !== 0.1 ||
    routeMix.search !== 0.25 ||
    routeMix.analysis !== 0.55 ||
    routeMix.csv !== 0.1
  ) {
    throw invalid(
      "Target-load report does not preserve the accepted 10-minute 10/25/55/10 workload with Market Analysis.",
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
  if (
    rollback.status !== "accepted" ||
    positiveNumber(rollback.measuredMs, "rollback measured time") <= 0
  ) {
    throw invalid("Lifecycle report does not contain an accepted rollback.");
  }
  return rollback;
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
}

function verifyVitestReport(
  value: Record<string, unknown>,
  requiredTests: readonly { id: string; title: string }[],
) {
  const observed = new Map<string, string>();
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
      if (title !== "") {
        observed.set(title, String(test.status));
      }
    }
  }
  return requiredTests.map((requiredTest) => {
    const matches = [...observed.entries()].filter(([title]) =>
      title.endsWith(requiredTest.title),
    );
    if (
      matches.length !== 1 ||
      (matches[0]![1] !== "passed" && matches[0]![1] !== "pass")
    ) {
      throw invalid(
        `Required contract test did not pass exactly once: ${requiredTest.title}.`,
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
    if (observed.get(requiredTest.title) !== true) {
      throw invalid(
        `Required browser test did not pass: ${requiredTest.title}.`,
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
      observed.set(spec.title, passed);
    }
  }
  for (const nested of Object.values(record)) {
    collectPlaywrightSpecs(nested, observed);
  }
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
  return new Date(value).toISOString();
}

function utcTimestamp(value: string, label: string): string {
  const timestamp = optionalTimestamp(value);
  if (timestamp === null) {
    throw invalid(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function earliestTimestamp(values: readonly string[]): string {
  return new Date(
    Math.min(...values.map((value) => Date.parse(value))),
  ).toISOString();
}

function latestTimestamp(values: readonly string[]): string {
  return new Date(
    Math.max(...values.map((value) => Date.parse(value))),
  ).toISOString();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function invalid(message: string): MarketAnalysisLaunchEvidenceError {
  return new MarketAnalysisLaunchEvidenceError(message);
}
