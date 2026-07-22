import {
  positiveSafeInteger,
  record,
} from "../deployment/value-validation";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "./acceptance-fixture";

const REQUIRED_GATES = [
  "source-and-domain",
  "origin-benchmarks",
  "browser-lab",
  "target-load",
  "coalescing-and-capacity",
  "http-cache-and-deadlines",
  "lifecycle-and-recovery",
  "deployment-resources",
  "external-smoke-and-observability",
  "recurring-cost",
  "market-analysis-launch",
] as const;

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

export type PromotionGateId = (typeof REQUIRED_GATES)[number];
export type PromotionEvidenceStatus =
  | "accepted"
  | "review-required"
  | "blocked";

export type PromotionIdentity = {
  fixtureManifestSha256: string;
  buildId: string;
  baciRelease: string;
  analysisBuildId: string;
  productSearchBuildId: string;
  artifactSha256: string;
  deploymentPairingId: string;
  sourceStatusSnapshotId: string;
  machineId: string;
  machineClass: string;
  region: string;
};

export type PromotionAttempt = {
  attemptedAt: string;
  status: PromotionEvidenceStatus;
  logSha256: string;
};

export type PromotionResolution = {
  resolvedAt: string;
  cause: string;
  buildId: string;
};

export type PromotionEvidence = {
  gate: PromotionGateId;
  schemaVersion: string;
  status: PromotionEvidenceStatus;
  identity: PromotionIdentity;
  reportSha256: string;
  measuredAt: string;
  windowStartedAt: string;
  windowEndedAt: string;
  sampleCount: number;
  retainedLogs: string[];
  attempts: PromotionAttempt[];
  resolution?: PromotionResolution;
};

export type PromotionReportInput = {
  schemaVersion: "production-promotion-input-v1";
  evaluatedAt: string;
  identity: PromotionIdentity;
  toolVersions: {
    node: string;
    npm: string;
    next: string;
    duckdb: string;
    playwright: string;
  };
  evidence: PromotionEvidence[];
};

export class PromotionReportInputError extends Error {
  readonly code = "PROMOTION_REPORT_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PromotionReportInputError";
  }
}

export function parsePromotionReportInput(
  value: unknown,
): PromotionReportInput {
  const input = object(value, "promotion input", [
    "schemaVersion",
    "evaluatedAt",
    "identity",
    "toolVersions",
    "evidence",
  ]);
  if (input.schemaVersion !== "production-promotion-input-v1") {
    throw new PromotionReportInputError(
      "Promotion input schema is incompatible.",
    );
  }
  return {
    schemaVersion: "production-promotion-input-v1",
    evaluatedAt: stringValue(
      input.evaluatedAt,
      "promotion evaluatedAt",
    ),
    identity: parseIdentity(input.identity, "promotion identity"),
    toolVersions: parseToolVersions(input.toolVersions),
    evidence: array(input.evidence, "promotion evidence").map(
      (evidence, index) =>
        parseEvidence(evidence, `promotion evidence ${index + 1}`),
    ),
  };
}

export function evaluatePromotionReport(input: PromotionReportInput) {
  if (input.schemaVersion !== "production-promotion-input-v1") {
    throw new PromotionReportInputError(
      "Promotion input schema is incompatible.",
    );
  }
  const evaluatedAt = utcTimestamp(
    input.evaluatedAt,
    "promotion evaluatedAt",
  );
  validateIdentity(input.identity, "promotion identity");
  const toolVersions = validateToolVersions(input.toolVersions);
  const evidenceByGate = new Map<
    PromotionGateId,
    PromotionEvidence
  >();
  for (const evidence of input.evidence) {
    if (!isPromotionGate(evidence.gate)) {
      throw new PromotionReportInputError(
        `Unsupported promotion gate ${String(evidence.gate)}.`,
      );
    }
    if (evidenceByGate.has(evidence.gate)) {
      throw new PromotionReportInputError(
        `Duplicate promotion evidence for ${evidence.gate}.`,
      );
    }
    evidenceByGate.set(evidence.gate, evidence);
  }

  const gates = REQUIRED_GATES.map((gate) => {
    const evidence = evidenceByGate.get(gate);
    if (evidence === undefined) {
      throw new PromotionReportInputError(
        `Missing promotion evidence for ${gate}.`,
      );
    }
    return evaluateEvidence(evidence, input.identity, evaluatedAt);
  });
  if (evidenceByGate.size !== REQUIRED_GATES.length) {
    throw new PromotionReportInputError(
      "Promotion input contains unsupported evidence.",
    );
  }

  const priorFailureCount = gates.reduce(
    (total, gate) => total + gate.priorFailureCount,
    0,
  );
  const unresolvedFailureCount = gates.reduce(
    (total, gate) => total + gate.unresolvedFailureCount,
    0,
  );

  return {
    schemaVersion: "production-promotion-report-v1" as const,
    evaluatedAt,
    status: gates.every(
      (gate) => gate.promotionStatus === "accepted",
    )
      ? ("accepted" as const)
      : ("blocked" as const),
    gateCount: gates.length,
    priorFailureCount,
    unresolvedFailureCount,
    identity: input.identity,
    toolVersions,
    gates,
  };
}

function parseEvidence(
  value: unknown,
  label: string,
): PromotionEvidence {
  const evidence = object(value, label, [
    "gate",
    "schemaVersion",
    "status",
    "identity",
    "reportSha256",
    "measuredAt",
    "windowStartedAt",
    "windowEndedAt",
    "sampleCount",
    "retainedLogs",
    "attempts",
    "resolution",
  ]);
  const gate = promotionGate(evidence.gate, `${label} gate`);
  return {
    gate,
    schemaVersion: stringValue(
      evidence.schemaVersion,
      `${gate} schema version`,
    ),
    status: evidenceStatus(evidence.status, `${gate} status`),
    identity: parseIdentity(evidence.identity, `${gate} identity`),
    reportSha256: stringValue(
      evidence.reportSha256,
      `${gate} report SHA-256`,
    ),
    measuredAt: stringValue(
      evidence.measuredAt,
      `${gate} measuredAt`,
    ),
    windowStartedAt: stringValue(
      evidence.windowStartedAt,
      `${gate} window start`,
    ),
    windowEndedAt: stringValue(
      evidence.windowEndedAt,
      `${gate} window end`,
    ),
    sampleCount: positiveSafeInteger(
      evidence.sampleCount,
      `${gate} sample count`,
      promotionInputError,
    ),
    retainedLogs: array(
      evidence.retainedLogs,
      `${gate} retained logs`,
    ).map((log, index) =>
      stringValue(log, `${gate} retained log ${index + 1}`),
    ),
    attempts: array(evidence.attempts, `${gate} attempts`).map(
      (attempt, index) => parseAttempt(attempt, gate, index),
    ),
    resolution:
      evidence.resolution === undefined
        ? undefined
        : parseResolution(evidence.resolution, gate),
  };
}

function parseIdentity(
  value: unknown,
  label: string,
): PromotionIdentity {
  const identity = object(value, label, [...IDENTITY_FIELDS]);
  return {
    fixtureManifestSha256: stringValue(
      identity.fixtureManifestSha256,
      `${label} fixture manifest SHA-256`,
    ),
    buildId: stringValue(identity.buildId, `${label} build ID`),
    baciRelease: stringValue(
      identity.baciRelease,
      `${label} BACI Release`,
    ),
    analysisBuildId: stringValue(
      identity.analysisBuildId,
      `${label} analysis build ID`,
    ),
    productSearchBuildId: stringValue(
      identity.productSearchBuildId,
      `${label} product-search build ID`,
    ),
    artifactSha256: stringValue(
      identity.artifactSha256,
      `${label} artifact SHA-256`,
    ),
    deploymentPairingId: stringValue(
      identity.deploymentPairingId,
      `${label} deployment pairing ID`,
    ),
    sourceStatusSnapshotId: stringValue(
      identity.sourceStatusSnapshotId,
      `${label} Source Freshness Status snapshot ID`,
    ),
    machineId: stringValue(
      identity.machineId,
      `${label} Machine ID`,
    ),
    machineClass: stringValue(
      identity.machineClass,
      `${label} Machine class`,
    ),
    region: stringValue(identity.region, `${label} region`),
  };
}

function parseToolVersions(
  value: unknown,
): PromotionReportInput["toolVersions"] {
  const versions = object(value, "promotion tool versions", [
    "node",
    "npm",
    "next",
    "duckdb",
    "playwright",
  ]);
  return {
    node: stringValue(versions.node, "Node.js version"),
    npm: stringValue(versions.npm, "npm version"),
    next: stringValue(versions.next, "Next.js version"),
    duckdb: stringValue(versions.duckdb, "DuckDB version"),
    playwright: stringValue(
      versions.playwright,
      "Playwright version",
    ),
  };
}

function parseAttempt(
  value: unknown,
  gate: PromotionGateId,
  index: number,
): PromotionAttempt {
  const label = `${gate} attempt ${index + 1}`;
  const attempt = object(value, label, [
    "attemptedAt",
    "status",
    "logSha256",
  ]);
  return {
    attemptedAt: stringValue(
      attempt.attemptedAt,
      `${label} timestamp`,
    ),
    status: evidenceStatus(attempt.status, `${label} status`),
    logSha256: stringValue(
      attempt.logSha256,
      `${label} log SHA-256`,
    ),
  };
}

function parseResolution(
  value: unknown,
  gate: PromotionGateId,
): PromotionResolution {
  const resolution = object(value, `${gate} resolution`, [
    "resolvedAt",
    "cause",
    "buildId",
  ]);
  return {
    resolvedAt: stringValue(
      resolution.resolvedAt,
      `${gate} resolution timestamp`,
    ),
    cause: stringValue(
      resolution.cause,
      `${gate} resolution cause`,
    ),
    buildId: stringValue(
      resolution.buildId,
      `${gate} resolution build ID`,
    ),
  };
}

function evaluateEvidence(
  evidence: PromotionEvidence,
  identity: PromotionIdentity,
  evaluatedAt: string,
) {
  nonemptyString(
    evidence.schemaVersion,
    `${evidence.gate} schema version`,
  );
  validateEvidenceIdentity(evidence, identity);
  sha256(evidence.reportSha256, `${evidence.gate} report SHA-256`);
  const measuredAt = utcTimestamp(
    evidence.measuredAt,
    `${evidence.gate} measuredAt`,
  );
  const windowStartedAt = utcTimestamp(
    evidence.windowStartedAt,
    `${evidence.gate} window start`,
  );
  const windowEndedAt = utcTimestamp(
    evidence.windowEndedAt,
    `${evidence.gate} window end`,
  );
  if (
    Date.parse(windowStartedAt) > Date.parse(windowEndedAt) ||
    Date.parse(windowEndedAt) > Date.parse(measuredAt) ||
    Date.parse(measuredAt) > Date.parse(evaluatedAt)
  ) {
    throw new PromotionReportInputError(
      `${evidence.gate} evidence timestamps are not chronological.`,
    );
  }
  const sampleCount = positiveSafeInteger(
    evidence.sampleCount,
    `${evidence.gate} sample count`,
    promotionInputError,
  );
  if (evidence.retainedLogs.length === 0) {
    throw new PromotionReportInputError(
      `${evidence.gate} evidence requires a retained log.`,
    );
  }
  const retainedLogs = evidence.retainedLogs.map((log, index) =>
    retainedLog(log, `${evidence.gate} retained log ${index + 1}`),
  );
  if (evidence.attempts.length === 0) {
    throw new PromotionReportInputError(
      `${evidence.gate} evidence requires at least one attempt.`,
    );
  }
  const attempts = evidence.attempts.map((attempt, index) =>
    validateAttempt(attempt, evidence.gate, index),
  );
  for (let index = 1; index < attempts.length; index += 1) {
    if (
      Date.parse(attempts[index - 1].attemptedAt) >
      Date.parse(attempts[index].attemptedAt)
    ) {
      throw new PromotionReportInputError(
        `${evidence.gate} attempts must be chronological.`,
      );
    }
  }
  if (attempts.at(-1)?.status !== evidence.status) {
    throw new PromotionReportInputError(
      `${evidence.gate} status must match its latest attempt.`,
    );
  }
  const priorFailureCount = attempts.filter(
    (attempt) => attempt.status !== "accepted",
  ).length;
  const resolution =
    evidence.resolution === undefined
      ? null
      : validateResolution(
          evidence.resolution,
          evidence.gate,
          identity,
          attempts,
        );
  if (priorFailureCount === 0 && resolution !== null) {
    throw new PromotionReportInputError(
      `${evidence.gate} cannot resolve a failure that was not retained.`,
    );
  }
  const unresolvedFailureCount =
    priorFailureCount > 0 && resolution === null
      ? priorFailureCount
      : 0;
  const promotionStatus =
    evidence.status === "accepted" && unresolvedFailureCount === 0
      ? ("accepted" as const)
      : ("blocked" as const);

  return {
    gate: evidence.gate,
    schemaVersion: evidence.schemaVersion,
    status: evidence.status,
    promotionStatus,
    identity: evidence.identity,
    reportSha256: evidence.reportSha256,
    measuredAt,
    windowStartedAt,
    windowEndedAt,
    sampleCount,
    retainedLogs,
    attempts,
    priorFailureCount,
    unresolvedFailureCount,
    resolution,
  };
}

function validateEvidenceIdentity(
  evidence: PromotionEvidence,
  expected: PromotionIdentity,
): void {
  validateIdentity(evidence.identity, `${evidence.gate} identity`);
  for (const field of IDENTITY_FIELDS) {
    if (evidence.identity[field] !== expected[field]) {
      throw new PromotionReportInputError(
        `${evidence.gate} evidence ${field} does not match the promotion identity.`,
      );
    }
  }
}

function validateAttempt(
  attempt: PromotionAttempt,
  gate: PromotionGateId,
  index: number,
): PromotionAttempt {
  const attemptedAt = utcTimestamp(
    attempt.attemptedAt,
    `${gate} attempt ${index + 1} timestamp`,
  );
  if (!isEvidenceStatus(attempt.status)) {
    throw new PromotionReportInputError(
      `${gate} attempt ${index + 1} has an unsupported status.`,
    );
  }
  const logSha256 = sha256(
    attempt.logSha256,
    `${gate} attempt ${index + 1} log SHA-256`,
  );
  return {
    attemptedAt,
    status: attempt.status,
    logSha256,
  };
}

function validateResolution(
  resolution: PromotionResolution,
  gate: PromotionGateId,
  identity: PromotionIdentity,
  attempts: readonly PromotionAttempt[],
): PromotionResolution {
  const resolvedAt = utcTimestamp(
    resolution.resolvedAt,
    `${gate} resolution timestamp`,
  );
  const cause = nonemptyString(
    resolution.cause,
    `${gate} resolution cause`,
  );
  if (resolution.buildId !== identity.buildId) {
    throw new PromotionReportInputError(
      `${gate} resolution build ID does not match the promotion identity.`,
    );
  }
  const firstFailure = attempts.find(
    (attempt) => attempt.status !== "accepted",
  );
  const latestAttempt = attempts.at(-1);
  if (
    firstFailure === undefined ||
    latestAttempt === undefined ||
    Date.parse(resolvedAt) < Date.parse(firstFailure.attemptedAt) ||
    Date.parse(resolvedAt) > Date.parse(latestAttempt.attemptedAt)
  ) {
    throw new PromotionReportInputError(
      `${gate} resolution must fall between its first failure and latest attempt.`,
    );
  }
  return {
    resolvedAt,
    cause,
    buildId: resolution.buildId,
  };
}

function validateIdentity(
  identity: PromotionIdentity,
  label: string,
): void {
  sha256(
    identity.fixtureManifestSha256,
    `${label} fixture manifest SHA-256`,
  );
  if (identity.fixtureManifestSha256 !== ACCEPTANCE_FIXTURE_CONTENT_SHA256) {
    throw new PromotionReportInputError(
      `${label} fixture manifest SHA-256 does not match the canonical acceptance fixture.`,
    );
  }
  nonemptyString(identity.buildId, `${label} build ID`);
  if (!/^V\d{6}$/u.test(identity.baciRelease)) {
    throw new PromotionReportInputError(
      `${label} BACI Release must use VYYYYMM.`,
    );
  }
  nonemptyString(
    identity.analysisBuildId,
    `${label} analysis build ID`,
  );
  nonemptyString(
    identity.productSearchBuildId,
    `${label} product-search build ID`,
  );
  sha256(identity.artifactSha256, `${label} artifact SHA-256`);
  nonemptyString(
    identity.deploymentPairingId,
    `${label} deployment pairing ID`,
  );
  nonemptyString(
    identity.sourceStatusSnapshotId,
    `${label} Source Freshness Status snapshot ID`,
  );
  nonemptyString(identity.machineId, `${label} Machine ID`);
  nonemptyString(identity.machineClass, `${label} Machine class`);
  if (!/^[a-z]{3}$/u.test(identity.region)) {
    throw new PromotionReportInputError(
      `${label} region must be a three-letter provider region.`,
    );
  }
}

function validateToolVersions(
  versions: PromotionReportInput["toolVersions"],
) {
  return {
    node: nonemptyString(versions.node, "Node.js version"),
    npm: nonemptyString(versions.npm, "npm version"),
    next: nonemptyString(versions.next, "Next.js version"),
    duckdb: nonemptyString(versions.duckdb, "DuckDB version"),
    playwright: nonemptyString(
      versions.playwright,
      "Playwright version",
    ),
  };
}

function retainedLog(value: string, label: string): string {
  const parsed = nonemptyString(value, label);
  if (parsed.startsWith("reports/")) {
    if (parsed.includes("..") || parsed.includes("\\")) {
      throw new PromotionReportInputError(
        `${label} must be a safe reports-relative path.`,
      );
    }
    return parsed;
  }
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new PromotionReportInputError(
      `${label} must be a reports-relative path or HTTPS URL.`,
    );
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PromotionReportInputError(
      `${label} must be a credential-free HTTPS URL.`,
    );
  }
  return parsed;
}

function isPromotionGate(value: string): value is PromotionGateId {
  return (REQUIRED_GATES as readonly string[]).includes(value);
}

function isEvidenceStatus(
  value: unknown,
): value is PromotionEvidenceStatus {
  return (
    value === "accepted" ||
    value === "review-required" ||
    value === "blocked"
  );
}

function promotionGate(
  value: unknown,
  label: string,
): PromotionGateId {
  if (typeof value !== "string" || !isPromotionGate(value)) {
    throw new PromotionReportInputError(
      `${label} must be a supported promotion gate.`,
    );
  }
  return value;
}

function evidenceStatus(
  value: unknown,
  label: string,
): PromotionEvidenceStatus {
  if (!isEvidenceStatus(value)) {
    throw new PromotionReportInputError(
      `${label} must be accepted, review-required, or blocked.`,
    );
  }
  return value;
}

function object(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  const parsed = record(value, label, promotionInputError);
  const unexpected = Object.keys(parsed).find(
    (key) => !keys.includes(key),
  );
  if (unexpected !== undefined) {
    throw new PromotionReportInputError(
      `${label} contains unsupported field ${unexpected}.`,
    );
  }
  return parsed;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PromotionReportInputError(
      `${label} must be an array.`,
    );
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new PromotionReportInputError(`${label} must be a string.`);
  }
  return value;
}

function nonemptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PromotionReportInputError(
      `${label} must be a nonempty string.`,
    );
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new PromotionReportInputError(
      `${label} must be a lowercase SHA-256.`,
    );
  }
  return value;
}

function utcTimestamp(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PromotionReportInputError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function promotionInputError(message: string): PromotionReportInputError {
  return new PromotionReportInputError(message);
}
