import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const TRADE_TREND_V1_CAPABILITY_REQUIREMENTS = [
  { id: "trade-trend/importer-annual-value", version: "1" },
  { id: "trade-trend/economy-identity", version: "1" },
  { id: "trade-trend/hs-product-identity", version: "1" },
] as const;

// This is the artifact-declared counterpart of
// CANDIDATE_MARKET_V1_DATASET_DECLARATION: the published analysis artifact
// carries this declaration so createTradeTrendDatasetPackageFromArtifacts()
// derives its package from reviewed, artifact-embedded capabilities instead
// of synthesizing them from TRADE_TREND_V1_CAPABILITY_REQUIREMENTS directly.
// evaluateTradeTrendV1DatasetPackage() still checks the declared capabilities
// against those requirements, so a divergent declaration fails closed.
export type TradeTrendDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "trade-trend-dataset-capabilities-v1";
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}>;

export const TRADE_TREND_V1_DATASET_DECLARATION: TradeTrendDatasetCapabilityDeclaration =
  {
    schemaVersion: "trade-trend-dataset-capabilities-v1",
    capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
  };

export function parseTradeTrendDatasetCapabilityDeclaration(
  value: unknown,
): TradeTrendDatasetCapabilityDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(
      "Trade Trend Dataset Package capability declaration must be an object.",
    );
  }
  const declaration = value as Record<string, unknown>;
  if (
    declaration.schemaVersion !== "trade-trend-dataset-capabilities-v1"
  ) {
    throw new TypeError(
      "Trade Trend Dataset Package capability declaration schema is incompatible.",
    );
  }
  if (!Array.isArray(declaration.capabilities)) {
    throw new TypeError(
      "Trade Trend Dataset Package capabilities must be an array.",
    );
  }
  const capabilities = declaration.capabilities.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(
        `Trade Trend Dataset Package capability ${index} must be an object.`,
      );
    }
    const capability = entry as Record<string, unknown>;
    if (
      typeof capability.id !== "string" ||
      capability.id.length === 0 ||
      typeof capability.version !== "string" ||
      capability.version.length === 0
    ) {
      throw new TypeError(
        `Trade Trend Dataset Package capability ${index} is malformed.`,
      );
    }
    return { id: capability.id, version: capability.version };
  });
  if (new Set(capabilities.map(({ id }) => id)).size !== capabilities.length) {
    throw new TypeError(
      "Trade Trend Dataset Package capability IDs must be unique.",
    );
  }
  return {
    schemaVersion: "trade-trend-dataset-capabilities-v1",
    capabilities: [...capabilities].sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version),
    ),
  };
}

export type TradeTrendDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: Readonly<{
    schemaVersion: "trade-trend-dataset-package-manifest-v1";
    baciRelease: string;
    hsRevision: "HS12";
    finalizedYearCount: 5;
    evidenceSha256: string;
    capabilities: readonly Readonly<{ id: string; version: string }>[];
  }>;
}>;

export function createTradeTrendDatasetPackage(value: {
  schemaVersion: "trade-trend-dataset-package-manifest-v1";
  baciRelease: string;
  hsRevision: "HS12";
  finalizedYearCount: 5;
  evidenceSha256: string;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}): TradeTrendDatasetPackage {
  if (!/^[a-f0-9]{64}$/u.test(value.evidenceSha256)) {
    throw new TypeError(
      "Trade Trend Dataset Package evidence identity must be SHA-256.",
    );
  }
  const manifest = {
    ...value,
    capabilities: [...value.capabilities].sort(
      (left, right) =>
        left.id.localeCompare(right.id) || left.version.localeCompare(right.version),
    ),
  } as const;
  const canonical = JSON.stringify(manifest);
  const identity = `dataset-package-v1-${createHash("sha256")
    .update(canonical)
    .digest("hex")}` as DatasetPackageIdentity;
  return { identity, manifest };
}

export function evaluateTradeTrendV1DatasetPackage(
  datasetPackage: TradeTrendDatasetPackage,
): Readonly<
  | { compatible: true }
  | {
      compatible: false;
      reason:
        | "MISSING_REQUIRED_CAPABILITY"
        | "CAPABILITY_VERSION_MISMATCH"
        | "PACKAGE_IDENTITY_MISMATCH";
    }
> {
  const { manifest } = datasetPackage;
  if (
    manifest.schemaVersion !== "trade-trend-dataset-package-manifest-v1" ||
    manifest.hsRevision !== "HS12" ||
    manifest.finalizedYearCount !== 5 ||
    !/^[a-f0-9]{64}$/u.test(manifest.evidenceSha256)
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  if (
    createTradeTrendDatasetPackage(manifest).identity !==
    datasetPackage.identity
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  const capabilities = new Map(
    manifest.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const required of TRADE_TREND_V1_CAPABILITY_REQUIREMENTS) {
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
