import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createRecommendedDatasetMapping,
  recommendedEconomyCatalogIdentity,
  recommendedProductCatalogIdentity,
  validateRecommendedDatasetMapping,
} from "../../src/domain/trade-analytics/recommended-dataset-mapping";
import { createCandidateMarketDatasetPackage } from "../../src/domain/trade-analytics/dataset-package";
import {
  createOpportunityDiscoveryDatasetPackage,
  OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/opportunity-discovery-v1-dataset-package";
import {
  createRecentTradeMomentumDatasetPackage,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-dataset-package";
import {
  createSupplierCompetitionDatasetPackage,
  SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/supplier-competition-v1-dataset-package";
import {
  createTradeTrendDatasetPackage,
  TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/trade-trend-v1-dataset-package";
import { createFixtureCandidateMarketDatasetPackages } from "../../src/evidence/fixture-trade-evidence-source";
import {
  createFixtureRecentTradeMomentumDatasetPackages,
} from "../../src/evidence/fixture-recent-trade-momentum-source";
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
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
  });

  it("accepts legacy-absent and explicit-null Recent Trade Momentum slots while annual mappings remain valid", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const withoutMonthly = createRecommendedDatasetMapping({
      schemaVersion: manifest.schemaVersion,
      recipe: manifest.recipe,
      datasetPackage: manifest.datasetPackage,
      tradeTrend: manifest.tradeTrend,
      supplierCompetition: manifest.supplierCompetition,
      tradeExplorer: manifest.tradeExplorer,
      opportunity: manifest.opportunity,
      productCatalog: manifest.productCatalog,
      economyCatalog: manifest.economyCatalog,
    });
    const explicitNone = createRecommendedDatasetMapping({
      ...manifest,
      recentTradeMomentum: null,
    });

    for (const mapping of [withoutMonthly, explicitNone]) {
      expect(mapping.manifest.recentTradeMomentum).toBeNull();
      expect(() =>
        validateRecommendedDatasetMapping({
          mapping,
          datasetPackage,
          tradeTrendDatasetPackage: null,
          supplierCompetitionDatasetPackage: null,
          recentTradeMomentumDatasetPackage: null,
          tradeExplorerDatasetPackage: null,
          opportunityDatasetPackage: null,
          productCatalog: manifest.productCatalog,
          economyCatalog: manifest.economyCatalog,
        }),
      ).not.toThrow();
    }
  });

  it("declares, validates, and rejects incompatible Recent Trade Momentum monthly packages without changing annual declarations", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const recentTradeMomentumDatasetPackage =
      createFixtureRecentTradeMomentumDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      recentTradeMomentum: {
        recipe: "recent-trade-momentum-v1",
        datasetPackage: {
          identity: recentTradeMomentumDatasetPackage.identity,
          manifest: objectReference(
            "fixtures/recent-trade-momentum/v1/dataset-package.json",
            Buffer.from(
              recentTradeMomentumDatasetPackage.serializedManifest,
              "utf8",
            ),
          ),
        },
        artifact: {
          schemaVersion: "monthly-trade-artifact-v1",
          object: {
            key: "fixtures/recent-trade-momentum/v1/recent-trade-momentum.duckdb",
            bytes:
              recentTradeMomentumDatasetPackage.manifest.artifact.bytes,
            sha256:
              recentTradeMomentumDatasetPackage.manifest.artifactSha256,
          },
        },
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        recentTradeMomentumDatasetPackage,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
    expect(mapping.manifest.tradeTrend).toBeNull();
    expect(mapping.manifest.supplierCompetition).toBeNull();
    expect(mapping.manifest.opportunity).toBeNull();

    const incompatibleRecentTradeMomentumDatasetPackage =
      createRecentTradeMomentumDatasetPackage({
        ...recentTradeMomentumDatasetPackage.manifest,
        capabilities:
          recentTradeMomentumDatasetPackage.manifest.capabilities.slice(1),
      });
    const incompatibleMapping = createRecommendedDatasetMapping({
      ...manifest,
      recentTradeMomentum: {
        recipe: "recent-trade-momentum-v1",
        datasetPackage: {
          identity: incompatibleRecentTradeMomentumDatasetPackage.identity,
          manifest: objectReference(
            "fixtures/recent-trade-momentum/v1/incompatible-dataset-package.json",
            Buffer.from(
              incompatibleRecentTradeMomentumDatasetPackage.serializedManifest,
              "utf8",
            ),
          ),
        },
        artifact: mapping.manifest.recentTradeMomentum!.artifact,
      },
    });
    expect(() =>
      validateRecommendedDatasetMapping({
        mapping: incompatibleMapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        recentTradeMomentumDatasetPackage:
          incompatibleRecentTradeMomentumDatasetPackage,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Recent Trade Momentum package is incompatible: MISSING_REQUIRED_CAPABILITY",
    );
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
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow("Recommended Dataset Mapping package is incompatible");
  });

  it("declares and gates trade-trend-v1 alongside candidate-market-v1 when its declaration is compatible", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const tradeTrendDatasetPackage = createTradeTrendDatasetPackage({
      schemaVersion: "trade-trend-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      evidenceSha256: manifest.economyCatalog.artifact.sha256,
      capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
    });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      tradeTrend: {
        recipe: "trade-trend-v1",
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
    expect(mapping.manifest.tradeTrend).toEqual({
      recipe: "trade-trend-v1",
      evidenceSha256: manifest.economyCatalog.artifact.sha256,
    });
  });

  it("rejects a caller-supplied Trade Trend package the mapping does not declare", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const tradeTrendDatasetPackage = createTradeTrendDatasetPackage({
      schemaVersion: "trade-trend-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      evidenceSha256: manifest.economyCatalog.artifact.sha256,
      capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping: FIXTURE_RECOMMENDED_DATASET_MAPPING,
        datasetPackage,
        tradeTrendDatasetPackage,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow("Recommended Dataset Mapping does not declare trade-trend-v1");
  });

  it("rejects a mapping that declares trade-trend-v1 without a compatible package", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      tradeTrend: {
        recipe: "trade-trend-v1",
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping declares trade-trend-v1 without a package",
    );
  });

  it("rejects a Trade Trend declaration whose evidence does not match the pinned analysis artifact", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mismatchedEvidenceSha256 = "c".repeat(64);
    const tradeTrendDatasetPackage = createTradeTrendDatasetPackage({
      schemaVersion: "trade-trend-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      evidenceSha256: mismatchedEvidenceSha256,
      capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
    });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      tradeTrend: {
        recipe: "trade-trend-v1",
        evidenceSha256: mismatchedEvidenceSha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow("Recommended Dataset Mapping Trade Trend evidence is incompatible");
  });

  it("rejects a Trade Trend declaration missing a required capability", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const tradeTrendDatasetPackage = createTradeTrendDatasetPackage({
      schemaVersion: "trade-trend-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      evidenceSha256: manifest.economyCatalog.artifact.sha256,
      capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS.slice(1),
    });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      tradeTrend: {
        recipe: "trade-trend-v1",
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Trade Trend package is incompatible",
    );
  });

  it("declares and gates supplier-competition-v1 alongside candidate-market-v1 when its declaration is compatible", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const supplierCompetitionDatasetPackage =
      createSupplierCompetitionDatasetPackage({
        schemaVersion: "supplier-competition-dataset-package-manifest-v1",
        baciRelease: "V202601",
        hsRevision: "HS12",
        finalizedYearCount: 5,
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
        capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
      });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      supplierCompetition: {
        recipe: "supplier-competition-v1",
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
    expect(mapping.manifest.supplierCompetition).toEqual({
      recipe: "supplier-competition-v1",
      evidenceSha256: manifest.economyCatalog.artifact.sha256,
    });
  });

  it("rejects a caller-supplied Supplier Competition package the mapping does not declare", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const supplierCompetitionDatasetPackage =
      createSupplierCompetitionDatasetPackage({
        schemaVersion: "supplier-competition-dataset-package-manifest-v1",
        baciRelease: "V202601",
        hsRevision: "HS12",
        finalizedYearCount: 5,
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
        capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
      });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping: FIXTURE_RECOMMENDED_DATASET_MAPPING,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping does not declare supplier-competition-v1",
    );
  });

  it("rejects a mapping that declares supplier-competition-v1 without a compatible package", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      supplierCompetition: {
        recipe: "supplier-competition-v1",
        evidenceSha256: manifest.economyCatalog.artifact.sha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping declares supplier-competition-v1 without a package",
    );
  });

  it("rejects a Supplier Competition declaration whose evidence does not match the pinned analysis artifact", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mismatchedEvidenceSha256 = "d".repeat(64);
    const supplierCompetitionDatasetPackage =
      createSupplierCompetitionDatasetPackage({
        schemaVersion: "supplier-competition-dataset-package-manifest-v1",
        baciRelease: "V202601",
        hsRevision: "HS12",
        finalizedYearCount: 5,
        evidenceSha256: mismatchedEvidenceSha256,
        capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
      });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      supplierCompetition: {
        recipe: "supplier-competition-v1",
        evidenceSha256: mismatchedEvidenceSha256,
      },
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Supplier Competition evidence is incompatible",
    );
  });

  it.each([
    "supplier-competition/supplier-structure",
    "supplier-competition/period-coverage",
  ])(
    "rejects a Supplier Competition declaration missing required capability %s",
    (missingCapabilityId) => {
      const datasetPackage =
        createFixtureCandidateMarketDatasetPackages().get(
          "acceptance-fixtures-v1",
        )!;
      const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
      const supplierCompetitionDatasetPackage =
        createSupplierCompetitionDatasetPackage({
          schemaVersion: "supplier-competition-dataset-package-manifest-v1",
          baciRelease: "V202601",
          hsRevision: "HS12",
          finalizedYearCount: 5,
          evidenceSha256: manifest.economyCatalog.artifact.sha256,
          capabilities:
            SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS.filter(
              ({ id }) => id !== missingCapabilityId,
            ),
        });
      const mapping = createRecommendedDatasetMapping({
        ...manifest,
        supplierCompetition: {
          recipe: "supplier-competition-v1",
          evidenceSha256: manifest.economyCatalog.artifact.sha256,
        },
      });

      expect(() =>
        validateRecommendedDatasetMapping({
          mapping,
          datasetPackage,
          tradeTrendDatasetPackage: null,
          supplierCompetitionDatasetPackage,
          tradeExplorerDatasetPackage: null,
          opportunityDatasetPackage: null,
          productCatalog: manifest.productCatalog,
          economyCatalog: manifest.economyCatalog,
        }),
      ).toThrow(
        "Recommended Dataset Mapping Supplier Competition package is incompatible",
      );
    },
  );

  it("validates a mapping that declares and gates opportunity-discovery-v1", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const opportunityDatasetPackage = opportunityPackage();
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      opportunity: opportunityDeclaration(opportunityDatasetPackage),
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).not.toThrow();
  });

  it("rejects an Opportunity package offered against a mapping that does not declare it", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping: FIXTURE_RECOMMENDED_DATASET_MAPPING,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: opportunityPackage(),
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping does not declare opportunity-discovery-v1",
    );
  });

  it("rejects a mapping that declares opportunity-discovery-v1 without a package", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      opportunity: opportunityDeclaration(opportunityPackage()),
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: null,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping declares opportunity-discovery-v1 without a package",
    );
  });

  it("rejects an Opportunity declaration whose package identity does not match", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const declaredPackage = opportunityPackage({
      evidenceSha256: "a".repeat(64),
    });
    const suppliedPackage = opportunityPackage({
      evidenceSha256: "b".repeat(64),
    });
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      opportunity: opportunityDeclaration(declaredPackage),
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage: suppliedPackage,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Opportunity package identity is incompatible",
    );
  });

  it("rejects an Opportunity declaration whose index object does not carry the package evidence", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const opportunityDatasetPackage = opportunityPackage();
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      opportunity: opportunityDeclaration(opportunityDatasetPackage, {
        indexSha256: "c".repeat(64),
      }),
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Opportunity evidence is incompatible",
    );
  });

  it("rejects an Opportunity declaration whose published package bytes do not match", () => {
    const datasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(
        "acceptance-fixtures-v1",
      )!;
    const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
    const opportunityDatasetPackage = opportunityPackage();
    const mapping = createRecommendedDatasetMapping({
      ...manifest,
      opportunity: opportunityDeclaration(opportunityDatasetPackage, {
        manifestBytes: Buffer.from("tampered opportunity manifest", "utf8"),
      }),
    });

    expect(() =>
      validateRecommendedDatasetMapping({
        mapping,
        datasetPackage,
        tradeTrendDatasetPackage: null,
        supplierCompetitionDatasetPackage: null,
        tradeExplorerDatasetPackage: null,
        opportunityDatasetPackage,
        productCatalog: manifest.productCatalog,
        economyCatalog: manifest.economyCatalog,
      }),
    ).toThrow(
      "Recommended Dataset Mapping Opportunity package reference is incompatible",
    );
  });

  it.each([
    "opportunity-discovery/bilateral-annual-value",
    "opportunity-discovery/market-annual-value",
  ])(
    "rejects an Opportunity declaration missing required capability %s",
    (missingCapabilityId) => {
      const datasetPackage =
        createFixtureCandidateMarketDatasetPackages().get(
          "acceptance-fixtures-v1",
        )!;
      const manifest = FIXTURE_RECOMMENDED_DATASET_MAPPING.manifest;
      const opportunityDatasetPackage = opportunityPackage({
        capabilities: OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS.filter(
          ({ id }) => id !== missingCapabilityId,
        ),
      });
      const mapping = createRecommendedDatasetMapping({
        ...manifest,
        opportunity: opportunityDeclaration(opportunityDatasetPackage),
      });

      expect(() =>
        validateRecommendedDatasetMapping({
          mapping,
          datasetPackage,
          tradeTrendDatasetPackage: null,
          supplierCompetitionDatasetPackage: null,
          tradeExplorerDatasetPackage: null,
          opportunityDatasetPackage,
          productCatalog: manifest.productCatalog,
          economyCatalog: manifest.economyCatalog,
        }),
      ).toThrow(
        "Recommended Dataset Mapping Opportunity package is incompatible",
      );
    },
  );
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

function opportunityPackage(overrides?: {
  evidenceSha256?: string;
  capabilities?: readonly Readonly<{ id: string; version: string }>[];
}) {
  return createOpportunityDiscoveryDatasetPackage({
    schemaVersion: "opportunity-discovery-dataset-package-manifest-v1",
    baciRelease: "V202601",
    hsRevision: "HS12",
    finalizedYearCount: 5,
    evidenceSha256: overrides?.evidenceSha256 ?? "a".repeat(64),
    capabilities:
      overrides?.capabilities ??
      OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
  });
}

function opportunityDeclaration(
  datasetPackage: ReturnType<typeof opportunityPackage>,
  overrides?: { indexSha256?: string; manifestBytes?: Buffer },
) {
  const manifestBytes =
    overrides?.manifestBytes ??
    Buffer.from(JSON.stringify(datasetPackage.manifest), "utf8");
  return {
    recipe: "opportunity-discovery-v1" as const,
    datasetPackage: {
      identity: datasetPackage.identity,
      manifest: objectReference(
        "opportunity/dataset-package.json",
        manifestBytes,
      ),
    },
    index: {
      schemaVersion: "opportunity-index-v1" as const,
      object: {
        key: "opportunity/opportunity-index.duckdb",
        bytes: 4096,
        sha256:
          overrides?.indexSha256 ?? datasetPackage.manifest.evidenceSha256,
      },
    },
  };
}
