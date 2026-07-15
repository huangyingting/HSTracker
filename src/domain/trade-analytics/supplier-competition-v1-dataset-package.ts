import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS = [
  { id: "supplier-competition/supplier-annual-value", version: "1" },
  { id: "supplier-competition/supplier-structure", version: "1" },
  { id: "supplier-competition/economy-identity", version: "1" },
  { id: "supplier-competition/hs-product-identity", version: "1" },
  { id: "supplier-competition/period-coverage", version: "1" },
] as const;

// This is the artifact-declared counterpart of
// CANDIDATE_MARKET_V1_DATASET_DECLARATION and
// TRADE_TREND_V1_DATASET_DECLARATION: the published analysis artifact
// carries this declaration so createSupplierCompetitionDatasetPackageFrom
// Artifacts() derives its package from reviewed, artifact-embedded
// capabilities instead of synthesizing them from
// SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS directly.
// evaluateSupplierCompetitionV1DatasetPackage() still checks the declared
// capabilities against those requirements, so a divergent declaration fails
// closed.
export type SupplierCompetitionDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "supplier-competition-dataset-capabilities-v1";
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}>;

export const SUPPLIER_COMPETITION_V1_DATASET_DECLARATION: SupplierCompetitionDatasetCapabilityDeclaration =
  {
    schemaVersion: "supplier-competition-dataset-capabilities-v1",
    capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
  };

export function parseSupplierCompetitionDatasetCapabilityDeclaration(
  value: unknown,
): SupplierCompetitionDatasetCapabilityDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(
      "Supplier Competition Dataset Package capability declaration must be an object.",
    );
  }
  const declaration = value as Record<string, unknown>;
  if (
    declaration.schemaVersion !==
    "supplier-competition-dataset-capabilities-v1"
  ) {
    throw new TypeError(
      "Supplier Competition Dataset Package capability declaration schema is incompatible.",
    );
  }
  if (!Array.isArray(declaration.capabilities)) {
    throw new TypeError(
      "Supplier Competition Dataset Package capabilities must be an array.",
    );
  }
  const capabilities = declaration.capabilities.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(
        `Supplier Competition Dataset Package capability ${index} must be an object.`,
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
        `Supplier Competition Dataset Package capability ${index} is malformed.`,
      );
    }
    return { id: capability.id, version: capability.version };
  });
  if (new Set(capabilities.map(({ id }) => id)).size !== capabilities.length) {
    throw new TypeError(
      "Supplier Competition Dataset Package capability IDs must be unique.",
    );
  }
  return {
    schemaVersion: "supplier-competition-dataset-capabilities-v1",
    capabilities: [...capabilities].sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version),
    ),
  };
}

export type SupplierCompetitionDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: Readonly<{
    schemaVersion: "supplier-competition-dataset-package-manifest-v1";
    baciRelease: string;
    hsRevision: "HS12";
    finalizedYearCount: 5;
    evidenceSha256: string;
    capabilities: readonly Readonly<{ id: string; version: string }>[];
  }>;
}>;

export function createSupplierCompetitionDatasetPackage(value: {
  schemaVersion: "supplier-competition-dataset-package-manifest-v1";
  baciRelease: string;
  hsRevision: "HS12";
  finalizedYearCount: 5;
  evidenceSha256: string;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}): SupplierCompetitionDatasetPackage {
  if (!/^[a-f0-9]{64}$/u.test(value.evidenceSha256)) {
    throw new TypeError(
      "Supplier Competition Dataset Package evidence identity must be SHA-256.",
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

export function evaluateSupplierCompetitionV1DatasetPackage(
  datasetPackage: SupplierCompetitionDatasetPackage,
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
    manifest.schemaVersion !==
      "supplier-competition-dataset-package-manifest-v1" ||
    manifest.hsRevision !== "HS12" ||
    manifest.finalizedYearCount !== 5 ||
    !/^[a-f0-9]{64}$/u.test(manifest.evidenceSha256)
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  if (
    createSupplierCompetitionDatasetPackage(manifest).identity !==
    datasetPackage.identity
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  const capabilities = new Map(
    manifest.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const required of SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS) {
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
