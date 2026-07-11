import { describe, expect, it } from "vitest";

import { createFixtureCandidateMarketAnalysis } from "../../src/evidence/fixture-trade-evidence-source";
import {
  CORE_CANDIDATE_SUMMARY,
  CORE_STABILITY,
} from "../../test/fixtures/acceptance/v1/expected/core-analysis";

describe("CandidateMarketAnalysis", () => {
  it("matches the exact 13-market cms-v1 core oracle", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();

    const result = await analysis.analyze({
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });

    expect(result.schemaVersion).toBe("candidate-market-result-v1");
    expect(result.cohortSize).toBe(13);
    expect(result.emptyReason).toBeNull();
    expect(result.provenance).toMatchObject({
      baciRelease: "V202601",
      sourceUpdateDate: "2026-01-22",
      hsRevision: "HS12",
      ingestedYears: { start: 2012, end: 2024 },
      finalizedCutoffYear: 2023,
      scoreWindow: { start: 2019, end: 2023 },
      provisionalYear: 2024,
      scoreVersion: "cms-v1",
    });
    expect(result.stability).toEqual(CORE_STABILITY);
    expect(
      result.candidates.map((candidate) => ({
        code: candidate.economy.code,
        score: candidate.score,
        rank: candidate.rank,
        tieSize: candidate.rankTieSize,
        rankPercentile: candidate.rankPercentile,
        confidence: candidate.confidence.score,
        confidenceLabel: candidate.confidence.label,
        componentPercentiles: [
          candidate.components.marketSize.percentile,
          candidate.components.marketGrowth.percentile,
          candidate.components.recordedFoothold.percentile,
          candidate.components.supplierDiversity.percentile,
        ],
      })),
    ).toEqual(CORE_CANDIDATE_SUMMARY);
  });

  it("preserves missingness, quantity, provisional, and identity evidence", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();

    const result = await analysis.analyze({
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });
    const byCode = new Map(
      result.candidates.map((candidate) => [
        candidate.economy.code,
        candidate,
      ]),
    );

    expect(byCode.get("484")).toMatchObject({
      observedScoreYears: [2019, 2020, 2021, 2022, 2023],
      components: {
        marketSize: { meanCurrentUsd: "9000000" },
        marketGrowth: {
          state: "COMPUTED",
          annualRate: "0.057335",
          reasonCodes: [],
        },
        recordedFoothold: {
          share: "0.200000",
          bilateralFlowState: "RECORDED",
          wording: null,
        },
        supplierDiversity: {
          state: "COMPUTED",
          index: "0.933333",
        },
      },
      quantityCoverageRate: "0.880000",
      provisionalEvidence: {
        year: 2024,
        marketState: "RECORDED",
        marketImportCurrentUsd: "11000000",
        bilateralState: "RECORDED",
        bilateralCurrentUsd: "2200000",
        recordedBilateralShare: "0.200000",
        quantityCoverageRate: "0.800000",
      },
    });
    expect(byCode.get("699")).toMatchObject({
      components: {
        recordedFoothold: {
          share: "0.000000",
          bilateralFlowState: "NO_RECORDED_POSITIVE_FLOW",
          wording: "No recorded bilateral flow in the score window",
        },
      },
      confidence: { score: 100, deductions: [] },
      provisionalEvidence: {
        marketState: "RECORDED",
        bilateralState: "NO_RECORDED_POSITIVE_FLOW",
        bilateralCurrentUsd: null,
        recordedBilateralShare: null,
        quantityCoverageRate: "0.666667",
      },
    });
    expect(byCode.get("710")).toMatchObject({
      components: {
        marketGrowth: {
          state: "NEUTRAL",
          annualRate: null,
          reasonCodes: ["INSUFFICIENT_OBSERVED_YEARS"],
        },
        supplierDiversity: {
          state: "NEUTRAL",
          index: null,
          reasonCode: "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR",
        },
      },
      confidence: {
        score: 40,
        deductions: [
          { code: "MISSING_SCORE_WINDOW_YEARS", points: 30 },
          {
            code: "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
            points: 10,
          },
        ],
        sparseEvidenceCapApplied: true,
      },
      provisionalEvidence: {
        marketState: "NO_RECORDED_POSITIVE_FLOW",
        bilateralState: "NOT_APPLICABLE",
      },
    });
    expect(byCode.get("404")).toMatchObject({
      components: {
        marketGrowth: {
          state: "NEUTRAL",
          reasonCodes: [
            "INSUFFICIENT_OBSERVED_YEARS",
            "BELOW_MATERIALITY_THRESHOLD",
          ],
        },
      },
      confidence: {
        score: 40,
        deductions: [
          { code: "MISSING_SCORE_WINDOW_YEARS", points: 30 },
          { code: "MISSING_CUTOFF_YEAR_EVIDENCE", points: 15 },
          { code: "SMALL_BASE", points: 15 },
        ],
        sparseEvidenceCapApplied: false,
      },
    });
    expect(byCode.get("490")).toMatchObject({
      economy: {
        name: "Other Asia, nes",
        iso3: null,
        identityNote:
          "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
      },
      confidence: {
        deductions: [{ code: "IDENTITY_PROXY", points: 10 }],
      },
      caveatCodes: ["IDENTITY_PROXY"],
    });
  });

  it("returns an honest empty result for a valid product without evidence", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();

    const result = await analysis.analyze({
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "851712",
    });

    expect(result).toMatchObject({
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      candidates: [],
      query: {
        product: {
          hsRevision: "HS12",
          code: "851712",
        },
      },
    });
  });

  it("flags the exact discontinuity year without changing scores or ranks", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();

    const result = await analysis.analyze({
      analysisBuildId: "acceptance-fixtures-v1-discontinuity",
      exporterCode: "156",
      productCode: "851712",
    });

    expect(result.productSeriesDiscontinuityYears).toEqual([2017]);
    expect(
      result.candidates.map(({ economy, score, rank }) => ({
        code: economy.code,
        score,
        rank,
      })),
    ).toEqual([
      { code: "528", score: 85, rank: 1 },
      { code: "484", score: 70, rank: 2 },
      { code: "152", score: 57, rank: 3 },
      { code: "616", score: 56, rank: 4 },
      { code: "124", score: 54, rank: 5 },
      { code: "392", score: 54, rank: 5 },
      { code: "710", score: 50, rank: 7 },
      { code: "842", score: 50, rank: 7 },
      { code: "699", score: 45, rank: 9 },
      { code: "76", score: 39, rank: 10 },
      { code: "490", score: 37, rank: 11 },
      { code: "36", score: 36, rank: 12 },
      { code: "404", score: 17, rank: 13 },
    ]);
    for (const candidate of result.candidates) {
      expect(candidate.caveatCodes).toContain(
        "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
      );
      expect(candidate.confidence.deductions).toContainEqual({
        code: "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
        points: 15,
      });
    }
  });

  it("normalizes one-member, equal, and half-point component pools", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const query = {
      exporterCode: "156",
      productCode: "010121",
    };

    const oneMember = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-component-pool-one",
    });
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

    const allEqual = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-component-all-equal",
    });
    expect(allEqual.candidates).toHaveLength(4);
    for (const candidate of allEqual.candidates) {
      expect([
        candidate.components.marketSize.percentile,
        candidate.components.marketGrowth.percentile,
        candidate.components.recordedFoothold.percentile,
        candidate.components.supplierDiversity.percentile,
      ]).toEqual([50, 50, 50, 50]);
    }

    const halfDisplay = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-component-half-display",
    });
    const lowest = halfDisplay.candidates.find(
      (candidate) => candidate.economy.code === "101",
    );
    expect(lowest).toMatchObject({
      score: 39,
      components: {
        marketSize: { percentile: 13 },
      },
    });
  });

  it("distinguishes neutral growth from zero and unknown diversity", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const query = {
      exporterCode: "156",
      productCode: "010121",
    };

    const growthNeutral = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-growth-both-neutral-reasons",
    });
    expect(growthNeutral.candidates[0]!.components.marketGrowth).toEqual({
      state: "NEUTRAL",
      annualRate: null,
      percentile: 50,
      yearsUsed: [],
      reasonCodes: [
        "INSUFFICIENT_OBSERVED_YEARS",
        "BELOW_MATERIALITY_THRESHOLD",
      ],
    });

    const diversityZero = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-diversity-zero",
    });
    expect(
      diversityZero.candidates[0]!.components.supplierDiversity,
    ).toMatchObject({
      state: "COMPUTED",
      index: "0.000000",
      percentile: 50,
      reasonCode: null,
    });

    const diversityNeutral = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-diversity-neutral",
    });
    expect(
      diversityNeutral.candidates[0]!.components.supplierDiversity,
    ).toEqual({
      state: "NEUTRAL",
      index: null,
      percentile: 50,
      yearsUsed: [],
      reasonCode: "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR",
    });
    expect(
      diversityNeutral.candidates[0]!.confidence.deductions,
    ).toContainEqual({
      code: "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
      points: 10,
    });
  });

  it("reports informational outliers without mutating score semantics", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const query = {
      exporterCode: "156",
      productCode: "010121",
    };

    const extremeGrowth = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-extreme-growth",
    });
    expect(extremeGrowth.candidates[0]).toMatchObject({
      score: 50,
      components: {
        marketGrowth: {
          state: "COMPUTED",
          annualRate: "1.000000",
        },
      },
    });
    expect(extremeGrowth.candidates[0]!.caveatCodes).toContain(
      "EXTREME_NOMINAL_GROWTH",
    );

    const dominantSize = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-dominant-size",
    });
    expect(
      dominantSize.candidates
        .filter(({ caveatCodes }) =>
          caveatCodes.includes("DOMINANT_SIZE_OUTLIER"),
        )
        .map(({ economy }) => economy.code),
    ).toEqual(["101"]);

    const noExporterHistory = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-no-exporter-history",
    });
    for (const candidate of noExporterHistory.candidates) {
      expect(candidate.components.recordedFoothold).toMatchObject({
        state: "COMPUTED",
        share: "0.000000",
      });
      expect(candidate.confidence.deductions).toContainEqual({
        code: "NO_EXPORTER_PRODUCT_HISTORY",
        points: 10,
      });
    }
  });

  it("uses canonical competition ranks for stability boundaries", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const query = {
      exporterCode: "156",
      productCode: "010121",
    };

    const low = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-stability-low",
    });
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

    const threshold = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-stability-threshold",
    });
    expect(threshold.stability.threeYear).toMatchObject({
      commonCandidateCount: 10,
      state: "NOT_FLAGGED",
      rankCorrelation: "0.700000",
    });
    for (const candidate of threshold.candidates) {
      expect(candidate.confidence.deductions).not.toContainEqual({
        code: "LOW_WINDOW_STABILITY",
        points: 10,
      });
    }

    const small = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-stability-small",
    });
    expect(small.stability).toMatchObject({
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
    for (const candidate of small.candidates) {
      expect(candidate.confidence.deductions).not.toContainEqual({
        code: "LOW_WINDOW_STABILITY",
        points: 10,
      });
    }
  });

  it("keeps quantity and provisional mutations outside finalized scoring", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const baseQuery = {
      exporterCode: "156",
      productCode: "010121",
    };
    const base = await analysis.analyze({
      ...baseQuery,
      analysisBuildId: "acceptance-fixtures-v1",
    });
    const quantityMutation = await analysis.analyze({
      ...baseQuery,
      analysisBuildId: "acceptance-fixtures-v1-quantity-zero",
    });
    const provisionalMutation = await analysis.analyze({
      ...baseQuery,
      analysisBuildId: "acceptance-fixtures-v1-provisional-mutation",
    });
    const finalizedProjection = (result: typeof base) =>
      result.candidates.map((candidate) => ({
        code: candidate.economy.code,
        score: candidate.score,
        rank: candidate.rank,
        components: candidate.components,
        confidence: candidate.confidence,
      }));

    expect(finalizedProjection(quantityMutation)).toEqual(
      finalizedProjection(base),
    );
    expect(
      quantityMutation.candidates.map(
        (candidate) => candidate.quantityCoverageRate,
      ),
    ).toEqual(Array.from({ length: 13 }, () => "0.000000"));

    expect(finalizedProjection(provisionalMutation)).toEqual(
      finalizedProjection(base),
    );
    expect(provisionalMutation.analysisBuildId).not.toBe(base.analysisBuildId);
    expect(provisionalMutation.provenance.artifactSha256).not.toBe(
      base.provenance.artifactSha256,
    );
    expect(
      provisionalMutation.candidates.map(
        (candidate) => candidate.provisionalEvidence,
      ),
    ).not.toEqual(
      base.candidates.map((candidate) => candidate.provisionalEvidence),
    );
  });

  it("applies the confidence ledger in order, then floors and caps it", async () => {
    const analysis = createFixtureCandidateMarketAnalysis();
    const query = {
      exporterCode: "156",
      productCode: "010121",
    };

    const oneCandidate = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-one-candidate",
    });
    expect(oneCandidate.candidates[0]).toMatchObject({
      score: 50,
      rank: 1,
      rankPercentile: "50.000",
    });

    const floor = await analysis.analyze({
      ...query,
      analysisBuildId: "micro-confidence-floor",
    });
    expect(floor.candidates[0]!.confidence).toEqual({
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
    {
      analysisBuildId: "micro-invalid-world-zero",
      message: "worldValueKusd must be positive.",
    },
    {
      analysisBuildId: "micro-invalid-recorded-bilateral-zero",
      message: "selectedExporter.valueKusd must be positive.",
    },
    {
      analysisBuildId: "micro-invalid-recorded-bilateral-exceeds-world",
      message:
        "selectedExporter.valueKusd cannot exceed worldValueKusd.",
    },
    {
      analysisBuildId: "micro-invalid-provisional-world-zero",
      message: "provisional.worldValueKusd must be positive.",
    },
    {
      analysisBuildId: "micro-invalid-provisional-recorded-bilateral-zero",
      message: "provisional.selectedExporter.valueKusd must be positive.",
    },
    {
      analysisBuildId:
        "micro-invalid-provisional-recorded-bilateral-exceeds-world",
      message:
        "provisional.selectedExporter.valueKusd cannot exceed provisional.worldValueKusd.",
    },
    {
      analysisBuildId: "micro-invalid-alternative-supplier-zero",
      message: "alternativeSupplierShares must be positive.",
    },
    {
      analysisBuildId: "micro-invalid-quantity-coverage",
      message:
        "quantityPresentCount must be a nonnegative safe integer no greater than sourceFlowCount.",
    },
  ])(
    "rejects invalid recorded evidence from $analysisBuildId",
    async ({ analysisBuildId, message }) => {
      const analysis = createFixtureCandidateMarketAnalysis();

      await expect(
        analysis.analyze({
          analysisBuildId,
          exporterCode: "156",
          productCode: "010121",
        }),
      ).rejects.toThrow(message);
    },
  );
});
