import { parseArgs } from "node:util";

import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
import { SourceRefreshOrchestrator } from "../../src/release/source-refresh";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
import {
  requiredOption,
  writeReleaseCommandError,
} from "./release-command";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "activated-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const objectStore = createPromotionReleaseObjectStore();
  const published = await new SourceRefreshOrchestrator({
    deployments: new ReleasePublisher(objectStore),
    statuses: new SourceStatusPublisher(objectStore),
    async build() {
      throw new Error("Rollback cannot invoke a release build.");
    },
  }).rollback({
    activatedAt: requiredOption(values["activated-at"], "activated-at"),
  });
  process.stdout.write(`${JSON.stringify(published.deployment)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release rollback", error);
});
