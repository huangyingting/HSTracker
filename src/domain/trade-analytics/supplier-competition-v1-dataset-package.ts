import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS = [
  { id: "supplier-competition/supplier-annual-value", version: "1" },
  { id: "supplier-competition/economy-identity", version: "1" },
  { id: "supplier-competition/hs-product-identity", version: "1" },
] as const;

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
