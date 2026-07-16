import { createHash } from "node:crypto";

import {
  OPPORTUNITY_FIXTURE_BUILD_ID,
  OPPORTUNITY_FIXTURE_COHORTS,
} from "../../fixtures/opportunity-discovery/v1/cohort";
import {
  unknownExportEconomy,
  unknownOpportunityProduct,
} from "../domain/opportunity-discovery/errors";
import {
  computeOpportunityCohort,
  type OpportunityCohort,
} from "../domain/opportunity-discovery/opportunity-discovery-v1";
import { pageOpportunityCohort } from "../domain/opportunity-discovery/page";
import type { MarketInvestigationPage } from "../domain/opportunity-discovery/result";
import {
  createOpportunityDiscoveryDatasetPackage,
  OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
  type OpportunityDiscoveryDatasetPackage,
} from "../domain/trade-analytics/opportunity-discovery-v1-dataset-package";
import type {
  OpportunityCandidateIndex,
  OpportunityDetailEvidence,
  OpportunityDetailRequest,
  OpportunityDiscoveryV1CohortInputs,
  OpportunityEvidenceSource,
} from "./opportunity-evidence-source";
import type { OpportunityDiscoveryV1RecipeInput } from "../domain/opportunity-discovery/result";

function normalizeEconomyCode(code: string): string {
  return String(Number(code));
}

// Precomputes every fixture cohort offline (exactly what a production adapter
// reads from a precomputed ordered index) and serves keyset pages from it. It
// binds/validates cursors to the Analysis Identity the platform supplies, so a
// cursor minted for one exporter/product-filter feed can never be replayed
// against another.
export class FixtureOpportunityCandidateIndex
  implements OpportunityCandidateIndex
{
  private readonly cohortsByExporter: Map<string, OpportunityCohort>;
  private readonly catalog: ReadonlySet<string>;

  constructor(
    inputs: readonly OpportunityDiscoveryV1CohortInputs[] = OPPORTUNITY_FIXTURE_COHORTS,
  ) {
    this.cohortsByExporter = new Map();
    const catalog = new Set<string>();
    for (const input of inputs) {
      this.cohortsByExporter.set(
        normalizeEconomyCode(input.exporter.code),
        computeOpportunityCohort(input),
      );
      for (const product of input.products) {
        catalog.add(product.product.code);
      }
    }
    this.catalog = catalog;
  }

  async page(
    query: OpportunityDiscoveryV1RecipeInput,
    analysisIdentity: string,
  ): Promise<MarketInvestigationPage> {
    const cohort = this.cohortsByExporter.get(
      normalizeEconomyCode(query.exportEconomyCode),
    );
    if (cohort === undefined) {
      throw unknownExportEconomy(query.exportEconomyCode);
    }
    if (query.productCodes !== null) {
      for (const code of query.productCodes) {
        if (!this.catalog.has(code)) {
          throw unknownOpportunityProduct(code);
        }
      }
    }
    return pageOpportunityCohort(
      cohort,
      {
        limit: query.limit,
        cursor: query.cursor,
        productCodes: query.productCodes,
      },
      analysisIdentity,
    );
  }
}

// Serves detail evidence for one candidate straight from the raw fixture
// cohort rows, carrying the canonical Candidate Market drill-down link plus the
// exact BACI year rows that back the candidate.
export class FixtureOpportunityEvidenceSource
  implements OpportunityEvidenceSource
{
  private readonly inputsByExporter: Map<string, OpportunityDiscoveryV1CohortInputs>;

  constructor(
    inputs: readonly OpportunityDiscoveryV1CohortInputs[] = OPPORTUNITY_FIXTURE_COHORTS,
  ) {
    this.inputsByExporter = new Map(
      inputs.map((input) => [normalizeEconomyCode(input.exporter.code), input]),
    );
  }

  async loadDetail(
    request: OpportunityDetailRequest,
  ): Promise<OpportunityDetailEvidence> {
    const inputs = this.inputsByExporter.get(
      normalizeEconomyCode(request.exportEconomyCode),
    );
    if (inputs === undefined) {
      throw unknownExportEconomy(request.exportEconomyCode);
    }
    const marketEvidence = inputs.markets.find(
      (market) =>
        market.product.code === request.productCode &&
        normalizeEconomyCode(market.market.code) ===
          normalizeEconomyCode(request.marketCode),
    );
    if (marketEvidence === undefined) {
      throw unknownOpportunityProduct(request.productCode);
    }
    const cutoffYear = inputs.release.finalizedCutoffYear;
    return {
      analysisBuildId: inputs.analysisBuildId,
      exporter: inputs.exporter,
      product: marketEvidence.product,
      market: marketEvidence.market,
      candidateMarketDrillDown: {
        recipe: "candidate-market-v1",
        exporterCode: normalizeEconomyCode(inputs.exporter.code),
        product: marketEvidence.product,
        focusMarketCode: normalizeEconomyCode(marketEvidence.market.code),
      },
      scoreWindow: { start: cutoffYear - 4, end: cutoffYear },
      marketYears: marketEvidence.marketYears,
    };
  }
}

// A stable content identity over the fixture cohorts, so the fixture dataset
// package's evidence identity changes if and only if the fixture evidence does.
export const OPPORTUNITY_FIXTURE_CONTENT_SHA256 = createHash("sha256")
  .update(JSON.stringify(OPPORTUNITY_FIXTURE_COHORTS))
  .digest("hex");

export function createFixtureOpportunityDiscoveryDatasetPackages(): ReadonlyMap<
  string,
  OpportunityDiscoveryDatasetPackage
> {
  const datasetPackage = createOpportunityDiscoveryDatasetPackage({
    schemaVersion: "opportunity-discovery-dataset-package-manifest-v1",
    baciRelease: "BACI-HS12-fixture",
    hsRevision: "HS12",
    finalizedYearCount: 5,
    evidenceSha256: OPPORTUNITY_FIXTURE_CONTENT_SHA256,
    capabilities: OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
  });
  return new Map([[OPPORTUNITY_FIXTURE_BUILD_ID, datasetPackage]]);
}
