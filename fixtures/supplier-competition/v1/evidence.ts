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
]);

function fixtureKey(input: SupplierCompetitionV1Inputs): string {
  return `${input.importer.code}:${input.product.code}`;
}

export const SUPPLIER_COMPETITION_FIXTURE_CONTENT_SHA256 = createHash("sha256")
  .update(JSON.stringify([...SUPPLIER_COMPETITION_FIXTURE_INPUTS.entries()]))
  .digest("hex");
