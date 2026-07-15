import { describe, expect, it } from "vitest";

import {
  createCandidateMarketV1TradeAnalyticsPlatform,
  createTradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createFixtureCandidateMarketDatasetPackages,
  FixtureTradeEvidenceSource,
} from "../../src/evidence/fixture-trade-evidence-source";
import type { TradeEvidenceSource } from "../../src/evidence/trade-evidence-source";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { CORE_CURRENT_INPUT } from "../../fixtures/acceptance/v1/evidence/core-current";
import { CORE_CANDIDATE_SUMMARY } from "../../fixtures/acceptance/v1/expected/core-analysis";
import { ACCEPTANCE_FIXTURE_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import { TRADE_TREND_ACCEPTANCE_CASES } from "../../fixtures/trade-trend/v1/expected";
import { createTradeTrendDatasetPackage } from "../../src/domain/trade-analytics/trade-trend-v1-dataset-package";
import { SUPPLIER_COMPETITION_ACCEPTANCE_CASES } from "../../fixtures/supplier-competition/v1/expected";
import {
  createSupplierCompetitionDatasetPackage,
  SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/supplier-competition-v1-dataset-package";

describe("TradeAnalyticsPlatform", () => {
  it.each(TRADE_TREND_ACCEPTANCE_CASES)(
    "returns the $name Trade Trend acceptance fixture",
    async ({ importerCode, productCode, summary, provisional }) => {
      const outcome =
        await createFixtureApplicationRuntime().tradeAnalytics.execute({
          recipe: "trade-trend-v1",
          analysisBuildId: "acceptance-fixtures-v1",
          importerCode,
          productCode,
        });

      expect(outcome.state).toBe("success");
      if (outcome.state !== "success") {
        throw new Error(`Expected success, received ${outcome.state}.`);
      }
      expect(outcome.payload.summary).toEqual(
        expect.objectContaining(summary),
      );
      expect(outcome.payload.provisionalObservation).toEqual(provisional);
    },
  );

  it("returns the fixture-backed Trade Trend v1 outcome through the closed execute seam", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        importerCode: "528",
        productCode: "010121",
      });

    expect(outcome).toMatchObject({
      state: "success",
      recipe: "trade-trend-v1",
      normalizedInputs: {
        importerCode: "528",
        product: { hsRevision: "HS12", code: "010121" },
      },
      payload: {
        schemaVersion: "trade-trend-result-v1",
        query: {
          importer: { code: "528", name: "Netherlands" },
          product: { code: "010121" },
        },
        finalizedObservations: [
          {
            year: 2019,
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "100000",
          },
          {
            year: 2020,
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "110000",
          },
          {
            year: 2021,
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "120000",
          },
          {
            year: 2022,
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "130000",
          },
          {
            year: 2023,
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: "160000",
          },
        ],
        summary: {
          state: "AVAILABLE",
          absoluteChangeCurrentUsd: "60000",
          percentageChangePercent: "60.000000",
          cagrPercent: "12.468265",
        },
        provisionalObservation: {
          year: 2024,
          state: "RECORDED_POSITIVE",
          valueCurrentUsd: "200000",
        },
      },
    });
    expect(outcome.analysisIdentity).toMatch(
      /^analysis-identity-v1-[a-f0-9]{64}$/,
    );
  });

  it("derives Trade Trend identity only from its recipe, package, and normalized semantic inputs", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const request = {
      recipe: "trade-trend-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "528",
      productCode: "010121",
    } as const;

    const [first, presentationVariant] = await Promise.all([
      platform.execute(request),
      platform.execute({
        ...request,
        locale: "zh-Hans",
        executionTime: "2099-01-01T00:00:00Z",
        cacheState: "miss",
        requestOrigin: "198.51.100.4",
      }),
    ]);

    expect(first.analysisIdentity).toBe(presentationVariant.analysisIdentity);
    expect(first.normalizedInputs).toEqual({
      importerCode: "528",
      product: { hsRevision: "HS12", code: "010121" },
    });
  });

  it("changes Trade Trend Analysis Identity when exact package evidence changes", async () => {
    const request = {
      recipe: "trade-trend-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "528",
      productCode: "010121",
    } as const;
    const platform = (evidenceSha256: string) =>
      createTradeAnalyticsPlatform({
        tradeTrend: {
          evidenceSource: new FixtureTradeEvidenceSource(),
          datasetPackages: new Map([
            [
              request.analysisBuildId,
              createTradeTrendDatasetPackage({
                schemaVersion: "trade-trend-dataset-package-manifest-v1",
                baciRelease: "V202601",
                hsRevision: "HS12",
                finalizedYearCount: 5,
                evidenceSha256,
                capabilities: [
                  {
                    id: "trade-trend/importer-annual-value",
                    version: "1",
                  },
                  { id: "trade-trend/economy-identity", version: "1" },
                  { id: "trade-trend/hs-product-identity", version: "1" },
                ],
              }),
            ],
          ]),
        },
      });

    const [first, changed] = await Promise.all([
      platform("a".repeat(64)).execute(request),
      platform("b".repeat(64)).execute(request),
    ]);

    expect(first.state).toBe("success");
    expect(changed.state).toBe("success");
    expect(first.analysisIdentity).not.toBe(changed.analysisIdentity);
    expect(first.datasetPackageIdentity).not.toBe(
      changed.datasetPackageIdentity,
    );
  });

  it("returns the accepted 13-market Candidate Market v1 oracle", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        exporterCode: "156",
        productCode: "010121",
      });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }
    expect(outcome.payload.schemaVersion).toBe(
      "candidate-market-result-v1",
    );
    expect(outcome.payload.cohortSize).toBe(13);
    expect(
      outcome.payload.candidates.map((candidate) => ({
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

  it("preserves missingness, identity proxy, Data Confidence, and Release Revision evidence", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        exporterCode: "156",
        productCode: "010121",
      });
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }
    const byCode = new Map(
      outcome.payload.candidates.map((candidate) => [
        candidate.economy.code,
        candidate,
      ]),
    );

    expect(byCode.get("710")).toMatchObject({
      observedScoreYears: [2022, 2023],
      missingScoreYears: [2019, 2020, 2021],
      confidence: {
        score: 40,
        label: "LOW",
        deductions: [
          { code: "MISSING_SCORE_WINDOW_YEARS", points: 30 },
          {
            code: "UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE",
            points: 10,
          },
        ],
        sparseEvidenceCapApplied: true,
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
        score: 90,
        deductions: [{ code: "IDENTITY_PROXY", points: 10 }],
      },
      caveatCodes: ["IDENTITY_PROXY"],
    });
    expect(outcome.payload.releaseRevisionSummary).toEqual({
      comparisonRelease: null,
      previousArtifactSha256: null,
      notComparedReason: "NO_PREVIOUS_ARTIFACT",
      noLongerEligibleCount: null,
    });
    expect(
      outcome.payload.candidates.every(
        ({ releaseRevision }) =>
          releaseRevision.state === "NOT_COMPARED",
      ),
    ).toBe(true);
  });

  it("compares same-period evidence from a compatible previous release", async () => {
    const previousArtifactSha256 = "b".repeat(64);
    const previousInput = {
      ...CORE_CURRENT_INPUT,
      artifact: {
        ...CORE_CURRENT_INPUT.artifact,
        baciRelease: "V202501",
        buildId: "acceptance-fixtures-v1-previous-artifact",
        sha256: previousArtifactSha256,
      },
      release: {
        ...CORE_CURRENT_INPUT.release,
        baciRelease: "V202501",
      },
    };
    const platform = createCandidateMarketV1TradeAnalyticsPlatform({
      evidenceSource: new FixtureTradeEvidenceSource(),
      previousRelease: {
        source: {
          async loadCmsV1Inputs() {
            return previousInput;
          },
        },
        baciRelease: "V202501",
        artifactSha256: previousArtifactSha256,
        hsRevision: "HS12",
        availableYears: [2019, 2020, 2021, 2022, 2023],
      },
      datasetPackages: createFixtureCandidateMarketDatasetPackages(
        new Map([
          [CORE_CURRENT_INPUT.analysisBuildId, previousInput],
        ]),
      ),
    });

    const outcome = await platform.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }

    expect(outcome.payload.releaseRevisionSummary).toEqual({
      comparisonRelease: "V202501",
      previousArtifactSha256,
      notComparedReason: null,
      noLongerEligibleCount: 0,
    });
    expect(
      outcome.payload.candidates.every(
        ({ releaseRevision }) =>
          releaseRevision.state === "BELOW_THRESHOLD" &&
          releaseRevision.scoreChange === 0 &&
          releaseRevision.materialChange === false,
      ),
    ).toBe(true);
    expect(outcome.payload.candidates[0]!.releaseRevision).toEqual({
      state: "BELOW_THRESHOLD",
      previousReleaseRecomputedScore: 85,
      scoreChange: 0,
      previousReleaseRecomputedRankPercentile: "100.000",
      rankPercentileChange: "0.000",
      materialChange: false,
    });
  });

  it("preserves integer ties and discontinuity treatment", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "acceptance-fixtures-v1-discontinuity",
        exporterCode: "156",
        productCode: "851712",
      });
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }

    expect(outcome.payload.productSeriesDiscontinuityYears).toEqual([
      2017,
    ]);
    expect(
      outcome.payload.candidates
        .filter(({ economy }) =>
          ["124", "392", "710", "842"].includes(economy.code),
        )
        .map(
          ({
            economy,
            score,
            rank,
            rankTieSize,
            rankPercentile,
          }) => ({
            code: economy.code,
            score,
            rank,
            rankTieSize,
            rankPercentile,
          }),
        ),
    ).toEqual([
      {
        code: "124",
        score: 54,
        rank: 5,
        rankTieSize: 2,
        rankPercentile: "62.500",
      },
      {
        code: "392",
        score: 54,
        rank: 5,
        rankTieSize: 2,
        rankPercentile: "62.500",
      },
      {
        code: "710",
        score: 50,
        rank: 7,
        rankTieSize: 2,
        rankPercentile: "45.833",
      },
      {
        code: "842",
        score: 50,
        rank: 7,
        rankTieSize: 2,
        rankPercentile: "45.833",
      },
    ]);
    for (const candidate of outcome.payload.candidates) {
      expect(candidate.caveatCodes).toContain(
        "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
      );
      expect(candidate.confidence.deductions).toContainEqual({
        code: "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
        points: 15,
      });
    }
  });

  it("keeps Provisional Year evidence outside finalized scoring", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const execute = (analysisBuildId: string) =>
      platform.execute({
        recipe: "candidate-market-v1",
        analysisBuildId,
        exporterCode: "156",
        productCode: "010121",
      });
    const [base, mutation] = await Promise.all([
      execute("acceptance-fixtures-v1"),
      execute("acceptance-fixtures-v1-provisional-mutation"),
    ]);
    if (base.state !== "success" || mutation.state !== "success") {
      throw new Error("Expected both Candidate Market outcomes to succeed.");
    }
    const finalizedProjection = (outcome: typeof base) =>
      outcome.payload.candidates.map((candidate) => ({
        code: candidate.economy.code,
        score: candidate.score,
        rank: candidate.rank,
        components: candidate.components,
        confidence: candidate.confidence,
      }));

    expect(mutation.payload.provenance.provisionalYear).toBe(2024);
    expect(finalizedProjection(mutation)).toEqual(
      finalizedProjection(base),
    );
    expect(
      mutation.payload.candidates.map(
        (candidate) => candidate.provisionalEvidence,
      ),
    ).not.toEqual(
      base.payload.candidates.map(
        (candidate) => candidate.provisionalEvidence,
      ),
    );
  });

  it("returns an attributable empty Candidate Market outcome", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        exporterCode: "156",
        productCode: "851712",
      });

    expect(outcome.state).toBe("empty");
    if (outcome.state !== "empty") {
      throw new Error(`Expected empty, received ${outcome.state}.`);
    }
    expect(outcome.emptyReason).toBe(
      "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
    );
    expect(outcome.payload).toMatchObject({
      schemaVersion: "candidate-market-result-v1",
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      candidates: [],
    });
  });

  it.each([
    {
      name: "malformed product",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "10121",
      state: "invalid-input",
      code: "INVALID_ANALYSIS_QUERY",
    },
    {
      name: "unknown exporter",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "999",
      productCode: "010121",
      state: "invalid-input",
      code: "UNKNOWN_EXPORTER",
    },
    {
      name: "unknown product",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "999999",
      state: "invalid-input",
      code: "UNKNOWN_PRODUCT",
    },
    {
      name: "retired analysis build",
      analysisBuildId: "retired-fixture-build",
      exporterCode: "156",
      productCode: "010121",
      state: "retired",
      code: "ANALYSIS_BUILD_RETIRED",
    },
    {
      name: "temporarily unavailable analysis build",
      analysisBuildId: "unavailable-fixture-build",
      exporterCode: "156",
      productCode: "010121",
      state: "temporary-unavailability",
      code: "ANALYSIS_UNAVAILABLE",
    },
  ] as const)(
    "returns the typed $state outcome for $name",
    async ({
      analysisBuildId,
      exporterCode,
      productCode,
      state,
      code,
    }) => {
      const outcome =
        await createFixtureApplicationRuntime().tradeAnalytics.execute({
          recipe: "candidate-market-v1",
          analysisBuildId,
          exporterCode,
          productCode,
        });

      expect(outcome).toMatchObject({
        state,
        recipe: "candidate-market-v1",
        analysisIdentity: null,
        datasetPackageIdentity: null,
        normalizedInputs: null,
        error: { code },
      });
    },
  );

  it("returns a retryable capacity outcome when execution cannot be admitted", async () => {
    const platform = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
      {
        maxConcurrentAnalyses: 0,
        maxQueuedAnalyses: 0,
      },
    ).tradeAnalytics;

    const outcome = await platform.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });

    expect(outcome).toMatchObject({
      state: "capacity",
      recipe: "candidate-market-v1",
      analysisIdentity: null,
      datasetPackageIdentity: null,
      normalizedInputs: null,
      error: {
        code: "ANALYSIS_CAPACITY_EXCEEDED",
        reason: "queue-full",
        retryAfterSeconds: 2,
      },
    });
  });

  it("derives stable identity only from recipe, package, and normalized semantic inputs", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const request = {
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    } as const;

    const first = await platform.execute(request);
    const second = await platform.execute(
      {
        ...request,
        locale: "zh-Hans",
        executionTime: "2099-01-01T00:00:00Z",
        cacheState: "miss",
        requestOrigin: "198.51.100.4",
      },
      { signal: new AbortController().signal },
    );

    expect(first.analysisIdentity).toBe(
      "analysis-identity-v1-9b0b1f1b6bef89cda3060c0242de91d2b9dc8f6e541a77ce17779b688e60125d",
    );
    expect(second.analysisIdentity).toBe(first.analysisIdentity);
    expect(first.datasetPackageIdentity).toBe(
      "dataset-package-v1-e213940cbd10bc1028dee1dbae426387fd6472a6561ee5ff834e1693210b2ef4",
    );
    expect(first.normalizedInputs).toEqual({
      exporterCode: "156",
      product: { hsRevision: "HS12", code: "010121" },
    });
  });

  it("keeps one package identity across inputs without colliding across artifacts", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const execute = (
      analysisBuildId: string,
      productCode: string,
    ) =>
      platform.execute({
        recipe: "candidate-market-v1",
        analysisBuildId,
        exporterCode: "156",
        productCode,
      });

    const [core, empty, provisionalMutation] = await Promise.all([
      execute("acceptance-fixtures-v1", "010121"),
      execute("acceptance-fixtures-v1", "851712"),
      execute(
        "acceptance-fixtures-v1-provisional-mutation",
        "010121",
      ),
    ]);

    expect(core.datasetPackageIdentity).toBe(
      empty.datasetPackageIdentity,
    );
    expect(provisionalMutation.datasetPackageIdentity).not.toBe(
      core.datasetPackageIdentity,
    );
  });

  it("delivers observations without making cache partitions semantic", async () => {
    const platform = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    ).tradeAnalytics;
    const request = {
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    } as const;
    const cacheStates: string[] = [];
    const execute = (cachePartitionKey: string) =>
      platform.execute(request, {
        cachePartitionKey,
        observe: (observation) => {
          cacheStates.push(observation.cacheState);
        },
      });

    const first = await execute("platform-sample-a");
    const cached = await execute("platform-sample-a");
    const partitioned = await execute("platform-sample-b");

    expect(cacheStates).toEqual(["miss", "hit", "miss"]);
    expect(cached.analysisIdentity).toBe(first.analysisIdentity);
    expect(partitioned.analysisIdentity).toBe(first.analysisIdentity);
  });

  it.each(SUPPLIER_COMPETITION_ACCEPTANCE_CASES)(
    "returns the $name Supplier Competition acceptance fixture",
    async ({
      importerCode,
      productCode,
      cohortSize,
      finalizedPooledValueCurrentUsd,
      supplierShares,
      concentration,
      qualityWarnings,
      provisionalSupplierShares,
    }) => {
      const outcome =
        await createFixtureApplicationRuntime().tradeAnalytics.execute({
          recipe: "supplier-competition-v1",
          analysisBuildId: "acceptance-fixtures-v1",
          importerCode,
          productCode,
        });

      const expectedState = cohortSize === 0 ? "empty" : "success";
      expect(outcome.state).toBe(expectedState);
      if (outcome.state !== "success" && outcome.state !== "empty") {
        throw new Error(`Expected ${expectedState}, received ${outcome.state}.`);
      }
      expect(outcome.payload.cohortSize).toBe(cohortSize);
      expect(outcome.payload.finalizedPooledValueCurrentUsd).toBe(
        finalizedPooledValueCurrentUsd,
      );
      expect(
        outcome.payload.supplierShares.map((share) => ({
          code: share.economy.code,
          pooled: share.pooledValueCurrentUsd,
          share: share.sharePercent,
          quantityCoverageRate: share.quantityCoverageRate,
        })),
      ).toEqual(
        supplierShares.map(({ code, pooled, share, quantityCoverageRate }) => ({
          code,
          pooled,
          share,
          quantityCoverageRate,
        })),
      );
      expect(outcome.payload.concentration).toEqual(concentration);
      expect(outcome.payload.qualityWarnings).toEqual(qualityWarnings);
      expect(
        outcome.payload.provisionalSupplierShares.map((share) => ({
          code: share.economy.code,
          state: share.bilateralState,
          value: share.valueCurrentUsd,
        })),
      ).toEqual(
        provisionalSupplierShares.map(({ code, state, value }) => ({
          code,
          state,
          value,
        })),
      );
    },
  );

  it("returns the fixture-backed Supplier Competition v1 outcome through the closed execute seam", async () => {
    const outcome =
      await createFixtureApplicationRuntime().tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        importerCode: "124",
        productCode: "010121",
      });

    expect(outcome).toMatchObject({
      state: "success",
      recipe: "supplier-competition-v1",
      normalizedInputs: {
        importerCode: "124",
        product: { hsRevision: "HS12", code: "010121" },
      },
      payload: {
        schemaVersion: "supplier-competition-result-v1",
        query: {
          importer: { code: "124", name: "Canada" },
          product: { code: "010121" },
        },
        cohortSize: 4,
        emptyReason: null,
        concentration: {
          state: "COMPUTED",
          herfindahlHirschmanIndex: "5200.000000",
          scale: 10000,
        },
      },
    });
    expect(outcome.analysisIdentity).toMatch(
      /^analysis-identity-v1-[a-f0-9]{64}$/,
    );
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }
    expect(outcome.payload.discoveryDisclaimer).toMatch(
      /does not identify companies, buyers, shipments, Party Roles, or Commercial Relationship Assertions/,
    );
  });

  it("derives Supplier Competition identity only from its recipe, package, and normalized semantic inputs", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const request = {
      recipe: "supplier-competition-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "124",
      productCode: "010121",
    } as const;

    const [first, presentationVariant] = await Promise.all([
      platform.execute(request),
      platform.execute({
        ...request,
        locale: "zh-Hans",
        executionTime: "2099-01-01T00:00:00Z",
        cacheState: "miss",
        requestOrigin: "198.51.100.4",
      }),
    ]);

    expect(first.analysisIdentity).toBe(presentationVariant.analysisIdentity);
    expect(first.normalizedInputs).toEqual({
      importerCode: "124",
      product: { hsRevision: "HS12", code: "010121" },
    });
  });

  it("changes Supplier Competition Analysis Identity when exact package evidence changes", async () => {
    const request = {
      recipe: "supplier-competition-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "124",
      productCode: "010121",
    } as const;
    const platform = (evidenceSha256: string) =>
      createTradeAnalyticsPlatform({
        supplierCompetition: {
          evidenceSource: new FixtureTradeEvidenceSource(),
          datasetPackages: new Map([
            [
              request.analysisBuildId,
              createSupplierCompetitionDatasetPackage({
                schemaVersion:
                  "supplier-competition-dataset-package-manifest-v1",
                baciRelease: "V202601",
                hsRevision: "HS12",
                finalizedYearCount: 5,
                evidenceSha256,
                capabilities:
                  SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS,
              }),
            ],
          ]),
        },
      });

    const [first, changed] = await Promise.all([
      platform("a".repeat(64)).execute(request),
      platform("b".repeat(64)).execute(request),
    ]);

    expect(first.state).toBe("success");
    expect(changed.state).toBe("success");
    expect(first.analysisIdentity).not.toBe(changed.analysisIdentity);
    expect(first.datasetPackageIdentity).not.toBe(
      changed.datasetPackageIdentity,
    );
  });

  it("leaves Supplier Competition retired when the platform declares no Supplier Competition input", async () => {
    const platform = createCandidateMarketV1TradeAnalyticsPlatform({
      evidenceSource: new FixtureTradeEvidenceSource(),
      datasetPackages: createFixtureCandidateMarketDatasetPackages(),
    });

    const outcome = await platform.execute({
      recipe: "supplier-competition-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "124",
      productCode: "010121",
    });

    expect(outcome.state).toBe("retired");
  });

  describe("retained per-build evidence binding", () => {
    const currentBuildId = ACCEPTANCE_FIXTURE_BUILD_IDS.core;
    const retainedBuildId = "acceptance-fixtures-v1-retained";

    it("binds each retained analysisBuildId to its own evidence source rather than one shared source", async () => {
      const currentSource: TradeEvidenceSource = {
        async loadCmsV1Inputs(query) {
          if (query.analysisBuildId !== currentBuildId) {
            throw new Error(
              "The current evidence source must only see current-build requests.",
            );
          }
          return CORE_CURRENT_INPUT;
        },
      };
      const retainedSource: TradeEvidenceSource = {
        async loadCmsV1Inputs(query) {
          if (query.analysisBuildId !== retainedBuildId) {
            throw new Error(
              "The retained evidence source must only see retained-build requests.",
            );
          }
          return {
            ...CORE_CURRENT_INPUT,
            analysisBuildId: retainedBuildId,
            exporter: { ...CORE_CURRENT_INPUT.exporter, code: "276" },
          };
        },
      };
      const datasetPackage = createFixtureCandidateMarketDatasetPackages().get(
        currentBuildId,
      )!;
      const platform = createCandidateMarketV1TradeAnalyticsPlatform({
        evidenceSource: new Map([
          [currentBuildId, currentSource],
          [retainedBuildId, retainedSource],
        ]),
        datasetPackages: new Map([
          [currentBuildId, datasetPackage],
          [retainedBuildId, datasetPackage],
        ]),
      });

      const [currentOutcome, retainedOutcome] = await Promise.all([
        platform.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: currentBuildId,
          exporterCode: "156",
          productCode: "010121",
        }),
        platform.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: retainedBuildId,
          exporterCode: "276",
          productCode: "010121",
        }),
      ]);

      expect(currentOutcome.state).toBe("success");
      expect(retainedOutcome.state).toBe("success");
      if (
        currentOutcome.state !== "success" ||
        retainedOutcome.state !== "success"
      ) {
        throw new Error("Expected both builds to succeed.");
      }
      // Each retained build reproduces its own exact deterministic
      // Analysis Identity, never the other build's.
      expect(currentOutcome.analysisIdentity).not.toBe(
        retainedOutcome.analysisIdentity,
      );
    });

    it("throws at construction when a Map evidence binding omits a declared analysis build", () => {
      const datasetPackage = createFixtureCandidateMarketDatasetPackages().get(
        currentBuildId,
      )!;
      expect(() =>
        createCandidateMarketV1TradeAnalyticsPlatform({
          evidenceSource: new Map([
            [currentBuildId, new FixtureTradeEvidenceSource()],
          ]),
          datasetPackages: new Map([
            [currentBuildId, datasetPackage],
            [retainedBuildId, datasetPackage],
          ]),
        }),
      ).toThrow(/no candidate-market-v1 evidence source is bound/iu);
    });

    it("scopes Release Revision evidence to its own retained build rather than the current deployment's", async () => {
      const previousArtifactSha256 = "e".repeat(64);
      const previousInput = {
        ...CORE_CURRENT_INPUT,
        artifact: {
          ...CORE_CURRENT_INPUT.artifact,
          baciRelease: "V202501",
          buildId: "acceptance-fixtures-v1-retained-previous-artifact",
          sha256: previousArtifactSha256,
        },
        release: { ...CORE_CURRENT_INPUT.release, baciRelease: "V202501" },
      };
      const sharedSource: TradeEvidenceSource = {
        async loadCmsV1Inputs(query) {
          return query.analysisBuildId === currentBuildId
            ? CORE_CURRENT_INPUT
            : { ...CORE_CURRENT_INPUT, analysisBuildId: retainedBuildId };
        },
      };
      const datasetPackage = createFixtureCandidateMarketDatasetPackages().get(
        currentBuildId,
      )!;
      const platform = createCandidateMarketV1TradeAnalyticsPlatform({
        evidenceSource: sharedSource,
        // Only the retained build carries Release Revision comparison
        // evidence; the current deployment declares none.
        previousRelease: new Map([
          [
            retainedBuildId,
            {
              source: { async loadCmsV1Inputs() { return previousInput; } },
              baciRelease: "V202501",
              artifactSha256: previousArtifactSha256,
              hsRevision: "HS12" as const,
              availableYears: [2019, 2020, 2021, 2022, 2023],
            },
          ],
        ]),
        datasetPackages: new Map([
          [currentBuildId, datasetPackage],
          [retainedBuildId, datasetPackage],
        ]),
      });

      const [currentOutcome, retainedOutcome] = await Promise.all([
        platform.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: currentBuildId,
          exporterCode: "156",
          productCode: "010121",
        }),
        platform.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: retainedBuildId,
          exporterCode: "156",
          productCode: "010121",
        }),
      ]);

      if (
        currentOutcome.state !== "success" ||
        retainedOutcome.state !== "success"
      ) {
        throw new Error("Expected both builds to succeed.");
      }
      expect(currentOutcome.payload.releaseRevisionSummary).toEqual({
        comparisonRelease: null,
        previousArtifactSha256: null,
        notComparedReason: "NO_PREVIOUS_ARTIFACT",
        noLongerEligibleCount: null,
      });
      expect(
        retainedOutcome.payload.releaseRevisionSummary.comparisonRelease,
      ).toBe("V202501");
    });
  });
});
