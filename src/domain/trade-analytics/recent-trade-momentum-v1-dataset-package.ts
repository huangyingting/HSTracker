import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS = [
  { id: "recent-trade-momentum/reporting-market-import-value", version: "1" },
  { id: "recent-trade-momentum/eu27-reporter-identity", version: "1" },
  { id: "recent-trade-momentum/identified-partner-aggregation", version: "1" },
  { id: "recent-trade-momentum/cn-to-hs12-exact-complete-preimage", version: "1" },
  { id: "recent-trade-momentum/source-vintage-revision-report", version: "1" },
  { id: "recent-trade-momentum/period-coverage", version: "1" },
] as const;

export type RecentTradeMomentumDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "recent-trade-momentum-dataset-capabilities-v1";
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}>;

export const RECENT_TRADE_MOMENTUM_V1_DATASET_DECLARATION: RecentTradeMomentumDatasetCapabilityDeclaration =
  {
    schemaVersion: "recent-trade-momentum-dataset-capabilities-v1",
    capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
  };

export type RecentTradeMomentumDatasetPackageManifest = Readonly<{
  schemaVersion: "monthly-trade-dataset-package-manifest-v1";
  artifactSchemaVersion: "monthly-trade-artifact-v1";
  resultSchemaVersion: "recent-trade-momentum-result-v1";
  recipeId: "recent-trade-momentum-v1";
  capability: "recent-trade-momentum/reporting-market-import-value@1";
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1";
  sourceOwner: string;
  sourceDataset: "EUROSTAT_COMEXT_DETAIL";
  sourceVintageId: string;
  extractionTimestamp: string;
  sourceObjectsSha256: string;
  sourceMetadataSha256: string;
  mappingEvidenceSha256: string;
  partnerMappingVersion: string;
  reporterAllowlist: readonly string[];
  referenceMonthRange: Readonly<{ start: string; end: string }>;
  newestEligibleMonthByReporter: Readonly<Record<string, string>>;
  artifact: Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>;
  artifactSha256: string;
  rowCounts: Readonly<{
    reporters: number;
    partners: number;
    productMappings: number;
    marketMonths: number;
    momentum: number;
  }>;
  coverage: Readonly<{
    expectedHistoryMonths: 24;
    shadowVintagesPassed: number;
    publicCapabilityActivated: false;
  }>;
  revisionReportSha256: string;
  conformanceReportSha256: string;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
  quality: Readonly<
    | { status: "accepted"; reason: null }
    | { status: "blocked"; reason: string }
  >;
  attribution: Readonly<{
    statement: string;
    license: Readonly<{ name: string; url: string }>;
  }>;
  supersedesPackageIdentity: DatasetPackageIdentity | null;
}>;

export type RecentTradeMomentumDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: RecentTradeMomentumDatasetPackageManifest;
  serializedManifest: string;
}>;

export type RecentTradeMomentumDatasetPackageCompatibility =
  | Readonly<{ compatible: true }>
  | Readonly<{
      compatible: false;
      reason:
        | "MISSING_REQUIRED_CAPABILITY"
        | "CAPABILITY_VERSION_MISMATCH"
        | "PACKAGE_IDENTITY_MISMATCH";
    }>;

export function createRecentTradeMomentumDatasetPackage(
  value: RecentTradeMomentumDatasetPackageManifest,
): RecentTradeMomentumDatasetPackage {
  const manifest = canonicalManifest(value);
  validateManifestShape(manifest);
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const identity = `dataset-package-v1-${createHash("sha256")
    .update(serializedManifest)
    .digest("hex")}` as DatasetPackageIdentity;
  return { identity, manifest, serializedManifest };
}

export function evaluateRecentTradeMomentumV1DatasetPackage(
  datasetPackage: RecentTradeMomentumDatasetPackage,
): RecentTradeMomentumDatasetPackageCompatibility {
  const { manifest } = datasetPackage;
  try {
    validateManifestShape(manifest);
  } catch {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  if (
    manifest.quality.status !== "accepted" ||
    createRecentTradeMomentumDatasetPackage(manifest).identity !==
      datasetPackage.identity
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  const capabilities = new Map(
    manifest.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const required of RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS) {
    const version = capabilities.get(required.id);
    if (version === undefined) {
      return { compatible: false, reason: "MISSING_REQUIRED_CAPABILITY" };
    }
    if (version !== required.version) {
      return { compatible: false, reason: "CAPABILITY_VERSION_MISMATCH" };
    }
  }
  return { compatible: true };
}

function canonicalManifest(
  value: RecentTradeMomentumDatasetPackageManifest,
): RecentTradeMomentumDatasetPackageManifest {
  return {
    schemaVersion: value.schemaVersion,
    artifactSchemaVersion: value.artifactSchemaVersion,
    resultSchemaVersion: value.resultSchemaVersion,
    recipeId: value.recipeId,
    capability: value.capability,
    mappingPolicy: value.mappingPolicy,
    sourceOwner: value.sourceOwner,
    sourceDataset: value.sourceDataset,
    sourceVintageId: value.sourceVintageId,
    extractionTimestamp: value.extractionTimestamp,
    sourceObjectsSha256: value.sourceObjectsSha256,
    sourceMetadataSha256: value.sourceMetadataSha256,
    mappingEvidenceSha256: value.mappingEvidenceSha256,
    partnerMappingVersion: value.partnerMappingVersion,
    reporterAllowlist: [...value.reporterAllowlist].sort(),
    referenceMonthRange: {
      start: value.referenceMonthRange.start,
      end: value.referenceMonthRange.end,
    },
    newestEligibleMonthByReporter: Object.fromEntries(
      Object.entries(value.newestEligibleMonthByReporter).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    artifact: {
      relativePath: value.artifact.relativePath,
      bytes: value.artifact.bytes,
      sha256: value.artifact.sha256,
    },
    artifactSha256: value.artifactSha256,
    rowCounts: {
      reporters: value.rowCounts.reporters,
      partners: value.rowCounts.partners,
      productMappings: value.rowCounts.productMappings,
      marketMonths: value.rowCounts.marketMonths,
      momentum: value.rowCounts.momentum,
    },
    coverage: {
      expectedHistoryMonths: value.coverage.expectedHistoryMonths,
      shadowVintagesPassed: value.coverage.shadowVintagesPassed,
      publicCapabilityActivated: value.coverage.publicCapabilityActivated,
    },
    revisionReportSha256: value.revisionReportSha256,
    conformanceReportSha256: value.conformanceReportSha256,
    capabilities: [...value.capabilities].sort(compareCapability),
    quality: value.quality,
    attribution: {
      statement: value.attribution.statement,
      license: {
        name: value.attribution.license.name,
        url: value.attribution.license.url,
      },
    },
    supersedesPackageIdentity: value.supersedesPackageIdentity,
  };
}

function validateManifestShape(
  manifest: RecentTradeMomentumDatasetPackageManifest,
): void {
  if (
    manifest.schemaVersion !== "monthly-trade-dataset-package-manifest-v1" ||
    manifest.artifactSchemaVersion !== "monthly-trade-artifact-v1" ||
    manifest.resultSchemaVersion !== "recent-trade-momentum-result-v1" ||
    manifest.recipeId !== "recent-trade-momentum-v1" ||
    manifest.capability !==
      "recent-trade-momentum/reporting-market-import-value@1" ||
    manifest.mappingPolicy !== "cn-to-hs12-exact-complete-preimage-v1" ||
    manifest.sourceDataset !== "EUROSTAT_COMEXT_DETAIL" ||
    manifest.coverage.expectedHistoryMonths !== 24 ||
    manifest.coverage.publicCapabilityActivated !== false ||
    manifest.artifact.sha256 !== manifest.artifactSha256
  ) {
    throw new TypeError("Recent Trade Momentum Dataset Package manifest is incompatible.");
  }
  for (const [label, value] of [
    ["source objects", manifest.sourceObjectsSha256],
    ["source metadata", manifest.sourceMetadataSha256],
    ["mapping evidence", manifest.mappingEvidenceSha256],
    ["artifact", manifest.artifactSha256],
    ["revision report", manifest.revisionReportSha256],
    ["conformance report", manifest.conformanceReportSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new TypeError(`${label} identity must be a SHA-256 digest.`);
    }
  }
  if (
    !/^\d{4}-\d{2}$/u.test(manifest.referenceMonthRange.start) ||
    !/^\d{4}-\d{2}$/u.test(manifest.referenceMonthRange.end) ||
    manifest.reporterAllowlist.length === 0 ||
    manifest.reporterAllowlist.some((reporter) => !/^[A-Z]{2}$/u.test(reporter)) ||
    Object.values(manifest.rowCounts).some(
      (count) => !Number.isSafeInteger(count) || count < 0,
    ) ||
    !Number.isSafeInteger(manifest.artifact.bytes) ||
    manifest.artifact.bytes < 0 ||
    manifest.quality.status === "blocked" && manifest.quality.reason.length === 0
  ) {
    throw new TypeError("Recent Trade Momentum Dataset Package manifest is malformed.");
  }
}

function compareCapability(
  left: Readonly<{ id: string; version: string }>,
  right: Readonly<{ id: string; version: string }>,
): number {
  return left.id.localeCompare(right.id) || left.version.localeCompare(right.version);
}
