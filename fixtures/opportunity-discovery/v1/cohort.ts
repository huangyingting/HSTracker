import type {
  OpportunityDiscoveryV1CohortInputs,
  OpportunityMarketEvidence,
  OpportunityProductEvidence,
} from "../../../src/evidence/opportunity-evidence-source";
import type {
  EconomyIdentity,
  ProductIdentity,
} from "../../../src/domain/opportunity-discovery/result";

// Synthetic fixed-cohort oracle for `opportunity-discovery-v1` (recipe doc
// section 10.1). Exporters 100/200, products 010001/010002/010003, importers
// 300/400/500. The exporter-100 cohort is exactly six rows and is engineered
// to force: strict orderings in all four component pools; a raw-value tie with
// a shared midrank; one two-year growth-neutral and one small-base
// growth-neutral; a no-exporter-product-history product; no-recorded-bilateral
// rows with computed foothold percentiles; and all three opportunity types.

export const OPPORTUNITY_FIXTURE_BUILD_ID = "opportunity-discovery-fixtures-v1";
export const OPPORTUNITY_FIXTURE_CUTOFF_YEAR = 2023;
export const OPPORTUNITY_FIXTURE_PROVISIONAL_YEAR = 2024;

const HOMELAND: EconomyIdentity = {
  code: "100",
  name: "Homeland",
  iso3: "HML",
  identityNote: null,
};
const RIVAL: EconomyIdentity = {
  code: "200",
  name: "Rival",
  iso3: "RVL",
  identityNote: null,
};
const ALPHA: EconomyIdentity = {
  code: "300",
  name: "Alpha",
  iso3: "ALP",
  identityNote: null,
};
const BETA: EconomyIdentity = {
  code: "400",
  name: "Beta",
  iso3: "BET",
  identityNote: null,
};
const GAMMA: EconomyIdentity = {
  code: "500",
  name: "Gamma",
  iso3: "GAM",
  identityNote: null,
};

export const OPPORTUNITY_FIXTURE_ECONOMIES = {
  HOMELAND,
  RIVAL,
  ALPHA,
  BETA,
  GAMMA,
} as const;

const PRODUCT_ONE: ProductIdentity = {
  hsRevision: "HS12",
  code: "010001",
  descriptionEn: "Fixture product one",
};
const PRODUCT_TWO: ProductIdentity = {
  hsRevision: "HS12",
  code: "010002",
  descriptionEn: "Fixture product two",
};
const PRODUCT_THREE: ProductIdentity = {
  hsRevision: "HS12",
  code: "010003",
  descriptionEn: "Fixture product three",
};

export const OPPORTUNITY_FIXTURE_PRODUCTS = {
  PRODUCT_ONE,
  PRODUCT_TWO,
  PRODUCT_THREE,
} as const;

const W5_YEARS = [2019, 2020, 2021, 2022, 2023];

function yearTotals(
  values: readonly number[],
  years: readonly number[] = W5_YEARS,
): readonly { year: number; worldValueKusd: string }[] {
  return years.map((year, index) => ({
    year,
    worldValueKusd: String(values[index]),
  }));
}

function exporterTotals(
  values: readonly number[],
  years: readonly number[] = W5_YEARS,
): readonly { year: number; valueKusd: string }[] {
  return years.map((year, index) => ({
    year,
    valueKusd: String(values[index]),
  }));
}

// Builds one market's yearly world/bilateral evidence. `world` and `bilateral`
// align to `years`; a `null` bilateral entry is an absent bilateral flow.
function market(
  product: ProductIdentity,
  economy: EconomyIdentity,
  world: readonly number[],
  bilateral: readonly (number | null)[],
  years: readonly number[] = W5_YEARS,
): OpportunityMarketEvidence {
  return {
    product,
    market: economy,
    marketYears: years.map((year, index) => ({
      year,
      worldValueKusd: String(world[index]),
      bilateralValueKusd:
        bilateral[index] === null || bilateral[index] === undefined
          ? null
          : String(bilateral[index]),
    })),
  };
}

// --- Exporter 100 cohort ---

const EXPORTER_100_PRODUCTS: readonly OpportunityProductEvidence[] = [
  {
    product: PRODUCT_ONE,
    // Exporter 100 exports product one strongly (high presence).
    worldYearTotals: yearTotals([10000, 10000, 10000, 10000, 10000]),
    exporterExportTotals: exporterTotals([4000, 4000, 4000, 4000, 4000]),
  },
  {
    product: PRODUCT_TWO,
    // Medium presence.
    worldYearTotals: yearTotals([20000, 20000, 20000, 20000, 20000]),
    exporterExportTotals: exporterTotals([2000, 2000, 2000, 2000, 2000]),
  },
  {
    product: PRODUCT_THREE,
    // No recorded exporter export history -> presence 0.
    worldYearTotals: yearTotals([5000, 5000, 5000, 5000, 5000]),
    exporterExportTotals: [],
  },
];

const EXPORTER_100_MARKETS: readonly OpportunityMarketEvidence[] = [
  // (010001,300): largest & strongly growing, NO recorded bilateral -> the
  // attractiveness leader with no exporter flow: an unvalidated market gap.
  market(
    PRODUCT_ONE,
    ALPHA,
    [1500, 1700, 1900, 2100, 2500],
    [null, null, null, null, null],
  ),
  // (010001,400): large & strongly growing, recorded bilateral with a real
  // foothold and high product presence -> expansion evidence.
  market(
    PRODUCT_ONE,
    BETA,
    [1300, 1500, 1700, 1900, 2100],
    [400, 420, 440, 460, 500],
  ),
  // (010002,300): small base (<500 mean) -> growth NEUTRAL (small base).
  market(PRODUCT_TWO, ALPHA, [300, 320, 340, 360, 400], [50, 50, 50, 50, 50]),
  // (010002,500): only two observed years -> growth NEUTRAL (too few years);
  // two observed years also triggers the confidence cap.
  market(PRODUCT_TWO, GAMMA, [1500, 1800], [300, 400], [2022, 2023]),
  // (010003,400): computed growth, recorded bilateral, no product export.
  market(PRODUCT_THREE, BETA, [600, 650, 700, 750, 900], [60, 60, 60, 60, 60]),
  // (010003,500): computed growth, NO recorded bilateral, no product export.
  market(
    PRODUCT_THREE,
    GAMMA,
    [1000, 1100, 1200, 1300, 1500],
    [null, null, null, null, null],
  ),
];

// --- Exporter 200 cohort: same eligible market-product rows, different
// bilateral/product-presence evidence so its normalization differs. ---

const EXPORTER_200_PRODUCTS: readonly OpportunityProductEvidence[] = [
  {
    product: PRODUCT_ONE,
    worldYearTotals: yearTotals([10000, 10000, 10000, 10000, 10000]),
    exporterExportTotals: exporterTotals([1000, 1000, 1000, 1000, 1000]),
  },
  {
    product: PRODUCT_TWO,
    worldYearTotals: yearTotals([20000, 20000, 20000, 20000, 20000]),
    exporterExportTotals: exporterTotals([8000, 8000, 8000, 8000, 8000]),
  },
  {
    product: PRODUCT_THREE,
    worldYearTotals: yearTotals([5000, 5000, 5000, 5000, 5000]),
    exporterExportTotals: exporterTotals([2500, 2500, 2500, 2500, 2500]),
  },
];

const EXPORTER_200_MARKETS: readonly OpportunityMarketEvidence[] = [
  market(
    PRODUCT_ONE,
    ALPHA,
    [1000, 1200, 1400, 1600, 2000],
    [500, 500, 500, 500, 500],
  ),
  market(
    PRODUCT_ONE,
    BETA,
    [1600, 1650, 1700, 1750, 1800],
    [100, 100, 100, 100, 100],
  ),
  market(
    PRODUCT_TWO,
    ALPHA,
    [300, 320, 340, 360, 400],
    [100, 100, 100, 100, 100],
  ),
  market(PRODUCT_TWO, GAMMA, [1500, 1800], [500, 600], [2022, 2023]),
  market(
    PRODUCT_THREE,
    BETA,
    [600, 650, 700, 750, 900],
    [300, 300, 300, 300, 300],
  ),
  market(
    PRODUCT_THREE,
    GAMMA,
    [1000, 1100, 1200, 1300, 1500],
    [200, 200, 200, 200, 200],
  ),
];

const RELEASE = {
  baciRelease: "BACI-HS12-fixture",
  sourceUpdateDate: "2026-07-16",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2019, end: 2024 },
  finalizedCutoffYear: OPPORTUNITY_FIXTURE_CUTOFF_YEAR,
  provisionalYear: OPPORTUNITY_FIXTURE_PROVISIONAL_YEAR,
};

const ARTIFACT = {
  baciRelease: "BACI-HS12-fixture",
  buildId: OPPORTUNITY_FIXTURE_BUILD_ID,
  schemaVersion: "opportunity-index-v1",
  sha256: "f".repeat(64),
};

export const OPPORTUNITY_FIXTURE_COHORTS: readonly OpportunityDiscoveryV1CohortInputs[] =
  [
    {
      analysisBuildId: OPPORTUNITY_FIXTURE_BUILD_ID,
      artifact: ARTIFACT,
      release: RELEASE,
      exporter: HOMELAND,
      products: EXPORTER_100_PRODUCTS,
      markets: EXPORTER_100_MARKETS,
    },
    {
      analysisBuildId: OPPORTUNITY_FIXTURE_BUILD_ID,
      artifact: ARTIFACT,
      release: RELEASE,
      exporter: RIVAL,
      products: EXPORTER_200_PRODUCTS,
      markets: EXPORTER_200_MARKETS,
    },
  ];
