import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import type {
  ReleaseObject,
  ReleaseObjectReader,
} from "../../src/release/release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
} from "../fixtures/runtime-release";

const temporaryDirectories: string[] = [];
const runtimes: VerifiedReleaseRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("verified release runtime", () => {
  it("reaches readiness from an empty volume with exact release identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.health("runtime-test-build")).toEqual({
      status: "ok",
      readiness: "ready",
      buildId: "runtime-test-build",
      deployment: {
        deploymentPairingId: published.deploymentPairingId,
        baciRelease: "V202601",
        analysisBuildId: published.analysisBuildId,
        analysisReleaseCatalogSha256:
          published.analysisReleaseCatalogSha256,
        productSearchBuildId: published.productSearchBuildId,
        activatedAt: "2026-07-12T02:00:00Z",
      },
      analysisArtifact: {
        buildId: expect.stringMatching(
          /^candidate-market-artifact-v1-[a-f0-9]{16}$/u,
        ),
        schemaVersion: "candidate-market-artifact-v1",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      previousAnalysisArtifact: null,
      freshness: {
        sourceStatusSnapshotId:
          `source-status:deployment:${published.deploymentPairingId}`,
        freshnessStatusId: expect.stringMatching(/^freshness:/u),
        state: "LATEST_KNOWN",
      },
    });
  }, 20_000);

  it("reuses a verified resident release without downloading its artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T02:00:00Z",
    });
    initial.close();
    const residentReader = new ResidentReleaseReader(objectStore);

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: residentReader,
      volumePath,
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis()).toMatchObject({
      schemaVersion: "current-analysis-manifest-v1",
      analysisBuildId: published.analysisBuildId,
      productSearchBuildId: published.productSearchBuildId,
      analysisReleaseCatalogSha256:
        published.analysisReleaseCatalogSha256,
      source: {
        baciRelease: "V202601",
        finalizedCutoffYear: 2023,
        artifact: {
          schemaVersion: "candidate-market-artifact-v1",
        },
      },
      freshness: {
        servedBaciRelease: "V202601",
        state: "LATEST_KNOWN",
      },
    });
    expect(residentReader.requestedKeys).toEqual([
      "deployment-pointers/current.json",
      `deployment-pairings/${published.deploymentPairingId}.json`,
    ]);
  }, 20_000);

  it("serves real analysis and product search without request-time object storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const reader = new CountingReleaseReader(objectStore);
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: reader,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    const startupReads = reader.readCount;

    const [analysis, search] = await Promise.all([
      runtime.analyze({
        analysisBuildId: published.analysisBuildId,
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
      runtime.searchProducts({
        productSearchBuildId: published.productSearchBuildId,
        query: "horse",
        locale: "en",
        limit: 20,
      }),
    ]);

    expect({
      analysisBuildId: analysis.analysisBuildId,
      analysisReleaseCatalogSha256:
        analysis.analysisReleaseCatalogSha256,
      analysisBaciRelease: analysis.provenance.baciRelease,
      candidateCodes: analysis.candidates.map(
        ({ economy }) => economy.code,
      ),
      productSearchBuildId: search.productSearchBuildId,
      productCodes: search.matches.map(({ product }) => product.code),
      requestTimeObjectReads: reader.readCount - startupReads,
    }).toEqual({
      analysisBuildId: published.analysisBuildId,
      analysisReleaseCatalogSha256:
        published.analysisReleaseCatalogSha256,
      analysisBaciRelease: published.baciRelease,
      candidateCodes: ["276"],
      productSearchBuildId: published.productSearchBuildId,
      productCodes: [RUNTIME_RELEASE_FIXTURE.productCode],
      requestTimeObjectReads: 0,
    });

    await expect(
      runtime.analyze({
        analysisBuildId: "analysis-build-v1-ffffffffffffffff",
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_BUILD_RETIRED",
      status: 410,
    });
    await expect(
      runtime.searchProducts({
        productSearchBuildId:
          "product-search-v1-ffffffffffffffff",
        query: "horse",
        locale: "en",
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "PRODUCT_SEARCH_BUILD_RETIRED",
      status: 410,
    });
  }, 20_000);

  it("serves the versioned economy directory from the verified DuckDB", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);

    await expect(
      runtime.searchEconomies({
        analysisBuildId: published.analysisBuildId,
        query: "Germany",
        limit: 50,
      }),
    ).resolves.toEqual({
      schemaVersion: "economy-search-result-v1",
      analysisBuildId: published.analysisBuildId,
      query: { normalized: "germany", limit: 50 },
      totalMatches: 1,
      truncated: false,
      matches: [
        {
          economy: {
            code: "276",
            iso2: "DE",
            iso3: "DEU",
            name: "Germany",
            identityNote: null,
          },
          match: {
            class: "EXACT_NAME",
            field: "NAME",
            matchedText: "Germany",
          },
        },
      ],
    });
    await expect(
      runtime.searchEconomies({
        analysisBuildId: "analysis-build-v1-ffffffffffffffff",
        query: "Germany",
        limit: 50,
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_BUILD_RETIRED",
      status: 410,
    });
  }, 20_000);

  it("loads the compatible previous artifact for release revision without mixing releases", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
      { finalizedCutoffYear: 2022 },
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const firstManifest = JSON.parse(
      await readFile(
        join(
          firstCandidate.analysisDirectoryPath,
          "artifact-manifest.json",
        ),
        "utf8",
      ),
    ) as { artifact: { buildId: string; sha256: string } };
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const published = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    const result = await runtime.analyze({
      analysisBuildId: published.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });

    expect({
      previousHealth: runtime.health("runtime-test-build")
        .previousAnalysisArtifact,
      currentRevision: runtime.currentAnalysis().revisionComparison,
      resultRevision: result.releaseRevisionSummary,
      resultRelease: result.provenance.baciRelease,
    }).toEqual({
      previousHealth: {
        baciRelease: "V202601",
        buildId: firstManifest.artifact.buildId,
        schemaVersion: "candidate-market-artifact-v1",
        sha256: firstManifest.artifact.sha256,
      },
      currentRevision: {
        comparisonRelease: "V202601",
        previousArtifactSha256: firstManifest.artifact.sha256,
        notComparedReason: null,
      },
      resultRevision: {
        comparisonRelease: "V202601",
        previousArtifactSha256: firstManifest.artifact.sha256,
        notComparedReason: null,
        noLongerEligibleCount: 0,
      },
      resultRelease: "V202601",
    });
  }, 20_000);
});

class ResidentReleaseReader implements ReleaseObjectReader {
  readonly requestedKeys: string[] = [];

  constructor(private readonly delegate: ReleaseObjectReader) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    this.requestedKeys.push(key);
    if (
      key !== "deployment-pointers/current.json" &&
      !key.startsWith("deployment-pairings/")
    ) {
      throw new Error(`Resident startup attempted to download ${key}.`);
    }
    return this.delegate.getObject(key);
  }
}

class CountingReleaseReader implements ReleaseObjectReader {
  readCount = 0;

  constructor(private readonly delegate: ReleaseObjectReader) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    this.readCount += 1;
    return this.delegate.getObject(key);
  }
}
