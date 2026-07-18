import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { FilesystemReleaseObjectStore } from "../../src/release/filesystem-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";

/**
 * Assemble a filesystem release object store from already-built real release
 * candidates (analysis artifact + product catalog + optional opportunity index)
 * so the production container can be stood up over loopback for genuine
 * local-machine-class gate measurement (issue #30).
 *
 * This is a measurement-environment assembly step. It publishes real, mutually
 * paired candidates directly through ReleasePublisher.promote; it is NOT the
 * gated release:promote activation (which requires an accepted promotion input).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "object-store": { type: "string" },
      analysis: { type: "string" },
      catalog: { type: "string" },
      "opportunity-index": { type: "string" },
      "activated-at": { type: "string" },
    },
  });

  const objectStoreDirectory = required(values["object-store"], "object-store");
  const analysisDirectoryPath = required(values.analysis, "analysis");
  const productCatalogDirectoryPath = required(values.catalog, "catalog");
  const opportunityIndexDirectoryPath = values["opportunity-index"];
  const activatedAt = values["activated-at"] ?? new Date().toISOString();

  const objectStore = new FilesystemReleaseObjectStore({
    directory: resolve(objectStoreDirectory),
  });
  const publisher = new ReleasePublisher(objectStore);
  const published = await publisher.promote({
    analysisDirectoryPath: resolve(analysisDirectoryPath),
    productCatalogDirectoryPath: resolve(productCatalogDirectoryPath),
    ...(opportunityIndexDirectoryPath === undefined
      ? {}
      : { opportunityIndexDirectoryPath: resolve(opportunityIndexDirectoryPath) }),
    activatedAt,
  });
  process.stdout.write(`${JSON.stringify(published, null, 2)}\n`);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
