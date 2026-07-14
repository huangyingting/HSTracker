import {
  retiredAnalysisBuild,
  unavailableAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../domain/candidate-market/errors";
import {
  CmsV1CandidateMarketAnalysis,
  type CandidateMarketAnalysis,
} from "../domain/candidate-market/analyze-candidate-markets";
import type { CandidateMarketAnalysisQuery } from "../domain/candidate-market/result";
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
    query: CandidateMarketAnalysisQuery,
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
}

export function createFixtureCandidateMarketAnalysis(): CandidateMarketAnalysis {
  return new CmsV1CandidateMarketAnalysis(
    new FixtureTradeEvidenceSource(),
  );
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
