import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS = [
  { id: "trade-explorer/bilateral-annual-value", version: "1" },
  { id: "trade-explorer/economy-identity", version: "1" },
  { id: "trade-explorer/hs-product-identity", version: "1" },
  { id: "trade-explorer/period-coverage", version: "1" },
] as const;

// The artifact-declared counterpart of CANDIDATE_MARKET_V1_DATASET_
// DECLARATION / TRADE_TREND_V1_DATASET_DECLARATION /
// SUPPLIER_COMPETITION_V1_DATASET_DECLARATION: the published analysis
// artifact carries this declaration so a future production adapter (#47)
// derives its package from reviewed, artifact-embedded capabilities
// instead of synthesizing them from TRADE_EXPLORER_V1_CAPABILITY_
// REQUIREMENTS directly. evaluateTradeExplorerV1DatasetPackage() still
// checks the declared capabilities against those requirements, so a
// divergent declaration fails closed.
export type TradeExplorerDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "trade-explorer-dataset-capabilities-v1";
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}>;

export const TRADE_EXPLORER_V1_DATASET_DECLARATION: TradeExplorerDatasetCapabilityDeclaration =
  {
    schemaVersion: "trade-explorer-dataset-capabilities-v1",
    capabilities: TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
  };

export function parseTradeExplorerDatasetCapabilityDeclaration(
  value: unknown,
): TradeExplorerDatasetCapabilityDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(
      "Trade Explorer Dataset Package capability declaration must be an object.",
    );
  }
  const declaration = value as Record<string, unknown>;
  if (
    declaration.schemaVersion !== "trade-explorer-dataset-capabilities-v1"
  ) {
    throw new TypeError(
      "Trade Explorer Dataset Package capability declaration schema is incompatible.",
    );
  }
  if (!Array.isArray(declaration.capabilities)) {
    throw new TypeError(
      "Trade Explorer Dataset Package capabilities must be an array.",
    );
  }
  const capabilities = declaration.capabilities.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(
        `Trade Explorer Dataset Package capability ${index} must be an object.`,
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
        `Trade Explorer Dataset Package capability ${index} is malformed.`,
      );
    }
    return { id: capability.id, version: capability.version };
  });
  if (new Set(capabilities.map(({ id }) => id)).size !== capabilities.length) {
    throw new TypeError(
      "Trade Explorer Dataset Package capability IDs must be unique.",
    );
  }
  return {
    schemaVersion: "trade-explorer-dataset-capabilities-v1",
    capabilities: [...capabilities].sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version),
    ),
  };
}

export type TradeExplorerDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: Readonly<{
    schemaVersion: "trade-explorer-dataset-package-manifest-v1";
    baciRelease: string;
    hsRevision: "HS12";
    finalizedYearCount: 5;
    // The exact finalized-window upper bound this package serves. Trade
    // Explorer needs this available from the Dataset Package itself
    // (rather than only from loaded evidence) so normalizeTradeExplorerV1
    // Request can validate/expand year filters against a real window
    // before evidence loading -- see trade-analytics-platform.ts's
    // executeTradeExplorerV1, which resolves this before calling
    // validateTradeExplorerV1Request.
    finalizedCutoffYear: number;
    evidenceSha256: string;
    capabilities: readonly Readonly<{ id: string; version: string }>[];
  }>;
}>;

export function createTradeExplorerDatasetPackage(value: {
  schemaVersion: "trade-explorer-dataset-package-manifest-v1";
  baciRelease: string;
  hsRevision: "HS12";
  finalizedYearCount: 5;
  finalizedCutoffYear: number;
  evidenceSha256: string;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}): TradeExplorerDatasetPackage {
  if (!/^[a-f0-9]{64}$/u.test(value.evidenceSha256)) {
    throw new TypeError(
      "Trade Explorer Dataset Package evidence identity must be SHA-256.",
    );
  }
  if (!Number.isSafeInteger(value.finalizedCutoffYear)) {
    throw new TypeError(
      "Trade Explorer Dataset Package finalizedCutoffYear must be a safe integer.",
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

export function evaluateTradeExplorerV1DatasetPackage(
  datasetPackage: TradeExplorerDatasetPackage,
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
    manifest.schemaVersion !== "trade-explorer-dataset-package-manifest-v1" ||
    manifest.hsRevision !== "HS12" ||
    manifest.finalizedYearCount !== 5 ||
    !Number.isSafeInteger(manifest.finalizedCutoffYear) ||
    !/^[a-f0-9]{64}$/u.test(manifest.evidenceSha256)
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  if (
    createTradeExplorerDatasetPackage(manifest).identity !==
    datasetPackage.identity
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  const capabilities = new Map(
    manifest.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const required of TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS) {
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
