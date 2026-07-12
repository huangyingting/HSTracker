import { describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";

describe("source-status publication", () => {
  it("refuses to move the active pointer backward in publication time", async () => {
    const publisher = new SourceStatusPublisher(
      new InMemoryReleaseObjectStore(),
    );
    const accepted = await publisher.publish({
      checkedAt: "2026-03-02T00:00:00Z",
      servedBaciRelease: "V202601",
      latestKnownBaciRelease: "V202601",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-03-02T00:00:00Z",
    });

    await expect(
      publisher.publish({
        checkedAt: "2026-03-01T00:00:00Z",
        servedBaciRelease: "V202601",
        latestKnownBaciRelease: "V202601",
        newerReleaseDetectedAt: null,
        refreshFailed: false,
        rollbackActive: false,
        publishedAt: "2026-03-01T00:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "SourceStatusPublicationError",
      code: "STATUS_REGRESSION",
    });
    await expect(
      publisher.publish({
        checkedAt: "2026-03-01T00:00:00Z",
        servedBaciRelease: "V202601",
        latestKnownBaciRelease: "V202601",
        newerReleaseDetectedAt: null,
        refreshFailed: false,
        rollbackActive: false,
        publishedAt: "2026-03-03T00:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "SourceStatusPublicationError",
      code: "STATUS_REGRESSION",
    });
    await expect(publisher.current()).resolves.toEqual(accepted);
  });
});
