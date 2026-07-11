import { describe, expect, it } from "vitest";

import { computeCmsV1 } from "../../src/domain/candidate-market/cms-v1";
import { compareReleaseRevisions } from "../../src/domain/release/release-revision";
import { CORE_CURRENT_INPUT } from "../../test/fixtures/acceptance/v1/evidence/core-current";

const currentRelease = {
  baciRelease: "V202601",
  hsRevision: "HS12",
  scoreVersion: "cms-v1",
  scoreWindow: { start: 2019, end: 2023 },
  candidates: [
    { code: "528", score: 80, rankPercentile: "100.000" },
    { code: "484", score: 70, rankPercentile: "75.000" },
    { code: "152", score: 60, rankPercentile: "50.000" },
    { code: "710", score: 50, rankPercentile: "25.000" },
    { code: "124", score: 40, rankPercentile: "0.000" },
  ],
} as const;

const previousArtifact = {
  baciRelease: "V202501",
  artifactSha256:
    "a5e8f9f95462b43ca5f5f34679a6fe0e265010e5858d774da545f9f579f8c821",
  hsRevision: "HS12",
  scoreVersion: "cms-v1",
  availableYears: [2019, 2020, 2021, 2022, 2023],
  scoreWindowUsed: { start: 2019, end: 2023 },
  recomputedCandidates: [
    { code: "528", score: 85, rankPercentile: "100.000" },
    { code: "36", score: 75, rankPercentile: "75.000" },
    { code: "152", score: 60, rankPercentile: "50.000" },
    { code: "484", score: 55, rankPercentile: "25.000" },
    { code: "124", score: 40, rankPercentile: "0.000" },
  ],
} as const;

describe("Release Revision comparison", () => {
  it("classifies the complete same-window comparison oracle", () => {
    const comparison = compareReleaseRevisions({
      currentRelease,
      previousArtifact,
    });

    expect(comparison).toEqual({
      comparisonRelease: "V202501",
      previousArtifactSha256:
        "a5e8f9f95462b43ca5f5f34679a6fe0e265010e5858d774da545f9f579f8c821",
      notComparedReason: null,
      noLongerEligibleCount: 1,
      candidates: {
        "124": {
          state: "BELOW_THRESHOLD",
          previousReleaseRecomputedScore: 40,
          scoreChange: 0,
          previousReleaseRecomputedRankPercentile: "0.000",
          rankPercentileChange: "0.000",
          materialChange: false,
        },
        "152": {
          state: "BELOW_THRESHOLD",
          previousReleaseRecomputedScore: 60,
          scoreChange: 0,
          previousReleaseRecomputedRankPercentile: "50.000",
          rankPercentileChange: "0.000",
          materialChange: false,
        },
        "484": {
          state: "MATERIAL_CHANGE",
          previousReleaseRecomputedScore: 55,
          scoreChange: 15,
          previousReleaseRecomputedRankPercentile: "25.000",
          rankPercentileChange: "50.000",
          materialChange: true,
        },
        "528": {
          state: "BELOW_THRESHOLD",
          previousReleaseRecomputedScore: 85,
          scoreChange: -5,
          previousReleaseRecomputedRankPercentile: "100.000",
          rankPercentileChange: "0.000",
          materialChange: false,
        },
        "710": {
          state: "NEWLY_ELIGIBLE",
          previousReleaseRecomputedScore: null,
          scoreChange: null,
          previousReleaseRecomputedRankPercentile: null,
          rankPercentileChange: null,
          materialChange: null,
        },
      },
    });
  });

  it.each([
    [70, "50.000", 60, "50.000", "MATERIAL_CHANGE"],
    [69, "50.000", 60, "50.000", "BELOW_THRESHOLD"],
    [60, "65.000", 60, "50.000", "MATERIAL_CHANGE"],
    [60, "64.9996", 60, "50.000", "BELOW_THRESHOLD"],
  ] as const)(
    "uses unrounded inclusive materiality thresholds",
    (
      currentScore,
      currentRankPercentile,
      previousScore,
      previousRankPercentile,
      expectedState,
    ) => {
      const comparison = compareReleaseRevisions({
        currentRelease: {
          ...currentRelease,
          candidates: [
            {
              code: "484",
              score: currentScore,
              rankPercentile: currentRankPercentile,
            },
          ],
        },
        previousArtifact: {
          ...previousArtifact,
          recomputedCandidates: [
            {
              code: "484",
              score: previousScore,
              rankPercentile: previousRankPercentile,
            },
          ],
        },
      });

      expect(comparison.candidates["484"]!.state).toBe(expectedState);
    },
  );

  it.each([
    [null, "NO_PREVIOUS_ARTIFACT", null, null],
    [
      { ...previousArtifact, hsRevision: "HS17" },
      "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
      null,
      null,
    ],
    [
      {
        ...previousArtifact,
        scoreWindowUsed: { start: 2018, end: 2022 },
      },
      "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
      null,
      null,
    ],
    [
      {
        ...previousArtifact,
        availableYears: [2019, 2020, 2021, 2022],
      },
      "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
      "V202501",
      previousArtifact.artifactSha256,
    ],
  ] as const)(
    "reports not-compared reason %s without inventing deltas",
    (
      assessedArtifact,
      expectedReason,
      expectedRelease,
      expectedArtifactSha256,
    ) => {
      const comparison = compareReleaseRevisions({
        currentRelease,
        previousArtifact: assessedArtifact,
      });

      expect(comparison).toMatchObject({
        comparisonRelease: expectedRelease,
        previousArtifactSha256: expectedArtifactSha256,
        notComparedReason: expectedReason,
        noLongerEligibleCount: null,
      });
      expect(comparison.candidates["484"]).toEqual({
        state: "NOT_COMPARED",
        previousReleaseRecomputedScore: null,
        scoreChange: null,
        previousReleaseRecomputedRankPercentile: null,
        rankPercentileChange: null,
        materialChange: null,
      });
    },
  );

  it("attaches same-window revisions without changing current score or provisional evidence", () => {
    const baseline = computeCmsV1(CORE_CURRENT_INPUT);
    const currentByCode = new Map(
      baseline.candidates.map((candidate) => [
        candidate.economy.code,
        candidate,
      ]),
    );
    const revised = computeCmsV1(CORE_CURRENT_INPUT, {
      baciRelease: "V202501",
      artifactSha256: previousArtifact.artifactSha256,
      hsRevision: "HS12",
      scoreVersion: "cms-v1",
      availableYears: [2019, 2020, 2021, 2022, 2023],
      scoreWindowUsed: { start: 2019, end: 2023 },
      recomputedCandidates: [
        ...baseline.candidates
          .filter(({ economy }) => economy.code !== "710")
          .map((candidate) => ({
            code: candidate.economy.code,
            score:
              candidate.economy.code === "484"
                ? candidate.score - 10
                : candidate.score,
            rankPercentile:
              candidate.economy.code === "484"
                ? Number(candidate.rankPercentile) - 15
                : Number(candidate.rankPercentile),
          })),
        { code: "999", score: 50, rankPercentile: 50 },
      ],
    });

    expect(
      revised.candidates.find(({ economy }) => economy.code === "484")
        ?.releaseRevision.state,
    ).toBe("MATERIAL_CHANGE");
    expect(
      revised.candidates.find(({ economy }) => economy.code === "710")
        ?.releaseRevision.state,
    ).toBe("NEWLY_ELIGIBLE");
    expect(revised.releaseRevisionSummary.noLongerEligibleCount).toBe(1);
    expect(
      revised.candidates.map((candidate) => ({
        code: candidate.economy.code,
        score: candidate.score,
        rank: candidate.rank,
        confidence: candidate.confidence,
        provisionalEvidence: candidate.provisionalEvidence,
      })),
    ).toEqual(
      baseline.candidates.map((candidate) => ({
        code: candidate.economy.code,
        score: candidate.score,
        rank: candidate.rank,
        confidence: candidate.confidence,
        provisionalEvidence: candidate.provisionalEvidence,
      })),
    );
    expect(
      revised.candidates.find(({ economy }) => economy.code === "484")
        ?.provisionalEvidence,
    ).toEqual(currentByCode.get("484")?.provisionalEvidence);
  });

  it("rejects an artifact bound to a different BACI Release before scoring", () => {
    expect(() =>
      computeCmsV1({
        ...CORE_CURRENT_INPUT,
        artifact: {
          ...CORE_CURRENT_INPUT.artifact,
          baciRelease: "V202501",
        },
      }),
    ).toThrow("A Candidate Market Score cannot mix BACI Releases.");
  });
});
