import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export type AcceptedReleaseCandidateOptions = {
  analysisArtifactBuildId?: string;
  analysisArtifactVersion?: string;
  productCatalogVersion?: string;
  productSearchBuildId?: string;
  productSourceArchiveSha256?: string;
};

export async function writeAcceptedReleaseCandidate(
  root: string,
  options: AcceptedReleaseCandidateOptions = {},
): Promise<{
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
}> {
  const analysisDirectoryPath = join(root, "analysis");
  const productCatalogDirectoryPath = join(root, "product-catalog");
  await Promise.all([
    mkdir(analysisDirectoryPath, { recursive: true }),
    mkdir(productCatalogDirectoryPath, { recursive: true }),
  ]);

  const analysisArtifact = Buffer.from(
    `fixture DuckDB artifact ${options.analysisArtifactVersion ?? "v1"}`,
    "utf8",
  );
  const analysisArtifactIdentity = identity(analysisArtifact);
  const analysisManifest = {
    schemaVersion: "candidate-market-artifact-manifest-v1",
    baciRelease: "VTEST001",
    sourceSha256: "a".repeat(64),
    sourceUpdateDate: "2026-01-22",
    hsRevision: "HS12",
    scoreVersionsSupported: ["cms-v1"],
    artifact: {
      schemaVersion: "candidate-market-artifact-v1",
      buildId:
        options.analysisArtifactBuildId ??
        "candidate-market-artifact-v1-2222222222222222",
      relativePath: "candidate-market.duckdb",
      ...analysisArtifactIdentity,
    },
    builtAt: "2026-07-12T01:00:00Z",
  };
  const analysisManifestBytes = jsonBytes(analysisManifest);
  const analysisReport = {
    schemaVersion: "candidate-market-artifact-build-report-v1",
    status: "accepted",
    artifactManifestSha256: sha256(analysisManifestBytes),
    artifactManifest: analysisManifest,
    artifact: analysisManifest.artifact,
  };

  const productCatalog = Buffer.from(
    `fixture product catalog ${options.productCatalogVersion ?? "v1"}`,
    "utf8",
  );
  const productCatalogIdentity = identity(productCatalog);
  const catalogManifest = {
    schemaVersion: "product-catalog-manifest-v1",
    baciRelease: "VTEST001",
    sourceArchiveSha256:
      options.productSourceArchiveSha256 ?? "a".repeat(64),
    hsRevision: "HS12",
    productSearchBuildId:
      options.productSearchBuildId ?? "product-search-v1-1111111111111111",
    catalog: {
      schemaVersion: "product-catalog-artifact-v1",
      relativePath: "product-catalog.json",
      ...productCatalogIdentity,
    },
    builtAt: "2026-07-12T01:00:00Z",
  };
  const catalogManifestBytes = jsonBytes(catalogManifest);
  const catalogReport = {
    schemaVersion: "product-catalog-build-report-v1",
    status: "accepted",
    catalogManifestSha256: sha256(catalogManifestBytes),
    catalogManifest,
  };

  await Promise.all([
    writeFile(
      join(analysisDirectoryPath, "candidate-market.duckdb"),
      analysisArtifact,
    ),
    writeFile(
      join(analysisDirectoryPath, "artifact-manifest.json"),
      analysisManifestBytes,
    ),
    writeFile(
      join(analysisDirectoryPath, "artifact-build-report.json"),
      jsonBytes(analysisReport),
    ),
    writeFile(
      join(productCatalogDirectoryPath, "product-catalog.json"),
      productCatalog,
    ),
    writeFile(
      join(productCatalogDirectoryPath, "catalog-manifest.json"),
      catalogManifestBytes,
    ),
    writeFile(
      join(productCatalogDirectoryPath, "catalog-build-report.json"),
      jsonBytes(catalogReport),
    ),
  ]);

  return { analysisDirectoryPath, productCatalogDirectoryPath };
}

function identity(bytes: Buffer): { bytes: number; sha256: string } {
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
