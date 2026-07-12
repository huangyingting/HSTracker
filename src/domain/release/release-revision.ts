export const RELEASE_REVISION_NOT_COMPARED_REASONS = [
  "NO_PREVIOUS_ARTIFACT",
  "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
  "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
] as const;

export type ReleaseRevisionNotComparedReason =
  (typeof RELEASE_REVISION_NOT_COMPARED_REASONS)[number];

export type CandidateReleaseRevisionState =
  "NOT_COMPARED" | "BELOW_THRESHOLD" | "MATERIAL_CHANGE" | "NEWLY_ELIGIBLE";

export type CandidateReleaseRevision = {
  state: CandidateReleaseRevisionState;
  previousReleaseRecomputedScore: number | null;
  scoreChange: number | null;
  previousReleaseRecomputedRankPercentile: string | null;
  rankPercentileChange: string | null;
  materialChange: boolean | null;
};

export type ReleaseCandidateSnapshot = {
  code: string;
  score: number;
  rankPercentile: number | string;
};

export type ReleaseRevisionPreviousArtifact = {
  baciRelease: string;
  artifactSha256: string;
  hsRevision: string;
  scoreVersion: string;
  availableYears: readonly number[];
  scoreWindowUsed: { start: number; end: number };
  recomputedCandidates: readonly ReleaseCandidateSnapshot[];
};

export type ReleaseRevisionComparisonInput = {
  currentRelease: {
    baciRelease: string;
    hsRevision: string;
    scoreVersion: string;
    scoreWindow: { start: number; end: number };
    candidates: readonly ReleaseCandidateSnapshot[];
  };
  previousArtifact: ReleaseRevisionPreviousArtifact | null;
};

export type ReleaseRevisionComparisonIdentity = {
  comparisonRelease: string | null;
  previousArtifactSha256: string | null;
  notComparedReason: ReleaseRevisionNotComparedReason | null;
};

export type ReleaseRevisionComparison = ReleaseRevisionComparisonIdentity & {
  noLongerEligibleCount: number | null;
  candidates: Readonly<Record<string, CandidateReleaseRevision>>;
};

export function compareReleaseRevisions({
  currentRelease,
  previousArtifact,
}: ReleaseRevisionComparisonInput): ReleaseRevisionComparison {
  if (previousArtifact === null) {
    return notCompared(currentRelease.candidates, "NO_PREVIOUS_ARTIFACT");
  }
  if (
    previousArtifact.baciRelease === currentRelease.baciRelease ||
    previousArtifact.hsRevision !== currentRelease.hsRevision ||
    previousArtifact.scoreVersion !== currentRelease.scoreVersion ||
    previousArtifact.scoreWindowUsed.start !==
      currentRelease.scoreWindow.start ||
    previousArtifact.scoreWindowUsed.end !== currentRelease.scoreWindow.end
  ) {
    return notCompared(
      currentRelease.candidates,
      "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
    );
  }

  const requiredYears = yearsBetween(
    currentRelease.scoreWindow.start,
    currentRelease.scoreWindow.end,
  );
  if (
    requiredYears.some(
      (year) => !previousArtifact.availableYears.includes(year),
    )
  ) {
    return notCompared(
      currentRelease.candidates,
      "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
      previousArtifact,
    );
  }

  const previousByCode = new Map(
    previousArtifact.recomputedCandidates.map((candidate) => [
      candidate.code,
      candidate,
    ]),
  );
  const currentCodes = new Set(
    currentRelease.candidates.map((candidate) => candidate.code),
  );
  const candidates = Object.fromEntries(
    currentRelease.candidates.map((current) => {
      const previous = previousByCode.get(current.code);
      if (previous === undefined) {
        return [current.code, newlyEligible()] as const;
      }
      const scoreChange = current.score - previous.score;
      const rankPercentileChange =
        Number(current.rankPercentile) - Number(previous.rankPercentile);
      const materialChange =
        Math.abs(scoreChange) >= 10 || Math.abs(rankPercentileChange) >= 15;
      return [
        current.code,
        {
          state: materialChange ? "MATERIAL_CHANGE" : "BELOW_THRESHOLD",
          previousReleaseRecomputedScore: previous.score,
          scoreChange,
          previousReleaseRecomputedRankPercentile: formatRankPercentile(
            previous.rankPercentile,
          ),
          rankPercentileChange: formatDelta(rankPercentileChange),
          materialChange,
        },
      ] as const;
    }),
  );

  return {
    comparisonRelease: previousArtifact.baciRelease,
    previousArtifactSha256: previousArtifact.artifactSha256,
    notComparedReason: null,
    noLongerEligibleCount: previousArtifact.recomputedCandidates.filter(
      ({ code }) => !currentCodes.has(code),
    ).length,
    candidates,
  };
}

function notCompared(
  currentCandidates: readonly ReleaseCandidateSnapshot[],
  reason: ReleaseRevisionNotComparedReason,
  assessedArtifact?: NonNullable<
    ReleaseRevisionComparisonInput["previousArtifact"]
  >,
): ReleaseRevisionComparison {
  return {
    comparisonRelease: assessedArtifact?.baciRelease ?? null,
    previousArtifactSha256: assessedArtifact?.artifactSha256 ?? null,
    notComparedReason: reason,
    noLongerEligibleCount: null,
    candidates: Object.fromEntries(
      currentCandidates.map(({ code }) => [
        code,
        emptyRevision("NOT_COMPARED"),
      ]),
    ),
  };
}

function newlyEligible(): CandidateReleaseRevision {
  return emptyRevision("NEWLY_ELIGIBLE");
}

function emptyRevision(
  state: "NOT_COMPARED" | "NEWLY_ELIGIBLE",
): CandidateReleaseRevision {
  return {
    state,
    previousReleaseRecomputedScore: null,
    scoreChange: null,
    previousReleaseRecomputedRankPercentile: null,
    rankPercentileChange: null,
    materialChange: null,
  };
}

function yearsBetween(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatDelta(value: number): string {
  return (Object.is(value, -0) ? 0 : value).toFixed(3);
}

function formatRankPercentile(value: number | string): string {
  return Number(value).toFixed(3);
}
