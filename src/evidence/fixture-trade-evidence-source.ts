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
} from "../../test/fixtures/acceptance/v1/evidence/core-current";
import { MICRO_FIXTURE_INPUTS } from "../../test/fixtures/acceptance/v1/evidence/microfixtures";
import type {
  CmsV1Inputs,
  TradeEvidenceSource,
} from "./trade-evidence-source";

export class FixtureTradeEvidenceSource implements TradeEvidenceSource {
  async loadCmsV1Inputs(
    query: CandidateMarketAnalysisQuery,
  ): Promise<CmsV1Inputs> {
    if (query.analysisBuildId === "failing-fixture-build") {
      throw new Error("fixture adapter failure");
    }

    if (query.analysisBuildId === "unavailable-fixture-build") {
      throw unavailableAnalysisBuild(query.analysisBuildId);
    }

    const microfixture = MICRO_FIXTURE_INPUTS.get(query.analysisBuildId);
    if (
      query.analysisBuildId !== "acceptance-fixtures-v1" &&
      query.analysisBuildId !== "acceptance-fixtures-v1-discontinuity" &&
      query.analysisBuildId !== "acceptance-fixtures-v1-quantity-zero" &&
      query.analysisBuildId !==
        "acceptance-fixtures-v1-provisional-mutation" &&
      microfixture === undefined
    ) {
      throw retiredAnalysisBuild(query.analysisBuildId);
    }

    if (query.exporterCode !== "156") {
      throw unknownExporter(query.exporterCode);
    }

    if (microfixture !== undefined) {
      if (query.productCode !== microfixture.product.code) {
        throw unknownProduct(query.productCode);
      }
      return microfixture;
    }

    if (query.analysisBuildId === "acceptance-fixtures-v1-quantity-zero") {
      if (query.productCode !== "010121") {
        throw unknownProduct(query.productCode);
      }
      return QUANTITY_ZERO_INPUT;
    }

    if (
      query.analysisBuildId === "acceptance-fixtures-v1-provisional-mutation"
    ) {
      if (query.productCode !== "010121") {
        throw unknownProduct(query.productCode);
      }
      return PROVISIONAL_MUTATION_INPUT;
    }

    if (query.productCode === "010121") {
      if (query.analysisBuildId !== "acceptance-fixtures-v1") {
        throw unknownProduct(query.productCode);
      }
      return CORE_CURRENT_INPUT;
    }

    if (query.productCode === "851712") {
      return query.analysisBuildId === "acceptance-fixtures-v1"
        ? EMPTY_INPUT
        : DISCONTINUITY_INPUT;
    }

    throw unknownProduct(query.productCode);
  }
}

export function createFixtureCandidateMarketAnalysis(): CandidateMarketAnalysis {
  return new CmsV1CandidateMarketAnalysis(
    new FixtureTradeEvidenceSource(),
  );
}
