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

function fixtureKey(analysisBuildId: string, productCode: string): string {
  return `${analysisBuildId}:${productCode}`;
}
