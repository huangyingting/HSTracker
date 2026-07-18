/**
 * The durable local-launch report (issue #63, ADR-0004). A launch report links
 * the local origin, provider decisions, active identities, release manifests,
 * retained gate reports, live probes, privacy/runbooks, and rollback evidence
 * for a single-host launch. `evaluateLaunchReport` re-derives the launch verdict
 * from the linked evidence rather than trusting a caller-supplied status, so a
 * report cannot claim a launch its evidence does not support. When any check
 * fails the launch is `held`: the prior deployment stays active.
 */

const REQUIRED_PROBES = [
  "health",
  "readiness",
  "candidate-market-smoke",
  "secret-leakage",
  "machine-class",
] as const;

const REQUIRED_REPORTS = ["local-single-host-gates"] as const;

const MAX_RETAINED_RELEASES = 3;

export type LaunchProbeStatus = "ok" | "failed";
export type LaunchReportStatus = "accepted" | "blocked";

export type LaunchOrigin = {
  adr: string;
  machineClass: string;
  bind: string;
  hosting: string;
};

export type LaunchProviderDecisions = {
  recurringCostUsd: number;
  objectStore: string;
  operationalStore: string;
  hosting: string;
  adr: string;
};

export type LaunchIdentities = {
  buildId: string;
  deploymentPairingId: string;
  baciRelease: string;
  analysisBuildId: string;
  productSearchBuildId: string;
  analysisReleaseCatalogSha256: string;
  analysisArtifactSha256: string;
  sourceStatusSnapshotId: string;
  machineClass: string;
};

export type LaunchManifests = {
  currentReleaseId: string;
  retainedReleaseIds: string[];
  objectStorePointer: string;
};

export type LaunchLinkedReport = {
  gate: string;
  path: string;
  sha256: string;
  status: LaunchReportStatus;
};

export type LaunchProbe = {
  name: string;
  status: LaunchProbeStatus;
  detail: string;
};

export type LaunchRunbookLink = {
  title: string;
  path: string;
};

export type LaunchRollbackEvidence = {
  rollbackCommand: string;
  residentFallbackVerified: boolean;
  currentPlusTwoRetained: boolean;
  priorDeploymentPreservedOnFailure: boolean;
};

export type LaunchReportInput = {
  schemaVersion: "local-launch-report-input-v1";
  launchedAt: string;
  buildId: string;
  localOrigin: LaunchOrigin;
  providerDecisions: LaunchProviderDecisions;
  identities: LaunchIdentities;
  manifests: LaunchManifests;
  reports: LaunchLinkedReport[];
  probes: LaunchProbe[];
  privacyAndRunbooks: LaunchRunbookLink[];
  rollbackEvidence: LaunchRollbackEvidence;
};

export type LaunchReport = {
  schemaVersion: "local-launch-report-v1";
  status: "launched" | "held";
  buildId: string;
  launchedAt: string;
  identities: LaunchIdentities;
  reportCount: number;
  probeCount: number;
  runbookCount: number;
  retainedReleaseCount: number;
  recurringCostUsd: number;
  heldLeavesPriorDeploymentActive: boolean;
  failures: string[];
};

export class LaunchReportInputError extends Error {
  readonly code = "LAUNCH_REPORT_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "LaunchReportInputError";
  }
}

export function parseLaunchReportInput(value: unknown): LaunchReportInput {
  const input = object(value, "launch report input", [
    "schemaVersion",
    "launchedAt",
    "buildId",
    "localOrigin",
    "providerDecisions",
    "identities",
    "manifests",
    "reports",
    "probes",
    "privacyAndRunbooks",
    "rollbackEvidence",
  ]);
  if (input.schemaVersion !== "local-launch-report-input-v1") {
    throw new LaunchReportInputError(
      "Launch report input schema is incompatible.",
    );
  }
  return {
    schemaVersion: "local-launch-report-input-v1",
    launchedAt: utcTimestamp(
      stringValue(input.launchedAt, "launchedAt"),
      "launchedAt",
    ),
    buildId: nonemptyString(
      stringValue(input.buildId, "buildId"),
      "buildId",
    ),
    localOrigin: parseOrigin(input.localOrigin),
    providerDecisions: parseProviderDecisions(input.providerDecisions),
    identities: parseIdentities(input.identities),
    manifests: parseManifests(input.manifests),
    reports: parseReports(input.reports),
    probes: parseProbes(input.probes),
    privacyAndRunbooks: parseRunbooks(input.privacyAndRunbooks),
    rollbackEvidence: parseRollbackEvidence(input.rollbackEvidence),
  };
}

export function evaluateLaunchReport(input: LaunchReportInput): LaunchReport {
  const parsed =
    input.schemaVersion === "local-launch-report-input-v1"
      ? input
      : parseLaunchReportInput(input);
  const failures: string[] = [];

  if (parsed.localOrigin.machineClass !== "local") {
    failures.push(
      `Local origin machine class must be "local", found ${JSON.stringify(parsed.localOrigin.machineClass)}.`,
    );
  }
  if (parsed.identities.machineClass !== "local") {
    failures.push(
      `Active machine class must be "local", found ${JSON.stringify(parsed.identities.machineClass)}.`,
    );
  }
  if (parsed.identities.buildId !== parsed.buildId) {
    failures.push(
      "Identity build id disagrees with the launch build id.",
    );
  }
  if (parsed.providerDecisions.recurringCostUsd !== 0) {
    failures.push(
      `Recurring provider cost must be zero, found ${String(parsed.providerDecisions.recurringCostUsd)} USD.`,
    );
  }

  const retained = parsed.manifests.retainedReleaseIds;
  if (retained.length < 1 || retained.length > MAX_RETAINED_RELEASES) {
    failures.push(
      `Retained releases must number 1..${String(MAX_RETAINED_RELEASES)} (current plus two), found ${String(retained.length)}.`,
    );
  }
  if (!retained.includes(parsed.manifests.currentReleaseId)) {
    failures.push(
      "Current release is not among the retained releases.",
    );
  }

  for (const required of REQUIRED_REPORTS) {
    if (!parsed.reports.some((report) => report.gate === required)) {
      failures.push(`Missing required launch report ${required}.`);
    }
  }
  for (const report of parsed.reports) {
    if (report.status !== "accepted") {
      failures.push(
        `Linked report ${report.gate} is ${report.status}, not accepted.`,
      );
    }
  }

  for (const required of REQUIRED_PROBES) {
    if (!parsed.probes.some((probe) => probe.name === required)) {
      failures.push(`Missing required probe ${required}.`);
    }
  }
  for (const probe of parsed.probes) {
    if (probe.status !== "ok") {
      failures.push(`Probe ${probe.name} is ${probe.status}, not ok.`);
    }
  }

  if (parsed.privacyAndRunbooks.length === 0) {
    failures.push("At least one privacy/runbook link is required.");
  }

  const rollback = parsed.rollbackEvidence;
  if (!rollback.residentFallbackVerified) {
    failures.push("Resident fallback is not verified.");
  }
  if (!rollback.currentPlusTwoRetained) {
    failures.push("Current-plus-two retention is not confirmed.");
  }
  if (!rollback.priorDeploymentPreservedOnFailure) {
    failures.push(
      "Rollback evidence must guarantee the prior deployment stays active on failure.",
    );
  }

  return {
    schemaVersion: "local-launch-report-v1",
    status: failures.length === 0 ? "launched" : "held",
    buildId: parsed.buildId,
    launchedAt: parsed.launchedAt,
    identities: parsed.identities,
    reportCount: parsed.reports.length,
    probeCount: parsed.probes.length,
    runbookCount: parsed.privacyAndRunbooks.length,
    retainedReleaseCount: retained.length,
    recurringCostUsd: parsed.providerDecisions.recurringCostUsd,
    heldLeavesPriorDeploymentActive:
      rollback.priorDeploymentPreservedOnFailure,
    failures,
  };
}

function parseOrigin(value: unknown): LaunchOrigin {
  const origin = object(value, "localOrigin", [
    "adr",
    "machineClass",
    "bind",
    "hosting",
  ]);
  return {
    adr: nonemptyString(stringValue(origin.adr, "localOrigin.adr"), "localOrigin.adr"),
    machineClass: nonemptyString(
      stringValue(origin.machineClass, "localOrigin.machineClass"),
      "localOrigin.machineClass",
    ),
    bind: nonemptyString(stringValue(origin.bind, "localOrigin.bind"), "localOrigin.bind"),
    hosting: nonemptyString(
      stringValue(origin.hosting, "localOrigin.hosting"),
      "localOrigin.hosting",
    ),
  };
}

function parseProviderDecisions(value: unknown): LaunchProviderDecisions {
  const decisions = object(value, "providerDecisions", [
    "recurringCostUsd",
    "objectStore",
    "operationalStore",
    "hosting",
    "adr",
  ]);
  if (
    typeof decisions.recurringCostUsd !== "number" ||
    !Number.isFinite(decisions.recurringCostUsd) ||
    decisions.recurringCostUsd < 0
  ) {
    throw new LaunchReportInputError(
      "providerDecisions.recurringCostUsd must be a nonnegative number.",
    );
  }
  return {
    recurringCostUsd: decisions.recurringCostUsd,
    objectStore: nonemptyString(
      stringValue(decisions.objectStore, "providerDecisions.objectStore"),
      "providerDecisions.objectStore",
    ),
    operationalStore: nonemptyString(
      stringValue(
        decisions.operationalStore,
        "providerDecisions.operationalStore",
      ),
      "providerDecisions.operationalStore",
    ),
    hosting: nonemptyString(
      stringValue(decisions.hosting, "providerDecisions.hosting"),
      "providerDecisions.hosting",
    ),
    adr: nonemptyString(
      stringValue(decisions.adr, "providerDecisions.adr"),
      "providerDecisions.adr",
    ),
  };
}

function parseIdentities(value: unknown): LaunchIdentities {
  const identities = object(value, "identities", [
    "buildId",
    "deploymentPairingId",
    "baciRelease",
    "analysisBuildId",
    "productSearchBuildId",
    "analysisReleaseCatalogSha256",
    "analysisArtifactSha256",
    "sourceStatusSnapshotId",
    "machineClass",
  ]);
  return {
    buildId: nonemptyString(
      stringValue(identities.buildId, "identities.buildId"),
      "identities.buildId",
    ),
    deploymentPairingId: nonemptyString(
      stringValue(
        identities.deploymentPairingId,
        "identities.deploymentPairingId",
      ),
      "identities.deploymentPairingId",
    ),
    baciRelease: nonemptyString(
      stringValue(identities.baciRelease, "identities.baciRelease"),
      "identities.baciRelease",
    ),
    analysisBuildId: nonemptyString(
      stringValue(identities.analysisBuildId, "identities.analysisBuildId"),
      "identities.analysisBuildId",
    ),
    productSearchBuildId: nonemptyString(
      stringValue(
        identities.productSearchBuildId,
        "identities.productSearchBuildId",
      ),
      "identities.productSearchBuildId",
    ),
    analysisReleaseCatalogSha256: sha256(
      stringValue(
        identities.analysisReleaseCatalogSha256,
        "identities.analysisReleaseCatalogSha256",
      ),
      "identities.analysisReleaseCatalogSha256",
    ),
    analysisArtifactSha256: sha256(
      stringValue(
        identities.analysisArtifactSha256,
        "identities.analysisArtifactSha256",
      ),
      "identities.analysisArtifactSha256",
    ),
    sourceStatusSnapshotId: nonemptyString(
      stringValue(
        identities.sourceStatusSnapshotId,
        "identities.sourceStatusSnapshotId",
      ),
      "identities.sourceStatusSnapshotId",
    ),
    machineClass: nonemptyString(
      stringValue(identities.machineClass, "identities.machineClass"),
      "identities.machineClass",
    ),
  };
}

function parseManifests(value: unknown): LaunchManifests {
  const manifests = object(value, "manifests", [
    "currentReleaseId",
    "retainedReleaseIds",
    "objectStorePointer",
  ]);
  const retained = array(
    manifests.retainedReleaseIds,
    "manifests.retainedReleaseIds",
  ).map((id, index) =>
    nonemptyString(
      stringValue(id, `manifests.retainedReleaseIds[${String(index)}]`),
      `manifests.retainedReleaseIds[${String(index)}]`,
    ),
  );
  if (retained.length === 0) {
    throw new LaunchReportInputError(
      "manifests.retainedReleaseIds must not be empty.",
    );
  }
  return {
    currentReleaseId: nonemptyString(
      stringValue(manifests.currentReleaseId, "manifests.currentReleaseId"),
      "manifests.currentReleaseId",
    ),
    retainedReleaseIds: retained,
    objectStorePointer: nonemptyString(
      stringValue(
        manifests.objectStorePointer,
        "manifests.objectStorePointer",
      ),
      "manifests.objectStorePointer",
    ),
  };
}

function parseReports(value: unknown): LaunchLinkedReport[] {
  const reports = array(value, "reports");
  if (reports.length === 0) {
    throw new LaunchReportInputError("reports must not be empty.");
  }
  return reports.map((entry, index) => {
    const report = object(entry, `reports[${String(index)}]`, [
      "gate",
      "path",
      "sha256",
      "status",
    ]);
    return {
      gate: nonemptyString(
        stringValue(report.gate, `reports[${String(index)}].gate`),
        `reports[${String(index)}].gate`,
      ),
      path: nonemptyString(
        stringValue(report.path, `reports[${String(index)}].path`),
        `reports[${String(index)}].path`,
      ),
      sha256: sha256(
        stringValue(report.sha256, `reports[${String(index)}].sha256`),
        `reports[${String(index)}].sha256`,
      ),
      status: reportStatus(
        stringValue(report.status, `reports[${String(index)}].status`),
        `reports[${String(index)}].status`,
      ),
    };
  });
}

function parseProbes(value: unknown): LaunchProbe[] {
  const probes = array(value, "probes");
  if (probes.length === 0) {
    throw new LaunchReportInputError("probes must not be empty.");
  }
  return probes.map((entry, index) => {
    const probe = object(entry, `probes[${String(index)}]`, [
      "name",
      "status",
      "detail",
    ]);
    return {
      name: nonemptyString(
        stringValue(probe.name, `probes[${String(index)}].name`),
        `probes[${String(index)}].name`,
      ),
      status: probeStatus(
        stringValue(probe.status, `probes[${String(index)}].status`),
        `probes[${String(index)}].status`,
      ),
      detail: stringValue(probe.detail, `probes[${String(index)}].detail`),
    };
  });
}

function parseRunbooks(value: unknown): LaunchRunbookLink[] {
  const runbooks = array(value, "privacyAndRunbooks");
  if (runbooks.length === 0) {
    throw new LaunchReportInputError(
      "privacyAndRunbooks must not be empty.",
    );
  }
  return runbooks.map((entry, index) => {
    const runbook = object(entry, `privacyAndRunbooks[${String(index)}]`, [
      "title",
      "path",
    ]);
    return {
      title: nonemptyString(
        stringValue(runbook.title, `privacyAndRunbooks[${String(index)}].title`),
        `privacyAndRunbooks[${String(index)}].title`,
      ),
      path: nonemptyString(
        stringValue(runbook.path, `privacyAndRunbooks[${String(index)}].path`),
        `privacyAndRunbooks[${String(index)}].path`,
      ),
    };
  });
}

function parseRollbackEvidence(value: unknown): LaunchRollbackEvidence {
  const rollback = object(value, "rollbackEvidence", [
    "rollbackCommand",
    "residentFallbackVerified",
    "currentPlusTwoRetained",
    "priorDeploymentPreservedOnFailure",
  ]);
  return {
    rollbackCommand: nonemptyString(
      stringValue(rollback.rollbackCommand, "rollbackEvidence.rollbackCommand"),
      "rollbackEvidence.rollbackCommand",
    ),
    residentFallbackVerified: boolean(
      rollback.residentFallbackVerified,
      "rollbackEvidence.residentFallbackVerified",
    ),
    currentPlusTwoRetained: boolean(
      rollback.currentPlusTwoRetained,
      "rollbackEvidence.currentPlusTwoRetained",
    ),
    priorDeploymentPreservedOnFailure: boolean(
      rollback.priorDeploymentPreservedOnFailure,
      "rollbackEvidence.priorDeploymentPreservedOnFailure",
    ),
  };
}

function object(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LaunchReportInputError(`${label} must be an object.`);
  }
  const parsed = value as Record<string, unknown>;
  const unexpected = Object.keys(parsed).find((key) => !keys.includes(key));
  if (unexpected !== undefined) {
    throw new LaunchReportInputError(
      `${label} contains unsupported field ${unexpected}.`,
    );
  }
  return parsed;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new LaunchReportInputError(`${label} must be an array.`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new LaunchReportInputError(`${label} must be a string.`);
  }
  return value;
}

function nonemptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LaunchReportInputError(`${label} must be a nonempty string.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new LaunchReportInputError(`${label} must be a boolean.`);
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new LaunchReportInputError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function utcTimestamp(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new LaunchReportInputError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function reportStatus(value: string, label: string): LaunchReportStatus {
  if (value === "accepted" || value === "blocked") {
    return value;
  }
  throw new LaunchReportInputError(
    `${label} must be "accepted" or "blocked".`,
  );
}

function probeStatus(value: string, label: string): LaunchProbeStatus {
  if (value === "ok" || value === "failed") {
    return value;
  }
  throw new LaunchReportInputError(`${label} must be "ok" or "failed".`);
}
