import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPromotionReleaseObjectStore,
  createRuntimeReleaseObjectReader,
} from "../../src/release/release-object-storage";
import { ReleaseHydrator } from "../../src/release/release-hydration";
import { ReleasePublisher } from "../../src/release/release-publication";
import { S3ReleaseObjectStore } from "../../src/release/s3-release-object-store";
import { writeAcceptedReleaseCandidate } from "../fixtures/release-candidate";

const MINIO_IMAGE =
  "minio/minio:RELEASE.2025-04-22T22-12-26Z@" +
  "sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e";
const MINIO_USERNAME = "hs-tracker-test";
const MINIO_PASSWORD = "hs-tracker-test-secret";
const BUCKET = "hs-tracker-release-test";
const execFileAsync = promisify(execFile);

describe("S3 release object store", () => {
  let containerId: string;
  let endpoint: string;
  let client: S3Client;
  let objectStore: S3ReleaseObjectStore;

  beforeAll(async () => {
    const started = await execFileAsync("docker", [
      "run",
      "--detach",
      "--rm",
      "--publish",
      "127.0.0.1::9000",
      "--env",
      `MINIO_ROOT_USER=${MINIO_USERNAME}`,
      "--env",
      `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
      MINIO_IMAGE,
      "server",
      "/data",
    ]);
    containerId = started.stdout.trim();
    const publishedPort = await execFileAsync("docker", [
      "port",
      containerId,
      "9000/tcp",
    ]);
    endpoint = `http://${publishedPort.stdout.trim()}`;
    await waitForMinio(endpoint);
    client = new S3Client({
      endpoint,
      forcePathStyle: true,
      region: "us-east-1",
      credentials: {
        accessKeyId: MINIO_USERNAME,
        secretAccessKey: MINIO_PASSWORD,
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    objectStore = new S3ReleaseObjectStore(client, { bucket: BUCKET });
  }, 120_000);

  afterAll(async () => {
    client?.destroy();
    if (containerId !== undefined) {
      await execFileAsync("docker", ["stop", "--time", "1", containerId]);
    }
  });

  it("streams immutable objects through an S3-compatible store", async () => {
    const bytes = Buffer.from("accepted release artifact", "utf8");
    const identity = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };

    await objectStore.putImmutable(
      "releases/VTEST001/artifact.bin",
      chunks(bytes),
      identity,
    );
    await objectStore.putImmutable(
      "releases/VTEST001/artifact.bin",
      chunks(bytes),
      identity,
    );

    const stored = await objectStore.getObject(
      "releases/VTEST001/artifact.bin",
    );
    expect(stored?.version).toMatch(/^"[a-f0-9]{32}"$/u);
    await expect(collect(stored?.body)).resolves.toEqual(bytes);

    const changed = Buffer.from("different release artifact", "utf8");
    await expect(
      objectStore.putImmutable(
        "releases/VTEST001/artifact.bin",
        chunks(changed),
        {
          bytes: changed.length,
          sha256: createHash("sha256").update(changed).digest("hex"),
        },
      ),
    ).rejects.toThrow("already differs");
  });

  it("leaves no object when storage rejects the upload checksum", async () => {
    const key = "checksum-fixtures/rejected.bin";
    const bytes = Buffer.from("checksum-protected release", "utf8");

    await expect(
      objectStore.putImmutable(key, chunks(bytes), {
        bytes: bytes.length,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow();
    await expect(objectStore.getObject(key)).resolves.toBeNull();
  });

  it("accepts an identity-equivalent object created without adapter metadata", async () => {
    const key = "retry-fixtures/external.bin";
    const bytes = Buffer.from("externally uploaded release", "utf8");
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
      }),
    );

    await expect(
      objectStore.putImmutable(key, chunks(bytes), identity(bytes)),
    ).resolves.toBeUndefined();
  });

  it("replaces a pointer only from the version the caller observed", async () => {
    const key = "test-pointers/current.json";
    const firstBytes = Buffer.from('{"current":"first"}\n', "utf8");
    const secondBytes = Buffer.from('{"current":"second"}\n', "utf8");

    const firstVersion = await objectStore.compareAndSwap(
      key,
      null,
      firstBytes,
    );

    await expect(
      objectStore.compareAndSwap(key, null, secondBytes),
    ).rejects.toThrow("changed concurrently");

    const secondVersion = await objectStore.compareAndSwap(
      key,
      firstVersion,
      secondBytes,
    );
    expect(secondVersion).not.toBe(firstVersion);

    await expect(
      objectStore.compareAndSwap(key, firstVersion, firstBytes),
    ).rejects.toThrow("changed concurrently");
    const stored = await objectStore.getObject(key);
    await expect(collect(stored?.body)).resolves.toEqual(secondBytes);
  });

  it("uses separate runtime-read and promotion-write credentials", async () => {
    const source = Buffer.from("runtime-readable release", "utf8");
    const sourceIdentity = identity(source);
    await objectStore.putImmutable(
      "credential-fixtures/source.txt",
      chunks(source),
      sourceIdentity,
    );
    const commonEnvironment = {
      HS_TRACKER_RELEASE_S3_BUCKET: BUCKET,
      HS_TRACKER_RELEASE_S3_ENDPOINT: endpoint,
      HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE: "true",
      HS_TRACKER_RELEASE_S3_REGION: "us-east-1",
    };
    const reader = createRuntimeReleaseObjectReader({
      ...commonEnvironment,
      HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID: MINIO_USERNAME,
      HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY: MINIO_PASSWORD,
      HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID: "not-the-writer",
      HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY: "not-the-writer-secret",
    });
    const writer = createPromotionReleaseObjectStore({
      ...commonEnvironment,
      HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID: "not-the-reader",
      HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY: "not-the-reader-secret",
      HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID: MINIO_USERNAME,
      HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY: MINIO_PASSWORD,
    });

    const readSource = await reader.getObject(
      "credential-fixtures/source.txt",
    );
    await expect(collect(readSource?.body)).resolves.toEqual(source);

    const promoted = Buffer.from("promotion-writable release", "utf8");
    await writer.putImmutable(
      "credential-fixtures/promoted.txt",
      chunks(promoted),
      identity(promoted),
    );
    const readPromoted = await reader.getObject(
      "credential-fixtures/promoted.txt",
    );
    await expect(collect(readPromoted?.body)).resolves.toEqual(promoted);
  });

  it("promotes, rolls back, and hydrates exact pairings through MinIO", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-s3-release-"));
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
    const environment = {
      ...process.env,
      HS_TRACKER_RELEASE_S3_BUCKET: BUCKET,
      HS_TRACKER_RELEASE_S3_ENDPOINT: endpoint,
      HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE: "true",
      HS_TRACKER_RELEASE_S3_REGION: "us-east-1",
      HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID: MINIO_USERNAME,
      HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY: MINIO_PASSWORD,
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
      ],
      environment,
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
      ],
      environment,
    );
    const rolledBack = await runReleaseCommand(
      "scripts/release/rollback-release.ts",
      ["--activated-at", "2026-07-12T04:00:00Z"],
      environment,
    );

    expect(first).toMatchObject({
      schemaVersion: "published-deployment-v1",
      productSearchBuildId: "product-search-v1-1111111111111111",
      previousDeploymentPairingId: null,
    });
    expect(second).toMatchObject({
      productSearchBuildId: "product-search-v1-3333333333333333",
      previousDeploymentPairingId: first.deploymentPairingId,
    });
    expect(rolledBack).toMatchObject({
      deploymentPairingId: first.deploymentPairingId,
      activatedAt: "2026-07-12T04:00:00Z",
      previousDeploymentPairingId: second.deploymentPairingId,
    });
    await expect(new ReleasePublisher(objectStore).current()).resolves.toEqual(
      rolledBack,
    );

    const reader = createRuntimeReleaseObjectReader({
      HS_TRACKER_RELEASE_S3_BUCKET: BUCKET,
      HS_TRACKER_RELEASE_S3_ENDPOINT: endpoint,
      HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE: "true",
      HS_TRACKER_RELEASE_S3_REGION: "us-east-1",
      HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID: MINIO_USERNAME,
      HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY: MINIO_PASSWORD,
    });
    const hydrated = await new ReleaseHydrator(reader).hydrateCurrent({
      volumePath: join(root, "volume"),
    });
    expect(hydrated.deployment).toEqual(rolledBack);
    await expect(
      readFile(hydrated.analysisArtifactPath, "utf8"),
    ).resolves.toBe("fixture DuckDB artifact v1");
    await expect(readFile(hydrated.productCatalogPath, "utf8")).resolves.toBe(
      "fixture product catalog v1",
    );

    const publicMetadata = await activePublicMetadata();
    for (const metadata of publicMetadata) {
      expect(metadata).not.toContain(endpoint);
      expect(metadata).not.toContain(MINIO_USERNAME);
      expect(metadata).not.toContain(MINIO_PASSWORD);
    }
  }, 30_000);

  async function activePublicMetadata(): Promise<string[]> {
    const pointerText = await objectText(
      objectStore,
      "deployment-pointers/current.json",
    );
    const pointer = JSON.parse(pointerText) as {
      current: { key: string };
    };
    const deploymentText = await objectText(
      objectStore,
      pointer.current.key,
    );
    const deployment = JSON.parse(deploymentText) as {
      analysis: {
        artifact: { manifest: { key: string } };
        releaseCatalog: { key: string };
      };
      productSearch: { manifest: { key: string } };
    };
    const [releaseCatalogText, artifactManifestText, catalogManifestText] =
      await Promise.all([
        objectText(
          objectStore,
          deployment.analysis.releaseCatalog.key,
        ),
        objectText(
          objectStore,
          deployment.analysis.artifact.manifest.key,
        ),
        objectText(objectStore, deployment.productSearch.manifest.key),
      ]);
    return [
      pointerText,
      deploymentText,
      releaseCatalogText,
      artifactManifestText,
      catalogManifestText,
    ];
  }
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
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function objectText(
  objectStore: S3ReleaseObjectStore,
  key: string,
): Promise<string> {
  const stored = await objectStore.getObject(key);
  return (await collect(stored?.body)).toString("utf8");
}

function identity(bytes: Buffer): { bytes: number; sha256: string } {
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function runReleaseCommand(
  script: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const result = await execFileAsync(
    join(process.cwd(), "node_modules", ".bin", "tsx"),
    [script, ...arguments_],
    {
      cwd: process.cwd(),
      env: environment,
    },
  );
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function waitForMinio(endpoint: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/minio/health/live`);
      if (response.ok) {
        return;
      }
    } catch {
      // The container may not have bound its listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("MinIO did not become healthy within 15 seconds.");
}
