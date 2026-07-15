import type { TradeExplorerV1Payload } from "../domain/trade-analytics/trade-explorer-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";

export class TradeExplorerExportContextError extends TypeError {
  constructor(readonly binding: string) {
    super(`Trade Explorer export has an incompatible ${binding} binding.`);
    this.name = "TradeExplorerExportContextError";
  }
}

export function assertTradeExplorerExportContext(
  result: TradeExplorerV1Payload,
  manifest: CurrentAnalysisManifest,
): void {
  const bindings: readonly (readonly [unknown, unknown, string])[] = [
    [result.analysisBuildId, manifest.analysisBuildId, "analysis build"],
    [
      result.datasetPackageIdentity,
      manifest.recommendation.tradeExplorer?.datasetPackageIdentity ?? null,
      "Dataset Package",
    ],
    [
      result.analysisReleaseCatalogSha256,
      manifest.analysisReleaseCatalogSha256,
      "analysis release catalog",
    ],
    [result.provenance.baciRelease, manifest.source.baciRelease, "BACI Release"],
    [
      result.provenance.sourceUpdateDate,
      manifest.source.sourceUpdateDate,
      "source update date",
    ],
    [result.provenance.hsRevision, manifest.source.hsRevision, "source HS revision"],
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
    throw new TradeExplorerExportContextError(mismatch[2]);
  }
}
