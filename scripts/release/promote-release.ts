import { parseArgs } from "node:util";

import { loadAcceptedPromotion } from "../../src/promotion/promotion-acceptance";
import { verifyPromotionReleaseCandidates } from "../../src/promotion/release-candidate-acceptance";
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
  requiredOption,
  writeReleaseCommandError,
} from "./release-command";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "analysis-directory": { type: "string" },
      "product-catalog-directory": { type: "string" },
      "opportunity-index-directory": { type: "string" },
      "activated-at": { type: "string" },
      "promotion-input": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
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
  const opportunityIndexDirectoryPath =
    values["opportunity-index-directory"];
  const promotionInputPath = requiredOption(
    values["promotion-input"],
    "promotion-input",
  );
  const promotion = await loadAcceptedPromotion(
    promotionInputPath,
    process.cwd(),
  );
  const candidateSource = await verifyPromotionReleaseCandidates(
    promotion.input.identity,
    analysisDirectoryPath,
    productCatalogDirectoryPath,
  );
  const objectStore = createPromotionReleaseObjectStore();
  const publisher = new ReleasePublisher(objectStore);
  const statuses = new SourceStatusPublisher(objectStore);
  const [currentDeployment, currentStatus] = await Promise.all([
    publisher.current(),
    statuses.current(),
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
    candidateSource.baciRelease,
    candidateSource.builtAt,
    activatedAt,
  );
  const published = await publisher.promote({
    analysisDirectoryPath,
    productCatalogDirectoryPath,
    ...(opportunityIndexDirectoryPath === undefined
      ? {}
      : { opportunityIndexDirectoryPath }),
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

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release promotion", error);
});

function promotedSourceFreshnessStatus(
  current: PublishedSourceStatusSnapshot | null,
  baciRelease: string,
  candidateBuiltAt: string,
  activatedAt: string,
) {
  if (current === null) {
    return {
      checkedAt: candidateBuiltAt,
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
    checkedAt: current.checkedAt,
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
