import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAX_RELEASE_METADATA_BYTES } from "../release/release-manifest";
import {
  record,
  string,
  utcTimestamp,
} from "../release/release-validation";
import type { PromotionIdentity } from "./promotion-report";

export async function verifyPromotionReleaseCandidates(
  identity: Pick<
    PromotionIdentity,
    "baciRelease" | "artifactSha256" | "productSearchBuildId"
  >,
  analysisDirectoryPath: string,
  productCatalogDirectoryPath: string,
): Promise<{ baciRelease: string; builtAt: string }> {
  const [analysisBytes, catalogBytes] = await Promise.all([
    readMetadata(
      join(analysisDirectoryPath, "artifact-manifest.json"),
      "Analysis artifact manifest",
    ),
    readMetadata(
      join(productCatalogDirectoryPath, "catalog-manifest.json"),
      "Product catalog manifest",
    ),
  ]);
  const analysis = record(
    JSON.parse(analysisBytes.toString("utf8")),
    "analysis artifact manifest",
  );
  const artifact = record(
    analysis.artifact,
    "analysis artifact identity",
  );
  const catalog = record(
    JSON.parse(catalogBytes.toString("utf8")),
    "product catalog manifest",
  );
  const baciRelease = string(
    analysis.baciRelease,
    "analysis BACI Release",
  );
  const builtAt = utcTimestamp(
    analysis.builtAt,
    "analysis build time",
  );
  if (
    identity.baciRelease !== baciRelease ||
    identity.baciRelease !==
      string(catalog.baciRelease, "product catalog BACI Release") ||
    identity.artifactSha256 !==
      string(artifact.sha256, "analysis artifact SHA-256") ||
    identity.productSearchBuildId !==
      string(
        catalog.productSearchBuildId,
        "product-search build ID",
      )
  ) {
    throw new Error(
      "Accepted promotion evidence does not identify the release candidates.",
    );
  }
  return { baciRelease, builtAt };
}

async function readMetadata(
  path: string,
  label: string,
): Promise<Buffer> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
    throw new Error(`${label} is oversized.`);
  }
  return bytes;
}
