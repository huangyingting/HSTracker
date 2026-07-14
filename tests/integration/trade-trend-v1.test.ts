import { describe, expect, it } from "vitest";

import { computeTradeTrendV1 } from "../../src/domain/trade-trend/trade-trend-v1";
import type { TradeTrendObservation } from "../../src/domain/trade-trend/result";

describe("Trade Trend v1 calculation", () => {
  it("uses the first and last recorded-positive observations for an exact finalized summary", () => {
    const result = computeTradeTrendV1({
      analysisBuildId: "trend-fixture-build",
      analysisReleaseCatalogSha256: "a".repeat(64),
      artifact: {
        baciRelease: "V202601",
        buildId: "trend-fixture-artifact",
        schemaVersion: "trade-trend-fixture-v1",
        sha256: "b".repeat(64),
      },
      release: {
        baciRelease: "V202601",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        ingestedYears: { start: 2012, end: 2024 },
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
      importer: {
        code: "528",
        name: "Netherlands",
        iso3: "NLD",
        identityNote: null,
      },
      product: {
        hsRevision: "HS12",
        code: "010121",
        descriptionEn: "Horses: live, pure-bred breeding animals",
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "110" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "120" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "130" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "160" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "999",
      },
    });

    expect(result.finalizedObservations).toEqual([
      { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100" },
      { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "110" },
      { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "120" },
      { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "130" },
      { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "160" },
    ]);
    expect(result.summary).toEqual({
      state: "AVAILABLE",
      firstRecordedPositive: { year: 2019, valueCurrentUsd: "100" },
      lastRecordedPositive: { year: 2023, valueCurrentUsd: "160" },
      spanYears: 4,
      absoluteChangeCurrentUsd: "60",
      percentageChangePercent: "60.000000",
      cagrPercent: "12.468265",
    });
    expect(result.provisionalObservation).toEqual({
      year: 2024,
      state: "RECORDED_POSITIVE",
      valueCurrentUsd: "999",
    });
  });

  it.each([
    {
      name: "a sparse finalized series",
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100" },
        { year: 2020, state: "MISSING_OBSERVATION" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "50" },
        { year: 2023, state: "MISSING_OBSERVATION" },
      ],
      expected: {
        state: "AVAILABLE",
        firstRecordedPositive: { year: 2019, valueCurrentUsd: "100" },
        lastRecordedPositive: { year: 2022, valueCurrentUsd: "50" },
        spanYears: 3,
        absoluteChangeCurrentUsd: "-50",
        percentageChangePercent: "-50.000000",
        cagrPercent: "-20.629947",
      },
    },
    {
      name: "no recorded-positive flow",
      finalizedObservations: [
        { year: 2019, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2020, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2023, state: "NO_RECORDED_POSITIVE_FLOW" },
      ],
      expected: {
        state: "UNAVAILABLE",
        reason: "NO_RECORDED_POSITIVE_OBSERVATIONS",
      },
    },
    {
      name: "only one recorded-positive observation",
      finalizedObservations: [
        { year: 2019, state: "MISSING_OBSERVATION" },
        { year: 2020, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "7" },
        { year: 2022, state: "MISSING_OBSERVATION" },
        { year: 2023, state: "NO_RECORDED_POSITIVE_FLOW" },
      ],
      expected: {
        state: "UNAVAILABLE",
        reason: "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION",
      },
    },
  ])("marks $name without inventing a neutral trend", ({
    finalizedObservations,
    expected,
  }) => {
    const result = computeTradeTrendV1({
      analysisBuildId: "trend-fixture-build",
      analysisReleaseCatalogSha256: "a".repeat(64),
      artifact: {
        baciRelease: "V202601",
        buildId: "trend-fixture-artifact",
        schemaVersion: "trade-trend-fixture-v1",
        sha256: "b".repeat(64),
      },
      release: {
        baciRelease: "V202601",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        ingestedYears: { start: 2012, end: 2024 },
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
      importer: {
        code: "528",
        name: "Netherlands",
        iso3: "NLD",
        identityNote: null,
      },
      product: {
        hsRevision: "HS12",
        code: "010121",
        descriptionEn: "Horses: live, pure-bred breeding animals",
      },
      finalizedObservations: finalizedObservations as readonly TradeTrendObservation[],
      provisionalObservation: null,
    });

    expect(result.summary).toEqual(expected);
  });

  it("keeps a provisional observation outside the finalized summary", () => {
    const common = {
      analysisBuildId: "trend-fixture-build",
      analysisReleaseCatalogSha256: "a".repeat(64),
      artifact: {
        baciRelease: "V202601",
        buildId: "trend-fixture-artifact",
        schemaVersion: "trade-trend-fixture-v1",
        sha256: "b".repeat(64),
      },
      release: {
        baciRelease: "V202601",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12" as const,
        ingestedYears: { start: 2012, end: 2024 },
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
      importer: {
        code: "528",
        name: "Netherlands",
        iso3: "NLD",
        identityNote: null,
      },
      product: {
        hsRevision: "HS12" as const,
        code: "010121",
        descriptionEn: "Horses: live, pure-bred breeding animals",
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE" as const, valueCurrentUsd: "10" },
        { year: 2020, state: "RECORDED_POSITIVE" as const, valueCurrentUsd: "20" },
        { year: 2021, state: "RECORDED_POSITIVE" as const, valueCurrentUsd: "30" },
        { year: 2022, state: "RECORDED_POSITIVE" as const, valueCurrentUsd: "40" },
        { year: 2023, state: "RECORDED_POSITIVE" as const, valueCurrentUsd: "50" },
      ],
    };
    const absent = computeTradeTrendV1({
      ...common,
      provisionalObservation: null,
    });
    const recorded = computeTradeTrendV1({
      ...common,
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "999999999",
      },
    });

    expect(recorded.summary).toEqual(absent.summary);
  });
});
