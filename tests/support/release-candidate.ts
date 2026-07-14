import { writeRuntimeReleaseCandidate } from "./runtime-release";

export type AcceptedReleaseCandidateOptions = {
  baciRelease?: string;
  sourceSha256?: string;
  sourceUpdateDate?: string;
  builtAt?: string;
  analysisArtifactBuildId?: string;
  analysisArtifactVersion?: string;
  productCatalogVersion?: string;
  productSearchBuildId?: string;
  productSourceArchiveSha256?: string;
  productManifestCatalogSchemaVersion?: string;
};

export async function writeAcceptedReleaseCandidate(
  root: string,
  options: AcceptedReleaseCandidateOptions = {},
): Promise<{
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
}> {
  return writeRuntimeReleaseCandidate(root, {
    baciRelease: options.baciRelease ?? "VTEST001",
    sourceSha256: options.sourceSha256,
    sourceUpdateDate: options.sourceUpdateDate,
    builtAt: options.builtAt,
    analysisArtifactBuildId: options.analysisArtifactBuildId,
    valueOffset:
      options.analysisArtifactVersion === "v2" ? 1 : 0,
    productCatalogVersion: options.productCatalogVersion,
    productSearchBuildId: options.productSearchBuildId,
    productSourceArchiveSha256:
      options.productSourceArchiveSha256,
    productManifestCatalogSchemaVersion:
      options.productManifestCatalogSchemaVersion,
  });
}
