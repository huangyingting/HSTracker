// Shared, hand-authored TradeAnalyticsPlatform test doubles for
// MarketAnalysis Module tests (issue #66). These construct literal
// AnalysisOutcome<Recipe> values directly at the exact TradeAnalyticsPlatform
// interface -- the same pattern candidate-market-route.test.ts already
// uses (`platformReturning`/`unresolvedOutcome`) -- so Module tests can lock
// every documented failure-precedence edge deterministically without
// depending on any recipe's own evidence-source fixture data.
import type {
  AnalysisOutcome,
  AnalysisRecipe,
  AnalysisRequest,
  AnalysisExecutionOptions,
  TradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import type { AnalysisIdentity } from "../../src/domain/trade-analytics/trade-analytics-platform";
import type { DatasetPackageIdentity } from "../../src/domain/trade-analytics/dataset-package";
import type {
  CandidateMarket,
  CandidateMarketResult,
  EconomyIdentity,
  ProductIdentity,
} from "../../src/domain/candidate-market/result";
import type { TradeTrendResult } from "../../src/domain/trade-trend/result";
import type { SupplierCompetitionResult } from "../../src/domain/supplier-competition/result";

export function analysisIdentity(seed: string): AnalysisIdentity {
  return `analysis-identity-v1-${seed.padEnd(64, "0")}` as AnalysisIdentity;
}

export function datasetPackageIdentity(seed: string): DatasetPackageIdentity {
  return `dataset-package-v1-${seed.padEnd(64, "0")}` as DatasetPackageIdentity;
}

export const STUB_EXPORTER: EconomyIdentity = {
  code: "156",
  name: "China",
  iso3: "CHN",
  identityNote: null,
};

export const STUB_MARKET: EconomyIdentity = {
  code: "528",
  name: "Netherlands",
  iso3: "NLD",
  identityNote: null,
};

export const STUB_PRODUCT: ProductIdentity = {
  hsRevision: "HS12",
  code: "010121",
  descriptionEn: "Horses: live, pure-bred breeding animals",
};

const STABILITY = {
  window: { start: 2021, end: 2023 },
  commonCandidateCount: 1,
  state: "NOT_FLAGGED" as const,
  rankCorrelation: null,
};

export const STUB_CANDIDATE: CandidateMarket = {
  economy: STUB_MARKET,
  score: 62,
  rank: 1,
  rankTieSize: 1,
  rankPercentile: "100.000000",
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
};

const CANDIDATE_MARKET_PROVENANCE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2012, end: 2024 },
  finalizedCutoffYear: 2023,
  scoreWindow: { start: 2019, end: 2023 },
  provisionalYear: 2024,
  scoreVersion: "cms-v1" as const,
  artifactBuildId: "stub-artifact",
  artifactSchemaVersion: "candidate-market-artifact-v1",
  artifactSha256: "a".repeat(64),
  valueUnit: "CURRENT_USD" as const,
};

const TRADE_TREND_PROVENANCE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2012, end: 2024 },
  finalizedWindow: { start: 2019, end: 2023 },
  provisionalYear: 2024,
  artifactBuildId: "stub-artifact",
  artifactSchemaVersion: "candidate-market-artifact-v1",
  artifactSha256: "a".repeat(64),
  valueUnit: "CURRENT_USD" as const,
};

export function baseCandidateMarketResult(
  overrides: Partial<CandidateMarketResult> = {},
): CandidateMarketResult {
  return {
    schemaVersion: "candidate-market-result-v1",
    analysisId: "candidate-market-analysis-id",
    analysisBuildId: "stub-build",
    analysisReleaseCatalogSha256: "b".repeat(64),
    query: { exporter: STUB_EXPORTER, product: STUB_PRODUCT },
    provenance: CANDIDATE_MARKET_PROVENANCE,
    weights: {
      marketSize: 30,
      marketGrowth: 25,
      recordedFoothold: 25,
      supplierDiversity: 20,
    },
    cohortSize: 1,
    emptyReason: null,
    stability: { threeYear: STABILITY, tenYear: STABILITY },
    productSeriesDiscontinuityYears: [],
    releaseRevisionSummary: {
      comparisonRelease: null,
      previousArtifactSha256: null,
      notComparedReason: "NO_PREVIOUS_ARTIFACT",
      noLongerEligibleCount: null,
    },
    candidates: [STUB_CANDIDATE],
    discoveryDisclaimer: "Candidate Market stub disclaimer.",
    ...overrides,
  };
}

export function baseTradeTrendResult(
  overrides: Partial<TradeTrendResult> = {},
): TradeTrendResult {
  return {
    schemaVersion: "trade-trend-result-v1",
    analysisId: "trade-trend-analysis-id",
    analysisBuildId: "stub-build",
    analysisReleaseCatalogSha256: "b".repeat(64),
    query: { importer: STUB_MARKET, product: STUB_PRODUCT },
    provenance: TRADE_TREND_PROVENANCE,
    finalizedObservations: [
      { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "100000" },
      { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "110000" },
      { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "120000" },
      { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "130000" },
      { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "160000" },
    ],
    summary: {
      state: "AVAILABLE",
      firstRecordedPositive: { year: 2019, valueCurrentUsd: "100000" },
      lastRecordedPositive: { year: 2023, valueCurrentUsd: "160000" },
      spanYears: 4,
      absoluteChangeCurrentUsd: "60000",
      percentageChangePercent: "60.000000",
      cagrPercent: "12.468265",
    },
    provisionalObservation: {
      year: 2024,
      state: "RECORDED_POSITIVE",
      valueCurrentUsd: "200000",
    },
    discoveryDisclaimer: "Trade Trend stub disclaimer.",
    ...overrides,
  };
}

export function baseSupplierCompetitionResult(
  overrides: Partial<SupplierCompetitionResult> = {},
): SupplierCompetitionResult {
  return {
    schemaVersion: "supplier-competition-result-v1",
    analysisId: "supplier-competition-analysis-id",
    analysisBuildId: "stub-build",
    analysisReleaseCatalogSha256: "b".repeat(64),
    query: { importer: STUB_MARKET, product: STUB_PRODUCT },
    provenance: {
      baciRelease: "V202601",
      sourceUpdateDate: "2026-01-22",
      hsRevision: "HS12",
      ingestedYears: { start: 2012, end: 2024 },
      finalizedWindow: { start: 2019, end: 2023 },
      provisionalYear: 2024,
      artifactBuildId: "stub-artifact",
      artifactSchemaVersion: "candidate-market-artifact-v1",
      artifactSha256: "a".repeat(64),
      valueUnit: "CURRENT_USD",
    },
    cohortBudget: 250,
    cohortSize: 1,
    emptyReason: null,
    finalizedPooledValueCurrentUsd: "500000",
    supplierShares: [
      {
        economy: STUB_EXPORTER,
        pooledValueCurrentUsd: "500000",
        sharePercent: "100.000000",
        recordedYears: [2019, 2020, 2021, 2022, 2023],
        noRecordedFlowYears: [],
        missingYears: [],
        quantityCoverageRate: "0.8",
      },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "10000",
      scale: 10000,
    },
    qualityWarnings: [],
    provisionalMarketState: "RECORDED",
    provisionalSupplierShares: [
      {
        economy: STUB_EXPORTER,
        bilateralState: "RECORDED_POSITIVE",
        valueCurrentUsd: "60000",
      },
    ],
    discoveryDisclaimer: "Supplier Competition stub disclaimer.",
    ...overrides,
  };
}

function unresolved<Recipe extends AnalysisRecipe>(recipe: Recipe) {
  return {
    recipe,
    analysisIdentity: null,
    datasetPackageIdentity: null,
    normalizedInputs: null,
  } as const;
}

export function candidateMarketSuccess(
  overrides: Partial<CandidateMarketResult> = {},
): AnalysisOutcome<"candidate-market-v1"> {
  return {
    state: "success",
    recipe: "candidate-market-v1",
    analysisIdentity: analysisIdentity("cm"),
    datasetPackageIdentity: datasetPackageIdentity("cm"),
    normalizedInputs: {
      exporterCode: STUB_EXPORTER.code,
      product: { hsRevision: "HS12", code: STUB_PRODUCT.code },
    },
    payload: baseCandidateMarketResult(overrides),
  };
}

export function candidateMarketEmpty(): AnalysisOutcome<"candidate-market-v1"> {
  return {
    state: "empty",
    emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
    recipe: "candidate-market-v1",
    analysisIdentity: analysisIdentity("cm-empty"),
    datasetPackageIdentity: datasetPackageIdentity("cm-empty"),
    normalizedInputs: {
      exporterCode: STUB_EXPORTER.code,
      product: { hsRevision: "HS12", code: STUB_PRODUCT.code },
    },
    payload: baseCandidateMarketResult({
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      candidates: [],
    }),
  };
}

export function tradeTrendSuccess(
  overrides: Partial<TradeTrendResult> = {},
): AnalysisOutcome<"trade-trend-v1"> {
  return {
    state: "success",
    recipe: "trade-trend-v1",
    analysisIdentity: analysisIdentity("tt"),
    datasetPackageIdentity: datasetPackageIdentity("tt"),
    normalizedInputs: {
      importerCode: STUB_MARKET.code,
      product: { hsRevision: "HS12", code: STUB_PRODUCT.code },
    },
    payload: baseTradeTrendResult(overrides),
  };
}

export function supplierCompetitionSuccess(
  overrides: Partial<SupplierCompetitionResult> = {},
): AnalysisOutcome<"supplier-competition-v1"> {
  return {
    state: "success",
    recipe: "supplier-competition-v1",
    analysisIdentity: analysisIdentity("sc"),
    datasetPackageIdentity: datasetPackageIdentity("sc"),
    normalizedInputs: {
      importerCode: STUB_MARKET.code,
      product: { hsRevision: "HS12", code: STUB_PRODUCT.code },
    },
    payload: baseSupplierCompetitionResult(overrides),
  };
}

export function supplierCompetitionEmpty(): AnalysisOutcome<"supplier-competition-v1"> {
  return {
    state: "empty",
    emptyReason: "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
    recipe: "supplier-competition-v1",
    analysisIdentity: analysisIdentity("sc-empty"),
    datasetPackageIdentity: datasetPackageIdentity("sc-empty"),
    normalizedInputs: {
      importerCode: STUB_MARKET.code,
      product: { hsRevision: "HS12", code: STUB_PRODUCT.code },
    },
    payload: baseSupplierCompetitionResult({
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
      finalizedPooledValueCurrentUsd: "0",
      supplierShares: [],
      concentration: { state: "UNAVAILABLE", reason: "NO_POOLED_SUPPLIER_VALUE" },
      provisionalSupplierShares: [],
    }),
  };
}

// Generic failure-outcome builders shared across the three annual recipes
// (spec §5.4). Each accepts the recipe so one call site can build any of
// candidate-market-v1/trade-trend-v1/supplier-competition-v1's structurally
// identical failure shapes (they only differ in error payload field names,
// which the caller supplies).
export function invalidInputOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  error: Extract<AnalysisOutcome<Recipe>, { state: "invalid-input" }>["error"],
): AnalysisOutcome<Recipe> {
  return {
    state: "invalid-input",
    ...unresolved(recipe),
    error,
  } as AnalysisOutcome<Recipe>;
}

export function retiredOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  analysisBuildId = "retired-stub-build",
): AnalysisOutcome<Recipe> {
  return {
    state: "retired",
    ...unresolved(recipe),
    error: { code: "ANALYSIS_BUILD_RETIRED", analysisBuildId },
  } as AnalysisOutcome<Recipe>;
}

export function incompatiblePackageOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  reason:
    | "MISSING_REQUIRED_CAPABILITY"
    | "CAPABILITY_VERSION_MISMATCH"
    | "PACKAGE_IDENTITY_MISMATCH" = "PACKAGE_IDENTITY_MISMATCH",
): AnalysisOutcome<Recipe> {
  return {
    state: "incompatible-package",
    ...unresolved(recipe),
    error: { code: "NO_COMPATIBLE_DATASET_PACKAGE", reason },
  } as AnalysisOutcome<Recipe>;
}

export function budgetOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  budget:
    | "INPUT_CARDINALITY"
    | "SCAN"
    | "RESULT_ROWS"
    | "RESULT_BYTES"
    | "MEMORY"
    | "EXECUTION_DEADLINE"
    | "EXPORT" = "RESULT_ROWS",
): AnalysisOutcome<Recipe> {
  return {
    state: "budget",
    ...unresolved(recipe),
    error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget },
  } as AnalysisOutcome<Recipe>;
}

export function rateLimitOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  retryAfterSeconds = 5,
): AnalysisOutcome<Recipe> {
  return {
    state: "rate-limit",
    ...unresolved(recipe),
    error: { code: "ANALYSIS_RATE_LIMITED", retryAfterSeconds },
  } as AnalysisOutcome<Recipe>;
}

export function capacityOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
  reason: "queue-full" | "queue-timeout" | "execution-timeout" = "queue-full",
  retryAfterSeconds = 2,
): AnalysisOutcome<Recipe> {
  return {
    state: "capacity",
    ...unresolved(recipe),
    error: { code: "ANALYSIS_CAPACITY_EXCEEDED", reason, retryAfterSeconds },
  } as AnalysisOutcome<Recipe>;
}

export function temporaryUnavailabilityOutcome<Recipe extends AnalysisRecipe>(
  recipe: Recipe,
): AnalysisOutcome<Recipe> {
  return {
    state: "temporary-unavailability",
    ...unresolved(recipe),
    error: { code: "ANALYSIS_UNAVAILABLE" },
  } as AnalysisOutcome<Recipe>;
}

export type StubOutcomes = Readonly<{
  candidateMarket: AnalysisOutcome<"candidate-market-v1">;
  tradeTrend: AnalysisOutcome<"trade-trend-v1">;
  supplierCompetition: AnalysisOutcome<"supplier-competition-v1">;
}>;

// The three-recipe stub platform every Module test composes against (mirrors
// the single-recipe `platformReturning` already established in
// tests/integration/candidate-market-route.test.ts). `onExecute` optionally
// observes every call, e.g. to assert shared cancellation/options.
export function platformReturning(
  outcomes: StubOutcomes,
  onExecute?: (
    request: AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ) => void,
): TradeAnalyticsPlatform {
  return {
    async execute<Request extends AnalysisRequest>(
      request: Request,
      options?: AnalysisExecutionOptions,
    ) {
      onExecute?.(request, options);
      switch (request.recipe) {
        case "candidate-market-v1":
          return outcomes.candidateMarket as AnalysisOutcome<
            Request["recipe"]
          >;
        case "trade-trend-v1":
          return outcomes.tradeTrend as AnalysisOutcome<Request["recipe"]>;
        case "supplier-competition-v1":
          return outcomes.supplierCompetition as AnalysisOutcome<
            Request["recipe"]
          >;
        default:
          throw new TypeError(
            `Unsupported stub recipe: ${String(request.recipe)}`,
          );
      }
    },
  };
}

// A platform whose every execute() call rejects only once the shared
// AbortSignal fires, so tests can prove cancellation "aborts all outstanding
// constituent executions" (spec §5.4) without any recipe-specific fixture.
export function rejectingOnAbortPlatform(): TradeAnalyticsPlatform {
  return {
    execute(_request, options) {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      });
    },
  };
}
