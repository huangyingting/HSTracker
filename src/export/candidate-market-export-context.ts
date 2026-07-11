import type { CandidateMarketResult } from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";

export class CandidateMarketExportContextError extends TypeError {
  constructor(readonly binding: string) {
    super(`Candidate Market export has an incompatible ${binding} binding.`);
    this.name = "CandidateMarketExportContextError";
  }
}

export function assertCandidateMarketExportContext(
  result: CandidateMarketResult,
  manifest: CurrentAnalysisManifest,
): void {
  const bindings: readonly (readonly [unknown, unknown, string])[] = [
    [result.analysisBuildId, manifest.analysisBuildId, "analysis build"],
    [
      result.analysisReleaseCatalogSha256,
      manifest.analysisReleaseCatalogSha256,
      "analysis release catalog",
    ],
    [
      result.provenance.baciRelease,
      manifest.source.baciRelease,
      "BACI Release",
    ],
    [
      result.provenance.sourceUpdateDate,
      manifest.source.sourceUpdateDate,
      "source update date",
    ],
    [
      result.provenance.hsRevision,
      manifest.source.hsRevision,
      "source HS revision",
    ],
    [
      result.provenance.ingestedYears.start,
      manifest.source.ingestedYears.start,
      "ingested start year",
    ],
    [
      result.provenance.ingestedYears.end,
      manifest.source.ingestedYears.end,
      "ingested end year",
    ],
    [
      result.provenance.finalizedCutoffYear,
      manifest.source.finalizedCutoffYear,
      "finalized cutoff year",
    ],
    [
      result.provenance.scoreWindow.start,
      manifest.source.windows.score.start,
      "score-window start",
    ],
    [
      result.provenance.scoreWindow.end,
      manifest.source.windows.score.end,
      "score-window end",
    ],
    [
      result.provenance.provisionalYear,
      manifest.source.provisionalYear,
      "provisional year",
    ],
    [
      result.provenance.scoreVersion,
      manifest.source.scoreVersion,
      "score version",
    ],
    [
      result.provenance.artifactBuildId,
      manifest.source.artifact.buildId,
      "artifact build",
    ],
    [
      result.provenance.artifactSchemaVersion,
      manifest.source.artifact.schemaVersion,
      "artifact schema",
    ],
    [
      result.provenance.artifactSha256,
      manifest.source.artifact.sha256,
      "artifact digest",
    ],
    [
      result.releaseRevisionSummary.comparisonRelease,
      manifest.revisionComparison.comparisonRelease,
      "revision comparison release",
    ],
    [
      result.releaseRevisionSummary.previousArtifactSha256,
      manifest.revisionComparison.previousArtifactSha256,
      "previous artifact digest",
    ],
    [
      result.releaseRevisionSummary.notComparedReason,
      manifest.revisionComparison.notComparedReason,
      "revision comparison reason",
    ],
    [
      manifest.freshness.servedBaciRelease,
      result.provenance.baciRelease,
      "freshness served release",
    ],
  ];
  const mismatch = bindings.find(([left, right]) => left !== right);
  if (mismatch !== undefined) {
    throw new CandidateMarketExportContextError(mismatch[2]);
  }
}
