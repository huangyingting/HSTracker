import { createHash } from "node:crypto";

import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import type { ReleaseObjectIdentity } from "./release-object-store";
import {
  boolean,
  count,
  hs12,
  prefixedId,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "./release-validation";

export const ACTIVE_DEPLOYMENT_POINTER_KEY =
  "deployment-pointers/current.json";
export const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;

// The retention window is exactly one current deployment pairing plus two
// preceding compatible complete pairings (see CONTEXT.md and issue #44).
// `DEPLOYMENT_RETENTION_HISTORY_LIMIT` bounds `ActiveDeploymentPointer.history`
// (the predecessors alone; `current` is tracked separately).
export const DEPLOYMENT_RETENTION_WINDOW_SIZE = 3;
export const DEPLOYMENT_RETENTION_HISTORY_LIMIT =
  DEPLOYMENT_RETENTION_WINDOW_SIZE - 1;

export type ReleaseObjectReference = ReleaseObjectIdentity & {
  key: string;
};

export type AnalysisArtifactReference = {
  baciRelease: string;
  sourceSha256: string;
  hsRevision: "HS12";
  artifactBuildId: string;
  artifactSchemaVersion: string;
  artifact: ReleaseObjectReference;
  manifest: ReleaseObjectReference;
};

export type ProductCatalogReference = {
  baciRelease: string;
  sourceArchiveSha256: string;
  hsRevision: "HS12";
  productSearchBuildId: string;
  catalogSchemaVersion: string;
  catalog: ReleaseObjectReference;
  manifest: ReleaseObjectReference;
};

export type RecommendedDatasetMappingReference = {
  identity: string;
  manifest: ReleaseObjectReference;
};

export type OpportunityIndexReference = {
  schemaVersion: "opportunity-index-v1";
  object: ReleaseObjectReference;
  manifest: ReleaseObjectReference;
};

export type DeploymentPairingManifest = {
  schemaVersion: "deployment-pairing-manifest-v1";
  deploymentPairingId: string;
  baciRelease: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  sourceStatusFallback: SourceStatusSnapshot;
  analysis: {
    artifact: AnalysisArtifactReference;
    releaseCatalog: ReleaseObjectReference;
  };
  productSearch: ProductCatalogReference;
  recommendedDatasetMapping:
    | RecommendedDatasetMappingReference
    | null;
  opportunityIndex: OpportunityIndexReference | null;
  // The declared resident-volume footprint (bytes) this one pairing alone
  // requires for its directly referenced objects: its analysis artifact,
  // artifact manifest, analysis release catalog, product catalog, product
  // catalog manifest, and (when present) Recommended Dataset Mapping
  // manifest. The complete retention gate additionally counts the Dataset
  // Package manifest nested inside that mapping and Release Revision evidence
  // nested inside the release catalog. This value excludes the pairing
  // manifest's own bytes (avoiding self-reference) and is deterministically
  // derived from the other fields above, so it
  // participates in `deploymentPairingId` like any other field. Promotion
  // and runtime headroom gates sum this across the retention window
  // (deduplicating shared content-addressed objects) rather than trusting
  // an unverified operator-supplied number. See
  // `deployment-retention-footprint.ts`.
  residentFootprintBytes: number;
};

export type AnalysisReleaseCatalog = {
  schemaVersion: "analysis-release-catalog-v1";
  current: AnalysisArtifactReference;
  previous: AnalysisArtifactReference | null;
  scoreVersion: "cms-v1";
  resultSchemaVersion: "candidate-market-result-v1";
};

export type ActiveDeploymentPointer = {
  schemaVersion: "active-deployment-pointer-v1";
  current: ReleaseObjectReference;
  // Predecessors beyond `current`, most-recent-first (immediate predecessor
  // first), holding at most `DEPLOYMENT_RETENTION_HISTORY_LIMIT` entries.
  // Legacy pointers persisted before the retention window existed carried
  // a single nullable `previous` reference instead; `parseActiveDeploymentPointer`
  // normalizes that shape into `history` on read (see issue #44).
  history: readonly ReleaseObjectReference[];
  sourceStatusFallback: SourceStatusSnapshot;
  activatedAt: string;
};

export type PublishedDeployment = {
  schemaVersion: "published-deployment-v1";
  deploymentPairingId: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
  productSearchBuildId: string;
  baciRelease: string;
  sourceStatusFallback: SourceStatusSnapshot;
  activatedAt: string;
  previousDeploymentPairingId: string | null;
  recommendedDatasetMappingIdentity: string | null;
  opportunityIndex: OpportunityIndexReference | null;
};

export function parseActiveDeploymentPointer(
  value: unknown,
): ActiveDeploymentPointer {
  const pointer = record(value, "active deployment pointer");
  if (pointer.schemaVersion !== "active-deployment-pointer-v1") {
    throw new Error("Active deployment pointer schema is incompatible.");
  }
  return {
    schemaVersion: "active-deployment-pointer-v1",
    current: objectReference(pointer.current, "current deployment"),
    history: parsePointerHistory(pointer),
    sourceStatusFallback: parseSourceStatusSnapshot(
      pointer.sourceStatusFallback,
      "active deployment Source Freshness Status fallback",
    ),
    activatedAt: utcTimestamp(pointer.activatedAt, "pointer activatedAt"),
  };
}

// Reads the current `history` array when present. Pointers persisted
// before the retention window existed instead carried a single nullable
// `previous` reference; that legacy shape normalizes to `[]` or a
// one-element array rather than failing closed on old data (see issue #44
// "evolve compatibly with legacy manifests/pointers").
function parsePointerHistory(
  pointer: Record<string, unknown>,
): readonly ReleaseObjectReference[] {
  if (pointer.history !== undefined) {
    if (!Array.isArray(pointer.history)) {
      throw new Error("Active deployment pointer history must be an array.");
    }
    if (pointer.history.length > DEPLOYMENT_RETENTION_HISTORY_LIMIT) {
      throw new Error(
        "Active deployment pointer history exceeds the retention window.",
      );
    }
    return pointer.history.map((entry, index) =>
      objectReference(entry, `history[${index}] deployment`),
    );
  }
  if (pointer.previous === undefined) {
    throw new Error("Active deployment pointer is missing history.");
  }
  return pointer.previous === null
    ? []
    : [objectReference(pointer.previous, "previous deployment")];
}

export function parseDeploymentPairingManifest(
  value: unknown,
): DeploymentPairingManifest {
  const deployment = record(value, "deployment pairing manifest");
  if (deployment.schemaVersion !== "deployment-pairing-manifest-v1") {
    throw new Error("Deployment pairing manifest schema is incompatible.");
  }
  const analysis = record(deployment.analysis, "deployment analysis");
  const productSearch = record(
    deployment.productSearch,
    "deployment product search",
  );
  const releaseCatalog = objectReference(
    analysis.releaseCatalog,
    "deployment analysis release catalog",
  );
  const analysisReleaseCatalogSha256 = sha256String(
    deployment.analysisReleaseCatalogSha256,
    "analysis release catalog SHA-256",
  );
  if (releaseCatalog.sha256 !== analysisReleaseCatalogSha256) {
    throw new Error("Analysis release catalog identity is inconsistent.");
  }
  const analysisArtifact = analysisArtifactReference(
    analysis.artifact,
    "deployment analysis artifact",
  );
  const productSearchReference = productCatalogReference(
    productSearch,
    "deployment product search",
  );
  const recommendedDatasetMapping =
    deployment.recommendedDatasetMapping === undefined ||
    deployment.recommendedDatasetMapping === null
      ? null
      : recommendedDatasetMappingReference(
          deployment.recommendedDatasetMapping,
        );
  const opportunityIndex =
    deployment.opportunityIndex === undefined ||
    deployment.opportunityIndex === null
      ? null
      : opportunityIndexReference(deployment.opportunityIndex);
  // Manifests promoted before the retention window existed predate this
  // field entirely; normalize their absent declaration by computing it
  // rather than failing closed on old data (see issue #44 "evolve
  // compatibly with legacy manifests/pointers").
  const legacyWithoutResidentFootprint =
    deployment.residentFootprintBytes === undefined;
  const residentFootprintBytes = legacyWithoutResidentFootprint
    ? calculatePairingResidentFootprintBytes({
        analysis: { artifact: analysisArtifact, releaseCatalog },
        productSearch: productSearchReference,
        recommendedDatasetMapping,
        opportunityIndex,
      })
    : count(
        deployment.residentFootprintBytes,
        "deployment resident footprint bytes",
      );
  const parsed: DeploymentPairingManifest = {
    schemaVersion: "deployment-pairing-manifest-v1",
    deploymentPairingId: prefixedId(
      deployment.deploymentPairingId,
      "deployment pairing ID",
      "deployment-pairing-v1",
    ),
    baciRelease: string(deployment.baciRelease, "deployment BACI Release"),
    analysisBuildId: prefixedId(
      deployment.analysisBuildId,
      "deployment analysis build ID",
      "analysis-build-v1",
    ),
    analysisReleaseCatalogSha256,
    productSearchBuildId: prefixedId(
      deployment.productSearchBuildId,
      "product-search build ID",
      "product-search-v1",
    ),
    sourceStatusFallback: parseSourceStatusSnapshot(
      deployment.sourceStatusFallback,
      "deployment Source Freshness Status fallback",
    ),
    analysis: {
      artifact: analysisArtifact,
      releaseCatalog,
    },
    productSearch: productSearchReference,
    recommendedDatasetMapping,
    opportunityIndex,
    residentFootprintBytes,
  };
  validateDeploymentPairingManifest(parsed, {
    legacyWithoutRecommendedDatasetMapping:
      deployment.recommendedDatasetMapping === undefined,
    legacyWithoutOpportunityIndex: deployment.opportunityIndex === undefined,
    legacyWithoutResidentFootprint,
  });
  return parsed;
}

// The declared resident-volume footprint (bytes) one pairing alone
// requires for its directly referenced, content-addressed objects. The
// complete Deployment Retention Window footprint also resolves and counts
// objects nested inside the mapping and release catalog. This deliberately
// excludes the pairing manifest's own serialized bytes to avoid self-reference.
export function calculatePairingResidentFootprintBytes(
  pairing: Pick<
    DeploymentPairingManifest,
    "analysis" | "productSearch" | "recommendedDatasetMapping"
  > &
    Readonly<{ opportunityIndex?: OpportunityIndexReference | null }>,
): number {
  return (
    pairing.analysis.artifact.artifact.bytes +
    pairing.analysis.artifact.manifest.bytes +
    pairing.analysis.releaseCatalog.bytes +
    pairing.productSearch.catalog.bytes +
    pairing.productSearch.manifest.bytes +
    (pairing.recommendedDatasetMapping?.manifest.bytes ?? 0) +
    (pairing.opportunityIndex?.object.bytes ?? 0) +
    (pairing.opportunityIndex?.manifest.bytes ?? 0)
  );
}

export function parseSourceStatusSnapshot(
  value: unknown,
  label = "Source Freshness Status snapshot",
): SourceStatusSnapshot {
  const snapshot = record(value, label);
  if (snapshot.schemaVersion !== "source-status-v1") {
    throw new Error(`${label} schema is incompatible.`);
  }
  const checkedAt = utcTimestamp(snapshot.checkedAt, `${label} checkedAt`);
  const newerReleaseDetectedAt =
    snapshot.newerReleaseDetectedAt === null
      ? null
      : utcTimestamp(
          snapshot.newerReleaseDetectedAt,
          `${label} newerReleaseDetectedAt`,
        );
  const publishedAt = utcTimestamp(
    snapshot.publishedAt,
    `${label} publishedAt`,
  );
  if (
    Date.parse(checkedAt) > Date.parse(publishedAt) ||
    (newerReleaseDetectedAt !== null &&
      Date.parse(newerReleaseDetectedAt) > Date.parse(publishedAt))
  ) {
    throw new Error(`${label} chronology is invalid.`);
  }
  return {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId: string(
      snapshot.sourceStatusSnapshotId,
      `${label} ID`,
    ),
    checkedAt,
    servedBaciRelease: string(
      snapshot.servedBaciRelease,
      `${label} served BACI Release`,
    ),
    latestKnownBaciRelease: string(
      snapshot.latestKnownBaciRelease,
      `${label} latest known BACI Release`,
    ),
    newerReleaseDetectedAt,
    refreshFailed: boolean(
      snapshot.refreshFailed,
      `${label} refreshFailed`,
    ),
    rollbackActive: boolean(
      snapshot.rollbackActive,
      `${label} rollbackActive`,
    ),
    publishedAt,
  };
}

export function parseAnalysisReleaseCatalog(
  value: unknown,
): AnalysisReleaseCatalog {
  const catalog = record(value, "analysis release catalog");
  if (
    catalog.schemaVersion !== "analysis-release-catalog-v1" ||
    catalog.scoreVersion !== "cms-v1" ||
    catalog.resultSchemaVersion !== "candidate-market-result-v1"
  ) {
    throw new Error("Analysis release catalog schema is incompatible.");
  }
  return {
    schemaVersion: "analysis-release-catalog-v1",
    current: analysisArtifactReference(
      catalog.current,
      "current analysis artifact",
    ),
    previous:
      catalog.previous === null
        ? null
        : analysisArtifactReference(
            catalog.previous,
            "previous analysis artifact",
          ),
    scoreVersion: "cms-v1",
    resultSchemaVersion: "candidate-market-result-v1",
  };
}

export function assertDeploymentReleaseCatalog(
  deployment: DeploymentPairingManifest,
  catalog: AnalysisReleaseCatalog,
): void {
  if (
    !sameAnalysisArtifactReference(
      deployment.analysis.artifact,
      catalog.current,
    )
  ) {
    throw new Error(
      "Deployment analysis artifact does not match its release catalog.",
    );
  }
}

export function deploymentPairingIdFromKey(key: string): string {
  const match =
    /^deployment-pairings\/(deployment-pairing-v1-[a-f0-9]{16})\.json$/u.exec(
      key,
    );
  if (match === null) {
    throw new Error("Deployment pairing key is invalid.");
  }
  return match[1];
}

export function publishedDeployment(
  pointer: ActiveDeploymentPointer,
  deployment: DeploymentPairingManifest,
): PublishedDeployment {
  return {
    schemaVersion: "published-deployment-v1",
    deploymentPairingId: deployment.deploymentPairingId,
    analysisBuildId: deployment.analysisBuildId,
    analysisReleaseCatalogSha256:
      deployment.analysisReleaseCatalogSha256,
    productSearchBuildId: deployment.productSearchBuildId,
    baciRelease: deployment.baciRelease,
    sourceStatusFallback: pointer.sourceStatusFallback,
    activatedAt: pointer.activatedAt,
    previousDeploymentPairingId:
      pointer.history[0] === undefined
        ? null
        : deploymentPairingIdFromKey(pointer.history[0].key),
    recommendedDatasetMappingIdentity:
      deployment.recommendedDatasetMapping?.identity ?? null,
    opportunityIndex: deployment.opportunityIndex,
  };
}

export function sameSourceStatusSnapshot(
  left: SourceStatusSnapshot,
  right: SourceStatusSnapshot,
): boolean {
  return releaseJsonBytes(left).equals(releaseJsonBytes(right));
}

export async function readReleaseMetadata(
  body: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RELEASE_METADATA_BYTES) {
      throw new Error("Release metadata exceeds its size limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function releaseJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function contentAddressedId(prefix: string, value: unknown): string {
  const sha256 = releaseObjectSha256(releaseJsonBytes(value));
  return `${prefix}-${sha256.slice(0, 16)}`;
}

function analysisArtifactReference(
  value: unknown,
  label: string,
): AnalysisArtifactReference {
  const candidate = record(value, label);
  return {
    baciRelease: string(candidate.baciRelease, `${label} BACI Release`),
    sourceSha256: sha256String(
      candidate.sourceSha256,
      `${label} source SHA-256`,
    ),
    hsRevision: hs12(candidate.hsRevision, `${label} HS revision`),
    artifactBuildId: string(
      candidate.artifactBuildId,
      `${label} build ID`,
    ),
    artifactSchemaVersion: string(
      candidate.artifactSchemaVersion,
      `${label} schema version`,
    ),
    artifact: objectReference(candidate.artifact, `${label} object`),
    manifest: objectReference(candidate.manifest, `${label} manifest`),
  };
}

function productCatalogReference(
  value: unknown,
  label: string,
): ProductCatalogReference {
  const candidate = record(value, label);
  return {
    baciRelease: string(candidate.baciRelease, `${label} BACI Release`),
    sourceArchiveSha256: sha256String(
      candidate.sourceArchiveSha256,
      `${label} source archive SHA-256`,
    ),
    hsRevision: hs12(candidate.hsRevision, `${label} HS revision`),
    productSearchBuildId: prefixedId(
      candidate.productSearchBuildId,
      `${label} product-search build ID`,
      "product-search-v1",
    ),
    catalogSchemaVersion: string(
      candidate.catalogSchemaVersion,
      `${label} schema version`,
    ),
    catalog: objectReference(candidate.catalog, `${label} object`),
    manifest: objectReference(candidate.manifest, `${label} manifest`),
  };
}

function recommendedDatasetMappingReference(
  value: unknown,
): RecommendedDatasetMappingReference {
  const mapping = record(
    value,
    "recommended Dataset Mapping reference",
  );
  const identity = string(
    mapping.identity,
    "recommended Dataset Mapping identity",
  );
  if (
    !/^recommended-dataset-mapping-v1-[a-f0-9]{64}$/u.test(
      identity,
    )
  ) {
    throw new Error(
      "Recommended Dataset Mapping identity is malformed.",
    );
  }
  return {
    identity,
    manifest: objectReference(
      mapping.manifest,
      "recommended Dataset Mapping manifest",
    ),
  };
}

function opportunityIndexReference(value: unknown): OpportunityIndexReference {
  const reference = record(value, "opportunity index reference");
  if (reference.schemaVersion !== "opportunity-index-v1") {
    throw new Error("Opportunity Index schema is incompatible.");
  }
  return {
    schemaVersion: "opportunity-index-v1",
    object: objectReference(reference.object, "opportunity index object"),
    manifest: objectReference(
      reference.manifest,
      "opportunity index manifest",
    ),
  };
}

function objectReference(
  value: unknown,
  label: string,
): ReleaseObjectReference {
  const reference = record(value, label);
  return {
    key: string(reference.key, `${label} key`),
    bytes: count(reference.bytes, `${label} bytes`),
    sha256: sha256String(reference.sha256, `${label} SHA-256`),
  };
}

function validateDeploymentPairingManifest(
  deployment: DeploymentPairingManifest,
  legacy: {
    legacyWithoutRecommendedDatasetMapping?: boolean;
    legacyWithoutOpportunityIndex?: boolean;
    legacyWithoutResidentFootprint?: boolean;
  } = {},
): void {
  const analysis = deployment.analysis.artifact;
  const productSearch = deployment.productSearch;
  if (
    analysis.baciRelease !== deployment.baciRelease ||
    productSearch.baciRelease !== deployment.baciRelease ||
    analysis.sourceSha256 !== productSearch.sourceArchiveSha256 ||
    analysis.hsRevision !== productSearch.hsRevision ||
    productSearch.productSearchBuildId !==
      deployment.productSearchBuildId ||
    deployment.sourceStatusFallback.servedBaciRelease !==
      deployment.baciRelease
  ) {
    throw new Error("Deployment pairing identities are incompatible.");
  }
  if (
    analysis.artifactSchemaVersion !== "candidate-market-artifact-v1" ||
    productSearch.catalogSchemaVersion !== "product-catalog-artifact-v1"
  ) {
    throw new Error("Deployment pairing artifact schema is incompatible.");
  }
  const expectedAnalysisBuildId = contentAddressedId("analysis-build-v1", {
    analysisReleaseCatalogSha256:
      deployment.analysisReleaseCatalogSha256,
    scoreVersion: "cms-v1",
    resultSchemaVersion: "candidate-market-result-v1",
  });
  if (deployment.analysisBuildId !== expectedAnalysisBuildId) {
    throw new Error("Deployment analysis build identity is inconsistent.");
  }
  if (
    !legacy.legacyWithoutResidentFootprint &&
    deployment.residentFootprintBytes !==
      calculatePairingResidentFootprintBytes(deployment)
  ) {
    throw new Error(
      "Deployment pairing resident footprint is inconsistent.",
    );
  }
  const pairingIdentity = Object.fromEntries(
    Object.entries(deployment).filter(
      ([key]) =>
        key !== "deploymentPairingId" &&
        !(
          legacy.legacyWithoutRecommendedDatasetMapping &&
          key === "recommendedDatasetMapping"
        ) &&
        !(
          legacy.legacyWithoutOpportunityIndex &&
          key === "opportunityIndex"
        ) &&
        !(legacy.legacyWithoutResidentFootprint && key === "residentFootprintBytes"),
    ),
  );
  if (
    deployment.deploymentPairingId !==
    contentAddressedId("deployment-pairing-v1", pairingIdentity)
  ) {
    throw new Error("Deployment pairing identity is inconsistent.");
  }
}

function sameAnalysisArtifactReference(
  left: AnalysisArtifactReference,
  right: AnalysisArtifactReference,
): boolean {
  return (
    left.baciRelease === right.baciRelease &&
    left.sourceSha256 === right.sourceSha256 &&
    left.hsRevision === right.hsRevision &&
    left.artifactBuildId === right.artifactBuildId &&
    left.artifactSchemaVersion === right.artifactSchemaVersion &&
    sameObjectReference(left.artifact, right.artifact) &&
    sameObjectReference(left.manifest, right.manifest)
  );
}

function sameObjectReference(
  left: ReleaseObjectReference,
  right: ReleaseObjectReference,
): boolean {
  return (
    left.key === right.key &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

function releaseObjectSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
