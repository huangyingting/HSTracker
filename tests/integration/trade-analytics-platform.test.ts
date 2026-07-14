import { describe, expect, it } from "vitest";

import { CmsV1CandidateMarketAnalysis } from "../../src/domain/candidate-market/analyze-candidate-markets";
import { CandidateMarketTradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";
import { FixtureTradeEvidenceSource } from "../../src/evidence/fixture-trade-evidence-source";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { CORE_CURRENT_INPUT } from "../../fixtures/acceptance/v1/evidence/core-current";
import { CORE_CANDIDATE_SUMMARY } from "../../fixtures/acceptance/v1/expected/core-analysis";

describe("TradeAnalyticsPlatform", () => {
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
    const analysis = new CmsV1CandidateMarketAnalysis(
      new FixtureTradeEvidenceSource(),
      {
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
    );
    const platform = new CandidateMarketTradeAnalyticsPlatform(
      analysis.analyze.bind(analysis),
    );

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
      "analysis-identity-v1-c2581f2f118f78be998a7f581f2851844ba3d385bff7b5cd8f51bce00882ebbd",
    );
    expect(second.analysisIdentity).toBe(first.analysisIdentity);
    expect(first.datasetPackageIdentity).toBe(
      "dataset-package-v1-70d25bce90ecc0400de7984e72b78ed34477e9aa55a5eca7cf767730d1519cb8",
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
});
