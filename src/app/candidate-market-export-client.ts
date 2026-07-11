import type { CandidateMarketResult } from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { candidateMarketCsvUrl } from "../export/candidate-market-csv-contract";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";

export class CandidateMarketExportPreparationError extends Error {
  readonly code = "STALE_ANALYSIS";

  constructor(
    message: string,
    readonly manifest: CurrentAnalysisManifest,
  ) {
    super(message);
    this.name = "CandidateMarketExportPreparationError";
  }
}

export async function prepareCandidateMarketExport({
  result,
  fetcher,
  signal,
}: {
  result: CandidateMarketResult;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<{ manifest: CurrentAnalysisManifest; url: string }> {
  const manifest = await loadCurrentAnalysisManifest({
    fetcher,
    signal,
    revalidate: true,
  });
  validateManifestCompatibility(result, manifest);

  return {
    manifest,
    url: candidateMarketCsvUrl({
      analysisBuildId: result.analysisBuildId,
      exporterCode: result.query.exporter.code,
      productCode: result.query.product.code,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshness.freshnessStatusId,
    }),
  };
}

function validateManifestCompatibility(
  result: CandidateMarketResult,
  manifest: CurrentAnalysisManifest,
): void {
  const bindings: readonly (readonly [unknown, unknown])[] = [
    [result.analysisBuildId, manifest.analysisBuildId],
    [
      result.analysisReleaseCatalogSha256,
      manifest.analysisReleaseCatalogSha256,
    ],
    [result.provenance.baciRelease, manifest.source.baciRelease],
    [result.provenance.sourceUpdateDate, manifest.source.sourceUpdateDate],
    [result.provenance.hsRevision, manifest.source.hsRevision],
    [
      result.provenance.finalizedCutoffYear,
      manifest.source.finalizedCutoffYear,
    ],
    [result.provenance.scoreWindow.start, manifest.source.windows.score.start],
    [result.provenance.scoreWindow.end, manifest.source.windows.score.end],
    [result.provenance.provisionalYear, manifest.source.provisionalYear],
    [result.provenance.scoreVersion, manifest.source.scoreVersion],
    [result.provenance.artifactBuildId, manifest.source.artifact.buildId],
    [
      result.provenance.artifactSchemaVersion,
      manifest.source.artifact.schemaVersion,
    ],
    [result.provenance.artifactSha256, manifest.source.artifact.sha256],
    [
      manifest.freshness.servedBaciRelease,
      result.provenance.baciRelease,
    ],
  ];
  if (bindings.some(([left, right]) => left !== right)) {
    throw new CandidateMarketExportPreparationError(
      "The current analysis manifest no longer describes this Candidate Market result.",
      manifest,
    );
  }
}
