import { parseArgs } from "node:util";

import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
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
  const publisher = new ReleasePublisher(
    createPromotionReleaseObjectStore(),
  );
  const published = await publisher.rollback({
    activatedAt: requiredOption(values["activated-at"], "activated-at"),
  });
  process.stdout.write(`${JSON.stringify(published)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("Release rollback", error);
});
