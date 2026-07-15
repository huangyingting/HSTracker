import {
  retiredAnalysisBuild,
  unavailableAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../domain/candidate-market/errors";
import type { CandidateMarketV1RecipeInput } from "../domain/candidate-market/result";
import {
  retiredSupplierCompetitionAnalysisBuild,
  unavailableSupplierCompetitionAnalysisBuild,
  unknownSupplierCompetitionImporter,
  unknownSupplierCompetitionProduct,
} from "../domain/supplier-competition/errors";
import type {
  SupplierCompetitionV1Inputs,
  SupplierCompetitionV1RecipeInput,
} from "../domain/supplier-competition/result";
import {
  retiredTradeTrendAnalysisBuild,
  unavailableTradeTrendAnalysisBuild,
  unknownImporter,
  unknownTradeTrendProduct,
} from "../domain/trade-trend/errors";
import type {
  TradeTrendV1Inputs,
  TradeTrendV1RecipeInput,
} from "../domain/trade-trend/result";
import {
  retiredTradeExplorerAnalysisBuild,
  unavailableTradeExplorerAnalysisBuild,
  unknownTradeExplorerExportEconomy,
  unknownTradeExplorerHsProduct,
  unknownTradeExplorerImportEconomy,
} from "../domain/trade-explorer/errors";
import type {
  TradeExplorerV1EvidenceRequest,
  TradeExplorerV1Inputs,
} from "../domain/trade-explorer/result";
import {
  createTradeTrendDatasetPackage,
  TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
  type TradeTrendDatasetPackage,
} from "../domain/trade-analytics/trade-trend-v1-dataset-package";
import {
  createSupplierCompetitionDatasetPackage,
  SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
  type SupplierCompetitionDatasetPackage,
} from "../domain/trade-analytics/supplier-competition-v1-dataset-package";
import {
  createTradeExplorerDatasetPackage,
  TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
  type TradeExplorerDatasetPackage,
} from "../domain/trade-analytics/trade-explorer-v1-dataset-package";
import {
  CANDIDATE_MARKET_V1_DATASET_DECLARATION,
  createCandidateMarketDatasetPackage,
  type CandidateMarketDatasetPackage,
} from "../domain/trade-analytics/dataset-package";
import {
  CORE_CURRENT_INPUT,
  DISCONTINUITY_INPUT,
  EMPTY_INPUT,
  PROVISIONAL_MUTATION_INPUT,
  QUANTITY_ZERO_INPUT,
} from "../../fixtures/acceptance/v1/evidence/core-current";
import {
  generateDemoAnalysisInput,
  isDemoAnalysisProduct,
} from "../../fixtures/acceptance/v1/evidence/demo-analysis";
import { MICRO_FIXTURE_INPUTS } from "../../fixtures/acceptance/v1/evidence/microfixtures";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  FIXTURE_ADAPTER_TEST_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import type {
  CmsV1Inputs,
  TradeEvidenceSource,
} from "./trade-evidence-source";
import {
  TRADE_TREND_FIXTURE_CONTENT_SHA256,
  TRADE_TREND_FIXTURE_INPUTS,
} from "../../fixtures/trade-trend/v1/evidence";
import {
  SUPPLIER_COMPETITION_FIXTURE_CONTENT_SHA256,
  SUPPLIER_COMPETITION_FIXTURE_INPUTS,
} from "../../fixtures/supplier-competition/v1/evidence";
import {
  cellFor,
  knownTradeExplorerEconomy,
  knownTradeExplorerProduct,
  resolveTradeExplorerCombo,
  TRADE_EXPLORER_ARTIFACT,
  TRADE_EXPLORER_ANALYSIS_RELEASE_CATALOG_SHA256,
  TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
  TRADE_EXPLORER_RELEASE,
} from "../../fixtures/trade-explorer/v1/evidence";


const FIXTURE_INPUTS: ReadonlyMap<string, CmsV1Inputs> = new Map([
  [
    fixtureKey(ACCEPTANCE_FIXTURE_BUILD_IDS.core, "010121"),
    CORE_CURRENT_INPUT,
  ],
  [fixtureKey(ACCEPTANCE_FIXTURE_BUILD_IDS.core, "851712"), EMPTY_INPUT],
  [
    fixtureKey(ACCEPTANCE_FIXTURE_BUILD_IDS.discontinuity, "851712"),
    DISCONTINUITY_INPUT,
  ],
  [
    fixtureKey(ACCEPTANCE_FIXTURE_BUILD_IDS.quantityZero, "010121"),
    QUANTITY_ZERO_INPUT,
  ],
  [
    fixtureKey(ACCEPTANCE_FIXTURE_BUILD_IDS.provisionalMutation, "010121"),
    PROVISIONAL_MUTATION_INPUT,
  ],
  ...[...MICRO_FIXTURE_INPUTS.values()].map(
    (input) =>
      [fixtureKey(input.analysisBuildId, input.product.code), input] as const,
  ),
]);

const AVAILABLE_BUILD_IDS = new Set(
  [...FIXTURE_INPUTS.values()].map(({ analysisBuildId }) => analysisBuildId),
);

export class FixtureTradeEvidenceSource implements TradeEvidenceSource {
  async loadCmsV1Inputs(
    query: CandidateMarketV1RecipeInput,
  ): Promise<CmsV1Inputs> {
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture adapter failure");
    }

    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable) {
      throw unavailableAnalysisBuild(query.analysisBuildId);
    }

    if (!AVAILABLE_BUILD_IDS.has(query.analysisBuildId)) {
      throw retiredAnalysisBuild(query.analysisBuildId);
    }

    if (query.exporterCode !== "156") {
      throw unknownExporter(query.exporterCode);
    }

    const input = FIXTURE_INPUTS.get(
      fixtureKey(query.analysisBuildId, query.productCode),
    );
    if (input !== undefined) {
      return input;
    }

    if (
      query.analysisBuildId === ACCEPTANCE_FIXTURE_BUILD_IDS.core &&
      isDemoAnalysisProduct(query.productCode)
    ) {
      return generateDemoAnalysisInput(query.productCode);
    }

    throw unknownProduct(query.productCode);
  }

  async loadTradeTrendV1Inputs(
    query: TradeTrendV1RecipeInput,
  ): Promise<TradeTrendV1Inputs> {
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture adapter failure");
    }
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable) {
      throw unavailableTradeTrendAnalysisBuild(query.analysisBuildId);
    }
    if (query.analysisBuildId !== ACCEPTANCE_FIXTURE_BUILD_IDS.core) {
      throw retiredTradeTrendAnalysisBuild(query.analysisBuildId);
    }
    const input = TRADE_TREND_FIXTURE_INPUTS.get(
      tradeTrendFixtureKey(query.importerCode, query.productCode),
    );
    if (input !== undefined) {
      return input;
    }
    if (
      [...TRADE_TREND_FIXTURE_INPUTS.keys()].some((key) =>
        key.endsWith(`:${query.productCode}`),
      )
    ) {
      throw unknownImporter(query.importerCode);
    }
    throw unknownTradeTrendProduct(query.productCode);
  }

  async loadSupplierCompetitionV1Inputs(
    query: SupplierCompetitionV1RecipeInput,
  ): Promise<SupplierCompetitionV1Inputs> {
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture adapter failure");
    }
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable) {
      throw unavailableSupplierCompetitionAnalysisBuild(
        query.analysisBuildId,
      );
    }
    if (query.analysisBuildId !== ACCEPTANCE_FIXTURE_BUILD_IDS.core) {
      throw retiredSupplierCompetitionAnalysisBuild(query.analysisBuildId);
    }
    const input = SUPPLIER_COMPETITION_FIXTURE_INPUTS.get(
      supplierCompetitionFixtureKey(query.importerCode, query.productCode),
    );
    if (input !== undefined) {
      return input;
    }
    if (
      [...SUPPLIER_COMPETITION_FIXTURE_INPUTS.keys()].some((key) =>
        key.endsWith(`:${query.productCode}`),
      )
    ) {
      throw unknownSupplierCompetitionImporter(query.importerCode);
    }
    throw unknownSupplierCompetitionProduct(query.productCode);
  }

  async loadTradeExplorerV1Inputs(
    request: TradeExplorerV1EvidenceRequest,
  ): Promise<TradeExplorerV1Inputs> {
    if (request.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture adapter failure");
    }
    if (
      request.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable
    ) {
      throw unavailableTradeExplorerAnalysisBuild(request.analysisBuildId);
    }
    if (request.analysisBuildId !== ACCEPTANCE_FIXTURE_BUILD_IDS.core) {
      throw retiredTradeExplorerAnalysisBuild(request.analysisBuildId);
    }
    const { query } = request;

    const exportEconomies = query.exportEconomy.map((code) => {
      const identity = knownTradeExplorerEconomy(code);
      if (identity === null) {
        throw unknownTradeExplorerExportEconomy(code);
      }
      return identity;
    });
    const importEconomies = query.importEconomy.map((code) => {
      const identity = knownTradeExplorerEconomy(code);
      if (identity === null) {
        throw unknownTradeExplorerImportEconomy(code);
      }
      return identity;
    });
    const products = query.hsProduct.map((code) => {
      const identity = knownTradeExplorerProduct(code);
      if (identity === null) {
        throw unknownTradeExplorerHsProduct(code);
      }
      return identity;
    });

    const combo = resolveTradeExplorerCombo(query);
    if (combo === null) {
      return {
        analysisBuildId: request.analysisBuildId,
        analysisReleaseCatalogSha256: TRADE_EXPLORER_ANALYSIS_RELEASE_CATALOG_SHA256,
        evidenceSha256: TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
        artifact: TRADE_EXPLORER_ARTIFACT,
        release: TRADE_EXPLORER_RELEASE,
        query,
        exportEconomies,
        importEconomies,
        products,
        cohortEnumerable: false,
        cells: [],
      };
    }

    const groupedCodes =
      query.dimension === "YEAR"
        ? query.years.map(String)
        : query.dimension === "EXPORT_ECONOMY"
          ? query.exportEconomy
          : query.dimension === "IMPORT_ECONOMY"
            ? query.importEconomy
            : query.hsProduct;

    return {
      analysisBuildId: request.analysisBuildId,
      analysisReleaseCatalogSha256: TRADE_EXPLORER_ANALYSIS_RELEASE_CATALOG_SHA256,
      evidenceSha256: TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
      artifact: TRADE_EXPLORER_ARTIFACT,
      release: TRADE_EXPLORER_RELEASE,
      query,
      exportEconomies,
      importEconomies,
      products,
      cohortEnumerable: true,
      cells: groupedCodes.map((code) => cellFor(combo, code)),
    };
  }
}

export function createFixtureCandidateMarketDatasetPackages(
  comparisonInputs: ReadonlyMap<string, CmsV1Inputs> = new Map(),
): ReadonlyMap<string, CandidateMarketDatasetPackage> {
  const packages = new Map(
    [...FIXTURE_INPUTS.values()].map(
      (
        input,
      ): readonly [string, CandidateMarketDatasetPackage] => {
        const evidence = fixtureDatasetPackageEvidence(input);
        return [
          input.analysisBuildId,
          createCandidateMarketDatasetPackage({
            schemaVersion:
              "candidate-market-dataset-package-manifest-v1",
            ...evidence,
            content: {
              releaseCatalogSha256:
                input.analysisReleaseCatalogSha256,
              ...evidence.content,
            },
            physicalObjects: [
              {
                role: "ANALYSIS_ARTIFACT",
                objectId: input.artifact.buildId,
                relativePath: "candidate-market.duckdb",
                schemaVersion: input.artifact.schemaVersion,
                bytes: 0,
                sha256: input.artifact.sha256,
              },
            ],
            comparisonEvidence: fixtureComparisonEvidence(
              comparisonInputs.get(input.analysisBuildId) ?? null,
            ),
          }),
        ];
      },
    ),
  );
  const activePackage = packages.get(ACCEPTANCE_FIXTURE_BUILD_IDS.core)!;
  packages.set(FIXTURE_ADAPTER_TEST_BUILD_IDS.failing, activePackage);
  packages.set(FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable, activePackage);
  return packages;
}

function fixtureDatasetPackageEvidence(input: CmsV1Inputs) {
  return {
    source: {
      dataset: "CEPII_BACI",
      release: input.release.baciRelease,
      updateDate: input.release.sourceUpdateDate,
      archive: {
        url: `https://fixtures.invalid/${input.release.baciRelease}.zip`,
        bytes: 0,
        sha256: input.artifact.sha256,
      },
    },
    packageSchemaVersion: input.artifact.schemaVersion,
    hsRevision: input.release.hsRevision,
    missingObservationTreatment:
      CANDIDATE_MARKET_V1_DATASET_DECLARATION.missingObservationTreatment,
    coverage: {
      ingestedYears: input.release.ingestedYears,
      finalized: {
        years: {
          start: input.release.ingestedYears.start,
          end: input.release.finalizedCutoffYear,
        },
        cutoffYear: input.release.finalizedCutoffYear,
        scoreWindow: {
          start: input.release.finalizedCutoffYear - 4,
          end: input.release.finalizedCutoffYear,
        },
        treatment:
          CANDIDATE_MARKET_V1_DATASET_DECLARATION.finalizedTreatment,
      },
      provisional: {
        years: [input.release.provisionalYear],
        treatment:
          CANDIDATE_MARKET_V1_DATASET_DECLARATION.provisionalTreatment,
      },
    },
    capabilities:
      CANDIDATE_MARKET_V1_DATASET_DECLARATION.capabilities,
    content: {
      stagingManifestSha256: input.artifact.sha256,
      coverageApprovalSha256:
        input.analysisReleaseCatalogSha256,
      sourceReconciliationEvidence: {
        kind: "EMBEDDED_ANNUAL_SOURCE_CHECKS",
        sha256: input.artifact.sha256,
      },
    },
    quality: {
      status: "accepted",
      evidence: [
        {
          kind: "EMBEDDED_ANNUAL_SOURCE_CHECKS",
          sha256: input.artifact.sha256,
        },
        {
          kind: "COVERAGE_APPROVAL",
          sha256: input.analysisReleaseCatalogSha256,
        },
      ],
    },
    attribution: {
      statement:
        "Acceptance fixture with CEPII BACI-equivalent capability semantics.",
      license: {
        name: "Test fixture",
        url: "https://fixtures.invalid/license",
      },
    },
  };
}

function fixtureComparisonEvidence(
  input: CmsV1Inputs | null,
) {
  if (input === null) {
    return null;
  }
  return {
    ...fixtureDatasetPackageEvidence(input),
    physicalObject: {
      role: "PREVIOUS_ANALYSIS_ARTIFACT",
      objectId: input.artifact.buildId,
      relativePath: "previous/candidate-market.duckdb",
      schemaVersion: input.artifact.schemaVersion,
      bytes: 0,
      sha256: input.artifact.sha256,
    },
  };
}

function fixtureKey(analysisBuildId: string, productCode: string): string {
  return `${analysisBuildId}:${productCode}`;
}

export function createFixtureTradeTrendDatasetPackages(): ReadonlyMap<
  string,
  TradeTrendDatasetPackage
> {
  const datasetPackage = createTradeTrendDatasetPackage({
    schemaVersion: "trade-trend-dataset-package-manifest-v1",
    baciRelease: "V202601",
    hsRevision: "HS12",
    finalizedYearCount: 5,
    evidenceSha256: TRADE_TREND_FIXTURE_CONTENT_SHA256,
    capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS,
  });
  return new Map([
    [ACCEPTANCE_FIXTURE_BUILD_IDS.core, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.failing, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable, datasetPackage],
  ]);
}

function tradeTrendFixtureKey(importerCode: string, productCode: string): string {
  return `${importerCode}:${productCode}`;
}

export function createFixtureSupplierCompetitionDatasetPackages(): ReadonlyMap<
  string,
  SupplierCompetitionDatasetPackage
> {
  const datasetPackage = createSupplierCompetitionDatasetPackage({
    schemaVersion: "supplier-competition-dataset-package-manifest-v1",
    baciRelease: "V202601",
    hsRevision: "HS12",
    finalizedYearCount: 5,
    evidenceSha256: SUPPLIER_COMPETITION_FIXTURE_CONTENT_SHA256,
    capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
  });
  return new Map([
    [ACCEPTANCE_FIXTURE_BUILD_IDS.core, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.failing, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable, datasetPackage],
  ]);
}

function supplierCompetitionFixtureKey(
  importerCode: string,
  productCode: string,
): string {
  return `${importerCode}:${productCode}`;
}

export function createFixtureTradeExplorerDatasetPackages(): ReadonlyMap<
  string,
  TradeExplorerDatasetPackage
> {
  const datasetPackage = createTradeExplorerDatasetPackage({
    schemaVersion: "trade-explorer-dataset-package-manifest-v1",
    baciRelease: "V202601",
    hsRevision: "HS12",
    finalizedYearCount: 5,
    finalizedCutoffYear: TRADE_EXPLORER_RELEASE.finalizedCutoffYear,
    evidenceSha256: TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
    capabilities: TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
  });
  return new Map([
    [ACCEPTANCE_FIXTURE_BUILD_IDS.core, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.failing, datasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable, datasetPackage],
  ]);
}
