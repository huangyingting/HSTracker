import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  PromotionEvidence,
  PromotionIdentity,
} from "./promotion-report";

const MAX_RETAINED_LOG_BYTES = 16 * 1024 ** 2;
const REQUIRED_REPORT_IDENTITY_FIELDS = [
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
] as const satisfies readonly (keyof PromotionIdentity)[];
export const PROMOTION_GATE_REQUIRED_CHECKS: Readonly<
  Record<PromotionEvidence["gate"], readonly string[]>
> = {
  "source-and-domain": ["source-contract", "domain-contract"],
  "origin-benchmarks": [
    "representative-fixtures",
    "origin-thresholds",
    "trade-explorer-budgets",
  ],
  "browser-lab": ["mobile-profile", "browser-thresholds"],
  "target-load": ["route-mix", "load-thresholds", "cache-states"],
  "coalescing-and-capacity": ["coalescing", "capacity"],
  "http-cache-and-deadlines": ["http-cache", "deadlines"],
  "lifecycle-and-recovery": [
    "restart",
    "hydration",
    "rollback",
    "deployment",
    "recovery",
  ],
  "deployment-resources": ["memory", "storage", "cpu"],
  "external-smoke-and-observability": [
    "external-smoke",
    "request-sli",
    "probe-sli",
    "alerts-and-dashboard",
  ],
  "recurring-cost": ["monthly-cost"],
  "market-analysis-launch": [
    "product-contract",
    "analyst-needs",
    "accessibility",
    "annual-result-invariance",
    "performance",
    "retained-replay",
    "startup-smoke",
    "rollback",
  ],
};

export class PromotionEvidenceFileError extends Error {
  readonly code = "PROMOTION_EVIDENCE_FILE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PromotionEvidenceFileError";
  }
}

export async function verifyRetainedPromotionEvidence(
  evidence: readonly PromotionEvidence[],
  repositoryRoot: string,
) {
  const reportsRoot = await realpath(resolve(repositoryRoot, "reports"));
  return Promise.all(
    evidence.map(async (gateEvidence) => {
      const uniquePaths = new Set(gateEvidence.retainedLogs);
      if (uniquePaths.size !== gateEvidence.retainedLogs.length) {
        throw new PromotionEvidenceFileError(
          `${gateEvidence.gate} retained logs must be unique.`,
        );
      }
      const retainedLogs = await Promise.all(
        gateEvidence.retainedLogs.map(async (path) => {
          const verifiedPath = await retainedLogPath(
            path,
            repositoryRoot,
            reportsRoot,
            gateEvidence.gate,
          );
          const metadata = await lstat(verifiedPath);
          if (!metadata.isFile()) {
            throw new PromotionEvidenceFileError(
              `${gateEvidence.gate} retained log must be a regular file.`,
            );
          }
          if (metadata.size > MAX_RETAINED_LOG_BYTES) {
            throw new PromotionEvidenceFileError(
              `${gateEvidence.gate} retained log exceeds 16 MiB.`,
            );
          }
          const bytes = await readFile(verifiedPath);
          return {
            path,
            bytes: bytes.byteLength,
            sha256: sha256(bytes),
            content: bytes,
          };
        }),
      );
      const retainedDigests = new Set(
        retainedLogs.map((log) => log.sha256),
      );
      if (!retainedDigests.has(gateEvidence.reportSha256)) {
        throw new PromotionEvidenceFileError(
          `${gateEvidence.gate} report SHA-256 is not present in its retained logs.`,
        );
      }
      const reportLog = retainedLogs.find(
        (log) => log.sha256 === gateEvidence.reportSha256,
      );
      if (reportLog === undefined) {
        throw new PromotionEvidenceFileError(
          `${gateEvidence.gate} retained report could not be resolved.`,
        );
      }
      const report = verifyRetainedReport(reportLog.content, gateEvidence);
      const additionalLogs = retainedLogs.filter(
        (log) => log.path !== reportLog.path,
      );
      if (additionalLogs.length !== report.retainedLogDigests.size) {
        throw new PromotionEvidenceFileError(
          `${gateEvidence.gate} retained report does not bind every additional retained log.`,
        );
      }
      for (const log of additionalLogs) {
        const expectedDigest = report.retainedLogDigests.get(log.path);
        if (expectedDigest !== log.sha256) {
          throw new PromotionEvidenceFileError(
            `${gateEvidence.gate} retained log ${log.path} does not match its bound SHA-256.`,
          );
        }
      }
      for (const attempt of gateEvidence.attempts) {
        if (!retainedDigests.has(attempt.logSha256)) {
          throw new PromotionEvidenceFileError(
            `${gateEvidence.gate} attempt ${attempt.attemptedAt} is not present in its retained logs.`,
          );
        }
      }
      return {
        gate: gateEvidence.gate,
        reportSha256: gateEvidence.reportSha256,
        report: {
          schemaVersion: report.schemaVersion,
          measurementClass: report.measurementClass,
          status: report.status,
        },
        retainedLogs: retainedLogs.map((log) => ({
          path: log.path,
          bytes: log.bytes,
          sha256: log.sha256,
        })),
      };
    }),
  );
}

function verifyRetainedReport(
  bytes: Buffer,
  evidence: PromotionEvidence,
): {
  schemaVersion: string;
  measurementClass: "candidate" | "local-smoke";
  status: PromotionEvidence["status"];
  retainedLogDigests: ReadonlyMap<string, string>;
} {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report is not valid JSON.`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report must be a JSON object.`,
    );
  }
  const report = value as Record<string, unknown>;
  const expectedSchemaVersion = `${evidence.gate}-report-v1`;
  if (evidence.schemaVersion !== expectedSchemaVersion) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} evidence must declare schemaVersion ${expectedSchemaVersion}.`,
    );
  }
  if (report.schemaVersion !== evidence.schemaVersion) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report schemaVersion does not match its declared evidence.`,
    );
  }
  const measurementClass = report.measurementClass;
  if (
    measurementClass !== "candidate" &&
    measurementClass !== "local-smoke"
  ) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report must declare its measurementClass.`,
    );
  }
  if (
    evidence.status === "accepted" &&
    measurementClass !== "candidate"
  ) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} accepted evidence requires a candidate retained report.`,
    );
  }
  if (report.status !== evidence.status) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report status does not match its declared evidence.`,
    );
  }
  if (
    typeof report.identity !== "object" ||
    report.identity === null ||
    Array.isArray(report.identity)
  ) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report must declare its measured identity.`,
    );
  }
  const reportIdentity = report.identity as Record<string, unknown>;
  for (const field of REQUIRED_REPORT_IDENTITY_FIELDS) {
    if (reportIdentity[field] !== evidence.identity[field]) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained report ${field} does not match its declared evidence.`,
      );
    }
  }
  if (report.gate !== evidence.gate) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report gate does not match its declared evidence.`,
    );
  }
  verifyGateChecks(report.checks, evidence);
  const retainedLogDigests = verifyRetainedLogDigests(
    report.retainedLogDigests,
    evidence,
  );
  return {
    schemaVersion: evidence.schemaVersion,
    measurementClass,
    status: evidence.status,
    retainedLogDigests,
  };
}

function verifyRetainedLogDigests(
  value: unknown,
  evidence: PromotionEvidence,
): ReadonlyMap<string, string> {
  if (value === undefined) {
    return new Map();
  }
  if (!Array.isArray(value)) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report must bind its additional retained logs.`,
    );
  }
  const digests = new Map<string, string>();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained log digest ${index + 1} must be an object.`,
      );
    }
    const binding = entry as Record<string, unknown>;
    if (
      typeof binding.path !== "string" ||
      !binding.path.startsWith("reports/") ||
      binding.path.includes("..") ||
      binding.path.includes("\\") ||
      typeof binding.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(binding.sha256) ||
      digests.has(binding.path)
    ) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained log digest ${index + 1} is malformed or duplicated.`,
      );
    }
    digests.set(binding.path, binding.sha256);
  }
  return digests;
}

function verifyGateChecks(
  value: unknown,
  evidence: PromotionEvidence,
): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report must contain gate-specific checks.`,
    );
  }
  const statuses = new Map<string, PromotionEvidence["status"]>();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained report check ${index + 1} must be an object.`,
      );
    }
    const check = entry as Record<string, unknown>;
    if (
      typeof check.name !== "string" ||
      check.name.length === 0 ||
      (check.status !== "accepted" &&
        check.status !== "review-required" &&
        check.status !== "blocked") ||
      statuses.has(check.name)
    ) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained report check ${index + 1} is malformed or duplicated.`,
      );
    }
    statuses.set(check.name, check.status);
  }
  for (const name of PROMOTION_GATE_REQUIRED_CHECKS[evidence.gate]) {
    if (!statuses.has(name)) {
      throw new PromotionEvidenceFileError(
        `${evidence.gate} retained report is missing required check ${name}.`,
      );
    }
  }
  const derivedStatus: PromotionEvidence["status"] = [
    ...statuses.values(),
  ].includes("blocked")
    ? "blocked"
    : [...statuses.values()].includes("review-required")
      ? "review-required"
      : "accepted";
  if (derivedStatus !== evidence.status) {
    throw new PromotionEvidenceFileError(
      `${evidence.gate} retained report checks do not support its declared status.`,
    );
  }
}

async function retainedLogPath(
  path: string,
  repositoryRoot: string,
  reportsRoot: string,
  gate: PromotionEvidence["gate"],
): Promise<string> {
  if (
    !path.startsWith("reports/") ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    throw new PromotionEvidenceFileError(
      `${gate} retained log must be a local reports-relative path.`,
    );
  }
  const candidate = resolve(repositoryRoot, path);
  const canonical = await realpath(candidate);
  const fromReports = relative(reportsRoot, canonical);
  if (
    fromReports.length === 0 ||
    fromReports.startsWith(`..${sep}`) ||
    fromReports === ".." ||
    isAbsolute(fromReports)
  ) {
    throw new PromotionEvidenceFileError(
      `${gate} retained log resolves outside the reports directory.`,
    );
  }
  return canonical;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
