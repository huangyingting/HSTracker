import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_RETENTION_HISTORY_LIMIT,
  DEPLOYMENT_RETENTION_WINDOW_SIZE,
  calculatePairingResidentFootprintBytes,
  contentAddressedId,
  parseActiveDeploymentPointer,
  parseDeploymentPairingManifest,
  publishedDeployment,
  releaseJsonBytes,
  type DeploymentPairingManifest,
} from "../../src/release/release-manifest";

function objectReference(key: string, bytes: number, sha256 = "a".repeat(64)) {
  return { key, bytes, sha256 };
}

function samplePairing(
  overrides: Partial<DeploymentPairingManifest> = {},
): DeploymentPairingManifest {
  const analysisArtifactReference = {
    baciRelease: "V202601",
    sourceSha256: "b".repeat(64),
    hsRevision: "HS12" as const,
    artifactBuildId: "candidate-market-artifact-v1-1111111111111111",
    artifactSchemaVersion: "candidate-market-artifact-v1",
    artifact: objectReference(
      "releases/V202601/aaaa/candidate-market.duckdb",
      1_000,
    ),
    manifest: objectReference(
      "releases/V202601/aaaa/manifests/manifest.json",
      200,
    ),
  };
  const base = {
    schemaVersion: "deployment-pairing-manifest-v1" as const,
    baciRelease: "V202601",
    analysisBuildId: contentAddressedId("analysis-build-v1", {
      analysisReleaseCatalogSha256: "c".repeat(64),
      scoreVersion: "cms-v1",
      resultSchemaVersion: "candidate-market-result-v1",
    }),
    analysisReleaseCatalogSha256: "c".repeat(64),
    productSearchBuildId: "product-search-v1-2222222222222222",
    sourceStatusFallback: {
      schemaVersion: "source-status-v1" as const,
      sourceStatusSnapshotId: "source-status-bootstrap-v1-3333333333333333",
      checkedAt: "2026-07-12T01:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-07-12T02:00:00Z",
    },
    analysis: {
      artifact: analysisArtifactReference,
      releaseCatalog: objectReference(
        `analysis-release-catalogs/${"c".repeat(64)}.json`,
        150,
        "c".repeat(64),
      ),
    },
    productSearch: {
      baciRelease: "V202601",
      sourceArchiveSha256: "b".repeat(64),
      hsRevision: "HS12" as const,
      productSearchBuildId: "product-search-v1-2222222222222222",
      catalogSchemaVersion: "product-catalog-artifact-v1",
      catalog: objectReference(
        "product-search-catalogs/x/product-catalog.json",
        300,
      ),
      manifest: objectReference(
        "product-search-catalogs/x/manifests/manifest.json",
        50,
      ),
    },
    recommendedDatasetMapping: null,
    ...overrides,
  };
  const residentFootprintBytes = calculatePairingResidentFootprintBytes(base);
  const withFootprint = { ...base, residentFootprintBytes };
  const deploymentPairingId = contentAddressedId(
    "deployment-pairing-v1",
    withFootprint,
  );
  return { ...withFootprint, deploymentPairingId };
}

describe("release-manifest retention window", () => {
  it("exposes an exact 3-slot retention window (current + 2 predecessors)", () => {
    expect(DEPLOYMENT_RETENTION_WINDOW_SIZE).toBe(3);
    expect(DEPLOYMENT_RETENTION_HISTORY_LIMIT).toBe(2);
  });

  it("computes a deterministic resident footprint from referenced object bytes", () => {
    const pairing = samplePairing();
    expect(pairing.residentFootprintBytes).toBe(1_000 + 200 + 150 + 300 + 50);
  });

  it("includes a mapping manifest's bytes in the resident footprint when present", () => {
    const pairing = samplePairing({
      recommendedDatasetMapping: {
        identity: `recommended-dataset-mapping-v1-${"d".repeat(64)}`,
        manifest: objectReference(
          "recommended-dataset-mappings/x.json",
          75,
        ),
      },
    });
    expect(pairing.residentFootprintBytes).toBe(
      1_000 + 200 + 150 + 300 + 50 + 75,
    );
  });

  it("round-trips a deployment pairing manifest through parse", () => {
    const pairing = samplePairing();
    const parsed = parseDeploymentPairingManifest(
      JSON.parse(releaseJsonBytes(pairing).toString("utf8")),
    );
    expect(parsed).toEqual(pairing);
  });

  it("rejects a pairing whose declared resident footprint is inconsistent", () => {
    const pairing = samplePairing();
    const tampered = releaseJsonBytes({
      ...pairing,
      residentFootprintBytes: pairing.residentFootprintBytes + 1,
    });
    expect(() =>
      parseDeploymentPairingManifest(JSON.parse(tampered.toString("utf8"))),
    ).toThrow(/resident footprint/iu);
  });

  it("parses a pointer with an explicit history array up to the retention limit", () => {
    const current = objectReference("deployment-pairings/current.json", 10);
    const history = [
      objectReference("deployment-pairings/previous.json", 10),
      objectReference("deployment-pairings/previous2.json", 10),
    ];
    const sourceStatusFallback = samplePairing().sourceStatusFallback;
    const pointer = parseActiveDeploymentPointer({
      schemaVersion: "active-deployment-pointer-v1",
      current,
      history,
      sourceStatusFallback,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(pointer.history).toEqual(history);
  });

  it("rejects a pointer whose history exceeds the retention window", () => {
    const current = objectReference("deployment-pairings/current.json", 10);
    const history = [
      objectReference("deployment-pairings/previous.json", 10),
      objectReference("deployment-pairings/previous2.json", 10),
      objectReference("deployment-pairings/previous3.json", 10),
    ];
    const sourceStatusFallback = samplePairing().sourceStatusFallback;
    expect(() =>
      parseActiveDeploymentPointer({
        schemaVersion: "active-deployment-pointer-v1",
        current,
        history,
        sourceStatusFallback,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).toThrow(/retention window/iu);
  });

  it("normalizes a legacy pointer that only carries a singular previous reference", () => {
    const current = objectReference("deployment-pairings/current.json", 10);
    const previous = objectReference("deployment-pairings/previous.json", 10);
    const sourceStatusFallback = samplePairing().sourceStatusFallback;
    const pointer = parseActiveDeploymentPointer({
      schemaVersion: "active-deployment-pointer-v1",
      current,
      previous,
      sourceStatusFallback,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(pointer.history).toEqual([previous]);
  });

  it("normalizes a legacy pointer with a null previous reference to empty history", () => {
    const current = objectReference("deployment-pairings/current.json", 10);
    const sourceStatusFallback = samplePairing().sourceStatusFallback;
    const pointer = parseActiveDeploymentPointer({
      schemaVersion: "active-deployment-pointer-v1",
      current,
      previous: null,
      sourceStatusFallback,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(pointer.history).toEqual([]);
  });

  it("derives previousDeploymentPairingId from the first history entry", () => {
    const pairing = samplePairing();
    const previousKey =
      "deployment-pairings/deployment-pairing-v1-4444444444444444.json";
    const pointer = parseActiveDeploymentPointer({
      schemaVersion: "active-deployment-pointer-v1",
      current: objectReference(
        `deployment-pairings/${pairing.deploymentPairingId}.json`,
        10,
      ),
      history: [objectReference(previousKey, 10)],
      sourceStatusFallback: pairing.sourceStatusFallback,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(
      publishedDeployment(pointer, pairing).previousDeploymentPairingId,
    ).toBe("deployment-pairing-v1-4444444444444444");
  });

  it("reports null previousDeploymentPairingId when history is empty", () => {
    const pairing = samplePairing();
    const pointer = parseActiveDeploymentPointer({
      schemaVersion: "active-deployment-pointer-v1",
      current: objectReference(
        `deployment-pairings/${pairing.deploymentPairingId}.json`,
        10,
      ),
      history: [],
      sourceStatusFallback: pairing.sourceStatusFallback,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(
      publishedDeployment(pointer, pairing).previousDeploymentPairingId,
    ).toBeNull();
  });
});
