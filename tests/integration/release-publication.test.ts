import {
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  contentAddressedId,
  parseActiveDeploymentPointer,
  releaseJsonBytes,
} from "../../src/release/release-manifest";
import type {
  ReleaseObject,
  ReleaseObjectIdentity,
  ReleaseObjectStore,
} from "../../src/release/release-object-store";
import {
  releaseObjectIdentity,
  singleChunk,
} from "../../src/release/release-object-store";
import {
  ReleaseHydrator,
  RemoteCandidateActivationError,
} from "../../src/release/release-hydration";
import { ReleasePublisher } from "../../src/release/release-publication";
import { writeAcceptedReleaseCandidate } from "../support/release-candidate";
import { writeRuntimeReleaseCandidate } from "../support/runtime-release";

describe("immutable release publication", () => {
  it("publishes and activates one exact compatible pairing", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);

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
      recommendedDatasetMappingIdentity: expect.stringMatching(
        /^recommended-dataset-mapping-v1-[a-f0-9]{64}$/u,
      ),
    });
    expect(await publisher.current()).toEqual(published);
  });

  it("rejects a Source Freshness Status for another BACI Release before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );

    await expect(
      publisher.promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
        sourceStatusFallback: {
          schemaVersion: "source-status-v1",
          sourceStatusSnapshotId:
            "source-status-v1-0000000000000000",
          checkedAt: "2026-07-12T01:00:00Z",
          servedBaciRelease: "VTEST999",
          latestKnownBaciRelease: "VTEST999",
          newerReleaseDetectedAt: null,
          refreshFailed: false,
          rollbackActive: false,
          publishedAt: "2026-07-12T02:00:00Z",
        },
      }),
    ).rejects.toMatchObject({
      code: "PAIRING_INCOMPATIBLE",
    });
    await expect(publisher.current()).resolves.toBeNull();
  });

  it("keeps the active identity when the accepted inputs repeat", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
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
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
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

    expect(rolledBack).toMatchObject({
      analysisBuildId: first.analysisBuildId,
      productSearchBuildId: first.productSearchBuildId,
      baciRelease: first.baciRelease,
      activatedAt: "2026-07-12T04:00:00Z",
      previousDeploymentPairingId: second.deploymentPairingId,
      sourceStatusFallback: {
        servedBaciRelease: first.baciRelease,
        rollbackActive: true,
      },
    });
    expect(rolledBack.deploymentPairingId).not.toBe(
      first.deploymentPairingId,
    );
    expect(await publisher.current()).toEqual(rolledBack);
    const hydrated = await new ReleaseHydrator(
      objectStore,
    ).hydrateCurrent({
      volumePath: join(root, "volume"),
    });
    expect(hydrated.sourceStatusFallback).toEqual(
      hydrated.deploymentManifest.sourceStatusFallback,
    );
    expect(hydrated.sourceStatusFallback.rollbackActive).toBe(true);
  });

  it("keeps the active pointer when rollback target validation fails", async () => {
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
    await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    await activateLegacyDeploymentProjection(objectStore);
    const active = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    await expect(
      new ReleasePublisher(
        new CorruptingReadbackStore(
          objectStore,
          "candidate-market.duckdb",
        ),
      ).rollback({
        activatedAt: "2026-07-12T03:00:00Z",
      }),
    ).rejects.toMatchObject({
      code: "OBJECT_READBACK_MISMATCH",
    });
    await expect(publisher.current()).resolves.toEqual(active);
  }, 20_000);

  it.each([
    {
      target: "HEAD-era explicit-capability",
      legacyDatasetPackageManifest: false,
      expectedTradeTrendMapping: expect.objectContaining({
        recipe: "trade-trend-v1",
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      expectedSupplierCompetitionMapping: expect.objectContaining({
        recipe: "supplier-competition-v1",
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    },
    {
      target: "older narrowly normalized legacy",
      legacyDatasetPackageManifest: true,
      expectedTradeTrendMapping: null,
      expectedSupplierCompetitionMapping: null,
    },
  ])("upgrades and smokes a mapping-less $target rollback target", async ({
    legacyDatasetPackageManifest,
    expectedTradeTrendMapping,
    expectedSupplierCompetitionMapping,
  }) => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
      {
        baciRelease: "VTEST001",
        legacyDatasetPackageManifest,
      },
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      {
        baciRelease: "VTEST001",
        valueOffset: 25,
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    await activateLegacyDeploymentProjection(objectStore);
    const active = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const rolledBack = await publisher.rollback({
      activatedAt: "2026-07-12T03:00:00Z",
    });

    expect(rolledBack).toMatchObject({
      baciRelease: "VTEST001",
      previousDeploymentPairingId: active.deploymentPairingId,
      recommendedDatasetMappingIdentity: expect.stringMatching(
        /^recommended-dataset-mapping-v1-[a-f0-9]{64}$/u,
      ),
    });
    await expect(publisher.current()).resolves.toEqual(rolledBack);
    if (rolledBack.recommendedDatasetMappingIdentity === null) {
      throw new Error("Expected rollback to publish a Dataset Mapping.");
    }
    const storedMapping = await objectStore.getObject(
      `recommended-dataset-mappings/${rolledBack.recommendedDatasetMappingIdentity}.json`,
    );
    if (storedMapping === null) {
      throw new Error("Expected rollback Dataset Mapping bytes.");
    }
    const storedMappingJson = JSON.parse(
      (await collectReleaseObject(storedMapping)).toString("utf8"),
    );
    expect(storedMappingJson.tradeTrend).toEqual(expectedTradeTrendMapping);
    expect(storedMappingJson.supplierCompetition).toEqual(
      expectedSupplierCompetitionMapping,
    );
  }, 30_000);

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

  it("rejects a product manifest with a non-v1 artifact schema before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root, {
      productManifestCatalogSchemaVersion:
        "product-catalog-artifact-v2",
    });
    const publisher = new ReleasePublisher(
      new InMemoryReleaseObjectStore(),
    );

    await expect(
      publisher.promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toThrow("Product catalog schema is incompatible");
    await expect(publisher.current()).resolves.toBeNull();
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

  it("keeps the active pointer when promotion smoke analysis fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const accepted = await writeAcceptedReleaseCandidate(
      join(root, "accepted"),
    );
    const badSmoke = await writeRuntimeReleaseCandidate(
      join(root, "bad-smoke"),
      {
        baciRelease: "VTEST001",
        valueOffset: 25,
        benchmarkCandidateCount: 999,
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const active = await publisher.promote({
      ...accepted,
      activatedAt: "2026-07-12T01:00:00Z",
    });

    await expect(
      publisher.promote({
        ...badSmoke,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "SMOKE_FAILED" });
    await expect(publisher.current()).resolves.toEqual(active);
  });

  it("smokes immutable stored bytes after candidate files are replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-publication-"));
    const candidate = await writeAcceptedReleaseCandidate(root);
    const artifactPath = join(
      candidate.analysisDirectoryPath,
      "candidate-market.duckdb",
    );
    const originalArtifact = await readFile(artifactPath);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(
      new ReplacingCandidateStore(objectStore, artifactPath),
    );

    const published = await publisher.promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    expect(await readFile(artifactPath, "utf8")).toBe(
      "replaced candidate bytes",
    );
    const hydrated = await new ReleaseHydrator(
      objectStore,
    ).hydrateCurrent({
      volumePath: join(root, "volume"),
    });
    expect(hydrated.deployment).toEqual(published);
    await expect(
      readFile(hydrated.analysisArtifactPath),
    ).resolves.toEqual(originalArtifact);
  }, 20_000);

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
    expect(hydrated.deploymentManifest.sourceStatusFallback).toMatchObject({
      schemaVersion: "source-status-v1",
      sourceStatusSnapshotId: expect.stringMatching(
        /^source-status-bootstrap-v1-[a-f0-9]{16}$/u,
      ),
      checkedAt: "2026-07-12T01:00:00Z",
      servedBaciRelease: "VTEST001",
      latestKnownBaciRelease: "VTEST001",
      newerReleaseDetectedAt: null,
      refreshFailed: false,
      rollbackActive: false,
      publishedAt: "2026-07-12T02:00:00Z",
    });
    await expect(readFile(hydrated.analysisArtifactPath)).resolves.toEqual(
      await readFile(
        join(
          candidate.analysisDirectoryPath,
          "candidate-market.duckdb",
        ),
      ),
    );
    await expect(readFile(hydrated.productCatalogPath)).resolves.toEqual(
      await readFile(
        join(
          candidate.productCatalogDirectoryPath,
          "product-catalog.json",
        ),
      ),
    );
    expect(await readdir(volumePath)).toEqual([
      published.deploymentPairingId,
    ]);
  }, 20_000);

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
    await hydrator.commitResidentActivation(secondHydrated);

    expect((await stat(secondHydrated.analysisArtifactPath)).ino).toBe(
      firstArtifact.ino,
    );
    // The first pairing is now the retained immediate predecessor (not
    // pruned): the 3-slot retention window keeps it resident alongside
    // current.
    expect((await readdir(volumePath)).sort()).toEqual(
      [
        "active-deployment.json",
        first.deploymentPairingId,
        second.deploymentPairingId,
      ].sort(),
    );
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
    await hydrator.commitResidentActivation(secondHydrated);

    expect(secondHydrated.previousAnalysis).not.toBeNull();
    expect(
      (
        await stat(
          secondHydrated.previousAnalysis!.artifactPath,
        )
      ).ino,
    ).toBe(firstArtifact.ino);
    // The first pairing is now the retained immediate predecessor (not
    // pruned): the 3-slot retention window keeps it resident alongside
    // current.
    expect((await readdir(volumePath)).sort()).toEqual(
      [
        "active-deployment.json",
        first.deploymentPairingId,
        second.deploymentPairingId,
      ].sort(),
    );
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

    // A corrupt current candidate is fallback-eligible (see issue #45), but
    // there is no last verified resident deployment on a brand-new volume,
    // so hydration still fails closed and reports exactly why -- never
    // falling back when no verified record exists.
    await expect(hydrator.hydrateCurrent({ volumePath })).rejects.toMatchObject({
      name: RemoteCandidateActivationError.name,
      code: "CURRENT_DEPLOYMENT_INVALID",
      cause: {
        name: "ReleaseHydrationError",
        code: "OBJECT_IDENTITY_MISMATCH",
      },
    });
    expect(await readdir(volumePath)).toEqual([]);
  });
});

describe("retained deployment history window", () => {
  it("retains exactly current + 2 predecessors and trims the oldest", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-retention-"));
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);

    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const second = await promoteGeneration(publisher, root, "gen2", {
      valueOffset: 10,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const third = await promoteGeneration(publisher, root, "gen3", {
      valueOffset: 20,
      activatedAt: "2026-07-12T03:00:00Z",
    });

    const pointerAfterThree = await readActivePointer(objectStore);
    expect(pointerAfterThree.current.key).toContain(third.deploymentPairingId);
    expect(pointerAfterThree.history.map((reference) => reference.key)).toEqual([
      `deployment-pairings/${second.deploymentPairingId}.json`,
      `deployment-pairings/${first.deploymentPairingId}.json`,
    ]);

    const fourth = await promoteGeneration(publisher, root, "gen4", {
      valueOffset: 30,
      activatedAt: "2026-07-12T04:00:00Z",
    });

    const pointerAfterFour = await readActivePointer(objectStore);
    expect(pointerAfterFour.current.key).toContain(fourth.deploymentPairingId);
    // gen1 (the oldest predecessor) is trimmed beyond the 3-slot window;
    // only gen3 and gen2 remain retained.
    expect(pointerAfterFour.history.map((reference) => reference.key)).toEqual([
      `deployment-pairings/${third.deploymentPairingId}.json`,
      `deployment-pairings/${second.deploymentPairingId}.json`,
    ]);
  }, 30_000);

  it("deduplicates an already-retained target instead of listing it twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-retention-"));
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);

    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    // Simulate anomalous stored state where the active pairing already
    // appears in its own history (e.g. drifted data): the next promotion
    // must self-heal rather than perpetuate the duplicate.
    await duplicateCurrentIntoHistory(objectStore);
    const anomalous = await readActivePointer(objectStore);
    expect(anomalous.history.map((reference) => reference.key)).toEqual([
      `deployment-pairings/${first.deploymentPairingId}.json`,
    ]);

    const second = await promoteGeneration(publisher, root, "gen2", {
      valueOffset: 10,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    void second;

    const pointer = await readActivePointer(objectStore);
    const historyKeys = pointer.history.map((reference) => reference.key);
    expect(historyKeys).toEqual([
      `deployment-pairings/${first.deploymentPairingId}.json`,
    ]);
  }, 30_000);

  it("rolls back by promoting the immediate predecessor and keeps the displaced current retained", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-retention-"));
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);

    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const second = await promoteGeneration(publisher, root, "gen2", {
      valueOffset: 10,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const third = await promoteGeneration(publisher, root, "gen3", {
      valueOffset: 20,
      activatedAt: "2026-07-12T03:00:00Z",
    });
    void second;

    const rolledBack = await publisher.rollback({
      activatedAt: "2026-07-12T04:00:00Z",
    });

    expect(rolledBack.previousDeploymentPairingId).toBe(
      third.deploymentPairingId,
    );
    const pointerAfterRollback = await readActivePointer(objectStore);
    expect(pointerAfterRollback.history.map((reference) => reference.key)).toEqual([
      `deployment-pairings/${third.deploymentPairingId}.json`,
      `deployment-pairings/${first.deploymentPairingId}.json`,
    ]);

    // Rollback is reversible: rolling back again swaps current and
    // history[0] once more, without duplicating or losing an entry.
    const rolledBackAgain = await publisher.rollback({
      activatedAt: "2026-07-12T05:00:00Z",
    });
    expect(rolledBackAgain.previousDeploymentPairingId).toBe(
      rolledBack.deploymentPairingId,
    );
    const pointerAfterSecondRollback = await readActivePointer(objectStore);
    expect(
      pointerAfterSecondRollback.history.map((reference) => reference.key),
    ).toEqual([
      `deployment-pairings/${rolledBack.deploymentPairingId}.json`,
      `deployment-pairings/${first.deploymentPairingId}.json`,

    ]);
  }, 30_000);

  it("fails closed before activation when the declared window cannot fit the retention policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-retention-"));
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });

    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "gen2"),
      { baciRelease: "VTEST001", valueOffset: 10 },
    );
    // A tiny declared serving-volume policy makes even the small fixture
    // artifacts exceed the retention headroom gate, without materializing
    // multi-gigabyte fixtures.
    const constrainedPublisher = new ReleasePublisher(objectStore, {
      declaredServingVolumeBytes: 1_024,
    });

    await expect(
      constrainedPublisher.promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "ReleasePublicationError",
      code: "RETENTION_HEADROOM_EXCEEDED",
    });
    // The prior active deployment remains unchanged after a headroom
    // rejection: promotion never partially commits.
    await expect(publisher.current()).resolves.toMatchObject({
      deploymentPairingId: first.deploymentPairingId,
    });
  }, 30_000);
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

class ReplacingCandidateStore implements ReleaseObjectStore {
  private replaced = false;

  constructor(
    private readonly delegate: ReleaseObjectStore,
    private readonly artifactPath: string,
  ) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    return this.delegate.getObject(key);
  }

  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    await this.delegate.putImmutable(key, body, identity);
    if (
      !this.replaced &&
      key.startsWith("recommended-dataset-mappings/")
    ) {
      this.replaced = true;
      await writeFile(
        this.artifactPath,
        "replaced candidate bytes",
      );
    }
  }

  async compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string> {
    return this.delegate.compareAndSwap(key, expectedVersion, body);
  }
}

async function activateLegacyDeploymentProjection(
  objectStore: InMemoryReleaseObjectStore,
): Promise<void> {
  const storedPointer = await objectStore.getObject(
    ACTIVE_DEPLOYMENT_POINTER_KEY,
  );
  if (storedPointer === null) {
    throw new Error("Expected an active deployment pointer.");
  }
  const pointer = JSON.parse(
    (await collectReleaseObject(storedPointer)).toString("utf8"),
  ) as {
    current: { key: string };
    [key: string]: unknown;
  };
  const storedDeployment = await objectStore.getObject(
    pointer.current.key,
  );
  if (storedDeployment === null) {
    throw new Error("Expected an active deployment.");
  }
  const legacyBase = JSON.parse(
    (await collectReleaseObject(storedDeployment)).toString("utf8"),
  ) as Record<string, unknown>;
  delete legacyBase.deploymentPairingId;
  delete legacyBase.recommendedDatasetMapping;
  // A manifest that predates the Recommended Dataset Mapping also
  // predates the resident-footprint retention field introduced alongside
  // it, so this legacy simulation removes both rather than leaving a
  // present-but-stale `residentFootprintBytes` that would no longer match
  // a mapping-less recomputation.
  delete legacyBase.residentFootprintBytes;
  const deploymentPairingId = contentAddressedId(
    "deployment-pairing-v1",
    legacyBase,
  );
  const deploymentBytes = releaseJsonBytes({
    ...legacyBase,
    deploymentPairingId,
  });
  const deploymentReference = {
    key: `deployment-pairings/${deploymentPairingId}.json`,
    ...releaseObjectIdentity(deploymentBytes),
  };
  await objectStore.putImmutable(
    deploymentReference.key,
    singleChunk(deploymentBytes),
    deploymentReference,
  );
  await objectStore.compareAndSwap(
    ACTIVE_DEPLOYMENT_POINTER_KEY,
    storedPointer.version,
    releaseJsonBytes({
      ...pointer,
      current: deploymentReference,
    }),
  );
}

async function collectReleaseObject(
  object: ReleaseObject,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function* oneChunk(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function promoteGeneration(
  publisher: ReleasePublisher,
  root: string,
  name: string,
  options: {
    valueOffset: number;
    activatedAt: string;
    directoryName?: string;
  },
) {
  const candidate = await writeRuntimeReleaseCandidate(
    join(root, options.directoryName ?? name),
    { baciRelease: "VTEST001", valueOffset: options.valueOffset },
  );
  return publisher.promote({
    ...candidate,
    activatedAt: options.activatedAt,
  });
}

async function readActivePointer(objectStore: InMemoryReleaseObjectStore) {
  const stored = await objectStore.getObject(ACTIVE_DEPLOYMENT_POINTER_KEY);
  if (stored === null) {
    throw new Error("Expected an active deployment pointer.");
  }
  return parseActiveDeploymentPointer(
    JSON.parse((await collectReleaseObject(stored)).toString("utf8")),
  );
}

async function duplicateCurrentIntoHistory(
  objectStore: InMemoryReleaseObjectStore,
): Promise<void> {
  const stored = await objectStore.getObject(ACTIVE_DEPLOYMENT_POINTER_KEY);
  if (stored === null) {
    throw new Error("Expected an active deployment pointer.");
  }
  const pointer = JSON.parse(
    (await collectReleaseObject(stored)).toString("utf8"),
  ) as { current: unknown; [key: string]: unknown };
  await objectStore.compareAndSwap(
    ACTIVE_DEPLOYMENT_POINTER_KEY,
    stored.version,
    releaseJsonBytes({ ...pointer, history: [pointer.current] }),
  );
}
