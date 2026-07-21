import { describe, expect, it } from "vitest";

import type { AnalysisIdentity } from "../../src/domain/trade-analytics/trade-analytics-platform";
import type { DatasetPackageIdentity } from "../../src/domain/trade-analytics/dataset-package";
import type { TradeTrendObservation } from "../../src/domain/trade-trend/result";
import type {
  MarketAnalysisEvidenceStateKey,
} from "../../src/domain/market-analysis/copy";
import {
  marketAnalysisDemandObservationState,
  marketAnalysisDemandSummaryState,
  marketAnalysisSupplierConcentrationState,
  type MarketAnalysisV1,
} from "../../src/domain/market-analysis/result";

const analysisIdentity = (
  seed: string,
): AnalysisIdentity => `analysis-identity-v1-${seed.padEnd(64, "0")}` as AnalysisIdentity;

const datasetPackageIdentity = (
  seed: string,
): DatasetPackageIdentity =>
  `dataset-package-v1-${seed.padEnd(64, "0")}` as DatasetPackageIdentity;

function buildMarketAnalysisV1Fixture(): MarketAnalysisV1 {
  const exporter = {
    code: "156",
    name: "China",
    iso3: "CHN",
    identityNote: null,
  };
  const market = {
    code: "528",
    name: "Netherlands",
    iso3: "NLD",
    identityNote: null,
  };
  const product = {
    hsRevision: "HS12" as const,
    code: "010121",
    descriptionEn: "Horses: live, pure-bred breeding animals",
  };

  return {
    schemaVersion: "market-analysis-v1",
    context: {
      analysisBuildId: "market-analysis-fixture-build",
      exporter,
      product,
      market,
    },
    annualContext: {
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedWindow: { start: 2019, end: 2023 },
      provisionalYear: 2024,
      valueUnit: "CURRENT_USD",
    },
    constituentAnalyses: [
      {
        recipe: "candidate-market-v1",
        analysisIdentity: analysisIdentity("a"),
        datasetPackageIdentity: datasetPackageIdentity("a"),
      },
      {
        recipe: "trade-trend-v1",
        analysisIdentity: analysisIdentity("b"),
        datasetPackageIdentity: datasetPackageIdentity("b"),
      },
      {
        recipe: "supplier-competition-v1",
        analysisIdentity: analysisIdentity("c"),
        datasetPackageIdentity: datasetPackageIdentity("c"),
      },
    ],
    opportunity: {
      candidate: {
        economy: market,
        score: 62,
        rank: 3,
        rankTieSize: 1,
        rankPercentile: "88.500000",
        observedScoreYears: [2019, 2020, 2021, 2022, 2023],
        missingScoreYears: [],
        latestFinalizedObservedYear: 2023,
        components: {
          marketSize: {
            state: "COMPUTED",
            meanCurrentUsd: "1000000",
            percentile: 70,
            yearsUsed: [2019, 2020, 2021, 2022, 2023],
          },
          marketGrowth: {
            state: "COMPUTED",
            annualRate: "0.05",
            percentile: 65,
            yearsUsed: [2019, 2020, 2021, 2022, 2023],
            reasonCodes: [],
          },
          recordedFoothold: {
            state: "COMPUTED",
            share: "0.12",
            percentile: 55,
            bilateralFlowState: "RECORDED",
            wording: null,
          },
          supplierDiversity: {
            state: "COMPUTED",
            index: "0.4",
            percentile: 50,
            yearsUsed: [2019, 2020, 2021, 2022, 2023],
            reasonCode: null,
          },
        },
        confidence: {
          score: 90,
          label: "HIGH",
          deductions: [],
          sparseEvidenceCapApplied: false,
        },
        quantityCoverageRate: "0.8",
        provisionalEvidence: {
          year: 2024,
          marketState: "RECORDED",
          marketImportCurrentUsd: "120000",
          bilateralState: "RECORDED",
          bilateralCurrentUsd: "14000",
          recordedBilateralShare: "0.11",
          quantityCoverageRate: "0.75",
        },
        caveatCodes: [],
        releaseRevision: {
          state: "NOT_COMPARED",
          previousReleaseRecomputedScore: null,
          scoreChange: null,
          previousReleaseRecomputedRankPercentile: null,
          rankPercentileChange: null,
          materialChange: null,
        },
      },
      cohortSize: 40,
      weights: {
        marketSize: 30,
        marketGrowth: 25,
        recordedFoothold: 25,
        supplierDiversity: 20,
      },
    },
    demand: {
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "110" },
        { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
        { year: 2022, state: "MISSING_OBSERVATION" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "160" },
      ],
      summary: {
        state: "AVAILABLE",
        firstRecordedPositive: { year: 2019, valueCurrentUsd: "100" },
        lastRecordedPositive: { year: 2023, valueCurrentUsd: "160" },
        spanYears: 4,
        absoluteChangeCurrentUsd: "60",
        percentageChangePercent: "60.000000",
        cagrPercent: "12.468265",
      },
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "999",
      },
    },
    exporterPosition: {
      scoreWindowFoothold: {
        state: "COMPUTED",
        share: "0.12",
        percentile: 55,
        bilateralFlowState: "RECORDED",
        wording: null,
      },
      pooledSupplier: {
        economy: exporter,
        pooledValueCurrentUsd: "500000",
        sharePercent: "12.000000",
        recordedYears: [2019, 2020, 2021, 2022, 2023],
        noRecordedFlowYears: [],
        missingYears: [],
        quantityCoverageRate: "0.8",
      },
      pooledSupplierPosition: {
        rank: 1,
        cohortSize: 12,
      },
      provisionalBilateral: {
        year: 2024,
        marketState: "RECORDED",
        marketImportCurrentUsd: "120000",
        bilateralState: "RECORDED",
        bilateralCurrentUsd: "14000",
        recordedBilateralShare: "0.11",
        quantityCoverageRate: "0.75",
      },
    },
    supplierLandscape: {
      cohortBudget: 250,
      cohortSize: 12,
      emptyReason: null,
      finalizedPooledValueCurrentUsd: "4000000",
      supplierShares: [
        {
          economy: exporter,
          pooledValueCurrentUsd: "500000",
          sharePercent: "12.000000",
          recordedYears: [2019, 2020, 2021, 2022, 2023],
          noRecordedFlowYears: [],
          missingYears: [],
          quantityCoverageRate: "0.8",
        },
      ],
      concentration: {
        state: "COMPUTED",
        herfindahlHirschmanIndex: "1450",
        scale: 10000,
      },
      qualityWarnings: [],
      provisionalMarketState: "RECORDED",
      provisionalSupplierShares: [
        {
          economy: exporter,
          bilateralState: "RECORDED_POSITIVE",
          valueCurrentUsd: "14000",
        },
      ],
    },
    evidenceQuality: {
      confidence: {
        score: 90,
        label: "HIGH",
        deductions: [],
        sparseEvidenceCapApplied: false,
      },
      observedFinalizedYears: [2019, 2020, 2021, 2022, 2023],
      missingFinalizedYears: [],
      quantityCoverageRate: "0.8",
      caveatCodes: [],
      stability: {
        threeYear: {
          window: { start: 2021, end: 2023 },
          commonCandidateCount: 40,
          state: "NOT_FLAGGED",
          rankCorrelation: "0.91",
        },
        tenYear: {
          window: { start: 2014, end: 2023 },
          commonCandidateCount: 40,
          state: "NOT_FLAGGED",
          rankCorrelation: "0.88",
        },
      },
      productSeriesDiscontinuityYears: [],
      releaseRevision: {
        state: "NOT_COMPARED",
        previousReleaseRecomputedScore: null,
        scoreChange: null,
        previousReleaseRecomputedRankPercentile: null,
        rankPercentileChange: null,
        materialChange: null,
      },
      releaseRevisionSummary: {
        comparisonRelease: null,
        previousArtifactSha256: null,
        notComparedReason: "NO_PREVIOUS_ARTIFACT",
        noLongerEligibleCount: null,
      },
      sourceUpdateDate: "2026-01-22",
    },
    discoveryDisclaimer:
      "Candidate Markets are public evidence for further investigation, not a recommendation.",
  };
}

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "context",
  "annualContext",
  "constituentAnalyses",
  "opportunity",
  "demand",
  "exporterPosition",
  "supplierLandscape",
  "evidenceQuality",
  "discoveryDisclaimer",
] as const;

const FORBIDDEN_TOP_LEVEL_KEYS = [
  "score",
  "confidence",
  "aggregateConfidence",
  "probability",
  "recommendation",
  "generatedAt",
  "analysisIdentity",
  "recentMomentum",
];

describe("MarketAnalysisV1 product contract", () => {
  it("is a closed product composition with exactly the documented top-level keys", () => {
    const fixture = buildMarketAnalysisV1Fixture();

    expect(Object.keys(fixture).sort()).toEqual([...TOP_LEVEL_KEYS].sort());
    for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
      expect(fixture).not.toHaveProperty(forbidden);
    }
  });

  it("preserves the schema discriminant and reused constituent identity", () => {
    const fixture = buildMarketAnalysisV1Fixture();

    expect(fixture.schemaVersion).toBe("market-analysis-v1");
    expect(fixture.constituentAnalyses.map((entry) => entry.recipe)).toEqual([
      "candidate-market-v1",
      "trade-trend-v1",
      "supplier-competition-v1",
    ]);
    expect(fixture.context.exporter.code).toBe("156");
    expect(fixture.context.market.code).toBe("528");
    expect(fixture.context.product.hsRevision).toBe("HS12");
  });

  it("adds no product-level score, aggregate confidence, or recommendation anywhere in evidence quality", () => {
    const fixture = buildMarketAnalysisV1Fixture();

    expect(Object.keys(fixture.evidenceQuality).sort()).toEqual(
      [
        "caveatCodes",
        "confidence",
        "missingFinalizedYears",
        "observedFinalizedYears",
        "productSeriesDiscontinuityYears",
        "quantityCoverageRate",
        "releaseRevision",
        "releaseRevisionSummary",
        "sourceUpdateDate",
        "stability",
      ].sort(),
    );
    expect(fixture.evidenceQuality.confidence.label).toBe("HIGH");
  });
});

describe("MarketAnalysisV1 evidence-state semantics", () => {
  const observationCases: readonly [
    TradeTrendObservation,
    MarketAnalysisEvidenceStateKey,
  ][] = [
    [
      { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "100" },
      "recordedPositive",
    ],
    [
      { year: 2021, state: "NO_RECORDED_POSITIVE_FLOW" },
      "noRecordedPositiveFlow",
    ],
    [{ year: 2021, state: "MISSING_OBSERVATION" }, "missingObservation"],
  ];

  it.each(observationCases)(
    "maps a Trade Trend observation with state %o to the evidence state %s without flattening it",
    (observation, expected) => {
      expect(marketAnalysisDemandObservationState(observation)).toBe(
        expected,
      );
    },
  );

  it("keeps an unavailable Trade Trend summary distinct from a recorded one", () => {
    expect(
      marketAnalysisDemandSummaryState({
        state: "UNAVAILABLE",
        reason: "NO_RECORDED_POSITIVE_OBSERVATIONS",
      }),
    ).toBe("summaryUnavailable");
    expect(
      marketAnalysisDemandSummaryState({
        state: "AVAILABLE",
        firstRecordedPositive: { year: 2019, valueCurrentUsd: "1" },
        lastRecordedPositive: { year: 2023, valueCurrentUsd: "2" },
        spanYears: 4,
        absoluteChangeCurrentUsd: "1",
        percentageChangePercent: "100.000000",
        cagrPercent: "18.921000",
      }),
    ).toBe("recordedPositive");
  });

  it("keeps an unavailable Supplier Competition concentration distinct from a computed one", () => {
    expect(
      marketAnalysisSupplierConcentrationState({
        state: "UNAVAILABLE",
        reason: "NO_POOLED_SUPPLIER_VALUE",
      }),
    ).toBe("summaryUnavailable");
    expect(
      marketAnalysisSupplierConcentrationState({
        state: "COMPUTED",
        herfindahlHirschmanIndex: "1450",
        scale: 10000,
      }),
    ).toBe("recordedPositive");
  });
});
