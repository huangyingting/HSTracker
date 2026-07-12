import { parseArgs } from "node:util";

import {
  CepiiBaciReleaseSource,
  SourceMonitor,
} from "../../src/release/source-monitor";
import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
import { writeReleaseCommandError } from "./release-command";

const SOURCE_CHECK_TIMEOUT_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "checked-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const checkedAt = values["checked-at"] ?? currentUtcSecond();
  const objectStore = createPromotionReleaseObjectStore();
  const deployment = await new ReleasePublisher(
    objectStore,
  ).current();
  if (deployment === null) {
    throw new Error(
      "CEPII source monitoring requires an active deployment.",
    );
  }
  const monitor = new SourceMonitor({
    source: new CepiiBaciReleaseSource(),
    statuses: new SourceStatusPublisher(objectStore),
    observe(event) {
      process.stderr.write(
        `${JSON.stringify({
          event: event.type,
          checkedAt: event.checkedAt,
          diagnostic: privateDiagnostic(event.error),
        })}\n`,
      );
    },
  });
  const result = await monitor.check({
    servedBaciRelease: deployment.baciRelease,
    checkedAt,
    signal: AbortSignal.timeout(SOURCE_CHECK_TIMEOUT_MS),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("CEPII source check", error);
});

function currentUtcSecond(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function privateDiagnostic(error: unknown): {
  name: string;
  message: string;
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}
