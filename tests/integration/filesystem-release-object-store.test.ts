import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import {
  FilesystemReleaseObjectStore,
} from "../../src/release/filesystem-release-object-store";
import { createRuntimeReleaseObjectReader } from "../../src/release/release-object-storage";
import { ReleaseHydrator } from "../../src/release/release-hydration";
import {
  ReleasePublisher,
  type PublishedDeployment,
} from "../../src/release/release-publication";
import {
  ReleasePointerConflictError,
  releaseObjectIdentity,
} from "../../src/release/release-object-store";
import { SourceStatusReader } from "../../src/release/source-status-publication";
import { writeAcceptedReleaseCandidate } from "../support/release-candidate";

const execFileAsync = promisify(execFile);

describe("filesystem release object store", () => {
  let directory: string;
  let objectStore: FilesystemReleaseObjectStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "hs-tracker-fs-release-"));
    objectStore = new FilesystemReleaseObjectStore({ directory });
  });

  afterEach(async () => {
    await execFileAsync("rm", ["-rf", directory]);
  });

  it("returns null for a missing object", async () => {
    await expect(objectStore.getObject("objects/missing")).resolves.toBeNull();
  });

  it("streams immutable objects and rejects a differing rewrite", async () => {
    const bytes = Buffer.from("immutable release object body");
    const key = "objects/artifact.bin";
    await objectStore.putImmutable(
      key,
      Readable.from(chunks(bytes)),
      releaseObjectIdentity(bytes),
    );

    const stored = await objectStore.getObject(key);
    expect(stored).not.toBeNull();
    await expect(collect(stored?.body)).resolves.toEqual(bytes);

    await objectStore.putImmutable(
      key,
      Readable.from(chunks(bytes)),
      releaseObjectIdentity(bytes),
    );

    const differing = Buffer.from("a different immutable body");
    await expect(
      objectStore.putImmutable(
        key,
        Readable.from(chunks(differing)),
        releaseObjectIdentity(differing),
      ),
    ).rejects.toThrow(/already differs/u);
  });

  it("rejects a stored object whose bytes contradict the declared identity", async () => {
    const bytes = Buffer.from("declared and actual differ");
    await expect(
      objectStore.putImmutable(
        "objects/lying.bin",
        Readable.from(chunks(bytes)),
        releaseObjectIdentity(Buffer.from("something else entirely")),
      ),
    ).rejects.toThrow(/do not match their identity/u);
    await expect(
      objectStore.getObject("objects/lying.bin"),
    ).resolves.toBeNull();
  });

  it("replaces a pointer only from the version the caller observed", async () => {
    const key = "deployment-pointers/current.json";
    const first = Buffer.from(JSON.stringify({ current: 1 }));
    const firstVersion = await objectStore.compareAndSwap(key, null, first);

    await expect(
      objectStore.compareAndSwap(key, null, Buffer.from("stale")),
    ).rejects.toBeInstanceOf(ReleasePointerConflictError);

    const second = Buffer.from(JSON.stringify({ current: 2 }));
    const secondVersion = await objectStore.compareAndSwap(
      key,
      firstVersion,
      second,
    );
    expect(secondVersion).not.toBe(firstVersion);

    const stored = await objectStore.getObject(key);
    expect(stored?.version).toBe(secondVersion);
    await expect(collect(stored?.body)).resolves.toEqual(second);
  });

  it("rejects keys that escape the store directory", async () => {
    await expect(
      objectStore.getObject("../escape"),
    ).rejects.toThrow(/escapes the store directory/u);
  });

  it("promotes, rolls back, and hydrates exact pairings through the local store", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-fs-promote-"));
    const firstCandidate = await writeAcceptedReleaseCandidate(
      join(root, "first"),
      { baciRelease: "V202601" },
    );
    const secondCandidate = await writeAcceptedReleaseCandidate(
      join(root, "second"),
      {
        baciRelease: "V202601",
        productCatalogVersion: "v2",
        productSearchBuildId: "product-search-v1-3333333333333333",
      },
    );
    const firstPromotionInput = await writeAcceptedPromotionInput(
      root,
      "first",
      firstCandidate,
    );
    const secondPromotionInput = await writeAcceptedPromotionInput(
      root,
      "second",
      secondCandidate,
    );
    const environment = {
      ...process.env,
      HS_TRACKER_RELEASE_OBJECT_STORE: "filesystem",
      HS_TRACKER_RELEASE_FILESYSTEM_PATH: directory,
    };

    const first = await runReleaseCommand(
      "scripts/release/promote-release.ts",
      [
        "--analysis-directory",
        firstCandidate.analysisDirectoryPath,
        "--product-catalog-directory",
        firstCandidate.productCatalogDirectoryPath,
        "--activated-at",
        "2026-07-12T02:00:00Z",
        "--promotion-input",
        firstPromotionInput,
      ],
      environment,
      root,
    );
    const second = await runReleaseCommand(
      "scripts/release/promote-release.ts",
      [
        "--analysis-directory",
        secondCandidate.analysisDirectoryPath,
        "--product-catalog-directory",
        secondCandidate.productCatalogDirectoryPath,
        "--activated-at",
        "2026-07-12T03:00:00Z",
        "--promotion-input",
        secondPromotionInput,
      ],
      environment,
      root,
    );

    const promotedStatus = await new SourceStatusReader(objectStore).current();
    expect(promotedStatus).toMatchObject({
      servedBaciRelease: "V202601",
      state: "LATEST_KNOWN",
    });

    const rolledBack = await runReleaseCommand(
      "scripts/release/rollback-release.ts",
      ["--activated-at", "2026-07-12T04:00:00Z"],
      environment,
      root,
    );

    expect(first).toMatchObject({
      schemaVersion: "published-deployment-v1",
      previousDeploymentPairingId: null,
    });
    expect(second).toMatchObject({
      previousDeploymentPairingId: first.deploymentPairingId,
    });
    expect(rolledBack).toMatchObject({
      analysisBuildId: first.analysisBuildId,
      productSearchBuildId: first.productSearchBuildId,
      activatedAt: "2026-07-12T04:00:00Z",
      previousDeploymentPairingId: second.deploymentPairingId,
    });
    await expect(new ReleasePublisher(objectStore).current()).resolves.toEqual(
      rolledBack,
    );

    const reader = createRuntimeReleaseObjectReader(environment);
    await expect(
      new SourceStatusReader(reader).current(),
    ).resolves.toMatchObject({
      servedBaciRelease: rolledBack.baciRelease,
      rollbackActive: true,
      state: "REFRESH_DELAYED",
    });

    const hydrated = await new ReleaseHydrator(reader).hydrateCurrent({
      volumePath: join(root, "volume"),
    });
    expect(hydrated.deployment).toEqual(rolledBack);
    await expect(
      readFile(hydrated.analysisArtifactPath),
    ).resolves.toEqual(
      await readFile(
        join(firstCandidate.analysisDirectoryPath, "candidate-market.duckdb"),
      ),
    );
    await expect(readFile(hydrated.productCatalogPath)).resolves.toEqual(
      await readFile(
        join(
          firstCandidate.productCatalogDirectoryPath,
          "product-catalog.json",
        ),
      ),
    );

    await execFileAsync("rm", ["-rf", root]);
  }, 60_000);
});

async function* chunks(bytes: Buffer): AsyncIterable<Uint8Array> {
  const midpoint = Math.ceil(bytes.length / 2);
  yield bytes.subarray(0, midpoint);
  yield bytes.subarray(midpoint);
}

async function collect(
  body: AsyncIterable<Uint8Array> | undefined,
): Promise<Buffer> {
  if (body === undefined) {
    throw new Error("Expected a stored object.");
  }
  const collected: Buffer[] = [];
  for await (const chunk of body) {
    collected.push(Buffer.from(chunk));
  }
  return Buffer.concat(collected);
}

async function writeAcceptedPromotionInput(
  root: string,
  label: string,
  candidate: {
    analysisDirectoryPath: string;
    productCatalogDirectoryPath: string;
  },
): Promise<string> {
  const [analysisManifest, catalogManifest] = await Promise.all([
    readFile(
      join(candidate.analysisDirectoryPath, "artifact-manifest.json"),
      "utf8",
    ).then(
      (value) =>
        JSON.parse(value) as {
          baciRelease: string;
          artifact: { sha256: string };
        },
    ),
    readFile(
      join(candidate.productCatalogDirectoryPath, "catalog-manifest.json"),
      "utf8",
    ).then((value) => JSON.parse(value) as { productSearchBuildId: string }),
  ]);
  const identity = {
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    buildId: `fs-release-${label}`,
    baciRelease: analysisManifest.baciRelease,
    analysisBuildId: `analysis-${label}`,
    productSearchBuildId: catalogManifest.productSearchBuildId,
    artifactSha256: analysisManifest.artifact.sha256,
    deploymentPairingId: `deployment-${label}`,
    sourceStatusSnapshotId: `source-status-${label}`,
    machineId: `machine-${label}`,
    machineClass: "local",
    region: "loc",
  };
  const evidence = [];
  for (const [gate, requiredChecks] of Object.entries(
    PROMOTION_GATE_REQUIRED_CHECKS,
  )) {
    const relativePath = `reports/promotion/${label}/${gate}.json`;
    const reportBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: `${gate}-report-v1`,
        gate,
        measurementClass: "candidate",
        status: "accepted",
        identity,
        checks: requiredChecks.map((name) => ({ name, status: "accepted" })),
      })}\n`,
    );
    const reportSha256 = createHash("sha256")
      .update(reportBytes)
      .digest("hex");
    await mkdir(join(root, "reports/promotion", label), { recursive: true });
    await writeFile(join(root, relativePath), reportBytes);
    evidence.push({
      gate,
      schemaVersion: `${gate}-report-v1`,
      status: "accepted",
      identity,
      reportSha256,
      measuredAt: "2026-07-12T01:30:00Z",
      windowStartedAt: "2026-07-12T01:00:00Z",
      windowEndedAt: "2026-07-12T01:30:00Z",
      sampleCount: 100,
      retainedLogs: [relativePath],
      attempts: [
        {
          attemptedAt: "2026-07-12T01:30:00Z",
          status: "accepted",
          logSha256: reportSha256,
        },
      ],
    });
  }
  const inputPath = join(root, `promotion-${label}.json`);
  await writeFile(
    inputPath,
    `${JSON.stringify({
      schemaVersion: "production-promotion-input-v1",
      evaluatedAt: "2026-07-12T01:45:00Z",
      identity,
      toolVersions: {
        node: "24.17.0",
        npm: "11.13.0",
        next: "16.2.10",
        duckdb: "1.5.4-r.1",
        playwright: "1.61.1",
      },
      evidence,
    })}\n`,
  );
  return inputPath;
}

async function runReleaseCommand(
  script: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  workingDirectory = process.cwd(),
): Promise<PublishedDeployment> {
  const repositoryRoot = process.cwd();
  const result = await execFileAsync(
    join(repositoryRoot, "node_modules", ".bin", "tsx"),
    [join(repositoryRoot, script), ...arguments_],
    { cwd: workingDirectory, env: environment },
  );
  return JSON.parse(result.stdout) as PublishedDeployment;
}
