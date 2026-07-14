import {
  CandidateMarketAnalysisError,
} from "../candidate-market/errors";
import { computeCmsV1 } from "../candidate-market/cms-v1";
import type {
  CandidateMarketV1RecipeInput,
  CandidateMarketResult,
} from "../candidate-market/result";
import type {
  TradeEvidenceLoadOptions,
  TradeEvidenceSource,
} from "../../evidence/trade-evidence-source";
import type { ReleaseRevisionPreviousArtifact } from "../release/release-revision";

export type CandidateMarketV1PreviousReleaseEvidence = {
  source: TradeEvidenceSource;
  baciRelease: string;
  artifactSha256: string;
  hsRevision: "HS12";
  availableYears: readonly number[];
};

type CandidateMarketV1RecipeExecution = (
  query: CandidateMarketV1RecipeInput,
  options?: TradeEvidenceLoadOptions,
) => Promise<CandidateMarketResult>;

export function createCandidateMarketV1RecipeExecution(
  evidenceSource: TradeEvidenceSource,
  previousRelease: CandidateMarketV1PreviousReleaseEvidence | null,
): CandidateMarketV1RecipeExecution {
  return async (query, options) => {
    options?.signal?.throwIfAborted();
    const inputs = await evidenceSource.loadCmsV1Inputs(query, options);
    options?.signal?.throwIfAborted();
    const previousArtifact =
      previousRelease === null
        ? null
        : previousRelease.baciRelease === inputs.release.baciRelease
          ? unrecomputedPreviousArtifact(
              inputs.release.finalizedCutoffYear,
              previousRelease,
            )
          : await loadPreviousArtifact(
              query,
              inputs.release.finalizedCutoffYear,
              previousRelease,
              options,
            );
    options?.signal?.throwIfAborted();
    return computeCmsV1(inputs, previousArtifact);
  };
}

function unrecomputedPreviousArtifact(
  currentFinalizedCutoffYear: number,
  previous: CandidateMarketV1PreviousReleaseEvidence,
): ReleaseRevisionPreviousArtifact {
  return {
    baciRelease: previous.baciRelease,
    artifactSha256: previous.artifactSha256,
    hsRevision: previous.hsRevision,
    scoreVersion: "cms-v1",
    availableYears: previous.availableYears,
    scoreWindowUsed: {
      start: currentFinalizedCutoffYear - 4,
      end: currentFinalizedCutoffYear,
    },
    recomputedCandidates: [],
  };
}

async function loadPreviousArtifact(
  query: CandidateMarketV1RecipeInput,
  currentFinalizedCutoffYear: number,
  previous: CandidateMarketV1PreviousReleaseEvidence,
  options?: TradeEvidenceLoadOptions,
): Promise<ReleaseRevisionPreviousArtifact> {
  const scoreWindow = {
    start: currentFinalizedCutoffYear - 4,
    end: currentFinalizedCutoffYear,
  };
  let recomputedCandidates: ReleaseRevisionPreviousArtifact["recomputedCandidates"] =
    [];
  try {
    const inputs = await previous.source.loadCmsV1Inputs(query, options);
    if (
      inputs.release.baciRelease !== previous.baciRelease ||
      inputs.release.hsRevision !== previous.hsRevision ||
      inputs.artifact.sha256 !== previous.artifactSha256
    ) {
      throw new TypeError(
        "Previous release evidence does not match its artifact identity.",
      );
    }
    const result = computeCmsV1({
      ...inputs,
      marketYears: [
        ...inputs.marketYears,
        ...inputs.provisionalMarketYears,
      ],
      release: {
        ...inputs.release,
        finalizedCutoffYear: currentFinalizedCutoffYear,
      },
    });
    recomputedCandidates = result.candidates.map((candidate) => ({
      code: candidate.economy.code,
      score: candidate.score,
      rankPercentile: candidate.rankPercentile,
    }));
  } catch (error) {
    if (
      !(error instanceof CandidateMarketAnalysisError) ||
      (error.code !== "UNKNOWN_EXPORTER" &&
        error.code !== "UNKNOWN_PRODUCT")
    ) {
      throw error;
    }
  }
  return {
    baciRelease: previous.baciRelease,
    artifactSha256: previous.artifactSha256,
    hsRevision: previous.hsRevision,
    scoreVersion: "cms-v1",
    availableYears: previous.availableYears,
    scoreWindowUsed: scoreWindow,
    recomputedCandidates,
  };
}
