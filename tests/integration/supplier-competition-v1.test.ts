import { describe, expect, it } from "vitest";

import {
  SUPPLIER_COMPETITION_MAX_COHORT_SIZE,
} from "../../src/domain/supplier-competition/result";
import { computeSupplierCompetitionV1 } from "../../src/domain/supplier-competition/supplier-competition-v1";
import { isSupplierCompetitionAnalysisError } from "../../src/domain/supplier-competition/errors";
import type {
  SupplierCompetitionV1Inputs,
  SupplierEconomyEvidence,
} from "../../src/domain/supplier-competition/result";

const RELEASE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2012, end: 2024 },
  finalizedCutoffYear: 2023,
  provisionalYear: 2024,
};

const ARTIFACT = {
  baciRelease: "V202601",
  buildId: "supplier-competition-fixture-artifact",
  schemaVersion: "supplier-competition-fixture-v1",
  sha256: "c".repeat(64),
};

const IMPORTER = {
  code: "156",
  name: "China",
  iso3: "CHN",
  identityNote: null,
};

const PRODUCT = {
  hsRevision: "HS12" as const,
  code: "010121",
  descriptionEn: "Horses: live, pure-bred breeding animals",
};

function economy(code: string, name: string, iso3: string) {
  return { code, name, iso3, identityNote: null };
}

function recordedFiveYears(
  economyIdentity: SupplierEconomyEvidence["economy"],
  annualValue: string,
  sourceFlowCount = 5,
  quantityPresentCount = 5,
): SupplierEconomyEvidence {
  return {
    economy: economyIdentity,
    annualObservations: [2019, 2020, 2021, 2022, 2023].map((year) => ({
      year,
      state: "RECORDED_POSITIVE" as const,
      valueCurrentUsd: annualValue,
    })),
    sourceFlowCount,
    quantityPresentCount,
  };
}

function baseInputs(
  overrides: Partial<SupplierCompetitionV1Inputs>,
): SupplierCompetitionV1Inputs {
  return {
    analysisBuildId: "supplier-competition-fixture-build",
    analysisReleaseCatalogSha256: "a".repeat(64),
    artifact: ARTIFACT,
    release: RELEASE,
    importer: IMPORTER,
    product: PRODUCT,
    suppliers: [],
    provisionalMarketState: "MISSING_OBSERVATION",
    provisionalSuppliers: [],
    ...overrides,
  };
}

describe("Supplier Competition v1 calculation", () => {
  it("computes exact dispersed shares and HHI for four even suppliers", () => {
    const economies = [
      economy("528", "Netherlands", "NLD"),
      economy("484", "Mexico", "MEX"),
      economy("36", "Australia", "AUS"),
      economy("710", "South Africa", "ZAF"),
    ];
    const result = computeSupplierCompetitionV1(
      baseInputs({
        suppliers: economies.map((eco) => recordedFiveYears(eco, "50000")),
      }),
    );

    expect(result.cohortSize).toBe(4);
    expect(result.emptyReason).toBeNull();
    expect(result.finalizedPooledValueCurrentUsd).toBe("1000000");
    expect(
      result.supplierShares.map((share) => ({
        code: share.economy.code,
        pooled: share.pooledValueCurrentUsd,
        share: share.sharePercent,
      })),
    ).toEqual([
      { code: "36", pooled: "250000", share: "25.000000" },
      { code: "484", pooled: "250000", share: "25.000000" },
      { code: "528", pooled: "250000", share: "25.000000" },
      { code: "710", pooled: "250000", share: "25.000000" },
    ]);
    expect(result.concentration).toEqual({
      state: "COMPUTED",
      herfindahlHirschmanIndex: "2500.000000",
      scale: 10000,
    });
    expect(result.qualityWarnings).toEqual([]);
  });

  it("computes an exact concentrated HHI with a dominant supplier", () => {
    const dominant = economy("528", "Netherlands", "NLD");
    const others = [
      economy("484", "Mexico", "MEX"),
      economy("36", "Australia", "AUS"),
      economy("710", "South Africa", "ZAF"),
    ];
    const result = computeSupplierCompetitionV1(
      baseInputs({
        suppliers: [
          recordedFiveYears(dominant, "140000"),
          ...others.map((eco) => recordedFiveYears(eco, "20000")),
        ],
      }),
    );

    expect(result.finalizedPooledValueCurrentUsd).toBe("1000000");
    expect(result.supplierShares[0]).toMatchObject({
      economy: { code: "528" },
      sharePercent: "70.000000",
    });
    expect(
      result.supplierShares.slice(1).map((share) => share.sharePercent),
    ).toEqual(["10.000000", "10.000000", "10.000000"]);
    expect(result.concentration).toEqual({
      state: "COMPUTED",
      herfindahlHirschmanIndex: "5200.000000",
      scale: 10000,
    });
  });

  it("reports a monopoly HHI of exactly 10000 for a single supplier", () => {
    const only = economy("528", "Netherlands", "NLD");
    const result = computeSupplierCompetitionV1(
      baseInputs({ suppliers: [recordedFiveYears(only, "100000")] }),
    );

    expect(result.cohortSize).toBe(1);
    expect(result.supplierShares).toEqual([
      expect.objectContaining({
        economy: expect.objectContaining({ code: "528" }),
        sharePercent: "100.000000",
        pooledValueCurrentUsd: "500000",
      }),
    ]);
    expect(result.concentration).toEqual({
      state: "COMPUTED",
      herfindahlHirschmanIndex: "10000.000000",
      scale: 10000,
    });
    expect(result.qualityWarnings).toEqual([]);
  });

  it("pools recorded years and keeps missing/no-flow years distinct, warning on sparse and incomplete structure", () => {
    const supplierA = economy("528", "Netherlands", "NLD");
    const supplierB = economy("484", "Mexico", "MEX");
    const result = computeSupplierCompetitionV1(
      baseInputs({
        suppliers: [
          {
            economy: supplierA,
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
            economy: supplierB,
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
      }),
    );

    expect(result.finalizedPooledValueCurrentUsd).toBe("35000");
    expect(
      result.supplierShares.map((share) => ({
        code: share.economy.code,
        share: share.sharePercent,
        pooled: share.pooledValueCurrentUsd,
        recordedYears: share.recordedYears,
        missingYears: share.missingYears,
        noRecordedFlowYears: share.noRecordedFlowYears,
        quantityCoverageRate: share.quantityCoverageRate,
      })),
    ).toEqual([
      {
        code: "528",
        share: "85.714286",
        pooled: "30000",
        recordedYears: [2019, 2021, 2023],
        missingYears: [2020, 2022],
        noRecordedFlowYears: [],
        quantityCoverageRate: null,
      },
      {
        code: "484",
        share: "14.285714",
        pooled: "5000",
        recordedYears: [2019],
        missingYears: [],
        noRecordedFlowYears: [2020, 2021, 2022, 2023],
        quantityCoverageRate: "0.750000",
      },
    ]);
    expect(result.concentration).toEqual({
      state: "COMPUTED",
      herfindahlHirschmanIndex: "7551.020408",
      scale: 10000,
    });
    expect(result.qualityWarnings).toEqual([
      "SPARSE_FINALIZED_PERIODS",
      "INCOMPLETE_SUPPLIER_STRUCTURE",
    ]);
  });

  it("marks the cohort empty without inventing a neutral concentration when no supplier recorded a positive value", () => {
    const result = computeSupplierCompetitionV1(baseInputs({ suppliers: [] }));

    expect(result.cohortSize).toBe(0);
    expect(result.emptyReason).toBe(
      "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
    );
    expect(result.supplierShares).toEqual([]);
    expect(result.finalizedPooledValueCurrentUsd).toBe("0");
    expect(result.concentration).toEqual({
      state: "UNAVAILABLE",
      reason: "NO_POOLED_SUPPLIER_VALUE",
    });
    expect(result.qualityWarnings).toEqual([
      "SPARSE_FINALIZED_PERIODS",
      "CONCENTRATION_UNAVAILABLE",
    ]);
  });

  it("excludes an all-zero supplier from the cohort while still reporting others", () => {
    const zero = economy("36", "Australia", "AUS");
    const positive = economy("528", "Netherlands", "NLD");
    const result = computeSupplierCompetitionV1(
      baseInputs({
        suppliers: [
          {
            economy: zero,
            annualObservations: [2019, 2020, 2021, 2022, 2023].map((year) => ({
              year,
              state: "NO_RECORDED_POSITIVE_FLOW" as const,
            })),
            sourceFlowCount: 5,
            quantityPresentCount: 5,
          },
          recordedFiveYears(positive, "10000"),
        ],
      }),
    );

    expect(result.cohortSize).toBe(1);
    expect(result.supplierShares.map((share) => share.economy.code)).toEqual([
      "528",
    ]);
  });

  it("keeps a Provisional Year snapshot separate from finalized shares and HHI, including new entrants", () => {
    const supplierA = economy("528", "Netherlands", "NLD");
    const supplierB = economy("484", "Mexico", "MEX");
    const newEntrant = economy("36", "Australia", "AUS");
    const common = baseInputs({
      suppliers: [
        recordedFiveYears(supplierA, "40000"),
        recordedFiveYears(supplierB, "40000"),
      ],
    });

    const withoutProvisional = computeSupplierCompetitionV1(common);
    const withProvisional = computeSupplierCompetitionV1({
      ...common,
      provisionalMarketState: "RECORDED",
      provisionalSuppliers: [
        {
          economy: supplierA,
          bilateral: { state: "NO_RECORDED_POSITIVE_FLOW" },
        },
        {
          economy: newEntrant,
          bilateral: {
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "999999",
          },
        },
      ],
    });

    expect(withProvisional.supplierShares).toEqual(
      withoutProvisional.supplierShares,
    );
    expect(withProvisional.concentration).toEqual(
      withoutProvisional.concentration,
    );
    expect(withProvisional.finalizedPooledValueCurrentUsd).toBe(
      withoutProvisional.finalizedPooledValueCurrentUsd,
    );
    expect(
      withProvisional.provisionalSupplierShares.map((share) => ({
        code: share.economy.code,
        state: share.bilateralState,
        value: share.valueCurrentUsd,
      })),
    ).toEqual([
      { code: "36", state: "RECORDED_POSITIVE", value: "999999" },
      { code: "484", state: "NO_RECORDED_POSITIVE_FLOW", value: null },
      { code: "528", state: "NO_RECORDED_POSITIVE_FLOW", value: null },
    ]);
  });

  it("marks every finalized supplier's Provisional Year evidence not-applicable when the Provisional Year itself has no usable evidence", () => {
    const supplierA = economy("528", "Netherlands", "NLD");
    const result = computeSupplierCompetitionV1(
      baseInputs({
        suppliers: [recordedFiveYears(supplierA, "40000")],
        provisionalMarketState: "MISSING_OBSERVATION",
        provisionalSuppliers: [],
      }),
    );

    expect(result.provisionalSupplierShares).toEqual([
      { economy: supplierA, bilateralState: "NOT_APPLICABLE", valueCurrentUsd: null },
    ]);
  });

  it("fails typed rather than truncating a cohort beyond its explicit budget", () => {
    const suppliers = Array.from(
      { length: SUPPLIER_COMPETITION_MAX_COHORT_SIZE + 1 },
      (_, index) =>
        recordedFiveYears(
          economy(String(index + 1), `Economy ${index + 1}`, null as unknown as string),
          "1000",
        ),
    );

    try {
      computeSupplierCompetitionV1(baseInputs({ suppliers }));
      throw new Error("Expected supplierCohortBudgetExceeded to throw.");
    } catch (error) {
      expect(isSupplierCompetitionAnalysisError(error)).toBe(true);
      if (!isSupplierCompetitionAnalysisError(error)) {
        throw error;
      }
      expect(error.code).toBe("SUPPLIER_COHORT_BUDGET_EXCEEDED");
    }
  });

  it("rejects finalized observations that omit a member of the five-year finalized window", () => {
    const supplierA = economy("528", "Netherlands", "NLD");
    expect(() =>
      computeSupplierCompetitionV1(
        baseInputs({
          suppliers: [
            {
              economy: supplierA,
              annualObservations: [
                { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "1" },
              ],
              sourceFlowCount: 1,
              quantityPresentCount: 1,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
  });
});
