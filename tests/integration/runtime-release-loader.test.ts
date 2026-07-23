import {
  mkdtemp,
  readdir,
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
import { SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS } from "../../src/domain/trade-analytics/supplier-competition-v1-dataset-package";
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
  it("[launch-evidence:startup-smoke] reaches readiness only after the composed Market Analysis startup smoke with exact release identities", async () => {
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
      activation: { mode: "CURRENT", fallbackReason: null },
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
        deploymentActivation: {
          mode: "CURRENT",
          fallbackReason: null,
        },
        degraded: false,
        polling: null,
      },
    });
    expect(runtime.activation()).toEqual({ mode: "CURRENT" });
    expect(runtime.currentAnalysis().tradeExplorerBenchmarkQueries).toHaveLength(
      4,
    );
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

  it("hydrates and smoke-verifies a declared Opportunity Index before readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      { withOpportunityIndex: true },
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

    const residentRoot = join(root, "volume", published.deploymentPairingId);
    await expect(
      readFile(join(residentRoot, "opportunity-index.duckdb")),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(join(residentRoot, "opportunity-index-manifest.json"), "utf8"),
    ).resolves.toContain('"opportunity-index-manifest-v1"');
  }, 20_000);

  it("fails closed when a declared Opportunity Index cohort does not reconcile", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      { withOpportunityIndex: true, opportunityIndexStatsOffset: 1 },
    );

    await expect(
      new ReleasePublisher(new InMemoryReleaseObjectStore()).promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "PAIRING_INCOMPATIBLE" });
  }, 20_000);

  it("rejects activated Trade Explorer without every representative benchmark role", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      {
        tradeExplorerBenchmarkQueries: [
          "sparse",
          "median",
          "maximum-row",
        ].map((role) => ({
          role: role as "sparse" | "median" | "maximum-row",
          shape: "finalized-trend-v1" as const,
          measures: [
            "TRADE_VALUE_USD",
            "RECORDED_FLOW_COUNT",
          ] as ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
          exportEconomyCode: "156",
          importEconomyCode: "276",
          hsProductCode: RUNTIME_RELEASE_FIXTURE.productCode,
          groupedRowCount: 5,
        })),
      },
    );

    await expect(
      new ReleasePublisher(new InMemoryReleaseObjectStore()).promote({
        ...candidate,
        activatedAt: "2026-07-12T02:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "PAIRING_INCOMPATIBLE" });
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

  it("declares and gates supplier-competition-v1 on the Recommended Dataset Mapping selected at startup", async () => {
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

    expect(
      runtime.recommendedDatasetMapping.manifest.supplierCompetition,
    ).toEqual({
      recipe: "supplier-competition-v1",
      evidenceSha256:
        runtime.recommendedDatasetMapping.manifest.economyCatalog.artifact
          .sha256,
    });
    expect(
      runtime.currentAnalysis().recommendation.supplierCompetition,
    ).toMatchObject({
      recipe: "supplier-competition-v1",
      datasetPackageIdentity: expect.stringMatching(
        /^dataset-package-v1-[a-f0-9]{64}$/u,
      ),
    });
    expect(published.analysisBuildId).toBe(
      runtime.currentAnalysis().analysisBuildId,
    );
  }, 20_000);

  it("normalizes an artifact declaring incompatible Supplier Competition capabilities without blocking Candidate Market, omitting the recipe entirely rather than merely skipping its smoke check", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      {
        supplierCompetitionDatasetPackage: {
          schemaVersion: "supplier-competition-dataset-capabilities-v1",
          capabilities: SUPPLIER_COMPETITION_V1_CAPABILITY_REQUIREMENTS.slice(
            1,
          ),
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

    expect(
      runtime.recommendedDatasetMapping.manifest.supplierCompetition,
    ).toBeNull();
    expect(
      runtime.currentAnalysis().recommendation.supplierCompetition,
    ).toBeNull();
    expect(published.analysisBuildId).toBe(
      runtime.currentAnalysis().analysisBuildId,
    );

    await expect(
      runtime.tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
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
        deploymentActivation: {
          mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
          fallbackReason: "OBJECT_STORE_UNAVAILABLE",
        },
      },
    });
    expect(runtime.activation()).toEqual({
      mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
      reason: "OBJECT_STORE_UNAVAILABLE",
    });
    expect(runtime.health("runtime-test-build")).toMatchObject({
      readiness: "ready",
      activation: {
        mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
        fallbackReason: "OBJECT_STORE_UNAVAILABLE",
      },
      freshness: {
        deploymentActivation: {
          mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
          fallbackReason: "OBJECT_STORE_UNAVAILABLE",
        },
      },
    });
  }, 20_000);

  it("restarts from a legacy resident activation during an object-store outage", async () => {
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

    const pointerObject = await objectStore.getObject(
      ACTIVE_DEPLOYMENT_POINTER_KEY,
    );
    if (pointerObject === null) {
      throw new Error("Expected an active deployment pointer.");
    }
    const pointer = parseActiveDeploymentPointer(
      JSON.parse((await collectObject(pointerObject)).toString("utf8")),
    );
    const legacyPointer = {
      schemaVersion: pointer.schemaVersion,
      current: pointer.current,
      previous: pointer.history[0] ?? null,
      sourceStatusFallback: pointer.sourceStatusFallback,
      activatedAt: pointer.activatedAt,
    };
    const activationBase = {
      schemaVersion: "resident-deployment-activation-v1",
      pointer: legacyPointer,
    };
    await writeFile(
      join(volumePath, "active-deployment.json"),
      releaseJsonBytes({
        ...activationBase,
        activationId: contentAddressedId(
          "resident-deployment-activation-v1",
          activationBase,
        ),
      }),
    );

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: {
        getObject() {
          return Promise.reject(new Error("object storage unavailable"));
        },
      },
      volumePath,
      now: () => "2026-08-01T02:00:00Z",
    });
    runtimes.push(runtime);
    expect(runtime.currentAnalysis().analysisBuildId).toBe(
      published.analysisBuildId,
    );
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

  it("falls back to the last verified resident deployment when the newly pointed Recommended Dataset Mapping is corrupt, never partially serving the broken candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
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
    initial.close();

    // A second, remote-only deployment now names a Recommended Dataset
    // Mapping that reads back corrupt -- the newly pointed candidate that
    // must never take down the known-good resident deployment (see issue
    // #45).
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: new TamperedObjectReader(
        objectStore,
        "recommended-dataset-mappings/",
      ),
      volumePath,
      now: () => "2026-07-12T03:00:00Z",
    });
    runtimes.push(runtime);

    expect(runtime.currentAnalysis().analysisBuildId).toBe(
      first.analysisBuildId,
    );
    expect(runtime.activation()).toEqual({
      mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
      reason: "CURRENT_DEPLOYMENT_INVALID",
    });
    expect(runtime.health("runtime-test-build")).toMatchObject({
      readiness: "ready",
      activation: {
        mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
        fallbackReason: "CURRENT_DEPLOYMENT_INVALID",
      },
      deployment: { deploymentPairingId: first.deploymentPairingId },
    });
    // The broken candidate never created any sibling directory (its
    // Recommended Dataset Mapping fetch fails before any download
    // starts), and fallback never commits or prunes: only the already
    // durable first pairing, its DuckDB spill directory, and the
    // unchanged activation record remain.
    expect(
      await readFile(join(volumePath, "active-deployment.json"), "utf8"),
    ).toContain(first.deploymentPairingId);
    expect((await readdir(volumePath)).sort()).toEqual(
      ["active-deployment.json", first.deploymentPairingId, "spill"].sort(),
    );
    expect(second.deploymentPairingId).not.toBe(first.deploymentPairingId);
    // Truthful readiness in verified fallback still serves a real,
    // successful analysis through the closed execute seam -- the same
    // shape an external availability probe exercises via `/healthz` and
    // `/api/v1/analyses/current` (see issue #45 "documented SLI
    // contract"); only the distinct `activation` field, never the
    // analytical payload, marks it as degraded control-plane state.
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: first.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    expect(outcome.state).toBe("success");
  }, 20_000);

  it("keeps the durable resident activation record byte-identical and serves the exact same fallback deployment across a repeated outage", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
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
    initial.close();
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const tamperedReader = () =>
      new TamperedObjectReader(
        objectStore,
        "recommended-dataset-mappings/",
      );

    const outage1 = await VerifiedReleaseRuntime.load({
      objectStore: tamperedReader(),
      volumePath,
      now: () => "2026-07-12T03:00:00Z",
    });
    const activationBytesAfterFirstOutage = await readFile(
      join(volumePath, "active-deployment.json"),
    );
    const firstOutcome = await outage1.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: first.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    outage1.close();

    const outage2 = await VerifiedReleaseRuntime.load({
      objectStore: tamperedReader(),
      volumePath,
      now: () => "2026-07-12T04:00:00Z",
    });
    runtimes.push(outage2);
    const activationBytesAfterSecondOutage = await readFile(
      join(volumePath, "active-deployment.json"),
    );

    expect(outage2.currentAnalysis().analysisBuildId).toBe(
      first.analysisBuildId,
    );
    expect(outage2.activation()).toEqual({
      mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
      reason: "CURRENT_DEPLOYMENT_INVALID",
    });
    expect(activationBytesAfterSecondOutage.equals(
      activationBytesAfterFirstOutage,
    )).toBe(true);
    expect(
      await outage2.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: first.analysisBuildId,
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ).toEqual(firstOutcome);
  }, 20_000);

  it("activates a previously broken mapping's fixed replacement only after a controlled restart, keeping the fallback pairing as retained history", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
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
    initial.close();
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });

    const outage = await VerifiedReleaseRuntime.load({
      objectStore: new TamperedObjectReader(
        objectStore,
        "recommended-dataset-mappings/",
      ),
      volumePath,
      now: () => "2026-07-12T03:00:00Z",
    });
    expect(outage.currentAnalysis().analysisBuildId).toBe(
      first.analysisBuildId,
    );
    outage.close();

    // Object-store recovery never hot-swaps the already-running fallback
    // process; only this controlled restart, against the now-healthy
    // object store, may activate the fixed mapping (see issue #45).
    const recovered = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T04:00:00Z",
    });
    runtimes.push(recovered);
    expect(recovered.currentAnalysis().analysisBuildId).toBe(
      second.analysisBuildId,
    );
    expect(recovered.activation()).toEqual({ mode: "CURRENT" });
    expect(
      recovered.resolveAnalysisManifest(first.analysisBuildId)
        ?.analysisBuildId,
    ).toBe(first.analysisBuildId);
  }, 20_000);

  it("fails readiness instead of misclassifying a local resident-path error as fallback-eligible", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "first"),
    );
    await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
      now: () => "2026-07-12T01:00:00Z",
    });
    initial.close();
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "second"),
      { valueOffset: 25 },
    );
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    await writeFile(
      join(volumePath, second.deploymentPairingId),
      "not a resident directory",
    );

    let failure: unknown;
    try {
      await VerifiedReleaseRuntime.load({
        objectStore,
        volumePath,
        now: () => "2026-07-12T03:00:00Z",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "ENOTDIR" });
    expect(failure).not.toMatchObject({
      name: "RemoteCandidateActivationError",
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
    ).rejects.toMatchObject({
      name: "RemoteCandidateActivationError",
      code: "OBJECT_STORE_UNAVAILABLE",
      message: "object storage unavailable",
    });
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

describe("verified release runtime retained deployment window", () => {
  async function promoteGeneration(
    publisher: ReleasePublisher,
    root: string,
    name: string,
    options: { valueOffset: number; activatedAt: string },
  ) {
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, name),
      { valueOffset: options.valueOffset },
    );
    return publisher.promote({
      ...candidate,
      activatedAt: options.activatedAt,
    });
  }

  it("serves current and both retained predecessors through the closed execute seam without object-store access", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
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

    const volumePath = join(root, "volume");
    const countingReader = new CountingReleaseReader(objectStore);
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: countingReader,
      volumePath,
    });
    runtimes.push(runtime);
    countingReader.readCount = 0;

    const [currentOutcome, retainedOutcome1, retainedOutcome2, retiredOutcome] =
      await Promise.all([
        runtime.tradeAnalytics.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: third.analysisBuildId,
          exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
          productCode: RUNTIME_RELEASE_FIXTURE.productCode,
        }),
        runtime.tradeAnalytics.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: second.analysisBuildId,
          exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
          productCode: RUNTIME_RELEASE_FIXTURE.productCode,
        }),
        runtime.tradeAnalytics.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: first.analysisBuildId,
          exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
          productCode: RUNTIME_RELEASE_FIXTURE.productCode,
        }),
        runtime.tradeAnalytics.execute({
          recipe: "candidate-market-v1",
          analysisBuildId: "never-promoted-build",
          exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
          productCode: RUNTIME_RELEASE_FIXTURE.productCode,
        }),
      ]);

    expect(currentOutcome.state).toBe("success");
    expect(retainedOutcome1.state).toBe("success");
    expect(retainedOutcome2.state).toBe("success");
    expect(retiredOutcome.state).toBe("retired");
    if (
      currentOutcome.state !== "success" ||
      retainedOutcome1.state !== "success" ||
      retainedOutcome2.state !== "success"
    ) {
      throw new Error("Expected all three retained builds to succeed.");
    }
    // Every retained build reproduces its own exact deterministic
    // Analysis Identity.
    const identities = new Set([
      currentOutcome.analysisIdentity,
      retainedOutcome1.analysisIdentity,
      retainedOutcome2.analysisIdentity,
    ]);
    expect(identities.size).toBe(3);
    // No request-time object-store access: all three builds already
    // executed above via already-resident, verified data.
    expect(countingReader.readCount).toBe(0);
  }, 30_000);

  it("resolves the manifest for current and each retained predecessor, and null for an unknown build", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
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

    let now = "2026-07-12T02:00:00Z";
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => now,
    });
    runtimes.push(runtime);

    expect(
      runtime.resolveAnalysisManifest(second.analysisBuildId)
        ?.analysisBuildId,
    ).toBe(second.analysisBuildId);
    expect(
      runtime.resolveAnalysisManifest(first.analysisBuildId)
        ?.analysisBuildId,
    ).toBe(first.analysisBuildId);
    expect(
      runtime.resolveAnalysisManifest(first.analysisBuildId)
        ?.productSearchBuildId,
    ).toBe(first.productSearchBuildId);
    const retainedManifest = runtime.resolveAnalysisManifest(
      first.analysisBuildId,
    );
    now = "2030-07-12T02:00:00Z";
    expect(runtime.resolveAnalysisManifest(first.analysisBuildId)).toEqual(
      retainedManifest,
    );
    expect(runtime.resolveAnalysisManifest("never-promoted")).toBeNull();
  }, 20_000);

  it("trims retention beyond 3 pairings and retires a request for the trimmed generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    await promoteGeneration(publisher, root, "gen2", {
      valueOffset: 10,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    await promoteGeneration(publisher, root, "gen3", {
      valueOffset: 20,
      activatedAt: "2026-07-12T03:00:00Z",
    });
    await promoteGeneration(publisher, root, "gen4", {
      valueOffset: 30,
      activatedAt: "2026-07-12T04:00:00Z",
    });

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
    });
    runtimes.push(runtime);

    expect(runtime.resolveAnalysisManifest(first.analysisBuildId)).toBeNull();
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: first.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    expect(outcome.state).toBe("retired");
  }, 30_000);

  it("makes all three retained pairings available again after an outage restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
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
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
    });
    initial.close();

    const outage = await VerifiedReleaseRuntime.load({
      objectStore: {
        getObject() {
          return Promise.reject(new Error("object storage unavailable"));
        },
      },
      volumePath,
    });
    runtimes.push(outage);

    const [currentOutcome, retained1, retained2] = await Promise.all([
      outage.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: third.analysisBuildId,
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
      outage.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: second.analysisBuildId,
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
      outage.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: first.analysisBuildId,
        exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
        productCode: RUNTIME_RELEASE_FIXTURE.productCode,
      }),
    ]);
    expect(currentOutcome.state).toBe("success");
    expect(retained1.state).toBe("success");
    expect(retained2.state).toBe("success");
  }, 30_000);

  it("fails closed before activation when the actual serving volume lacks headroom, preserving the prior active deployment", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await promoteGeneration(publisher, root, "gen1", {
      valueOffset: 0,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const volumePath = join(root, "volume");
    const initial = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
    });
    initial.close();

    await expect(
      VerifiedReleaseRuntime.load({
        objectStore,
        volumePath,
        filesystemCapacityProbe: () => ({
          totalBytes: 1_024,
          freeBytes: 1,
        }),
      }),
    ).rejects.toThrow(/does not fit the serving volume/iu);

    // The prior active deployment's resident activation record is left
    // untouched: a normal restart still finds and trusts it.
    const restarted = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath,
    });
    runtimes.push(restarted);
    expect(restarted.currentAnalysis().analysisBuildId).toBe(
      first.analysisBuildId,
    );
  }, 30_000);

  it("resolves the exact retained product catalog and economy directory for a retained analysisBuildId", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-runtime-"));
    temporaryDirectories.push(root);
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

    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
    });
    runtimes.push(runtime);

    const retainedProduct = await runtime.searchProducts({
      productSearchBuildId: first.productSearchBuildId,
      query: RUNTIME_RELEASE_FIXTURE.productCode,
      locale: "en",
      limit: 1,
    });
    expect(retainedProduct.productSearchBuildId).toBe(
      first.productSearchBuildId,
    );
    expect(retainedProduct.matches[0]?.product.code).toBe(
      RUNTIME_RELEASE_FIXTURE.productCode,
    );

    const currentProduct = await runtime.searchProducts({
      productSearchBuildId: second.productSearchBuildId,
      query: RUNTIME_RELEASE_FIXTURE.productCode,
      locale: "en",
      limit: 1,
    });
    expect(currentProduct.productSearchBuildId).toBe(
      second.productSearchBuildId,
    );

    const retainedEconomy = await runtime.searchEconomies({
      analysisBuildId: first.analysisBuildId,
      query: RUNTIME_RELEASE_FIXTURE.exporterCode,
      limit: 1,
    });
    expect(retainedEconomy.analysisBuildId).toBe(first.analysisBuildId);
    expect(retainedEconomy.matches[0]?.economy.code).toBe(
      RUNTIME_RELEASE_FIXTURE.exporterCode,
    );
  }, 30_000);
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

// Returns tampered bytes for any key under the given prefix (for example
// `recommended-dataset-mappings/`), simulating a newly pointed candidate
// whose Recommended Dataset Mapping fails identity/schema verification
// while every other object -- including an already-resident pairing's own
// local files -- stays exactly as published (see issue #45).
class TamperedObjectReader implements ReleaseObjectReader {
  constructor(
    private readonly delegate: ReleaseObjectReader,
    private readonly tamperedPrefix: string,
  ) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    const stored = await this.delegate.getObject(key);
    if (stored === null || !key.startsWith(this.tamperedPrefix)) {
      return stored;
    }
    return {
      body: singleChunk(Buffer.from("tampered bytes", "utf8")),
      version: stored.version,
    };
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
    // A manifest that predates the Recommended Dataset Mapping also
    // predates the resident-footprint retention field introduced
    // alongside it; simulate both absent rather than leaving a
    // present-but-stale value.
    delete legacyBase.residentFootprintBytes;
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
