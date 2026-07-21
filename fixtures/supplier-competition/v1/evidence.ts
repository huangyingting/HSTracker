import { createHash } from "node:crypto";

import type { SupplierCompetitionV1Inputs } from "../../../src/domain/supplier-competition/result";

const common = {
  analysisBuildId: "acceptance-fixtures-v1",
  analysisReleaseCatalogSha256:
    "3b1ff899c301d11a2bb5c29e3040e9261a68633b54a7d94f4b15338129d4fcff",
  artifact: {
    baciRelease: "V202601",
    buildId: "acceptance-fixtures-v1-core-artifact",
    schemaVersion: "candidate-market-artifact-v1",
    sha256: "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
  },
  release: {
    baciRelease: "V202601",
    sourceUpdateDate: "2026-01-22",
    hsRevision: "HS12" as const,
    ingestedYears: { start: 2012, end: 2024 },
    finalizedCutoffYear: 2023,
    provisionalYear: 2024,
  },
  product: {
    hsRevision: "HS12" as const,
    code: "010121",
    descriptionEn: "Horses: live, pure-bred breeding animals",
  },
};

const CHINA = { code: "156", name: "China", iso3: "CHN", identityNote: null };
const JAPAN = { code: "392", name: "Japan", iso3: "JPN", identityNote: null };
const NETHERLANDS = {
  code: "528",
  name: "Netherlands",
  iso3: "NLD",
  identityNote: null,
};
const UNITED_STATES = {
  code: "842",
  name: "United States",
  iso3: "USA",
  identityNote: null,
};
const SOUTH_AFRICA = {
  code: "710",
  name: "South Africa",
  iso3: "ZAF",
  identityNote: null,
};
const MEXICO = { code: "484", name: "Mexico", iso3: "MEX", identityNote: null };

const BRAZIL = { code: "76", name: "Brazil", iso3: "BRA", identityNote: null };
const CANADA = { code: "124", name: "Canada", iso3: "CAN", identityNote: null };
const CHILE = { code: "152", name: "Chile", iso3: "CHL", identityNote: null };
const KENYA = { code: "404", name: "Kenya", iso3: "KEN", identityNote: null };
const POLAND = { code: "616", name: "Poland", iso3: "POL", identityNote: null };
const INDIA = { code: "699", name: "India", iso3: "IND", identityNote: null };

function recordedFiveYears(
  economy: typeof CHINA,
  annualValue: string,
  sourceFlowCount: number,
  quantityPresentCount: number,
) {
  return {
    economy,
    annualObservations: [2019, 2020, 2021, 2022, 2023].map((year) => ({
      year,
      state: "RECORDED_POSITIVE" as const,
      valueCurrentUsd: annualValue,
    })),
    sourceFlowCount,
    quantityPresentCount,
  };
}

// "dispersed": the importing economy (Brazil) draws evenly from four
// supplying economies, each an exact 25.000000% share (HHI 2500.000000).
export const SUPPLIER_COMPETITION_DISPERSED_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: BRAZIL,
  suppliers: [
    recordedFiveYears(CHINA, "50000", 5, 5),
    recordedFiveYears(JAPAN, "50000", 5, 4),
    recordedFiveYears(NETHERLANDS, "50000", 5, 5),
    recordedFiveYears(UNITED_STATES, "50000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" } },
    { economy: JAPAN, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" } },
    { economy: NETHERLANDS, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" } },
    { economy: UNITED_STATES, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" } },
  ],
};

// "concentrated": a dominant supplying economy (China, 70%) alongside three
// smaller economies at 10% each (HHI 5200.000000).
export const SUPPLIER_COMPETITION_CONCENTRATED_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: CANADA,
  suppliers: [
    recordedFiveYears(CHINA, "140000", 5, 5),
    recordedFiveYears(JAPAN, "20000", 5, 5),
    recordedFiveYears(NETHERLANDS, "20000", 5, 5),
    recordedFiveYears(SOUTH_AFRICA, "20000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "150000" } },
    { economy: JAPAN, bilateral: { state: "NO_RECORDED_POSITIVE_FLOW" } },
    { economy: NETHERLANDS, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "20000" } },
    { economy: SOUTH_AFRICA, bilateral: { state: "NO_RECORDED_POSITIVE_FLOW" } },
  ],
};

// "single-supplier": a monopoly supplying economy (United States, 100%),
// reporting a monopoly HHI of exactly 10000.000000.
export const SUPPLIER_COMPETITION_SINGLE_SUPPLIER_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: CHILE,
  suppliers: [recordedFiveYears(UNITED_STATES, "100000", 5, 5)],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: UNITED_STATES, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "120000" } },
  ],
};

// "sparse": one supplying economy misses two finalized years entirely
// (MISSING_OBSERVATION) while another reports positive trade only once and
// no recorded flow otherwise, together leaving two window years with no
// recorded supplier at all. The Provisional Year itself has no usable
// evidence, so every finalized supplier's provisional row is NOT_APPLICABLE.
export const SUPPLIER_COMPETITION_SPARSE_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: KENYA,
  suppliers: [
    {
      economy: NETHERLANDS,
      annualObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "10000" },
        { year: 2020, state: "MISSING_OBSERVATION" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "10000" },
        { year: 2022, state: "MISSING_OBSERVATION" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "10000" },
      ],
      sourceFlowCount: 0,
      quantityPresentCount: 0,
    },
    {
      economy: MEXICO,
      annualObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "5000" },
        { year: 2020, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2023, state: "NO_RECORDED_POSITIVE_FLOW" },
      ],
      sourceFlowCount: 4,
      quantityPresentCount: 3,
    },
  ],
  provisionalMarketState: "MISSING_OBSERVATION",
  provisionalSuppliers: [],
};

// "empty": no supplying economy recorded a positive value across the whole
// finalized window, so the cohort, pooled value, and concentration are all
// distinctly empty/unavailable rather than a neutral zero.
export const SUPPLIER_COMPETITION_EMPTY_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: POLAND,
  suppliers: [],
  provisionalMarketState: "NO_RECORDED_POSITIVE_FLOW",
  provisionalSuppliers: [],
};

// "provisional-changing": the finalized cohort is an even 50/50 split
// between China and the Netherlands (HHI 5000.000000). The Provisional Year
// snapshot shows a materially different supplier structure -- China drops to
// no recorded flow and the United States appears as a brand-new entrant --
// without ever changing the finalized shares or HHI above.
export const SUPPLIER_COMPETITION_PROVISIONAL_CHANGING_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: INDIA,
  suppliers: [
    recordedFiveYears(CHINA, "40000", 5, 5),
    recordedFiveYears(NETHERLANDS, "40000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "NO_RECORDED_POSITIVE_FLOW" } },
    {
      economy: NETHERLANDS,
      bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "300000" },
    },
    {
      economy: UNITED_STATES,
      bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "150000" },
    },
  ],
};

// "netherlands": the Market Analysis Module's own acceptance scenario (issue
// #66) -- China and the United States each hold half of a recorded,
// concentrated supplier structure behind the Netherlands' imports, with a
// matching Provisional Year snapshot. This importer is also a
// core-current.ts Candidate Market and a fixtures/trade-trend/v1 importer,
// so the same "acceptance-fixtures-v1" build can complete every constituent
// recipe for one Candidate Market Context.
export const SUPPLIER_COMPETITION_NETHERLANDS_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: NETHERLANDS,
  suppliers: [
    recordedFiveYears(CHINA, "60000", 5, 5),
    recordedFiveYears(UNITED_STATES, "60000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "70000" } },
    { economy: UNITED_STATES, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "70000" } },
  ],
};

// "south-africa-empty": another Market Analysis Module acceptance scenario
// (issue #66) -- no supplying economy recorded a positive pooled value, so
// the cohort, pooled value, and concentration stay distinctly empty rather
// than a neutral zero, exactly like SUPPLIER_COMPETITION_EMPTY_INPUT above.
// South Africa is also a core-current.ts Candidate Market and a
// fixtures/trade-trend/v1 importer with a missing Provisional Year, which
// this mirrors with a MISSING_OBSERVATION provisional market state.
export const SUPPLIER_COMPETITION_SOUTH_AFRICA_EMPTY_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: SOUTH_AFRICA,
  suppliers: [],
  provisionalMarketState: "MISSING_OBSERVATION",
  provisionalSuppliers: [],
};

const UNITED_KINGDOM = {
  code: "826",
  name: "United Kingdom",
  iso3: "GBR",
  identityNote: null,
};

// "united-kingdom": the Market Analysis Module's own acceptance scenario
// (issue #66) for a market absent from the complete Candidate Market
// cohort. This importer is deliberately not one of the core-current.ts
// Candidate Market candidates, so requesting it exercises
// CANDIDATE_MARKET_NOT_FOUND without any constituent invalid-input failure
// masking the absence, matching the fixtures/trade-trend/v1 "826" entry.
export const SUPPLIER_COMPETITION_UNITED_KINGDOM_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: UNITED_KINGDOM,
  suppliers: [recordedFiveYears(CHINA, "34000", 5, 5)],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "35000" } },
  ],
};

const AUSTRALIA = {
  code: "36",
  name: "Australia",
  iso3: "AUS",
  identityNote: null,
};

const OTHER_ASIA = {
  code: "490",
  name: "Other Asia, nes",
  iso3: null,
  identityNote:
    "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
};

// The remaining core-current.ts Candidate Markets (issue #68: Market
// Analysis replaces the Candidate Market audit detail with the atomic
// three-recipe Market Analysis Module, so every existing Candidate Market
// needs a compatible supplier-competition-v1 importer too, not only the
// Netherlands/South Africa pair issue #66 added for the Module's own
// acceptance scenarios).
export const SUPPLIER_COMPETITION_AUSTRALIA_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: AUSTRALIA,
  suppliers: [
    recordedFiveYears(CHINA, "30000", 5, 5),
    recordedFiveYears(NETHERLANDS, "10000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "31000" } },
    { economy: NETHERLANDS, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "11000" } },
  ],
};

export const SUPPLIER_COMPETITION_JAPAN_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: JAPAN,
  suppliers: [recordedFiveYears(CHINA, "50000", 5, 5)],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "51000" } },
  ],
};

export const SUPPLIER_COMPETITION_MEXICO_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: MEXICO,
  suppliers: [
    recordedFiveYears(CHINA, "40000", 5, 5),
    recordedFiveYears(UNITED_STATES, "20000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "42000" } },
    { economy: UNITED_STATES, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "21000" } },
  ],
};

export const SUPPLIER_COMPETITION_OTHER_ASIA_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: OTHER_ASIA,
  suppliers: [recordedFiveYears(CHINA, "25000", 5, 5)],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "26000" } },
  ],
};

export const SUPPLIER_COMPETITION_UNITED_STATES_INPUT: SupplierCompetitionV1Inputs = {
  ...common,
  importer: UNITED_STATES,
  suppliers: [
    recordedFiveYears(CHINA, "60000", 5, 5),
    recordedFiveYears(JAPAN, "15000", 5, 5),
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    { economy: CHINA, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "62000" } },
    { economy: JAPAN, bilateral: { state: "RECORDED_POSITIVE", valueCurrentUsd: "16000" } },
  ],
};

export const SUPPLIER_COMPETITION_FIXTURE_INPUTS: ReadonlyMap<
  string,
  SupplierCompetitionV1Inputs
> = new Map([
  [
    fixtureKey(SUPPLIER_COMPETITION_DISPERSED_INPUT),
    SUPPLIER_COMPETITION_DISPERSED_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_CONCENTRATED_INPUT),
    SUPPLIER_COMPETITION_CONCENTRATED_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_SINGLE_SUPPLIER_INPUT),
    SUPPLIER_COMPETITION_SINGLE_SUPPLIER_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_SPARSE_INPUT),
    SUPPLIER_COMPETITION_SPARSE_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_EMPTY_INPUT),
    SUPPLIER_COMPETITION_EMPTY_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_PROVISIONAL_CHANGING_INPUT),
    SUPPLIER_COMPETITION_PROVISIONAL_CHANGING_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_NETHERLANDS_INPUT),
    SUPPLIER_COMPETITION_NETHERLANDS_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_SOUTH_AFRICA_EMPTY_INPUT),
    SUPPLIER_COMPETITION_SOUTH_AFRICA_EMPTY_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_UNITED_KINGDOM_INPUT),
    SUPPLIER_COMPETITION_UNITED_KINGDOM_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_AUSTRALIA_INPUT),
    SUPPLIER_COMPETITION_AUSTRALIA_INPUT,
  ],
  [fixtureKey(SUPPLIER_COMPETITION_JAPAN_INPUT), SUPPLIER_COMPETITION_JAPAN_INPUT],
  [
    fixtureKey(SUPPLIER_COMPETITION_MEXICO_INPUT),
    SUPPLIER_COMPETITION_MEXICO_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_OTHER_ASIA_INPUT),
    SUPPLIER_COMPETITION_OTHER_ASIA_INPUT,
  ],
  [
    fixtureKey(SUPPLIER_COMPETITION_UNITED_STATES_INPUT),
    SUPPLIER_COMPETITION_UNITED_STATES_INPUT,
  ],
]);

function fixtureKey(input: SupplierCompetitionV1Inputs): string {
  return `${input.importer.code}:${input.product.code}`;
}

export const SUPPLIER_COMPETITION_FIXTURE_CONTENT_SHA256 = createHash("sha256")
  .update(JSON.stringify([...SUPPLIER_COMPETITION_FIXTURE_INPUTS.entries()]))
  .digest("hex");
