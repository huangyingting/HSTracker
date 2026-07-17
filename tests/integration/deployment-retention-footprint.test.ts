import { describe, expect, it } from "vitest";

import {
  calculateDeploymentRetentionFootprint,
  evaluateDeploymentRetentionHeadroom,
  evaluateDeclaredDeploymentRetentionPolicy,
} from "../../src/deployment/deployment-retention-footprint";
import { calculatePairingResidentFootprintBytes } from "../../src/release/release-manifest";
import type { DeploymentPairingManifest } from "../../src/release/release-manifest";

function objectReference(key: string, bytes: number) {
  return { key, bytes, sha256: "a".repeat(64) };
}

function pairing(
  id: string,
  overrides: Partial<{
    artifactBytes: number;
    artifactManifestBytes: number;
    releaseCatalogBytes: number;
    productCatalogBytes: number;
    productCatalogManifestBytes: number;
    mappingBytes: number | null;
    sharedArtifactKey: string;
  }> = {},
): DeploymentPairingManifest {
  const artifactKey =
    overrides.sharedArtifactKey ?? `releases/x/${id}/candidate-market.duckdb`;
  const analysis = {
    artifact: {
      baciRelease: "V202601",
      sourceSha256: "b".repeat(64),
      hsRevision: "HS12" as const,
      artifactBuildId: `candidate-market-artifact-v1-${id.padEnd(16, "0")}`,
      artifactSchemaVersion: "candidate-market-artifact-v1",
      artifact: objectReference(
        artifactKey,
        overrides.artifactBytes ?? 1_000_000_000,
      ),
      manifest: objectReference(
        `releases/x/${id}/manifest.json`,
        overrides.artifactManifestBytes ?? 1_000,
      ),
    },
    releaseCatalog: objectReference(
      `analysis-release-catalogs/${id}.json`,
      overrides.releaseCatalogBytes ?? 500,
    ),
  };
  const productSearch = {
    baciRelease: "V202601",
    sourceArchiveSha256: "b".repeat(64),
    hsRevision: "HS12" as const,
    productSearchBuildId: `product-search-v1-${id.padEnd(16, "0")}`,
    catalogSchemaVersion: "product-catalog-artifact-v1",
    catalog: objectReference(
      `product-search-catalogs/${id}/catalog.json`,
      overrides.productCatalogBytes ?? 2_000,
    ),
    manifest: objectReference(
      `product-search-catalogs/${id}/manifest.json`,
      overrides.productCatalogManifestBytes ?? 100,
    ),
  };
  const recommendedDatasetMapping =
    overrides.mappingBytes === null
      ? null
      : {
          identity: `recommended-dataset-mapping-v1-${"d".repeat(64)}`,
          manifest: objectReference(
            `recommended-dataset-mappings/${id}.json`,
            overrides.mappingBytes ?? 300,
          ),
        };
  const residentFootprintBytes = calculatePairingResidentFootprintBytes({
    analysis,
    productSearch,
    recommendedDatasetMapping,
    opportunityIndex: null,
  });
  return {
    schemaVersion: "deployment-pairing-manifest-v1",
    deploymentPairingId: `deployment-pairing-v1-${id.padEnd(16, "0")}`,
    baciRelease: "V202601",
    analysisBuildId: `analysis-build-v1-${id.padEnd(16, "0")}`,
    analysisReleaseCatalogSha256: "a".repeat(64),
    productSearchBuildId: `product-search-v1-${id.padEnd(16, "0")}`,
    sourceStatusFallback: {
      schemaVersion: "source-status-v1",
      sourceStatusSnapshotId: `source-status-bootstrap-v1-${id.padEnd(16, "0")}`,
      checkedAt: "2026-07-12T01:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-07-12T02:00:00Z",
    },
    analysis,
    productSearch,
    recommendedDatasetMapping,
    opportunityIndex: null,
    residentFootprintBytes,
  };
}

describe("deployment retention footprint", () => {
  it("sums unique referenced object bytes across the retention window", () => {
    const current = pairing("1111111111111111");
    const previous = pairing("2222222222222222");
    const footprint = calculateDeploymentRetentionFootprint([
      current,
      previous,
    ]);
    expect(footprint.uniqueObjectBytes).toBe(
      current.residentFootprintBytes + previous.residentFootprintBytes,
    );
  });

  it("does not double-count a content-addressed object shared across pairings", () => {
    const current = pairing("1111111111111111", {
      sharedArtifactKey: "releases/x/shared/candidate-market.duckdb",
    });
    const previous = pairing("2222222222222222", {
      sharedArtifactKey: "releases/x/shared/candidate-market.duckdb",
      artifactBytes: 1_000_000_000,
    });
    const footprint = calculateDeploymentRetentionFootprint([
      current,
      previous,
    ]);
    // The shared artifact key contributes once, not twice.
    const expected =
      current.residentFootprintBytes +
      previous.residentFootprintBytes -
      current.analysis.artifact.artifact.bytes;
    expect(footprint.uniqueObjectBytes).toBe(expected);
  });

  it("adds one DuckDB spill reserve per retained pairing", () => {
    const footprint = calculateDeploymentRetentionFootprint([
      pairing("1111111111111111"),
      pairing("2222222222222222"),
      pairing("3333333333333333"),
    ]);
    expect(footprint.spillReserveBytes).toBe(3 * 4 * 1024 ** 3);
  });

  it("rejects an empty or over-window pairing list", () => {
    expect(() => calculateDeploymentRetentionFootprint([])).toThrow();
    expect(() =>
      calculateDeploymentRetentionFootprint([
        pairing("1111111111111111"),
        pairing("2222222222222222"),
        pairing("3333333333333333"),
        pairing("4444444444444444"),
      ]),
    ).toThrow(/retention window/iu);
  });

  it("counts a pairing's own Release Revision previous artifact when its release catalog is supplied", () => {
    const current = pairing("1111111111111111");
    const previousArtifactReference = {
      baciRelease: "V202501",
      sourceSha256: "b".repeat(64),
      hsRevision: "HS12" as const,
      artifactBuildId: "candidate-market-artifact-v1-5555555555555555",
      artifactSchemaVersion: "candidate-market-artifact-v1",
      artifact: objectReference(
        "releases/V202501/bbbb/candidate-market.duckdb",
        900_000_000,
      ),
      manifest: objectReference(
        "releases/V202501/bbbb/manifests/manifest.json",
        900,
      ),
    };
    const releaseCatalog = {
      schemaVersion: "analysis-release-catalog-v1" as const,
      current: current.analysis.artifact,
      previous: previousArtifactReference,
      scoreVersion: "cms-v1" as const,
      resultSchemaVersion: "candidate-market-result-v1" as const,
    };
    const withoutCatalog = calculateDeploymentRetentionFootprint([current]);
    const withCatalog = calculateDeploymentRetentionFootprint([
      { pairing: current, releaseCatalog },
    ]);
    expect(withCatalog.uniqueObjectBytes).toBe(
      withoutCatalog.uniqueObjectBytes +
        previousArtifactReference.artifact.bytes +
        previousArtifactReference.manifest.bytes,
    );
  });

  it("does not double-count a shared Release Revision previous artifact across pairings", () => {
    const current = pairing("1111111111111111");
    const previousPairing = pairing("2222222222222222");
    const previousArtifactReference = {
      baciRelease: previousPairing.baciRelease,
      sourceSha256: "b".repeat(64),
      hsRevision: "HS12" as const,
      artifactBuildId: previousPairing.analysis.artifact.artifactBuildId,
      artifactSchemaVersion: "candidate-market-artifact-v1",
      artifact: previousPairing.analysis.artifact.artifact,
      manifest: previousPairing.analysis.artifact.manifest,
    };
    const releaseCatalog = {
      schemaVersion: "analysis-release-catalog-v1" as const,
      current: current.analysis.artifact,
      previous: previousArtifactReference,
      scoreVersion: "cms-v1" as const,
      resultSchemaVersion: "candidate-market-result-v1" as const,
    };
    const footprint = calculateDeploymentRetentionFootprint([
      { pairing: current, releaseCatalog },
      previousPairing,
    ]);
    expect(footprint.uniqueObjectBytes).toBe(
      current.residentFootprintBytes + previousPairing.residentFootprintBytes,
    );
  });

  it("counts the Dataset Package manifest nested inside the Recommended Dataset Mapping", () => {
    const current = pairing("1111111111111111");
    const packageManifest = objectReference(
      "dataset-packages/current.json",
      700,
    );
    const footprint = calculateDeploymentRetentionFootprint([
      {
        pairing: current,
        datasetPackageManifest: packageManifest,
      },
    ]);
    expect(footprint.uniqueObjectBytes).toBe(
      current.residentFootprintBytes + packageManifest.bytes,
    );
  });
});

describe("deployment retention headroom", () => {
  it("fits when free bytes cover the required footprint and safety reserve", () => {
    const pairings = [pairing("1111111111111111")];
    const footprint = calculateDeploymentRetentionFootprint(pairings);
    const totalBytes = 100_000_000_000;
    const result = evaluateDeploymentRetentionHeadroom(pairings, {
      totalBytes,
      freeBytes: footprint.requiredBytes + totalBytes * 0.25 + 1,
    });
    expect(result.fits).toBe(true);
  });

  it("fails closed when free bytes cannot cover the required footprint and reserve", () => {
    const pairings = [pairing("1111111111111111")];
    const footprint = calculateDeploymentRetentionFootprint(pairings);
    const totalBytes = 100_000_000_000;
    const result = evaluateDeploymentRetentionHeadroom(pairings, {
      totalBytes,
      freeBytes: footprint.requiredBytes,
    });
    expect(result.fits).toBe(false);
  });
});

describe("declared deployment retention policy", () => {
  it("accepts a window within the declared baseline volume policy", () => {
    const pairings = [
      pairing("1111111111111111"),
      pairing("2222222222222222"),
      pairing("3333333333333333"),
    ];
    const result = evaluateDeclaredDeploymentRetentionPolicy(pairings);
    expect(result.fits).toBe(true);
  });

  it("fails closed when the declared window exceeds the baseline volume policy", () => {
    const huge = 40 * 1024 ** 3;
    const pairings = [
      pairing("1111111111111111", { artifactBytes: huge }),
      pairing("2222222222222222", { artifactBytes: huge }),
      pairing("3333333333333333", { artifactBytes: huge }),
    ];
    const result = evaluateDeclaredDeploymentRetentionPolicy(pairings);
    expect(result.fits).toBe(false);
  });
});
