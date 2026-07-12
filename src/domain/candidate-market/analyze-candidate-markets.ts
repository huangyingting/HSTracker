import {
  CandidateMarketAnalysisError,
  invalidAnalysisQuery,
} from "./errors";
import { computeCmsV1 } from "./cms-v1";
import type {
  CandidateMarketAnalysisQuery,
  CandidateMarketResult,
} from "./result";
import type { TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import type { ReleaseRevisionPreviousArtifact } from "../release/release-revision";

export interface CandidateMarketAnalysis {
  analyze(query: CandidateMarketAnalysisQuery): Promise<CandidateMarketResult>;
}

export type PreviousReleaseEvidence = {
  source: TradeEvidenceSource;
  baciRelease: string;
  artifactSha256: string;
  hsRevision: "HS12";
  availableYears: readonly number[];
};

export class CmsV1CandidateMarketAnalysis implements CandidateMarketAnalysis {
  constructor(
    private readonly evidenceSource: TradeEvidenceSource,
    private readonly previousRelease: PreviousReleaseEvidence | null = null,
  ) {}

  async analyze(
    query: CandidateMarketAnalysisQuery,
  ): Promise<CandidateMarketResult> {
    validateQuery(query);
    const inputs = await this.evidenceSource.loadCmsV1Inputs(query);
    const previousArtifact =
      this.previousRelease === null
        ? null
        : await loadPreviousArtifact(
            query,
            inputs.release.finalizedCutoffYear,
            this.previousRelease,
          );
    return computeCmsV1(inputs, previousArtifact);
  }
}

async function loadPreviousArtifact(
  query: CandidateMarketAnalysisQuery,
  currentFinalizedCutoffYear: number,
  previous: PreviousReleaseEvidence,
): Promise<ReleaseRevisionPreviousArtifact> {
  const scoreWindow = {
    start: currentFinalizedCutoffYear - 4,
    end: currentFinalizedCutoffYear,
  };
  let recomputedCandidates: ReleaseRevisionPreviousArtifact["recomputedCandidates"] =
    [];
  try {
    const inputs = await previous.source.loadCmsV1Inputs(query);
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

function validateQuery(query: CandidateMarketAnalysisQuery) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(query.analysisBuildId)) {
    throw invalidAnalysisQuery("analysisBuildId is malformed.");
  }

  if (!/^[0-9]{1,3}$/.test(query.exporterCode)) {
    throw invalidAnalysisQuery("exporterCode must be a BACI economy code.");
  }

  if (!/^[0-9]{6}$/.test(query.productCode)) {
    throw invalidAnalysisQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
}
