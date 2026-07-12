import { parseArgs } from "node:util";

import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import {
  ReleasePublisher,
  type PublishedDeployment,
} from "../../src/release/release-publication";
import { compareBaciReleases } from "../../src/release/source-monitor";
import {
  SourceStatusPublisher,
  type PublishedSourceStatusSnapshot,
} from "../../src/release/source-status-publication";
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
  const currentDeployment = await publisher.current();
  const activatedAt = requiredOption(
    values["activated-at"],
    "activated-at",
  );
  const published = await publisher.promote({
    analysisDirectoryPath: requiredOption(
      values["analysis-directory"],
      "analysis-directory",
    ),
    productCatalogDirectoryPath: requiredOption(
      values["product-catalog-directory"],
      "product-catalog-directory",
    ),
    activatedAt,
  });
  if (
    currentDeployment?.deploymentPairingId !==
      published.deploymentPairingId
  ) {
    const currentStatus = await statuses.current();
    await statuses.publish(
      promotedSourceFreshnessStatus(
        currentStatus,
        published,
        activatedAt,
      ),
    );
  }
  process.stdout.write(`${JSON.stringify(published)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release promotion", error);
});

function promotedSourceFreshnessStatus(
  current: PublishedSourceStatusSnapshot | null,
  published: PublishedDeployment,
  activatedAt: string,
) {
  if (current === null) {
    return {
      checkedAt: activatedAt,
      servedBaciRelease: published.baciRelease,
      latestKnownBaciRelease: published.baciRelease,
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: activatedAt,
    } as const;
  }
  const promotedReleaseIsNewer =
    published.baciRelease !== current.latestKnownBaciRelease &&
    compareBaciReleases(
      published.baciRelease,
      current.latestKnownBaciRelease,
    ) > 0;
  const latestKnownBaciRelease = promotedReleaseIsNewer
    ? published.baciRelease
    : current.latestKnownBaciRelease;
  const promotedReleaseIsLatest =
    published.baciRelease === latestKnownBaciRelease;
  return {
    checkedAt: promotedReleaseIsNewer
      ? activatedAt
      : current.checkedAt,
    servedBaciRelease: published.baciRelease,
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
