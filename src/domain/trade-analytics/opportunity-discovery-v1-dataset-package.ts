import { createHash } from "node:crypto";

import type { DatasetPackageIdentity } from "./dataset-package";

export const OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS = [
  { id: "opportunity-discovery/bilateral-annual-value", version: "1" },
  { id: "opportunity-discovery/economy-identity", version: "1" },
  { id: "opportunity-discovery/hs-product-identity", version: "1" },
  { id: "opportunity-discovery/market-annual-value", version: "1" },
  { id: "opportunity-discovery/product-annual-value", version: "1" },
] as const;

export type OpportunityDiscoveryDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "opportunity-discovery-dataset-capabilities-v1";
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}>;

export const OPPORTUNITY_DISCOVERY_V1_DATASET_DECLARATION: OpportunityDiscoveryDatasetCapabilityDeclaration =
  {
    schemaVersion: "opportunity-discovery-dataset-capabilities-v1",
    capabilities: OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
  };

export type OpportunityDiscoveryDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: Readonly<{
    schemaVersion: "opportunity-discovery-dataset-package-manifest-v1";
    baciRelease: string;
    hsRevision: "HS12";
    finalizedYearCount: 5;
    evidenceSha256: string;
    capabilities: readonly Readonly<{ id: string; version: string }>[];
  }>;
}>;

export function createOpportunityDiscoveryDatasetPackage(value: {
  schemaVersion: "opportunity-discovery-dataset-package-manifest-v1";
  baciRelease: string;
  hsRevision: "HS12";
  finalizedYearCount: 5;
  evidenceSha256: string;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
}): OpportunityDiscoveryDatasetPackage {
  if (!/^[a-f0-9]{64}$/u.test(value.evidenceSha256)) {
    throw new TypeError(
      "Opportunity Discovery Dataset Package evidence identity must be SHA-256.",
    );
  }
  const manifest = {
    ...value,
    capabilities: [...value.capabilities].sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version),
    ),
  } as const;
  const canonical = JSON.stringify(manifest);
  const identity = `dataset-package-v1-${createHash("sha256")
    .update(canonical)
    .digest("hex")}` as DatasetPackageIdentity;
  return { identity, manifest };
}

export function evaluateOpportunityDiscoveryV1DatasetPackage(
  datasetPackage: OpportunityDiscoveryDatasetPackage,
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
      "opportunity-discovery-dataset-package-manifest-v1" ||
    manifest.hsRevision !== "HS12" ||
    manifest.finalizedYearCount !== 5 ||
    !/^[a-f0-9]{64}$/u.test(manifest.evidenceSha256)
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  if (
    createOpportunityDiscoveryDatasetPackage(manifest).identity !==
    datasetPackage.identity
  ) {
    return { compatible: false, reason: "PACKAGE_IDENTITY_MISMATCH" };
  }
  const capabilities = new Map(
    manifest.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const required of OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS) {
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
