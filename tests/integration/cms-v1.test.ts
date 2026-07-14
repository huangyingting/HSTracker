import { describe, expect, it } from "vitest";

import { computeCmsV1 } from "../../src/domain/candidate-market/cms-v1";
import { CORE_CURRENT_INPUT } from "../../fixtures/acceptance/v1/evidence/core-current";
import { MICRO_FIXTURE_INPUTS } from "../../fixtures/acceptance/v1/evidence/microfixtures";

describe("Candidate Market v1 recipe rules", () => {
  it("accepts valid highly concentrated alternative supplier aggregates", () => {
    const input = {
      ...CORE_CURRENT_INPUT,
      analysisBuildId: "concentrated-suppliers",
      marketYears: [
        {
          ...CORE_CURRENT_INPUT.marketYears[0]!,
          year: 2023,
          worldValueKusd: "10000000000.001",
          selectedExporter: {
            state: "NO_RECORDED_POSITIVE_FLOW" as const,
          },
          alternativeSuppliers: {
            count: 2,
            valueKusd: "10000000000.001",
            valueSquareSumKusdSquared:
              "100000000000000000000.000001",
          },
          sourceFlowCount: 2,
          quantityPresentCount: 2,
        },
      ],
      provisionalMarketYears: [],
      productYearTotals: [
        { year: 2023, worldValueKusd: "10000000000.001" },
      ],
    };

    expect(computeCmsV1(input)).toMatchObject({ cohortSize: 1 });
  });

  it("normalizes one-member, equal, and half-point component pools", () => {
    const oneMember = computeFixture("micro-component-pool-one");
    expect(oneMember.candidates[0]).toMatchObject({
      score: 50,
      rank: 1,
      rankTieSize: 1,
      rankPercentile: "50.000",
      components: {
        marketSize: { percentile: 50 },
        marketGrowth: { percentile: 50 },
        recordedFoothold: { percentile: 50 },
        supplierDiversity: { percentile: 50 },
      },
    });

    const allEqual = computeFixture("micro-component-all-equal");
    expect(allEqual.candidates).toHaveLength(4);
    for (const candidate of allEqual.candidates) {
      expect([
        candidate.components.marketSize.percentile,
        candidate.components.marketGrowth.percentile,
        candidate.components.recordedFoothold.percentile,
        candidate.components.supplierDiversity.percentile,
      ]).toEqual([50, 50, 50, 50]);
    }

    expect(
      computeFixture("micro-component-half-display").candidates.find(
        (candidate) => candidate.economy.code === "101",
      ),
    ).toMatchObject({
      score: 39,
      components: { marketSize: { percentile: 13 } },
    });
  });

  it("distinguishes neutral growth from zero and unknown diversity", () => {
    expect(
      computeFixture("micro-growth-both-neutral-reasons").candidates[0]!
        .components.marketGrowth,
    ).toEqual({
      state: "NEUTRAL",
      annualRate: null,
      percentile: 50,
      yearsUsed: [],
      reasonCodes: [
        "INSUFFICIENT_OBSERVED_YEARS",
        "BELOW_MATERIALITY_THRESHOLD",
      ],
    });

    expect(
      computeFixture("micro-diversity-zero").candidates[0]!.components
        .supplierDiversity,
    ).toMatchObject({
      state: "COMPUTED",
      index: "0.000000",
      percentile: 50,
      reasonCode: null,
    });

    const neutral = computeFixture("micro-diversity-neutral").candidates[0]!;
    expect(neutral.components.supplierDiversity).toEqual({
      state: "NEUTRAL",
      index: null,
      percentile: 50,
      yearsUsed: [],
      reasonCode: "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR",
    });
    expect(neutral.confidence.deductions).toContainEqual({
      code: "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
      points: 10,
    });
  });

  it("reports informational outliers without mutating score semantics", () => {
    const extremeGrowth =
      computeFixture("micro-extreme-growth").candidates[0]!;
    expect(extremeGrowth).toMatchObject({
      score: 50,
      components: {
        marketGrowth: {
          state: "COMPUTED",
          annualRate: "1.000000",
        },
      },
    });
    expect(extremeGrowth.caveatCodes).toContain(
      "EXTREME_NOMINAL_GROWTH",
    );

    expect(
      computeFixture("micro-dominant-size").candidates
        .filter(({ caveatCodes }) =>
          caveatCodes.includes("DOMINANT_SIZE_OUTLIER"),
        )
        .map(({ economy }) => economy.code),
    ).toEqual(["101"]);
  });

  it("uses canonical competition ranks for stability boundaries", () => {
    const low = computeFixture("micro-stability-low");
    expect(low.stability.threeYear).toMatchObject({
      commonCandidateCount: 10,
      state: "LOW",
      rankCorrelation: "-1.000000",
    });
    for (const candidate of low.candidates) {
      expect(candidate.confidence.deductions).toContainEqual({
        code: "LOW_WINDOW_STABILITY",
        points: 10,
      });
    }

    const threshold = computeFixture("micro-stability-threshold");
    expect(threshold.stability.threeYear).toMatchObject({
      commonCandidateCount: 10,
      state: "NOT_FLAGGED",
      rankCorrelation: "0.700000",
    });

    expect(computeFixture("micro-stability-small").stability).toMatchObject({
      threeYear: {
        commonCandidateCount: 9,
        state: "NOT_ESTIMATED_SMALL_COMMON_COHORT",
        rankCorrelation: null,
      },
      tenYear: {
        commonCandidateCount: 9,
        state: "NOT_ESTIMATED_SMALL_COMMON_COHORT",
        rankCorrelation: null,
      },
    });
  });

  it("applies the confidence ledger in order, then floors it", () => {
    expect(
      computeFixture("micro-confidence-floor").candidates[0]!.confidence,
    ).toEqual({
      score: 0,
      label: "LOW",
      deductions: [
        { code: "MISSING_SCORE_WINDOW_YEARS", points: 30 },
        { code: "MISSING_CUTOFF_YEAR_EVIDENCE", points: 15 },
        { code: "SMALL_BASE", points: 15 },
        {
          code: "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
          points: 10,
        },
        { code: "SMALL_CANDIDATE_COHORT", points: 10 },
        { code: "NO_EXPORTER_PRODUCT_HISTORY", points: 10 },
        { code: "IDENTITY_PROXY", points: 10 },
      ],
      sparseEvidenceCapApplied: false,
    });
  });

  it.each([
    ["micro-invalid-world-zero", "worldValueKusd must be positive."],
    [
      "micro-invalid-recorded-bilateral-zero",
      "selectedExporter.valueKusd must be positive.",
    ],
    [
      "micro-invalid-recorded-bilateral-exceeds-world",
      "selectedExporter.valueKusd cannot exceed worldValueKusd.",
    ],
    [
      "micro-invalid-provisional-world-zero",
      "provisional.worldValueKusd must be positive.",
    ],
    [
      "micro-invalid-provisional-recorded-bilateral-zero",
      "provisional.selectedExporter.valueKusd must be positive.",
    ],
    [
      "micro-invalid-provisional-recorded-bilateral-exceeds-world",
      "provisional.selectedExporter.valueKusd cannot exceed provisional.worldValueKusd.",
    ],
    [
      "micro-invalid-alternative-supplier-zero",
      "Alternative supplier aggregates are inconsistent.",
    ],
    [
      "micro-invalid-quantity-coverage",
      "quantityPresentCount must be a nonnegative safe integer no greater than sourceFlowCount.",
    ],
  ])("rejects invalid recorded evidence from %s", (analysisBuildId, message) => {
    expect(() => computeFixture(analysisBuildId)).toThrow(message);
  });
});

function computeFixture(analysisBuildId: string) {
  const input = MICRO_FIXTURE_INPUTS.get(analysisBuildId);
  if (input === undefined) {
    throw new TypeError(`Unknown microfixture ${analysisBuildId}.`);
  }
  return computeCmsV1(input);
}
