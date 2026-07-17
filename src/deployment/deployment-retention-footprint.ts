import {
  DEPLOYMENT_RETENTION_WINDOW_SIZE,
  releaseJsonBytes,
  type AnalysisReleaseCatalog,
  type DeploymentPairingManifest,
  type ReleaseObjectReference,
} from "../release/release-manifest";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import {
  statfsFilesystemCapacityProbe,
  type FilesystemCapacity,
  type FilesystemCapacityProbe,
} from "./filesystem-capacity";

export type { FilesystemCapacity, FilesystemCapacityProbe };
export { statfsFilesystemCapacityProbe };

// One retained pairing's contribution to the window footprint. Its own
// Release Revision "previous" artifact (see release-hydration.ts, which
// materializes `previous-candidate-market.duckdb` /
// `previous-artifact-manifest.json` onto disk whenever
// `analysisReleaseCatalog.previous !== null`) lives outside the pairing
// manifest itself, so a caller that already has the parsed release
// catalog on hand (the runtime does, from hydration) supplies it here for
// an exact count; a caller without it (promotion, before that catalog is
// fetched) still gets a correct-but-conservative count that omits it.
export type DeploymentRetentionFootprintPairing = Readonly<{
  pairing: DeploymentPairingManifest;
  releaseCatalog?: AnalysisReleaseCatalog;
  // Dataset Package manifests are referenced inside the parsed Recommended
  // Dataset Mapping rather than directly by the pairing manifest. Promotion
  // resolves them from object storage and startup resolves them from the verified
  // resident mapping so the separately materialized objects are still counted.
  datasetPackageManifest?: ReleaseObjectReference;
  recentTradeMomentumDatasetPackageManifest?: ReleaseObjectReference;
  recentTradeMomentumArtifact?: ReleaseObjectReference;
  opportunityDatasetPackageManifest?: ReleaseObjectReference;
}>;

export type DeploymentRetentionFootprint = Readonly<{
  // Content-addressed object bytes referenced by any pairing in the
  // window, counted once even when several pairings reference the exact
  // same immutable object (see issue #44 "do not double-count
  // content-addressed shared objects").
  uniqueObjectBytes: number;
  // Each pairing's own deployment-pairing manifest JSON bytes, which are
  // never shared across pairings (distinct content-addressed keys).
  pairingMetadataBytes: number;
  // One configured DuckDB spill allowance per retained pairing: each
  // retained deployment opens its own isolated DuckDB instance and spill
  // directory (see verified-release-runtime.ts).
  spillReserveBytes: number;
  requiredBytes: number;
}>;

export type DeploymentRetentionHeadroomResult = Readonly<{
  footprint: DeploymentRetentionFootprint;
  safetyReserveBytes: number;
  requiredFreeBytes: number;
  capacity: FilesystemCapacity;
  fits: boolean;
}>;

/**
 * Sums the resident-volume bytes a retention window of 1-3 deployment
 * pairings requires, deduplicating any content-addressed object (artifact,
 * artifact manifest, release catalog, product catalog, catalog manifest,
 * mapping manifest, Dataset Package manifests, Opportunity Index objects, and -- when the caller supplies
 * a pairing's own parsed release catalog -- its Release Revision previous
 * artifact and manifest)
 * that more than one pairing references by key, and adding one DuckDB
 * spill reserve per pairing (each retained deployment hydrates and opens
 * its own isolated DuckDB instance).
 */
export function calculateDeploymentRetentionFootprint(
  pairings: readonly (
    | DeploymentPairingManifest
    | DeploymentRetentionFootprintPairing
  )[],
): DeploymentRetentionFootprint {
  if (
    pairings.length === 0 ||
    pairings.length > DEPLOYMENT_RETENTION_WINDOW_SIZE
  ) {
    throw new Error(
      `A deployment retention footprint requires 1-${DEPLOYMENT_RETENTION_WINDOW_SIZE} pairings within the retention window.`,
    );
  }
  const entries = pairings.map(normalizeFootprintPairing);
  const uniqueObjects = new Map<string, number>();
  let pairingMetadataBytes = 0;
  for (const {
    pairing,
    releaseCatalog,
    datasetPackageManifest,
    recentTradeMomentumDatasetPackageManifest,
    recentTradeMomentumArtifact,
    opportunityDatasetPackageManifest,
  } of entries) {
    for (const reference of pairingReferencedObjects(
      pairing,
      releaseCatalog,
      datasetPackageManifest,
      recentTradeMomentumDatasetPackageManifest,
      recentTradeMomentumArtifact,
      opportunityDatasetPackageManifest,
    )) {
      uniqueObjects.set(reference.key, reference.bytes);
    }
    pairingMetadataBytes += releaseJsonBytes(pairing).byteLength;
  }
  const uniqueObjectBytes = sum([...uniqueObjects.values()]);
  const spillReserveBytes =
    parseByteSize(RUNTIME_RESOURCE_POLICY.duckDbMaxTempDirectorySize) *
    entries.length;
  return {
    uniqueObjectBytes,
    pairingMetadataBytes,
    spillReserveBytes,
    requiredBytes: uniqueObjectBytes + pairingMetadataBytes + spillReserveBytes,
  };
}

/**
 * Evaluates whether `capacity` (a real or declared filesystem capacity —
 * see `filesystem-capacity.ts`) has enough actual free bytes for the
 * retention window's required footprint plus a safety reserve. The
 * reserve is a fraction of the *declared* serving-volume policy size
 * (`referenceVolumeBytes`, defaulting to
 * `RUNTIME_RESOURCE_POLICY.deploymentRetention.declaredServingVolumeBytes`)
 * rather than of whatever the underlying filesystem's total capacity
 * happens to be: the deployment is provisioned at that declared size (see
 * docs/production-deployment.md), so the operational margin it needs is
 * fixed regardless of how large the surrounding disk is. Used both by
 * promotion (against the declared baseline policy volume) and by the
 * runtime (against the actual serving volume via
 * `statfsFilesystemCapacityProbe`) before committing resident activation,
 * so the same dedup/spill/reserve math backs both gates.
 */
export function evaluateDeploymentRetentionHeadroom(
  pairings: readonly (
    | DeploymentPairingManifest
    | DeploymentRetentionFootprintPairing
  )[],
  capacity: FilesystemCapacity,
  options: {
    minimumFreeFraction?: number;
    referenceVolumeBytes?: number;
  } = {},
): DeploymentRetentionHeadroomResult {
  const minimumFreeFraction =
    options.minimumFreeFraction ??
    RUNTIME_RESOURCE_POLICY.deploymentRetention.minimumFreeFraction;
  const referenceVolumeBytes =
    options.referenceVolumeBytes ??
    RUNTIME_RESOURCE_POLICY.deploymentRetention.declaredServingVolumeBytes;
  const footprint = calculateDeploymentRetentionFootprint(pairings);
  const safetyReserveBytes = Math.ceil(
    referenceVolumeBytes * minimumFreeFraction,
  );
  const requiredFreeBytes = footprint.requiredBytes + safetyReserveBytes;
  return {
    footprint,
    safetyReserveBytes,
    requiredFreeBytes,
    capacity,
    fits: capacity.freeBytes >= requiredFreeBytes,
  };
}

/**
 * The promotion-time gate: promotion cannot see the runtime's actual
 * serving-volume free space, so it enforces the declared baseline volume
 * policy instead, treating that declared volume as though it were empty.
 * This is the "promotion max/declared policy" half of issue #44's headroom
 * requirement; `evaluateDeploymentRetentionHeadroom` with a real
 * `FilesystemCapacity` is the runtime pre-activation half.
 */
export function evaluateDeclaredDeploymentRetentionPolicy(
  pairings: readonly (
    | DeploymentPairingManifest
    | DeploymentRetentionFootprintPairing
  )[],
  declaredServingVolumeBytes: number = RUNTIME_RESOURCE_POLICY
    .deploymentRetention.declaredServingVolumeBytes,
): DeploymentRetentionHeadroomResult {
  return evaluateDeploymentRetentionHeadroom(
    pairings,
    { totalBytes: declaredServingVolumeBytes, freeBytes: declaredServingVolumeBytes },
    { referenceVolumeBytes: declaredServingVolumeBytes },
  );
}

function normalizeFootprintPairing(
  input: DeploymentPairingManifest | DeploymentRetentionFootprintPairing,
): DeploymentRetentionFootprintPairing {
  return "pairing" in input ? input : { pairing: input };
}

function pairingReferencedObjects(
  pairing: DeploymentPairingManifest,
  releaseCatalog: AnalysisReleaseCatalog | undefined,
  datasetPackageManifest: ReleaseObjectReference | undefined,
  recentTradeMomentumDatasetPackageManifest: ReleaseObjectReference | undefined,
  recentTradeMomentumArtifact: ReleaseObjectReference | undefined,
  opportunityDatasetPackageManifest: ReleaseObjectReference | undefined,
): readonly ReleaseObjectReference[] {
  const references: ReleaseObjectReference[] = [
    pairing.analysis.artifact.artifact,
    pairing.analysis.artifact.manifest,
    pairing.analysis.releaseCatalog,
    pairing.productSearch.catalog,
    pairing.productSearch.manifest,
  ];
  if (pairing.recommendedDatasetMapping !== null) {
    references.push(pairing.recommendedDatasetMapping.manifest);
  }
  if (datasetPackageManifest !== undefined) {
    references.push(datasetPackageManifest);
  }
  if (recentTradeMomentumDatasetPackageManifest !== undefined) {
    references.push(recentTradeMomentumDatasetPackageManifest);
  }
  if (recentTradeMomentumArtifact !== undefined) {
    references.push(recentTradeMomentumArtifact);
  }
  if (opportunityDatasetPackageManifest !== undefined) {
    references.push(opportunityDatasetPackageManifest);
  }
  if (pairing.opportunityIndex !== null) {
    references.push(
      pairing.opportunityIndex.object,
      pairing.opportunityIndex.manifest,
    );
  }
  if (releaseCatalog?.previous != null) {
    references.push(
      releaseCatalog.previous.artifact,
      releaseCatalog.previous.manifest,
    );
  }
  return references;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const BYTE_SIZE_UNITS: Readonly<Record<string, number>> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

function parseByteSize(value: string): number {
  const match = /^(\d+)(B|KiB|MiB|GiB|TiB)$/u.exec(value);
  if (match === null) {
    throw new Error(`${value} is not a recognized byte size.`);
  }
  const [, amount, unit] = match;
  return Number(amount) * BYTE_SIZE_UNITS[unit!]!;
}
