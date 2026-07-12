import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { MAX_RELEASE_METADATA_BYTES } from "../../src/release/release-manifest";
import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
import { compareBaciReleases } from "../../src/release/source-monitor";
import {
  createPublishedSourceStatusSnapshot,
  sourceStatusSnapshot,
  SourceStatusPublisher,
  type PublishedSourceStatusSnapshot,
} from "../../src/release/source-status-publication";
import {
  record,
  string,
} from "../../src/release/release-validation";
import {
  requiredOption,
  writeReleaseCommandError,
} from "./release-command";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "analysis-directory": { type: "string" },
      "product-catalog-directory": { type: "string" },
      "activated-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const objectStore = createPromotionReleaseObjectStore();
  const publisher = new ReleasePublisher(objectStore);
  const statuses = new SourceStatusPublisher(objectStore);
  const analysisDirectoryPath = requiredOption(
    values["analysis-directory"],
    "analysis-directory",
  );
  const productCatalogDirectoryPath = requiredOption(
    values["product-catalog-directory"],
    "product-catalog-directory",
  );
  const activatedAt = requiredOption(
    values["activated-at"],
    "activated-at",
  );
  const [currentDeployment, currentStatus, baciRelease] =
    await Promise.all([
      publisher.current(),
      statuses.current(),
      candidateBaciRelease(analysisDirectoryPath),
    ]);
  if (
    currentDeployment !== null &&
    currentStatus !== null &&
    currentStatus.servedBaciRelease !==
      currentDeployment.baciRelease
  ) {
    throw new Error(
      "Active deployment and Source Freshness Status are incompatible.",
    );
  }
  const statusInput = promotedSourceFreshnessStatus(
    currentStatus,
    baciRelease,
    activatedAt,
  );
  const published = await publisher.promote({
    analysisDirectoryPath,
    productCatalogDirectoryPath,
    sourceStatusFallback: sourceStatusSnapshot(
      createPublishedSourceStatusSnapshot(statusInput),
    ),
    activatedAt,
  });
  if (
    currentDeployment?.deploymentPairingId !==
      published.deploymentPairingId
  ) {
    await statuses.publish(statusInput);
  }
  process.stdout.write(`${JSON.stringify(published)}\n`);
}

async function candidateBaciRelease(
  analysisDirectoryPath: string,
): Promise<string> {
  const bytes = await readFile(
    join(analysisDirectoryPath, "artifact-manifest.json"),
  );
  if (bytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
    throw new Error("Analysis artifact manifest is oversized.");
  }
  const manifest = record(
    JSON.parse(bytes.toString("utf8")),
    "analysis artifact manifest",
  );
  return string(manifest.baciRelease, "analysis BACI Release");
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release promotion", error);
});

function promotedSourceFreshnessStatus(
  current: PublishedSourceStatusSnapshot | null,
  baciRelease: string,
  activatedAt: string,
) {
  if (current === null) {
    return {
      checkedAt: activatedAt,
      servedBaciRelease: baciRelease,
      latestKnownBaciRelease: baciRelease,
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: activatedAt,
    } as const;
  }
  const promotedReleaseIsNewer =
    baciRelease !== current.latestKnownBaciRelease &&
    compareBaciReleases(
      baciRelease,
      current.latestKnownBaciRelease,
    ) > 0;
  const latestKnownBaciRelease = promotedReleaseIsNewer
    ? baciRelease
    : current.latestKnownBaciRelease;
  const promotedReleaseIsLatest =
    baciRelease === latestKnownBaciRelease;
  return {
    checkedAt: promotedReleaseIsNewer
      ? activatedAt
      : current.checkedAt,
    servedBaciRelease: baciRelease,
    latestKnownBaciRelease,
    newerReleaseDetectedAt: promotedReleaseIsLatest
      ? null
      : (current.newerReleaseDetectedAt ?? activatedAt),
    refreshFailed: promotedReleaseIsLatest
      ? false
      : current.refreshFailed,
    rollbackActive: promotedReleaseIsLatest
      ? false
      : current.rollbackActive,
    publishedAt: activatedAt,
  } as const;
}
