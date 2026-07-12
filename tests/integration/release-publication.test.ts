import {
  mkdtemp,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import type {
  ReleaseObject,
  ReleaseObjectIdentity,
  ReleaseObjectStore,
} from "../../src/release/release-object-store";
import { ReleaseHydrator } from "../../src/release/release-hydration";
import { ReleasePublisher } from "../../src/release/release-publication";
import { writeAcceptedReleaseCandidate } from "../fixtures/release-candidate";

describe("immutable release publication", () => {
  it("publishes and activates one exact compatible pairing", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );

    const published = await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    expect(published).toMatchObject({
      schemaVersion: "published-deployment-v1",
      deploymentPairingId: expect.stringMatching(
        /^deployment-pairing-v1-[a-f0-9]{16}$/u,
      ),
      analysisBuildId: expect.stringMatching(
        /^analysis-build-v1-[a-f0-9]{16}$/u,
      ),
      analysisReleaseCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      productSearchBuildId: "product-search-v1-1111111111111111",
      baciRelease: "VTEST001",
      activatedAt: "2026-07-12T02:00:00Z",
      previousDeploymentPairingId: null,
    });
    expect(await publisher.current()).toEqual(published);
  });

  it("keeps the active identity when the accepted inputs repeat", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );
    const first = await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const repeated = await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T03:00:00Z",
    });

    expect(repeated).toEqual(first);
    expect(await publisher.current()).toEqual(first);
  });

  it("keeps the analysis identity when only product-search content changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const translatedCandidate = await writeAcceptedReleaseCandidate(
      join(root, "translated"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const translated = await publisher.promote({
      ...translatedCandidate,
      activatedAt: "2026-07-12T03:00:00Z",
    });

    expect(translated.analysisBuildId).toBe(first.analysisBuildId);
    expect(translated.analysisReleaseCatalogSha256).toBe(
      first.analysisReleaseCatalogSha256,
    );
    expect(translated.productSearchBuildId).toBe(
      "product-search-v1-3333333333333333",
    );
    expect(translated.deploymentPairingId).not.toBe(
      first.deploymentPairingId,
    );
    expect(translated.previousDeploymentPairingId).toBe(
      first.deploymentPairingId,
    );
  });

  it.each([
    {
      mutation: "artifact bytes",
      options: { analysisArtifactVersion: "v2" },
    },
    {
      mutation: "artifact build ID",
      options: {
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-4444444444444444",
      },
    },
  ])(
    "keeps the product-search identity when only analysis $mutation change",
    async ({ options }) => {
      const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
      const firstCandidate = await writeAcceptedReleaseCandidate(
        join(root, "first"),
      );
      const refreshedCandidate = await writeAcceptedReleaseCandidate(
        join(root, "refreshed"),
        options,
      );
      const publisher = new ReleasePublisher(
        new InMemoryReleaseObjectStore(),
      );
      const first = await publisher.promote({
        ...firstCandidate,
        activatedAt: "2026-07-12T02:00:00Z",
      });

      const refreshed = await publisher.promote({
        ...refreshedCandidate,
        activatedAt: "2026-07-12T03:00:00Z",
      });

      expect(refreshed.productSearchBuildId).toBe(
        first.productSearchBuildId,
      );
      expect(refreshed.analysisBuildId).not.toBe(first.analysisBuildId);
      expect(refreshed.analysisReleaseCatalogSha256).not.toBe(
        first.analysisReleaseCatalogSha256,
      );
      expect(refreshed.deploymentPairingId).not.toBe(
        first.deploymentPairingId,
      );
      expect(refreshed.previousDeploymentPairingId).toBe(
        first.deploymentPairingId,
      );
    },
  );

  it("rolls back atomically to the retained previous pairing", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T03:00:00Z",
    });

    const rolledBack = await publisher.rollback({
      activatedAt: "2026-07-12T04:00:00Z",
    });

    expect(rolledBack).toEqual({
      ...first,
      activatedAt: "2026-07-12T04:00:00Z",
      previousDeploymentPairingId: second.deploymentPairingId,
    });
    expect(await publisher.current()).toEqual(rolledBack);
  });

  it("keeps the active pairing when uploaded bytes fail read-back verification", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const failingPublisher = new ReleasePublisher(
      new CorruptingReadbackStore(
        objectStore,
        "product-search-v1-3333333333333333",
      ),
    );

    await expect(
      failingPublisher.promote({
        ...secondCandidate,
        activatedAt: "2026-07-12T03:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "ReleasePublicationError",
      code: "OBJECT_READBACK_MISMATCH",
    });
    expect(await publisher.current()).toEqual(first);
  });

  it("rejects incompatible analysis and product-search candidates before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const incompatibleCandidate = await writeAcceptedReleaseCandidate(
      join(root, "incompatible"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
        productSourceArchiveSha256: "b".repeat(64),
      },
    );
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    await expect(
      publisher.promote({
        ...incompatibleCandidate,
        activatedAt: "2026-07-12T03:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "ReleasePublicationError",
      code: "PAIRING_INCOMPATIBLE",
    });
    expect(await publisher.current()).toEqual(first);
  });

  it("keeps the active pairing when atomic activation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const failingPublisher = new ReleasePublisher(
      new RejectingActivationStore(objectStore),
    );

    await expect(
      failingPublisher.promote({
        ...secondCandidate,
        activatedAt: "2026-07-12T03:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "ReleasePublicationError",
      code: "ACTIVATION_FAILED",
    });
    expect(await publisher.current()).toEqual(first);
  });

  it("rejects rollback until a previous pairing has been retained", async () => {
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );

    await expect(
      publisher.rollback({ activatedAt: "2026-07-12T04:00:00Z" }),
    ).rejects.toMatchObject({
      name: "ReleasePublicationError",
      code: "NO_PREVIOUS_DEPLOYMENT",
    });
    expect(await publisher.current()).toBeNull();
  });

  it("hydrates the active pairing through verified partial files and atomic rename", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const published = await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const volumePath = join(root, "volume");
    const hydrator = new ReleaseHydrator(objectStore);

    const hydrated = await hydrator.hydrateCurrent({ volumePath });

    expect(hydrated.deployment).toEqual(published);
    await expect(readFile(hydrated.analysisArtifactPath, "utf8")).resolves.toBe(
      "fixture DuckDB artifact v1",
    );
    await expect(readFile(hydrated.productCatalogPath, "utf8")).resolves.toBe(
      "fixture product catalog v1",
    );
    expect(await readdir(volumePath)).toEqual([
      published.deploymentPairingId,
    ]);
  });

  it("reuses unchanged analysis bytes and prunes retired pairing directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const hydrator = new ReleaseHydrator(objectStore);
    const firstHydrated = await hydrator.hydrateCurrent({ volumePath });
    const firstArtifact = await stat(
      firstHydrated.analysisArtifactPath,
    );
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const secondHydrated = await hydrator.hydrateCurrent({
      volumePath,
    });

    expect((await stat(secondHydrated.analysisArtifactPath)).ino).toBe(
      firstArtifact.ino,
    );
    expect(await readdir(volumePath)).toEqual([
      second.deploymentPairingId,
    ]);
    expect(second.deploymentPairingId).not.toBe(
      first.deploymentPairingId,
    );
  });

  it("reuses a retired current artifact as the next previous artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        analysisArtifactVersion: "v2",
        analysisArtifactBuildId:
          "candidate-market-artifact-v1-4444444444444444",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const hydrator = new ReleaseHydrator(objectStore);
    const firstHydrated = await hydrator.hydrateCurrent({ volumePath });
    const firstArtifact = await stat(
      firstHydrated.analysisArtifactPath,
    );
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const secondHydrated = await hydrator.hydrateCurrent({
      volumePath,
    });

    expect(secondHydrated.previousAnalysis).not.toBeNull();
    expect(
      (
        await stat(
          secondHydrated.previousAnalysis!.artifactPath,
        )
      ).ino,
    ).toBe(firstArtifact.ino);
    expect(await readdir(volumePath)).toEqual([
      second.deploymentPairingId,
    ]);
    expect(second.previousDeploymentPairingId).toBe(
      first.deploymentPairingId,
    );
  });

  it("removes partial hydration when downloaded bytes fail verification", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const volumePath = join(root, "volume");
    const hydrator = new ReleaseHydrator(
      new CorruptingReadbackStore(objectStore, "candidate-market.duckdb"),
    );

    await expect(
      hydrator.hydrateCurrent({ volumePath }),
    ).rejects.toMatchObject({
      name: "ReleaseHydrationError",
      code: "OBJECT_IDENTITY_MISMATCH",
    });
    expect(await readdir(volumePath)).toEqual([]);
  });
});

class CorruptingReadbackStore implements ReleaseObjectStore {
  constructor(
    private readonly delegate: ReleaseObjectStore,
    private readonly keyFragment: string,
  ) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    const stored = await this.delegate.getObject(key);
    if (stored === null || !key.includes(this.keyFragment)) {
      return stored;
    }
    return {
      body: oneChunk(Buffer.from("corrupt read-back", "utf8")),
      version: stored.version,
    };
  }

  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    await this.delegate.putImmutable(key, body, identity);
  }

  async compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string> {
    return this.delegate.compareAndSwap(key, expectedVersion, body);
  }
}

class RejectingActivationStore implements ReleaseObjectStore {
  constructor(private readonly delegate: ReleaseObjectStore) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    return this.delegate.getObject(key);
  }

  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    await this.delegate.putImmutable(key, body, identity);
  }

  async compareAndSwap(): Promise<string> {
    throw new Error("fixture activation failure");
  }
}

async function* oneChunk(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}
