import { createHash } from "node:crypto";

import { PROMOTION_GATE_REQUIRED_CHECKS } from "./promotion-evidence";
import type {
  PromotionAttempt,
  PromotionEvidence,
  PromotionEvidenceStatus,
  PromotionGateId,
  PromotionIdentity,
  PromotionReportInput,
} from "./promotion-report";

export type GateMeasurementClass = "candidate" | "local-smoke";

export type GateCheckResult = {
  readonly name: string;
  readonly status: PromotionEvidenceStatus;
};

export type BuiltGate = {
  readonly gate: PromotionGateId;
  readonly status: PromotionEvidenceStatus;
  readonly reportPath: string;
  readonly reportJson: Buffer;
  readonly reportSha256: string;
  readonly evidence: PromotionEvidence;
};

export class GateReportError extends Error {
  readonly code = "GATE_REPORT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "GateReportError";
  }
}

const EVIDENCE_STATUSES: readonly PromotionEvidenceStatus[] = [
  "accepted",
  "review-required",
  "blocked",
];

/**
 * Derives the aggregate status of a gate from its individual checks. A single
 * blocked check blocks the gate; any review-required check leaves it
 * review-required; only wholly-accepted checks yield an accepted gate. This
 * mirrors the aggregation the retained-evidence verifier performs, so a report
 * built here cannot claim a status its checks do not support.
 */
export function deriveGateStatus(
  checks: readonly GateCheckResult[],
): PromotionEvidenceStatus {
  const statuses = checks.map((check) => check.status);
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  if (statuses.includes("review-required")) {
    return "review-required";
  }
  return "accepted";
}

export type BuildGateInput = {
  readonly gate: PromotionGateId;
  readonly identity: PromotionIdentity;
  readonly measurementClass: GateMeasurementClass;
  readonly checks: readonly GateCheckResult[];
  readonly reportPath: string;
  readonly measuredAt: string;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly sampleCount: number;
  readonly additionalRetainedLogs?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly attempts?: readonly PromotionAttempt[];
};

/**
 * Builds the retained gate report bytes and the matching promotion evidence
 * entry from genuine check results. The report and the evidence share a single
 * derived status and a single SHA-256 over the exact bytes callers must write
 * to `reportPath`, so the pair always validates together.
 */
export function buildGate(input: BuildGateInput): BuiltGate {
  const requiredChecks = PROMOTION_GATE_REQUIRED_CHECKS[input.gate];
  if (requiredChecks === undefined) {
    throw new GateReportError(`Unsupported promotion gate ${input.gate}.`);
  }
  const seen = new Set<string>();
  for (const check of input.checks) {
    if (typeof check.name !== "string" || check.name.length === 0) {
      throw new GateReportError(
        `${input.gate} check names must be non-empty strings.`,
      );
    }
    if (!EVIDENCE_STATUSES.includes(check.status)) {
      throw new GateReportError(
        `${input.gate} check ${check.name} has an unsupported status.`,
      );
    }
    if (seen.has(check.name)) {
      throw new GateReportError(
        `${input.gate} check ${check.name} is duplicated.`,
      );
    }
    seen.add(check.name);
  }
  for (const name of requiredChecks) {
    if (!seen.has(name)) {
      throw new GateReportError(
        `${input.gate} report is missing required check ${name}.`,
      );
    }
  }
  if (!reportPathIsLocal(input.reportPath)) {
    throw new GateReportError(
      `${input.gate} report path must be a local reports-relative path.`,
    );
  }
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount <= 0) {
    throw new GateReportError(
      `${input.gate} sample count must be a positive integer.`,
    );
  }

  const status = deriveGateStatus(input.checks);
  if (input.measurementClass !== "candidate" && status === "accepted") {
    throw new GateReportError(
      `${input.gate} accepted evidence requires a candidate measurement class.`,
    );
  }

  const report = {
    schemaVersion: `${input.gate}-report-v1`,
    gate: input.gate,
    measurementClass: input.measurementClass,
    status,
    identity: input.identity,
    checks: input.checks.map((check) => ({
      name: check.name,
      status: check.status,
    })),
  };
  const reportJson = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const reportSha256 = sha256(reportJson);

  const retainedLogPaths = [
    input.reportPath,
    ...(input.additionalRetainedLogs ?? []).map((log) => log.path),
  ];
  if (new Set(retainedLogPaths).size !== retainedLogPaths.length) {
    throw new GateReportError(
      `${input.gate} retained logs must be unique.`,
    );
  }

  const attempts =
    input.attempts ??
    ([
      {
        attemptedAt: input.measuredAt,
        status,
        logSha256: reportSha256,
      },
    ] satisfies PromotionAttempt[]);

  const evidence: PromotionEvidence = {
    gate: input.gate,
    schemaVersion: report.schemaVersion,
    status,
    identity: input.identity,
    reportSha256,
    measuredAt: input.measuredAt,
    windowStartedAt: input.windowStartedAt,
    windowEndedAt: input.windowEndedAt,
    sampleCount: input.sampleCount,
    retainedLogs: retainedLogPaths,
    attempts: [...attempts],
  };

  return {
    gate: input.gate,
    status,
    reportPath: input.reportPath,
    reportJson,
    reportSha256,
    evidence,
  };
}

export type BuildPromotionInputArgs = {
  readonly identity: PromotionIdentity;
  readonly toolVersions: PromotionReportInput["toolVersions"];
  readonly evaluatedAt: string;
  readonly gates: readonly BuiltGate[];
};

export function buildPromotionInput(
  input: BuildPromotionInputArgs,
): PromotionReportInput {
  return {
    schemaVersion: "production-promotion-input-v1",
    evaluatedAt: input.evaluatedAt,
    identity: input.identity,
    toolVersions: input.toolVersions,
    evidence: input.gates.map((gate) => gate.evidence),
  };
}

function reportPathIsLocal(path: string): boolean {
  return (
    path.startsWith("reports/") &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
