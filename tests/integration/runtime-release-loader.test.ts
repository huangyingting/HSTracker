import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS,
  CANDIDATE_MARKET_V1_DATASET_DECLARATION,
} from "../../src/domain/trade-analytics/dataset-package";
import { TRADE_TREND_V1_CAPABILITY_REQUIREMENTS } from "../../src/domain/trade-analytics/trade-trend-v1-dataset-package";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  contentAddressedId,
  parseActiveDeploymentPointer,
  releaseJsonBytes,
} from "../../src/release/release-manifest";
import type {
  ReleaseObject,
  ReleaseObjectReader,
} from "../../src/release/release-object-store";
import {
  releaseObjectIdentity,
  singleChunk,
} from "../../src/release/release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import { CountingReleaseReader } from "../support/counting-release-reader";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
} from "../support/runtime-release";

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
        sourceStatusSnapshotId: expect.stringMatching(
          /^source-status-bootstrap-v1-[a-f0-9]{16}$/u,
        ),
        freshnessStatusId: expect.stringMatching(/^freshness:/u),
        state: "LATEST_KNOWN",
        degraded: false,
        polling: null,
      },
    });
    expect(runtime.resources()).toMatchObject({
      analysisExecution: {
        active: 0,
        queued: 0,
        maxConcurrent: 2,
        maxQueued: 16,
      },
      caches: {
        statusMicroCache: {
          bytes: expect.any(Number),
          maxBytes: 1024 * 1024,
        },
        safetyReserveBytes: 15 * 1024 * 1024,
      },
      duckDb: {
        connections: 2,
        activeConnections: 0,
        queued: 0,
        threads: 2,
        memoryLimit: "1GiB",
        tempDirectory: join(root, "volume", "spill"),
        maxTempDirectorySize: "4GiB",
      },
    });
  }, 20_000);

  it("rejects package incompatibility before promotion smoke or activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const failingAnalyticalSmokeOracle = 999;
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      {
        benchmarkCandidateCount: failingAnalyticalSmokeOracle,
        datasetPackage: {
          ...CANDIDATE_MARKET_V1_DATASET_DECLARATION,
          capabilities:
            CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS.slice(1),
        },
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);

    await expect(
      publisher.promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({
      code: "PAIRING_INCOMPATIBLE",
    });
    await expect(publisher.current()).resolves.toBeNull();
  }, 20_000);

  it("declares and gates trade-trend-v1 on the Recommended Dataset Mapping selected at startup", async () => {
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

    expect(runtime.recommendedDatasetMapping.manifest.tradeTrend).toEqual({
      recipe: "trade-trend-v1",
      evidenceSha256:
        runtime.recommendedDatasetMapping.manifest.economyCatalog.artifact
          .sha256,
    });
    expect(
      runtime.currentAnalysis().recommendation.tradeTrend,
    ).toMatchObject({
      recipe: "trade-trend-v1",
      datasetPackageIdentity: expect.stringMatching(
        /^dataset-package-v1-[a-f0-9]{64}$/u,
      ),
    });
    expect(published.analysisBuildId).toBe(
      runtime.currentAnalysis().analysisBuildId,
    );
  }, 20_000);

  it("normalizes an artifact declaring incompatible Trade Trend capabilities without blocking Candidate Market", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      {
        tradeTrendDatasetPackage: {
          schemaVersion: "trade-trend-dataset-capabilities-v1",
          capabilities: TRADE_TREND_V1_CAPABILITY_REQUIREMENTS.slice(1),
        },
      },
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

    expect(runtime.recommendedDatasetMapping.manifest.tradeTrend).toBeNull();
    expect(
      runtime.currentAnalysis().recommendation.tradeTrend,
    ).toBeNull();
    expect(published.analysisBuildId).toBe(
      runtime.currentAnalysis().analysisBuildId,
    );

    await expect(
      runtime.tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId: published.analysisBuildId,
        importerCode: "276",
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ).resolves.toMatchObject({
      state: "retired",
      error: {
        code: "ANALYSIS_BUILD_RETIRED",
      },
    });
  }, 20_000);

  it("normalizes and serves an accepted legacy cms-v1 artifact manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      { legacyDatasetPackageManifest: true },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore:
        await LegacyDeploymentReader.create(objectStore),
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: published.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });

    expect(outcome).toMatchObject({
      state: "success",
      payload: {
        schemaVersion: "candidate-market-result-v1",
        cohortSize: 1,
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

  it("restarts from the last smoke-tested resident release during an object-store outage", async () => {
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

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: {
        getObject() {
          return Promise.reject(
            new Error("object storage unavailable"),
          );
        },
      },
      volumePath,
      now: () => "2026-08-01T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis()).toMatchObject({
      analysisBuildId: published.analysisBuildId,
      productSearchBuildId: published.productSearchBuildId,
      source: { baciRelease: "V202601" },
      freshness: {
        servedBaciRelease: "V202601",
        state: "CHECK_OVERDUE",
      },
    });
  }, 20_000);

  it("uses the smoke-tested resident release when storage fails after pointer lookup", async () => {
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

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: {
        getObject(key) {
          if (key === "deployment-pointers/current.json") {
            return objectStore.getObject(key);
          }
          return Promise.reject(
            new Error("object storage unavailable"),
          );
        },
      },
      volumePath,
      now: () => "2026-08-01T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis()).toMatchObject({
      analysisBuildId: published.analysisBuildId,
      productSearchBuildId: published.productSearchBuildId,
      source: { baciRelease: "V202601" },
      freshness: {
        servedBaciRelease: "V202601",
        state: "CHECK_OVERDUE",
      },
    });
  }, 20_000);

  it("fails closed during a cold object-store outage", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);

    await expect(
      VerifiedReleaseRuntime.load({
        objectStore: {
          getObject() {
            return Promise.reject(
              new Error("object storage unavailable"),
            );
          },
        },
        volumePath: join(root, "volume"),
      }),
    ).rejects.toThrow(
      "Object storage is unavailable and no verified resident deployment is active.",
    );
  });

  it("fails closed when the resident activation is corrupt during an outage", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const volumePath = join(root, "volume");
    await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
    });
    initial.close();
    await writeFile(
      join(volumePath, "active-deployment.json"),
      "{}",
    );

    await expect(
      VerifiedReleaseRuntime.load({
        objectStore: {
          getObject() {
            return Promise.reject(
              new Error("object storage unavailable"),
            );
          },
        },
        volumePath,
      }),
    ).rejects.toThrow(
      "Resident deployment activation schema is incompatible.",
    );
  }, 20_000);

  it("keeps the prior resident activation when promotion smoke fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
    const invalidCandidate = await writeRuntimeReleaseCandidate(
      join(root, "invalid"),
      {
        valueOffset: 25,
        benchmarkCandidateCount: 2,
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
    });
    initial.close();
    await expect(
      publisher.promote({
        ...invalidCandidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "SMOKE_FAILED" });
    await expect(publisher.current()).resolves.toEqual(first);

    const recovered = await VerifiedReleaseRuntime.load({
      objectStore: {
        getObject() {
          return Promise.reject(
            new Error("object storage unavailable"),
          );
        },
      },
      volumePath,
    });
    runtimes.push(recovered);
    expect(recovered.currentAnalysis()).toMatchObject({
      analysisBuildId: first.analysisBuildId,
      productSearchBuildId: first.productSearchBuildId,
    });
  }, 20_000);

  it("hydrates previous evidence missing from a legacy resident volume", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
      {
        baciRelease: "V202501",
        finalizedCutoffYear: 2022,
      },
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
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
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T02:00:00Z",
    });
    initial.close();
    const residentPath = join(
      volumePath,
      published.deploymentPairingId,
    );
    await Promise.all([
      rm(join(residentPath, "previous-candidate-market.duckdb")),
      rm(join(residentPath, "previous-artifact-manifest.json")),
    ]);

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis().revisionComparison).toMatchObject({
      comparisonRelease: "V202501",
      notComparedReason: null,
    });
  }, 20_000);

  it("changes bootstrap Source Freshness Status identity when a pairing is reactivated", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T01:00:00Z",
    });
    const initialStatusId =
      initial.health("runtime-test-build").freshness
        .sourceStatusSnapshotId;
    initial.close();
    await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const rolledBack = await publisher.rollback({
      activatedAt: "2026-07-12T03:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T03:00:00Z",
    });
    runtimes.push(runtime);
    const reactivatedStatusId =
      runtime.health("runtime-test-build").freshness
        .sourceStatusSnapshotId;

    expect(rolledBack.deploymentPairingId).not.toBe(
      first.deploymentPairingId,
    );
    expect(rolledBack.analysisBuildId).toBe(first.analysisBuildId);
    expect(reactivatedStatusId).not.toBe(initialStatusId);
  }, 20_000);

  it("does not reset bootstrap Source Freshness Status check age on activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-08-01T02:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-08-01T02:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis().freshness).toMatchObject({
      checkedAt: "2026-07-12T01:00:00Z",
      state: "CHECK_OVERDUE",
      effectiveAt: "2026-07-26T01:00:00Z",
    });
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

    const [analysisOutcome, search] = await Promise.all([
      runtime.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
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
    if (analysisOutcome.state !== "success") {
      throw new TypeError(
        `Expected success, received ${analysisOutcome.state}.`,
      );
    }
    const analysis = analysisOutcome.payload;

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
      runtime.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "analysis-build-v1-ffffffffffffffff",
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ).resolves.toMatchObject({
      state: "retired",
      error: { code: "ANALYSIS_BUILD_RETIRED" },
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

  it("serves Trade Trend from the same verified DuckDB used for Candidate Market", async () => {
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

    // Importer 276 has full market_year coverage for product 010121 in
    // the runtime fixture, so every finalized year and the provisional
    // year resolve as recorded positive from the same physical evidence
    // used by the Candidate Market query above.
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "trade-trend-v1",
      analysisBuildId: published.analysisBuildId,
      importerCode: "276",
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }

    expect(outcome.payload.analysisBuildId).toBe(published.analysisBuildId);
    expect(outcome.payload.provenance.baciRelease).toBe(
      published.baciRelease,
    );
    expect(
      outcome.payload.finalizedObservations.every(
        (observation) => observation.state === "RECORDED_POSITIVE",
      ),
    ).toBe(true);
    expect(outcome.payload.provisionalObservation?.state).toBe(
      "RECORDED_POSITIVE",
    );
    expect(outcome.analysisIdentity).toMatch(
      /^analysis-identity-v1-[a-f0-9]{64}$/u,
    );
    expect(outcome.datasetPackageIdentity).toMatch(
      /^dataset-package-v1-[a-f0-9]{64}$/u,
    );

    await expect(
      runtime.tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId: published.analysisBuildId,
        importerCode: "999",
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ).resolves.toMatchObject({
      state: "invalid-input",
      error: { code: "UNKNOWN_IMPORTER" },
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
      {
        baciRelease: "V202501",
        finalizedCutoffYear: 2022,
      },
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
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: published.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    if (outcome.state !== "success") {
      throw new Error(`Expected success, received ${outcome.state}.`);
    }
    const result = outcome.payload;

    expect({
      previousHealth: runtime.health("runtime-test-build")
        .previousAnalysisArtifact,
      currentRevision: runtime.currentAnalysis().revisionComparison,
      resultRevision: result.releaseRevisionSummary,
      resultRelease: result.provenance.baciRelease,
    }).toEqual({
      previousHealth: {
        baciRelease: "V202501",
        buildId: firstManifest.artifact.buildId,
        schemaVersion: "candidate-market-artifact-v1",
        sha256: firstManifest.artifact.sha256,
      },
      currentRevision: {
        comparisonRelease: "V202501",
        previousArtifactSha256: firstManifest.artifact.sha256,
        notComparedReason: null,
      },
      resultRevision: {
        comparisonRelease: "V202501",
        previousArtifactSha256: firstManifest.artifact.sha256,
        notComparedReason: null,
        noLongerEligibleCount: 0,
      },
      resultRelease: "V202601",
    });
  }, 20_000);

  it("does not treat a same-release artifact rebuild as a Release Revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
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

    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: published.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }
    const result = outcome.payload;

    expect({
      current: runtime.currentAnalysis().revisionComparison,
      result: result.releaseRevisionSummary,
    }).toEqual({
      current: {
        comparisonRelease: null,
        previousArtifactSha256: null,
        notComparedReason: "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
      },
      result: {
        comparisonRelease: null,
        previousArtifactSha256: null,
        notComparedReason: "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
        noLongerEligibleCount: null,
      },
    });
  }, 20_000);

  it.each([
    {
      unavailablePrefix: "recommended-dataset-mappings/",
      label: "missing mapping",
    },
    {
      unavailablePrefix: "dataset-packages/",
      label: "partially available mapping",
    },
  ])("fails before readiness for a $label", async ({ unavailablePrefix }) => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    await expect(
      VerifiedReleaseRuntime.load({
        objectStore: new UnavailableObjectReader(
          objectStore,
          unavailablePrefix,
        ),
        volumePath: join(root, "volume"),
      }),
    ).rejects.toThrow("deployment object is unavailable");
  }, 20_000);

  it("keeps its startup mapping fixed until a controlled restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const running = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "first-volume"),
    });
    runtimes.push(running);
    const startupMapping =
      running.currentAnalysis().recommendation.mappingIdentity;

    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    expect(running.currentAnalysis()).toMatchObject({
      analysisBuildId: first.analysisBuildId,
      recommendation: { mappingIdentity: startupMapping },
    });
    const restarted = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "second-volume"),
    });
    runtimes.push(restarted);
    expect(restarted.currentAnalysis()).toMatchObject({
      analysisBuildId: second.analysisBuildId,
      recommendation: {
        mappingIdentity: second.recommendedDatasetMappingIdentity,
      },
    });
    expect(
      restarted.currentAnalysis().recommendation.mappingIdentity,
    ).not.toBe(startupMapping);
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

class UnavailableObjectReader implements ReleaseObjectReader {
  constructor(
    private readonly delegate: ReleaseObjectReader,
    private readonly unavailablePrefix: string,
  ) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    return key.startsWith(this.unavailablePrefix)
      ? null
      : this.delegate.getObject(key);
  }
}

class LegacyDeploymentReader implements ReleaseObjectReader {
  private constructor(
    private readonly delegate: ReleaseObjectReader,
    private readonly deploymentKey: string,
    private readonly deploymentBytes: Buffer,
    private readonly pointerBytes: Buffer,
  ) {}

  static async create(
    delegate: ReleaseObjectReader,
  ): Promise<LegacyDeploymentReader> {
    const pointerObject = await delegate.getObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (pointerObject === null) {
      throw new Error("Expected an active deployment.");
    }
    const pointer = parseActiveDeploymentPointer(
      JSON.parse(
        (await collectObject(pointerObject)).toString("utf8"),
      ),
    );
    const deploymentObject = await delegate.getObject(
      pointer.current.key,
    );
    if (deploymentObject === null) {
      throw new Error("Expected an active deployment manifest.");
    }
    const legacyBase = JSON.parse(
      (await collectObject(deploymentObject)).toString("utf8"),
    ) as Record<string, unknown>;
    delete legacyBase.deploymentPairingId;
    delete legacyBase.recommendedDatasetMapping;
    const deploymentPairingId = contentAddressedId(
      "deployment-pairing-v1",
      legacyBase,
    );
    const deploymentBytes = releaseJsonBytes({
      ...legacyBase,
      deploymentPairingId,
    });
    const deploymentKey =
      `deployment-pairings/${deploymentPairingId}.json`;
    const pointerBytes = releaseJsonBytes({
      ...pointer,
      current: {
        key: deploymentKey,
        ...releaseObjectIdentity(deploymentBytes),
      },
    });
    return new LegacyDeploymentReader(
      delegate,
      deploymentKey,
      deploymentBytes,
      pointerBytes,
    );
  }

  async getObject(key: string): Promise<ReleaseObject | null> {
    const bytes =
      key === ACTIVE_DEPLOYMENT_POINTER_KEY
        ? this.pointerBytes
        : key === this.deploymentKey
          ? this.deploymentBytes
          : null;
    return bytes === null
      ? this.delegate.getObject(key)
      : { body: singleChunk(bytes), version: "legacy-fixture-v1" };
  }
}

async function collectObject(object: ReleaseObject): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
