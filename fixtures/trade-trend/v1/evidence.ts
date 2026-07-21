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
