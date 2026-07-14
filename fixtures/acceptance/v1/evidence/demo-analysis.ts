import type { EconomyIdentity } from "../../../../src/domain/candidate-market/result";
import type {
  CmsV1Inputs,
  MarketYearEvidence,
} from "../../../../src/evidence/trade-evidence-source";
import { DEMO_PRODUCT_RECORDS } from "../catalog/demo-products";
import { CORE_CURRENT_INPUT } from "./core-current";

const DEMO_PRODUCT_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  DEMO_PRODUCT_RECORDS.map((product) => [
    product.code,
    product.sourceDescriptionEn,
  ]),
);

const CANDIDATE_IDENTITIES: readonly EconomyIdentity[] = (() => {
  const seen = new Map<string, EconomyIdentity>();
  for (const row of CORE_CURRENT_INPUT.marketYears) {
    if (!seen.has(row.candidateMarket.code)) {
      seen.set(row.candidateMarket.code, row.candidateMarket);
    }
  }
  return [...seen.values()];
})();

function rotationOffset(productCode: string): number {
  let hash = 0;
  for (const character of productCode) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CANDIDATE_IDENTITIES.length === 0
    ? 0
    : hash % CANDIDATE_IDENTITIES.length;
}

/**
 * Deterministically reassigns each candidate economy's fixture value profile to
 * a rotated economy identity so different demo products rank Candidate Markets
 * differently while every economy, value series, and derived indicator stays
 * internally consistent with {@link CORE_CURRENT_INPUT}.
 */
function relabelForProduct(
  productCode: string,
): ReadonlyMap<string, EconomyIdentity> {
  const offset = rotationOffset(productCode);
  const relabel = new Map<string, EconomyIdentity>();
  CANDIDATE_IDENTITIES.forEach((identity, index) => {
    const target =
      CANDIDATE_IDENTITIES[
        (index + offset) % CANDIDATE_IDENTITIES.length
      ]!;
    relabel.set(identity.code, target);
  });
  return relabel;
}

function relabelRows(
  rows: readonly MarketYearEvidence[],
  relabel: ReadonlyMap<string, EconomyIdentity>,
): readonly MarketYearEvidence[] {
  return rows.map((row) => ({
    ...row,
    candidateMarket: relabel.get(row.candidateMarket.code) ?? row.candidateMarket,
  }));
}

export function isDemoAnalysisProduct(productCode: string): boolean {
  return DEMO_PRODUCT_DESCRIPTIONS.has(productCode);
}

/**
 * Builds a complete, self-consistent Candidate Market analysis input for a
 * recognizable demo product so the fixture runtime can present a full ranked
 * result for common products such as computers, cars, or coffee.
 */
export function generateDemoAnalysisInput(productCode: string): CmsV1Inputs {
  const descriptionEn = DEMO_PRODUCT_DESCRIPTIONS.get(productCode);
  if (descriptionEn === undefined) {
    throw new Error(
      `No demo analysis is defined for product ${productCode}.`,
    );
  }
  const relabel = relabelForProduct(productCode);
  return {
    ...CORE_CURRENT_INPUT,
    product: {
      hsRevision: "HS12",
      code: productCode,
      descriptionEn,
    },
    marketYears: relabelRows(CORE_CURRENT_INPUT.marketYears, relabel),
    provisionalMarketYears: relabelRows(
      CORE_CURRENT_INPUT.provisionalMarketYears,
      relabel,
    ),
  };
}
