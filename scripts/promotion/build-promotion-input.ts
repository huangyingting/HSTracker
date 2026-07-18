import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  buildGate,
  buildPromotionInput,
  reviewRequiredChecks,
  type BuiltGate,
  type GateCheckResult,
  type GateMeasurementClass,
} from "../../src/promotion/gate-report";
import { loadPromotionEvaluation } from "../../src/promotion/promotion-acceptance";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import type {
  PromotionGateId,
  PromotionIdentity,
  PromotionReportInput,
} from "../../src/promotion/promotion-report";

const REPO_ROOT = process.cwd();
const DEFAULT_REPORTS_DIR = "reports/promotion/candidate/gates";
const DEFAULT_OUT = "reports/promotion/candidate/promotion-input.json";
const DEFAULT_CHECKS_DIR = "reports/promotion/candidate/checks";

class BuildPromotionInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BuildPromotionInputError";
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof BuildPromotionInputError
      ? error.code
      : "BUILD_PROMOTION_INPUT_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Building the promotion input failed with an unknown error.";
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "checks-dir": { type: "string" },
      "reports-dir": { type: "string" },
      out: { type: "string" },
      "evaluated-at": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const configPath = required(values.config, "config");
  const checksDir = values["checks-dir"] ?? DEFAULT_CHECKS_DIR;
  const reportsDir = values["reports-dir"] ?? DEFAULT_REPORTS_DIR;
  const outPath = values.out ?? DEFAULT_OUT;

  const config = await readConfig(configPath);
  const checkSets = await readCheckSets(checksDir);

  const measuredTimestamps = [...checkSets.values()].map(
    (set) => set.measuredAt,
  );
  const evaluatedAt = latestTimestamp([
    values["evaluated-at"] ?? nowUtc(),
    ...measuredTimestamps,
  ]);

  const gates: BuiltGate[] = [];
  for (const gate of Object.keys(
    PROMOTION_GATE_REQUIRED_CHECKS,
  ) as PromotionGateId[]) {
    const reportPath = `${reportsDir}/${gate}.json`;
    const measured = checkSets.get(gate);
    const built = measured
      ? buildGate({
          gate,
          identity: config.identity,
          measurementClass: measured.measurementClass,
          checks: measured.checks,
          reportPath,
          measuredAt: measured.measuredAt,
          windowStartedAt: measured.windowStartedAt,
          windowEndedAt: measured.windowEndedAt,
          sampleCount: measured.sampleCount,
          additionalRetainedLogs: measured.additionalRetainedLogs,
        })
      : buildGate({
          gate,
          identity: config.identity,
          measurementClass: "candidate",
          checks: reviewRequiredChecks(gate),
          reportPath,
          measuredAt: evaluatedAt,
          windowStartedAt: evaluatedAt,
          windowEndedAt: evaluatedAt,
          sampleCount: 1,
        });
    const absolute = join(REPO_ROOT, built.reportPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, built.reportJson);
    gates.push(built);
  }

  const input = buildPromotionInput({
    identity: config.identity,
    toolVersions: config.toolVersions,
    evaluatedAt,
    gates,
  });
  const absoluteOut = join(REPO_ROOT, outPath);
  await mkdir(dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, `${JSON.stringify(input, null, 2)}\n`);

  const { report } = await loadPromotionEvaluation(absoluteOut, REPO_ROOT);
  const blockedGates = gates
    .filter((gate) => gate.status !== "accepted")
    .map((gate) => ({ gate: gate.gate, status: gate.status }));
  const measuredGates = [...checkSets.keys()].sort();

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "promotion-input-build-report-v1",
        out: outPath,
        evaluatedAt,
        status: report.status,
        gateCount: report.gateCount,
        measuredGates,
        blockedGates,
      },
      null,
      2,
    )}\n`,
  );
  if (report.status !== "accepted") {
    process.exitCode = 1;
  }
}

type PromotionCandidateConfig = {
  identity: PromotionIdentity;
  toolVersions: PromotionReportInput["toolVersions"];
};

async function readConfig(path: string): Promise<PromotionCandidateConfig> {
  const value = parseJson(await readFile(path), `config ${path}`);
  const config = object(value, "config");
  if (config.schemaVersion !== "promotion-candidate-config-v1") {
    throw new BuildPromotionInputError(
      "PROMOTION_CONFIG_INVALID",
      "Promotion candidate config schemaVersion must be promotion-candidate-config-v1.",
    );
  }
  return {
    identity: parseIdentity(object(config.identity, "config identity")),
    toolVersions: parseToolVersions(
      object(config.toolVersions, "config toolVersions"),
    ),
  };
}

type GateCheckSet = {
  gate: PromotionGateId;
  measurementClass: GateMeasurementClass;
  measuredAt: string;
  windowStartedAt: string;
  windowEndedAt: string;
  sampleCount: number;
  checks: GateCheckResult[];
  additionalRetainedLogs?: { path: string; sha256: string }[];
};

async function readCheckSets(
  checksDir: string,
): Promise<Map<PromotionGateId, GateCheckSet>> {
  const sets = new Map<PromotionGateId, GateCheckSet>();
  let entries: string[];
  try {
    entries = await readdir(join(REPO_ROOT, checksDir));
  } catch {
    return sets;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".checks.json")) {
      continue;
    }
    const value = parseJson(
      await readFile(join(REPO_ROOT, checksDir, entry)),
      `check set ${entry}`,
    );
    const set = parseCheckSet(value, entry);
    if (sets.has(set.gate)) {
      throw new BuildPromotionInputError(
        "PROMOTION_CHECKS_DUPLICATE",
        `Duplicate check set for gate ${set.gate}.`,
      );
    }
    sets.set(set.gate, set);
  }
  return sets;
}

function parseCheckSet(value: unknown, label: string): GateCheckSet {
  const set = object(value, `check set ${label}`);
  if (set.schemaVersion !== "gate-checks-v1") {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `Check set ${label} schemaVersion must be gate-checks-v1.`,
    );
  }
  const gate = set.gate;
  if (
    typeof gate !== "string" ||
    !(gate in PROMOTION_GATE_REQUIRED_CHECKS)
  ) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `Check set ${label} declares an unsupported gate.`,
    );
  }
  const measurementClass = set.measurementClass;
  if (measurementClass !== "candidate" && measurementClass !== "local-smoke") {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `Check set ${label} measurementClass is unsupported.`,
    );
  }
  if (!Array.isArray(set.checks)) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `Check set ${label} checks must be an array.`,
    );
  }
  return {
    gate: gate as PromotionGateId,
    measurementClass,
    measuredAt: utcTimestamp(set.measuredAt, `${label} measuredAt`),
    windowStartedAt: utcTimestamp(
      set.windowStartedAt,
      `${label} windowStartedAt`,
    ),
    windowEndedAt: utcTimestamp(set.windowEndedAt, `${label} windowEndedAt`),
    sampleCount: positiveInteger(set.sampleCount, `${label} sampleCount`),
    checks: set.checks.map((check, index) =>
      parseCheck(check, `${label} check ${index + 1}`),
    ),
    additionalRetainedLogs: parseAdditionalLogs(
      set.additionalRetainedLogs,
      label,
    ),
  };
}

function parseCheck(value: unknown, label: string): GateCheckResult {
  const check = object(value, label);
  if (typeof check.name !== "string" || check.name.length === 0) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `${label} name must be a non-empty string.`,
    );
  }
  if (
    check.status !== "accepted" &&
    check.status !== "review-required" &&
    check.status !== "blocked"
  ) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `${label} status is unsupported.`,
    );
  }
  return { name: check.name, status: check.status };
}

function parseAdditionalLogs(
  value: unknown,
  label: string,
): { path: string; sha256: string }[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `${label} additionalRetainedLogs must be an array.`,
    );
  }
  return value.map((entry, index) => {
    const log = object(entry, `${label} additionalRetainedLogs ${index + 1}`);
    if (typeof log.path !== "string" || !log.path.startsWith("reports/")) {
      throw new BuildPromotionInputError(
        "PROMOTION_CHECKS_INVALID",
        `${label} additionalRetainedLogs ${index + 1} path must be reports-relative.`,
      );
    }
    if (typeof log.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(log.sha256)) {
      throw new BuildPromotionInputError(
        "PROMOTION_CHECKS_INVALID",
        `${label} additionalRetainedLogs ${index + 1} sha256 is malformed.`,
      );
    }
    return { path: log.path, sha256: log.sha256 };
  });
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

function parseIdentity(value: Record<string, unknown>): PromotionIdentity {
  const identity = {} as Record<string, string>;
  for (const field of IDENTITY_FIELDS) {
    const candidate = value[field];
    if (typeof candidate !== "string" || candidate.length === 0) {
      throw new BuildPromotionInputError(
        "PROMOTION_CONFIG_INVALID",
        `Config identity ${field} must be a non-empty string.`,
      );
    }
    identity[field] = candidate;
  }
  return identity as unknown as PromotionIdentity;
}

const TOOL_FIELDS = ["node", "npm", "next", "duckdb", "playwright"] as const;

function parseToolVersions(
  value: Record<string, unknown>,
): PromotionReportInput["toolVersions"] {
  const versions = {} as Record<string, string>;
  for (const field of TOOL_FIELDS) {
    const candidate = value[field];
    if (typeof candidate !== "string" || candidate.length === 0) {
      throw new BuildPromotionInputError(
        "PROMOTION_CONFIG_INVALID",
        `Config toolVersions ${field} must be a non-empty string.`,
      );
    }
    versions[field] = candidate;
  }
  return versions as unknown as PromotionReportInput["toolVersions"];
}

function latestTimestamp(timestamps: readonly string[]): string {
  return timestamps.reduce((latest, current) =>
    Date.parse(current) > Date.parse(latest) ? current : latest,
  );
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new BuildPromotionInputError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildPromotionInputError(
      "PROMOTION_INPUT_MALFORMED",
      `${label} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new BuildPromotionInputError(
      "PROMOTION_INPUT_MALFORMED",
      `${label} is not valid JSON.`,
    );
  }
}

function utcTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BuildPromotionInputError(
      "PROMOTION_CHECKS_INVALID",
      `${label} must be a positive integer.`,
    );
  }
  return value;
}
