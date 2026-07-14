import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createRecommendedDatasetMapping,
  recommendedEconomyCatalogIdentity,
  recommendedProductCatalogIdentity,
  validateRecommendedDatasetMapping,
} from "../../src/domain/trade-analytics/recommended-dataset-mapping";
import { createCandidateMarketDatasetPackage } from "../../src/domain/trade-analytics/dataset-package";
import { createFixtureCandidateMarketDatasetPackages } from "../../src/evidence/fixture-trade-evidence-source";
import {
  FIXTURE_RECOMMENDED_DATASET_MAPPING,
  FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES,
} from "../../src/release/fixture-current-analysis";
import { releaseObjectIdentity } from "../../src/release/release-object-store";

describe("Recommended Dataset Mapping", () => {
  it("has deterministic canonical serialization and content-addressed identity", () => {
    const input = mappingInput();
    const reordered = {
      economyCatalog: input.economyCatalog,
      productCatalog: input.productCatalog,
      datasetPackage: input.datasetPackage,
      recipe: input.recipe,
      schemaVersion: input.schemaVersion,
    };

    const first = createRecommendedDatasetMapping(input);
    const second = createRecommendedDatasetMapping(reordered);

    expect(first.serializedManifest).toBe(second.serializedManifest);
    expect(first.identity).toBe(second.identity);
    expect(first.identity).toMatch(
      /^recommended-dataset-mapping-v1-[a-f0-9]{64}$/u,
    );
  });

  it("uses the same validated mapping contract for fixtures", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping: FIXTURE_RECOMMENDED_DATASET_MAPPING,
        datasetPackage,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
  });

  it("references the exact canonical serialized fixture objects", () => {
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;

    expect(manifest.productCatalog.catalog).toMatchObject(
      releaseObjectIdentity(
        FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES.productCatalog,
      ),
    );
    expect(manifest.productCatalog.manifest).toMatchObject(
      releaseObjectIdentity(
        FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES.productCatalogManifest,
      ),
    );
    expect(manifest.economyCatalog.artifact).toMatchObject(
      releaseObjectIdentity(
        FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES.economyCatalog,
      ),
    );
    expect(manifest.economyCatalog.manifest).toMatchObject(
      releaseObjectIdentity(
        FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES.economyCatalogManifest,
      ),
    );
    expect(
      JSON.parse(
        FIXTURE_RECOMMENDED_DATASET_OBJECT_BYTES.productCatalog.toString(
          "utf8",
        ),
      ),
    ).toMatchObject({
      schemaVersion: "product-catalog-artifact-v1",
      productSearchBuildId: "acceptance-product-search-v3",
    });
  });

  it("rejects a selected package missing a recipe capability", () => {
    const accepted =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const incompatible = createCandidateMarketDatasetPackage({
      ...accepted.manifest,
      capabilities: accepted.manifest.capabilities.slice(1),
    });
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      datasetPackage: {
        identity: incompatible.identity,
        manifest: objectReference(
          "fixtures/incompatible-dataset-package.json",
          Buffer.from(incompatible.serializedManifest, "utf8"),
        ),
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage: incompatible,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow("Recommended Dataset Mapping package is incompatible");
  });
});

function mappingInput() {
  const datasetPackage =
    createFixtureCandidateMarketDatasetPackages().get(
      "acceptance-fixtures-v1",
    )!;
  const datasetPackageManifest = objectReference(
    "fixtures/dataset-package.json",
    Buffer.from(datasetPackage.serializedManifest, "utf8"),
  );
  const productCatalog = objectReference(
    "fixtures/product-catalog.json",
    Buffer.from("fixture product catalog", "utf8"),
  );
  const productCatalogManifest = objectReference(
    "fixtures/product-catalog-manifest.json",
    Buffer.from("fixture product catalog manifest", "utf8"),
  );
  const analysisArtifact = objectReference(
    "fixtures/candidate-market.duckdb",
    Buffer.from("fixture analysis artifact", "utf8"),
  );
  const analysisArtifactManifest = objectReference(
    "fixtures/artifact-manifest.json",
    Buffer.from("fixture analysis artifact manifest", "utf8"),
  );
  const productSearchBuildId =
    "product-search-v1-1111111111111111";
  const analysisBuildId = "analysis-build-v1-2222222222222222";
  const productCatalogSchemaVersion =
    "product-catalog-artifact-v1";
  const analysisArtifactSchemaVersion =
    "candidate-market-artifact-v1";

  return {
    schemaVersion: "recommended-dataset-mapping-manifest-v1",
    recipe: "candidate-market-v1",
    datasetPackage: {
      identity: datasetPackage.identity,
      manifest: datasetPackageManifest,
    },
    productCatalog: {
      identity: recommendedProductCatalogIdentity({
        productSearchBuildId,
        schemaVersion: productCatalogSchemaVersion,
        catalog: productCatalog,
        manifest: productCatalogManifest,
      }),
      productSearchBuildId,
      schemaVersion: productCatalogSchemaVersion,
      catalog: productCatalog,
      manifest: productCatalogManifest,
    },
    economyCatalog: {
      identity: recommendedEconomyCatalogIdentity({
        analysisBuildId,
        schemaVersion: analysisArtifactSchemaVersion,
        artifact: analysisArtifact,
        manifest: analysisArtifactManifest,
      }),
      analysisBuildId,
      schemaVersion: analysisArtifactSchemaVersion,
      artifact: analysisArtifact,
      manifest: analysisArtifactManifest,
    },
  };
}

function objectReference(key: string, bytes: Buffer) {
  return {
    key,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
