import type { TradeTrendV1Payload } from "../domain/trade-analytics/trade-trend-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";

export class TradeTrendExportContextError extends TypeError {
  constructor(readonly binding: string) {
    super(`Trade Trend export has an incompatible ${binding} binding.`);
    this.name = "TradeTrendExportContextError";
  }
}

export function assertTradeTrendExportContext(
  result: TradeTrendV1Payload,
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
      result.provenance.finalizedWindow.end,
      manifest.source.finalizedCutoffYear,
      "finalized cutoff year",
    ],
    [
      result.provenance.provisionalYear,
      manifest.source.provisionalYear,
      "provisional year",
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
      manifest.freshness.servedBaciRelease,
      result.provenance.baciRelease,
      "freshness served release",
    ],
  ];
  const mismatch = bindings.find(([left, right]) => left !== right);
  if (mismatch !== undefined) {
    throw new TradeTrendExportContextError(mismatch[2]);
  }
}
