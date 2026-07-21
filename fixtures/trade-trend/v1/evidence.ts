import { createHash } from "node:crypto";

import type { TradeTrendV1Inputs } from "../../../src/domain/trade-trend/result";

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

export const TRADE_TREND_FIXTURE_INPUTS = new Map<
  string,
  TradeTrendV1Inputs
>([
  [
    "156:010121",
    {
      ...common,
      importer: {
        code: "156",
        name: "China",
        iso3: "CHN",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "40000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "50000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "70000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "80000" },
      ],
      provisionalObservation: null,
    },
  ],
  [
    "528:010121",
    {
      ...common,
      importer: {
        code: "528",
        name: "Netherlands",
        iso3: "NLD",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "110000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "120000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "130000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "160000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "200000",
      },
    },
  ],
  [
    "484:010121",
    {
      ...common,
      importer: {
        code: "484",
        name: "Mexico",
        iso3: "MEX",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100000" },
        { year: 2020, state: "MISSING_OBSERVATION" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "50000" },
        { year: 2023, state: "MISSING_OBSERVATION" },
      ],
      provisionalObservation: null,
    },
  ],
  [
    "36:010121",
    {
      ...common,
      importer: {
        code: "36",
        name: "Australia",
        iso3: "AUS",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2020, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2023, state: "NO_RECORDED_POSITIVE_FLOW" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "NO_RECORDED_POSITIVE_FLOW",
      },
    },
  ],
  // The remaining core-current.ts Candidate Markets (issue #68: Market
  // Analysis replaces the Candidate Market audit detail with the atomic
  // three-recipe Market Analysis Module, so every existing Candidate
  // Market needs a compatible trade-trend-v1 importer to keep the
  // existing e2e evidence-panel journeys working end to end, not only the
  // Netherlands/South Africa pair issue #66 added for the Module's own
  // acceptance scenarios).
  [
    "76:010121",
    {
      ...common,
      importer: { code: "76", name: "Brazil", iso3: "BRA", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "40000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "42000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "44000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "46000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "48000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "50000",
      },
    },
  ],
  [
    "124:010121",
    {
      ...common,
      importer: { code: "124", name: "Canada", iso3: "CAN", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "60000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "61000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "62000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "63000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "64000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "65000",
      },
    },
  ],
  [
    "152:010121",
    {
      ...common,
      importer: { code: "152", name: "Chile", iso3: "CHL", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "20000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "21000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "22000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "23000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "24000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "25000",
      },
    },
  ],
  [
    "392:010121",
    {
      ...common,
      importer: { code: "392", name: "Japan", iso3: "JPN", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "55000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "56000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "57000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "58000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "59000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "60000",
      },
    },
  ],
  [
    "404:010121",
    {
      ...common,
      importer: { code: "404", name: "Kenya", iso3: "KEN", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "5000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "5200" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "5400" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "5600" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "5800" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "6000",
      },
    },
  ],
  [
    "490:010121",
    {
      ...common,
      importer: {
        code: "490",
        name: "Other Asia, nes",
        iso3: null,
        identityNote:
          "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "30000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "31000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "32000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "33000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "34000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "35000",
      },
    },
  ],
  [
    "616:010121",
    {
      ...common,
      importer: { code: "616", name: "Poland", iso3: "POL", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "45000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "46000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "47000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "48000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "49000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "50000",
      },
    },
  ],
  [
    "699:010121",
    {
      ...common,
      importer: { code: "699", name: "India", iso3: "IND", identityNote: null },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "25000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "27000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "29000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "31000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "33000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "35000",
      },
    },
  ],
  [
    "842:010121",
    {
      ...common,
      importer: {
        code: "842",
        name: "United States",
        iso3: "USA",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "70000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "71000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "72000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "73000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "74000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "75000",
      },
    },
  ],
  [
    "710:010121",
    {
      ...common,
      importer: {
        code: "710",
        name: "South Africa",
        iso3: "ZAF",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "MISSING_OBSERVATION" },
        { year: 2020, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "7000" },
        { year: 2022, state: "MISSING_OBSERVATION" },
        { year: 2023, state: "NO_RECORDED_POSITIVE_FLOW" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "MISSING_OBSERVATION",
      },
    },
  ],
  [
    "826:010121",
    {
      ...common,
      // The Market Analysis Module's own acceptance scenario (issue #66):
      // a fully recorded importer that is deliberately absent from the
      // core-current.ts Candidate Market cohort, so requesting it exercises
      // "valid identities naming a market absent from the complete
      // Candidate Market cohort" without any constituent invalid-input
      // failure masking the absence.
      importer: {
        code: "826",
        name: "United Kingdom",
        iso3: "GBR",
        identityNote: null,
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "30000" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "32000" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "34000" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "36000" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "38000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "39000",
      },
    },
  ],
]);

export const TRADE_TREND_FIXTURE_CONTENT_SHA256 = createHash("sha256")
  .update(JSON.stringify([...TRADE_TREND_FIXTURE_INPUTS.entries()]))
  .digest("hex");
