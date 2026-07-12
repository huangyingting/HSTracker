import { parseArgs } from "node:util";

import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
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
  const currentStatus = await statuses.current();
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
  if (currentStatus === null) {
    await statuses.publish({
      checkedAt: activatedAt,
      servedBaciRelease: published.baciRelease,
      latestKnownBaciRelease: published.baciRelease,
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: activatedAt,
    });
  }
  process.stdout.write(`${JSON.stringify(published)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release promotion", error);
});
