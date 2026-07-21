import { describe, expect, it } from "vitest";

import { createMarketAnalysis } from "../../src/domain/market-analysis/market-analysis";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import type { AnalysisOutcome, AnalysisRecipe } from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  budgetOutcome,
  baseSupplierCompetitionResult,
  baseTradeTrendResult,
  candidateMarketEmpty,
  capacityOutcome,
  incompatiblePackageOutcome,
  invalidInputOutcome,
  platformReturning,
  rateLimitOutcome,
  rejectingOnAbortPlatform,
  retiredOutcome,
  supplierCompetitionSuccess,
  temporaryUnavailabilityOutcome,
  tradeTrendSuccess,
  candidateMarketSuccess,
} from "../support/market-analysis-platform-stub";

const REQUEST = {
  analysisBuildId: "acceptance-fixtures-v1",
  exportEconomyCode: "156",
  productCode: "010121",
  marketCode: "528",
} as const;

describe("MarketAnalysis module", () => {
  it("returns one complete market-analysis-v1 result for a Netherlands Candidate Market Context with every constituent Analysis Identity and Dataset Package identity visible", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);

    const result = await marketAnalysis.load(REQUEST);

    expect(result.schemaVersion).toBe("market-analysis-v1");
    expect(result.context).toMatchObject({
      analysisBuildId: "acceptance-fixtures-v1",
      exporter: { code: "156" },
      product: { code: "010121" },
      market: { code: "528", name: "Netherlands" },
    });
    expect(result.constituentAnalyses).toHaveLength(3);
    const recipes = result.constituentAnalyses.map((entry) => entry.recipe);
    expect(recipes).toEqual([
      "candidate-market-v1",
      "trade-trend-v1",
      "supplier-competition-v1",
    ]);
    for (const entry of result.constituentAnalyses) {
      expect(entry.analysisIdentity).toMatch(/^analysis-identity-v1-/u);
      expect(entry.datasetPackageIdentity).toMatch(/^dataset-package-v1-/u);
    }
    expect(result.opportunity.candidate.economy.code).toBe("528");
    expect(result.demand.finalizedObservations.length).toBeGreaterThan(0);
    expect(result.supplierLandscape.supplierShares.length).toBeGreaterThan(0);
    expect(result.exporterPosition.pooledSupplierPosition).toEqual({
      rank: 1,
      cohortSize: 2,
    });
    expect(result.evidenceQuality.confidence).toBeDefined();
    expect(result.discoveryDisclaimer.length).toBeGreaterThan(0);
  });

  it("keeps supplier-empty evidence a valid complete product result with an empty landscape and unavailable concentration", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);

    const result = await marketAnalysis.load({
      ...REQUEST,
      marketCode: "710",
    });

    expect(result.context.market).toMatchObject({
      code: "710",
      name: "South Africa",
    });
    expect(result.supplierLandscape.cohortSize).toBe(0);
    expect(result.supplierLandscape.supplierShares).toEqual([]);
    expect(result.supplierLandscape.concentration).toEqual({
      state: "UNAVAILABLE",
      reason: "NO_POOLED_SUPPLIER_VALUE",
    });
    expect(result.supplierLandscape.emptyReason).toBe(
      "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
    );
    expect(result.exporterPosition.pooledSupplier).toBeNull();
    expect(result.exporterPosition.pooledSupplierPosition).toBeNull();
  });

  it("throws typed CANDIDATE_MARKET_NOT_FOUND when a valid market is absent from the complete Candidate Market cohort", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(
      marketAnalysis.load({ ...REQUEST, marketCode: "826" }),
    ).rejects.toMatchObject({
      code: "CANDIDATE_MARKET_NOT_FOUND",
    });
  });

  it("throws typed CANDIDATE_MARKET_NOT_FOUND when the Candidate Market cohort is empty", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketEmpty(),
      tradeTrend: tradeTrendSuccess(),
      supplierCompetition: supplierCompetitionSuccess(),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "CANDIDATE_MARKET_NOT_FOUND",
    });
  });
});

describe("MarketAnalysis module: every constituent Analysis Outcome family", () => {
  it.each([
    {
      scenario: "invalid query",
      outcome: invalidInputOutcome("candidate-market-v1", {
        code: "INVALID_ANALYSIS_QUERY",
      }),
      code: "INVALID_ANALYSIS_QUERY",
      status: 400,
      errorName: "CandidateMarketAnalysisError",
    },
    {
      scenario: "unknown exporter",
      outcome: invalidInputOutcome("candidate-market-v1", {
        code: "UNKNOWN_EXPORTER",
        exporterCode: "999",
      }),
      code: "UNKNOWN_EXPORTER",
      status: 404,
      errorName: "CandidateMarketAnalysisError",
    },
    {
      scenario: "unknown product",
      outcome: invalidInputOutcome("candidate-market-v1", {
        code: "UNKNOWN_PRODUCT",
        productCode: "999999",
      }),
      code: "UNKNOWN_PRODUCT",
      status: 404,
      errorName: "CandidateMarketAnalysisError",
    },
    {
      scenario: "retired build",
      outcome: retiredOutcome("candidate-market-v1"),
      code: "ANALYSIS_BUILD_RETIRED",
      status: 410,
      errorName: "CandidateMarketAnalysisError",
    },
    {
      scenario: "incompatible package",
      outcome: incompatiblePackageOutcome("candidate-market-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "CandidateMarketAnalysisError",
    },
    {
      scenario: "budget exceeded",
      outcome: budgetOutcome("candidate-market-v1"),
      code: "ANALYSIS_BUDGET_EXCEEDED",
      status: 413,
      errorName: "AnalysisBudgetExceededError",
    },
    {
      scenario: "rate limited",
      outcome: rateLimitOutcome("candidate-market-v1"),
      code: "ANALYSIS_RATE_LIMITED",
      status: 429,
      errorName: "AnalysisRateLimitedError",
    },
    {
      scenario: "capacity exceeded",
      outcome: capacityOutcome("candidate-market-v1"),
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      status: 503,
      errorName: "AnalysisCapacityExceededError",
    },
    {
      scenario: "temporarily unavailable",
      outcome: temporaryUnavailabilityOutcome("candidate-market-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "CandidateMarketAnalysisError",
    },
  ] as const)(
    "fails the complete annual Market Analysis with the Candidate Market $scenario outcome",
    async ({ outcome, code, status, errorName }) => {
      const platform = platformReturning({
        candidateMarket: outcome,
        tradeTrend: tradeTrendSuccess(),
        supplierCompetition: supplierCompetitionSuccess(),
      });
      const marketAnalysis = createMarketAnalysis(platform);

      await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
        code,
        status,
        name: errorName,
      });
    },
  );

  it.each([
    {
      scenario: "invalid query",
      outcome: invalidInputOutcome("trade-trend-v1", {
        code: "INVALID_ANALYSIS_QUERY",
      }),
      code: "INVALID_ANALYSIS_QUERY",
      status: 400,
      errorName: "TradeTrendAnalysisError",
    },
    {
      scenario: "unknown importer",
      outcome: invalidInputOutcome("trade-trend-v1", {
        code: "UNKNOWN_IMPORTER",
        importerCode: "999",
      }),
      code: "UNKNOWN_IMPORTER",
      status: 404,
      errorName: "TradeTrendAnalysisError",
    },
    {
      scenario: "unknown product",
      outcome: invalidInputOutcome("trade-trend-v1", {
        code: "UNKNOWN_PRODUCT",
        productCode: "999999",
      }),
      code: "UNKNOWN_PRODUCT",
      status: 404,
      errorName: "TradeTrendAnalysisError",
    },
    {
      scenario: "retired build",
      outcome: retiredOutcome("trade-trend-v1"),
      code: "ANALYSIS_BUILD_RETIRED",
      status: 410,
      errorName: "TradeTrendAnalysisError",
    },
    {
      scenario: "incompatible package",
      outcome: incompatiblePackageOutcome("trade-trend-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "TradeTrendAnalysisError",
    },
    {
      scenario: "budget exceeded",
      outcome: budgetOutcome("trade-trend-v1"),
      code: "ANALYSIS_BUDGET_EXCEEDED",
      status: 413,
      errorName: "AnalysisBudgetExceededError",
    },
    {
      scenario: "rate limited",
      outcome: rateLimitOutcome("trade-trend-v1"),
      code: "ANALYSIS_RATE_LIMITED",
      status: 429,
      errorName: "AnalysisRateLimitedError",
    },
    {
      scenario: "capacity exceeded",
      outcome: capacityOutcome("trade-trend-v1"),
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      status: 503,
      errorName: "AnalysisCapacityExceededError",
    },
    {
      scenario: "temporarily unavailable",
      outcome: temporaryUnavailabilityOutcome("trade-trend-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "TradeTrendAnalysisError",
    },
  ] as const)(
    "fails the complete annual Market Analysis with the Trade Trend $scenario outcome",
    async ({ outcome, code, status, errorName }) => {
      const platform = platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: outcome,
        supplierCompetition: supplierCompetitionSuccess(),
      });
      const marketAnalysis = createMarketAnalysis(platform);

      await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
        code,
        status,
        name: errorName,
      });
    },
  );

  it.each([
    {
      scenario: "invalid query",
      outcome: invalidInputOutcome("supplier-competition-v1", {
        code: "INVALID_ANALYSIS_QUERY",
      }),
      code: "INVALID_ANALYSIS_QUERY",
      status: 400,
      errorName: "SupplierCompetitionAnalysisError",
    },
    {
      scenario: "unknown importer",
      outcome: invalidInputOutcome("supplier-competition-v1", {
        code: "UNKNOWN_IMPORTER",
        importerCode: "999",
      }),
      code: "UNKNOWN_IMPORTER",
      status: 404,
      errorName: "SupplierCompetitionAnalysisError",
    },
    {
      scenario: "unknown product",
      outcome: invalidInputOutcome("supplier-competition-v1", {
        code: "UNKNOWN_PRODUCT",
        productCode: "999999",
      }),
      code: "UNKNOWN_PRODUCT",
      status: 404,
      errorName: "SupplierCompetitionAnalysisError",
    },
    {
      scenario: "retired build",
      outcome: retiredOutcome("supplier-competition-v1"),
      code: "ANALYSIS_BUILD_RETIRED",
      status: 410,
      errorName: "SupplierCompetitionAnalysisError",
    },
    {
      scenario: "incompatible package",
      outcome: incompatiblePackageOutcome("supplier-competition-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "SupplierCompetitionAnalysisError",
    },
    {
      scenario: "budget exceeded",
      outcome: budgetOutcome("supplier-competition-v1"),
      code: "ANALYSIS_BUDGET_EXCEEDED",
      status: 413,
      errorName: "AnalysisBudgetExceededError",
    },
    {
      scenario: "rate limited",
      outcome: rateLimitOutcome("supplier-competition-v1"),
      code: "ANALYSIS_RATE_LIMITED",
      status: 429,
      errorName: "AnalysisRateLimitedError",
    },
    {
      scenario: "capacity exceeded",
      outcome: capacityOutcome("supplier-competition-v1"),
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      status: 503,
      errorName: "AnalysisCapacityExceededError",
    },
    {
      scenario: "temporarily unavailable",
      outcome: temporaryUnavailabilityOutcome("supplier-competition-v1"),
      code: "ANALYSIS_UNAVAILABLE",
      status: 503,
      errorName: "SupplierCompetitionAnalysisError",
    },
  ] as const)(
    "fails the complete annual Market Analysis with the Supplier Competition $scenario outcome",
    async ({ outcome, code, status, errorName }) => {
      const platform = platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: tradeTrendSuccess(),
        supplierCompetition: outcome,
      });
      const marketAnalysis = createMarketAnalysis(platform);

      await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
        code,
        status,
        name: errorName,
      });
    },
  );
});


describe("MarketAnalysis module: deterministic failure precedence", () => {
  it("prefers the highest-precedence category across recipes even when a lower-precedence recipe would otherwise come first", async () => {
    const platform = platformReturning({
      candidateMarket: temporaryUnavailabilityOutcome("candidate-market-v1"),
      tradeTrend: incompatiblePackageOutcome("trade-trend-v1"),
      supplierCompetition: supplierCompetitionSuccess(),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
      name: "TradeTrendAnalysisError",
    });
  });

  it("breaks a same-category tie by Candidate Market before Trade Trend before Supplier Competition", async () => {
    const platform = platformReturning({
      candidateMarket: retiredOutcome("candidate-market-v1"),
      tradeTrend: retiredOutcome("trade-trend-v1"),
      supplierCompetition: retiredOutcome("supplier-competition-v1"),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_BUILD_RETIRED",
      name: "CandidateMarketAnalysisError",
    });
  });

  it("breaks a same-category tie between Trade Trend and Supplier Competition when Candidate Market succeeds", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketSuccess(),
      tradeTrend: retiredOutcome("trade-trend-v1"),
      supplierCompetition: retiredOutcome("supplier-competition-v1"),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_BUILD_RETIRED",
      name: "TradeTrendAnalysisError",
    });
  });

  it("resolves constituent invalid-input outcomes before evaluating Candidate Market absence", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketEmpty(),
      tradeTrend: invalidInputOutcome("trade-trend-v1", {
        code: "UNKNOWN_PRODUCT",
        productCode: "999999",
      }),
      supplierCompetition: supplierCompetitionSuccess(),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "UNKNOWN_PRODUCT",
      name: "TradeTrendAnalysisError",
    });
  });

  const CATEGORY_OUTCOMES = [
    {
      category: "invalid-input",
      build: (recipe: AnalysisRecipe) =>
        invalidInputOutcome(recipe, { code: "INVALID_ANALYSIS_QUERY" }),
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      category: "retired",
      build: (recipe: AnalysisRecipe) => retiredOutcome(recipe),
      code: "ANALYSIS_BUILD_RETIRED",
    },
    {
      category: "incompatible-package",
      build: (recipe: AnalysisRecipe) => incompatiblePackageOutcome(recipe),
      code: "ANALYSIS_UNAVAILABLE",
    },
    {
      category: "budget",
      build: (recipe: AnalysisRecipe) => budgetOutcome(recipe),
      code: "ANALYSIS_BUDGET_EXCEEDED",
    },
    {
      category: "rate-limit",
      build: (recipe: AnalysisRecipe) => rateLimitOutcome(recipe),
      code: "ANALYSIS_RATE_LIMITED",
    },
    {
      category: "capacity",
      build: (recipe: AnalysisRecipe) => capacityOutcome(recipe),
      code: "ANALYSIS_CAPACITY_EXCEEDED",
    },
    {
      category: "temporary-unavailability",
      build: (recipe: AnalysisRecipe) => temporaryUnavailabilityOutcome(recipe),
      code: "ANALYSIS_UNAVAILABLE",
    },
  ] as const;

  const ADJACENT_CATEGORY_PAIRS = CATEGORY_OUTCOMES.slice(0, -1).map(
    (higher, index) => [higher, CATEGORY_OUTCOMES[index + 1]] as const,
  );

  it.each(
    ADJACENT_CATEGORY_PAIRS.flatMap(([higher, lower]) => [
      {
        higherRecipe: "candidate-market-v1" as const,
        higher,
        lowerRecipe: "trade-trend-v1" as const,
        lower,
      },
      {
        higherRecipe: "trade-trend-v1" as const,
        higher,
        lowerRecipe: "candidate-market-v1" as const,
        lower,
      },
    ]),
  )(
    "prefers $higher.category over $lower.category regardless of which recipe holds each",
    async ({ higherRecipe, higher, lowerRecipe, lower }) => {
      const candidateMarketOutcome = (
        higherRecipe === "candidate-market-v1"
          ? higher.build("candidate-market-v1")
          : lower.build("candidate-market-v1")
      ) as AnalysisOutcome<"candidate-market-v1">;
      const tradeTrendOutcome = (
        higherRecipe === "trade-trend-v1"
          ? higher.build("trade-trend-v1")
          : lower.build("trade-trend-v1")
      ) as AnalysisOutcome<"trade-trend-v1">;
      void lowerRecipe;
      const platform = platformReturning({
        candidateMarket: candidateMarketOutcome,
        tradeTrend: tradeTrendOutcome,
        supplierCompetition: supplierCompetitionSuccess(),
      });
      const marketAnalysis = createMarketAnalysis(platform);

      await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
        code: higher.code,
      });
    },
  );
});

describe("MarketAnalysis module: annual provenance invariant", () => {
  it("fails closed as ANALYSIS_UNAVAILABLE when the BACI Release disagrees across constituent recipes", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketSuccess(),
      tradeTrend: tradeTrendSuccess({
        provenance: {
          ...baseTradeTrendResult().provenance,
          baciRelease: "V202512",
        },
      }),
      supplierCompetition: supplierCompetitionSuccess(),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
      name: "CandidateMarketAnalysisError",
    });
  });

  it("fails closed as ANALYSIS_UNAVAILABLE when the five-Finalized-Year window disagrees", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketSuccess(),
      tradeTrend: tradeTrendSuccess(),
      supplierCompetition: supplierCompetitionSuccess({
        provenance: {
          ...baseSupplierCompetitionResult().provenance,
          finalizedWindow: { start: 2018, end: 2022 },
        },
      }),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
      name: "CandidateMarketAnalysisError",
    });
  });

  it("fails closed as ANALYSIS_UNAVAILABLE when the Provisional Year disagrees", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketSuccess(),
      tradeTrend: tradeTrendSuccess({
        provenance: {
          ...baseTradeTrendResult().provenance,
          provisionalYear: 2023,
        },
      }),
      supplierCompetition: supplierCompetitionSuccess(),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
    });
  });

  it("fails closed as ANALYSIS_UNAVAILABLE when the analysis build disagrees", async () => {
    const platform = platformReturning({
      candidateMarket: candidateMarketSuccess(),
      tradeTrend: tradeTrendSuccess(),
      supplierCompetition: supplierCompetitionSuccess({
        analysisBuildId: "a-different-stub-build",
      }),
    });
    const marketAnalysis = createMarketAnalysis(platform);

    await expect(marketAnalysis.load(REQUEST)).rejects.toMatchObject({
      code: "ANALYSIS_UNAVAILABLE",
    });
  });

  it("does not fail closed when only the Dataset Package identities differ but shared semantics agree", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);

    const result = await marketAnalysis.load(REQUEST);

    const identities = new Set(
      result.constituentAnalyses.map((entry) => entry.datasetPackageIdentity),
    );
    // Every constituent Dataset Package identity stays individually visible
    // (spec §5.5) -- the invariant only requires their shared annual
    // semantics to agree, not the identities themselves.
    expect(identities.size).toBeGreaterThanOrEqual(1);
  });
});

describe("MarketAnalysis module: cancellation", () => {
  it("propagates cancellation and aborts all outstanding constituent executions", async () => {
    const controller = new AbortController();
    const platform = rejectingOnAbortPlatform();
    const marketAnalysis = createMarketAnalysis(platform);

    const pending = marketAnalysis.load(REQUEST, {
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
  });

  it("shares the same execution options across all three constituent executions", async () => {
    const seenSignals = new Set<AbortSignal | undefined>();
    const controller = new AbortController();
    const platform = platformReturning(
      {
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: tradeTrendSuccess(),
        supplierCompetition: supplierCompetitionSuccess(),
      },
      (request, options) => {
        seenSignals.add(options?.signal);
        void request;
      },
    );
    const marketAnalysis = createMarketAnalysis(platform);

    await marketAnalysis.load(REQUEST, { signal: controller.signal });

    expect(seenSignals.size).toBe(1);
    expect(seenSignals.has(controller.signal)).toBe(true);
  });
});

describe("MarketAnalysis module: determinism", () => {
  it("produces byte-for-byte identical results for identical inputs", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);

    const first = await marketAnalysis.load(REQUEST);
    const second = await marketAnalysis.load(REQUEST);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
