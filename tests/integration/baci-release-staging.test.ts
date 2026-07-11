import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

type MutableSourceDescriptor = {
  sourceUrl: string;
  expectedBytes: number;
  expectedSha256: string;
};

type MutableCoverageApproval = {
  sourceSha256: string;
  annualChecks: {
    year: number;
    rowCount: number;
  }[];
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("pinned BACI release staging CLI", () => {
  it("reports missing required options as CLI argument errors", async () => {
    await expect(
      runStagingCliArguments([
        "--descriptor",
        resolve("test/fixtures/pipeline/v1/safe-source.json"),
      ]),
    ).rejects.toMatchObject({
      code: "CLI_ARGUMENT_INVALID",
      message: "--approval is required.",
    });
  });

  it("publishes validated year-partitioned Parquet from a safe archive", async () => {
    const workspace = await temporaryWorkspace();
    const reportPath = join(workspace, "source-report.json");
    const archivePath = resolve(
      "test/fixtures/pipeline/v1/archives/safe-baci.zip",
    );

    const outcome = await runStagingCli({
      descriptorPath: resolve(
        "test/fixtures/pipeline/v1/safe-source.json",
      ),
      approvalPath: resolve(
        "test/fixtures/pipeline/v1/safe-coverage-approval.json",
      ),
      archivePath,
      workspace,
      reportPath,
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const manifest = JSON.parse(
      await readFile(outcome.stagingManifestPath, "utf8"),
    );

    expect(outcome.status).toBe("accepted");
    expect(report).toMatchObject({
      schemaVersion: "baci-source-staging-report-v1",
      status: "accepted",
      source: {
        baciRelease: "VTEST001",
        bytes: 1058,
        sha256:
          "e29a37b682f465e6be73a283d456fc5a5ff04426dccbefea9dae3d24bfa39346",
      },
      dimensions: {
        economies: 3,
        products: 2,
      },
      annualChecks: [
        {
          year: 2023,
          rowCount: 3,
          quantityNullCount: 1,
          valueTotalKusd: "33.375",
        },
        {
          year: 2024,
          rowCount: 2,
          quantityNullCount: 1,
          valueTotalKusd: "15.625",
        },
      ],
      staging: {
        format: "parquet",
        partitionCount: 2,
        rowCount: 5,
        bytes: expect.any(Number),
      },
    });
    expect(manifest).toMatchObject({
      schemaVersion: "baci-parquet-staging-v1",
      sourceSha256:
        "e29a37b682f465e6be73a283d456fc5a5ff04426dccbefea9dae3d24bfa39346",
      partitions: [
        {
          year: 2023,
          relativePath: "year=2023/trade.parquet",
          rowCount: 3,
        },
        {
          year: 2024,
          relativePath: "year=2024/trade.parquet",
          rowCount: 2,
        },
      ],
    });
    expect(report.staging.parquetSchema).toEqual(manifest.parquetSchema);
    expect(report.staging.partitions).toEqual(manifest.partitions);
    expect(report.staging.bytes).toBe(
      manifest.partitions.reduce(
        (sum: number, partition: { bytes: number }) => sum + partition.bytes,
        0,
      ),
    );
    await expect(
      readFile(
        join(dirname(outcome.stagingManifestPath), "source-report.json"),
      ),
    ).resolves.toEqual(await readFile(reportPath));

    for (const partition of manifest.partitions as {
      relativePath: string;
    }[]) {
      const bytes = await readFile(
        join(outcome.stagingManifestPath, "..", partition.relativePath),
      );
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("PAR1");
      expect(bytes.subarray(-4).toString("ascii")).toBe("PAR1");
    }

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    try {
      const parquetGlob = join(
        dirname(outcome.stagingManifestPath),
        "year=*",
        "trade.parquet",
      ).replaceAll("'", "''");
      const aggregate = await connection.runAndReadAll(`
        SELECT
          COUNT(*)::UBIGINT AS "rowCount",
          COUNT_IF(quantity_tons IS NULL)::UBIGINT AS "quantityNullCount",
          COUNT_IF(product_code = '010121')::UBIGINT
            AS "leadingZeroProductCount",
          COUNT_IF(
            year IS NULL
            OR exporter_code IS NULL
            OR importer_code IS NULL
            OR product_code IS NULL
            OR value_kusd IS NULL
          )::UBIGINT AS "missingRequiredCount",
          SUM(value_kusd) AS "valueTotalKusd",
          SUM(quantity_tons) AS "quantityTotalTons"
        FROM read_parquet('${parquetGlob}', hive_partitioning = false)
      `);
      const types = await connection.runAndReadAll(`
        SELECT
          typeof(year) AS "yearType",
          typeof(exporter_code) AS "exporterType",
          typeof(importer_code) AS "importerType",
          typeof(product_code) AS "productType",
          typeof(value_kusd) AS "valueType",
          typeof(quantity_tons) AS "quantityType"
        FROM read_parquet('${parquetGlob}', hive_partitioning = false)
        LIMIT 1
      `);

      expect(aggregate.getRowObjectsJson()[0]).toEqual({
        rowCount: "5",
        quantityNullCount: "2",
        leadingZeroProductCount: "3",
        missingRequiredCount: "0",
        valueTotalKusd: "49.000",
        quantityTotalTons: "3.375",
      });
      expect(types.getRowObjectsJson()[0]).toEqual({
        yearType: "USMALLINT",
        exporterType: "USMALLINT",
        importerType: "USMALLINT",
        productType: "VARCHAR",
        valueType: "DECIMAL(38,3)",
        quantityType: "DECIMAL(38,3)",
      });
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it("preserves mill precision from BACI floating-point text artifacts", async () => {
    const inputs = await mutableFixtureInputs("floating-artifact.zip");

    const outcome = await runStagingCli(inputs);
    const report = JSON.parse(await readFile(inputs.reportPath, "utf8"));

    expect(outcome.status).toBe("accepted");
    expect(report.annualChecks).toMatchObject([
      {
        year: 2023,
        valueTotalKusd: "33.375",
        quantityTotalTons: "1.625",
      },
      {
        year: 2024,
        valueTotalKusd: "15.625",
        quantityTotalTons: "1.750",
      },
    ]);
  });

  it.each([
    ["unsafe-member.zip", "SOURCE_ARCHIVE_INVALID"],
    ["missing-member.zip", "SOURCE_ARCHIVE_INVALID"],
    ["crc-mismatch.zip", "SOURCE_ARCHIVE_INVALID"],
    ["bad-header.zip", "SOURCE_DATA_INVALID"],
    ["wrong-year.zip", "SOURCE_DATA_INVALID"],
    ["nonpositive-value.zip", "SOURCE_DATA_INVALID"],
    ["nonpositive-quantity.zip", "SOURCE_DATA_INVALID"],
    ["duplicate-key.zip", "SOURCE_DATA_INVALID"],
    ["missing-metadata.zip", "SOURCE_DATA_INVALID"],
    ["malformed-product.zip", "SOURCE_DATA_INVALID"],
    ["dimension-count.zip", "SOURCE_DATA_INVALID"],
    ["missing-required-value.zip", "SOURCE_DATA_INVALID"],
    ["documentation-mismatch.zip", "SOURCE_DATA_INVALID"],
  ] as const)(
    "fails closed for corrupt fixture %s",
    async (archiveName, expectedCode) => {
      const inputs = await mutableFixtureInputs(archiveName);

      await expect(runStagingCli(inputs)).rejects.toMatchObject({
        code: expectedCode,
      });
      await expect(access(inputs.reportPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stagingManifestPaths(inputs.workspace)).resolves.toEqual([]);
    },
  );

  it("rejects archive bytes that do not match the committed source pin", async () => {
    const workspace = await temporaryWorkspace();
    const descriptor = JSON.parse(
      await readFile(
        resolve("test/fixtures/pipeline/v1/safe-source.json"),
        "utf8",
      ),
    ) as MutableSourceDescriptor;
    descriptor.expectedSha256 = "0".repeat(64);
    const approval = JSON.parse(
      await readFile(
        resolve(
          "test/fixtures/pipeline/v1/safe-coverage-approval.json",
        ),
        "utf8",
      ),
    ) as MutableCoverageApproval;
    approval.sourceSha256 = descriptor.expectedSha256;
    const descriptorPath = join(workspace, "source.json");
    const approvalPath = join(workspace, "approval.json");
    await writeFile(descriptorPath, JSON.stringify(descriptor));
    await writeFile(approvalPath, JSON.stringify(approval));

    await expect(
      runStagingCli({
        descriptorPath,
        approvalPath,
        archivePath: resolve(
          "test/fixtures/pipeline/v1/archives/safe-baci.zip",
        ),
        workspace,
        reportPath: join(workspace, "source-report.json"),
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_ARCHIVE_MISMATCH",
    });
    await expect(stagingManifestPaths(workspace)).resolves.toEqual([]);
  });

  it("resumes the pinned source into temporary build storage", async () => {
    const workspace = await temporaryWorkspace();
    const archiveBytes = await readFile(
      resolve("test/fixtures/pipeline/v1/archives/safe-baci.zip"),
    );
    const resumeOffset = 311;
    const downloadsPath = join(workspace, "downloads");
    await mkdir(downloadsPath, { recursive: true });
    await writeFile(
      join(downloadsPath, "BACI_HS12_VTEST001.zip.partial"),
      archiveBytes.subarray(0, resumeOffset),
    );
    const ranges: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      ranges.push(range);
      if (range !== `bytes=${resumeOffset}-`) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": String(archiveBytes.length - resumeOffset),
        "Content-Range": `bytes ${resumeOffset}-${archiveBytes.length - 1}/${archiveBytes.length}`,
        "Content-Type": "application/zip",
      });
      response.end(archiveBytes.subarray(resumeOffset));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture source server did not bind a TCP port.");
    }

    try {
      const descriptor = JSON.parse(
        await readFile(
          resolve("test/fixtures/pipeline/v1/safe-source.json"),
          "utf8",
        ),
      ) as MutableSourceDescriptor;
      descriptor.sourceUrl = `http://127.0.0.1:${address.port}/BACI_HS12_VTEST001.zip`;
      const descriptorPath = join(workspace, "source.json");
      await writeFile(descriptorPath, JSON.stringify(descriptor));

      const outcome = await runStagingCli({
        descriptorPath,
        approvalPath: resolve(
          "test/fixtures/pipeline/v1/safe-coverage-approval.json",
        ),
        workspace,
        reportPath: join(workspace, "source-report.json"),
      });

      expect(outcome.status).toBe("accepted");
      expect(ranges).toEqual([`bytes=${resumeOffset}-`]);
      await expect(
        readFile(join(downloadsPath, "BACI_HS12_VTEST001.zip")),
      ).resolves.toEqual(archiveBytes);
      await expect(
        access(
          join(downloadsPath, "BACI_HS12_VTEST001.zip.partial"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("replaces an invalid completed download from the pinned source", async () => {
    const workspace = await temporaryWorkspace();
    const archiveBytes = await readFile(
      resolve("test/fixtures/pipeline/v1/archives/safe-baci.zip"),
    );
    const downloadsPath = join(workspace, "downloads");
    const completedPath = join(
      downloadsPath,
      "BACI_HS12_VTEST001.zip",
    );
    await mkdir(downloadsPath, { recursive: true });
    await writeFile(completedPath, "stale archive");
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        "Content-Length": String(archiveBytes.length),
        "Content-Type": "application/zip",
      });
      response.end(archiveBytes);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture source server did not bind a TCP port.");
    }

    try {
      const descriptor = JSON.parse(
        await readFile(
          resolve("test/fixtures/pipeline/v1/safe-source.json"),
          "utf8",
        ),
      ) as MutableSourceDescriptor;
      descriptor.sourceUrl = `http://127.0.0.1:${address.port}/BACI_HS12_VTEST001.zip`;
      const descriptorPath = join(workspace, "source.json");
      await writeFile(descriptorPath, JSON.stringify(descriptor));

      const outcome = await runStagingCli({
        descriptorPath,
        approvalPath: resolve(
          "test/fixtures/pipeline/v1/safe-coverage-approval.json",
        ),
        workspace,
        reportPath: join(workspace, "source-report.json"),
      });

      expect(outcome.status).toBe("accepted");
      expect(requests).toBe(1);
      await expect(readFile(completedPath)).resolves.toEqual(archiveBytes);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("rejects a corrupted existing staging publication", async () => {
    const inputs = await mutableFixtureInputs("safe-baci.zip");
    const outcome = await runStagingCli(inputs);
    const manifest = JSON.parse(
      await readFile(outcome.stagingManifestPath, "utf8"),
    ) as {
      partitions: { relativePath: string }[];
    };
    const partitionPath = join(
      dirname(outcome.stagingManifestPath),
      manifest.partitions[0]!.relativePath,
    );
    await writeFile(partitionPath, "corrupted");

    await expect(runStagingCli(inputs)).rejects.toMatchObject({
      code: "STAGING_PUBLICATION_FAILED",
    });
  });

  it("does not publish staging when the report cannot be prepared", async () => {
    const inputs = await mutableFixtureInputs("safe-baci.zip");
    const reportParent = join(inputs.workspace, "report-parent");
    await writeFile(reportParent, "not a directory");
    inputs.reportPath = join(reportParent, "source-report.json");

    await expect(runStagingCli(inputs)).rejects.toMatchObject({
      code: "REPORT_PUBLICATION_FAILED",
    });
    await expect(stagingManifestPaths(inputs.workspace)).resolves.toEqual([]);
  });

  it("retains annual drift evidence without publishing unapproved staging", async () => {
    const inputs = await mutableFixtureInputs("safe-baci.zip");
    const approval = JSON.parse(
      await readFile(inputs.approvalPath, "utf8"),
    ) as MutableCoverageApproval;
    approval.annualChecks[0]!.rowCount = 999;
    await writeFile(inputs.approvalPath, JSON.stringify(approval));

    await expect(runStagingCli(inputs)).rejects.toMatchObject({
      code: "SOURCE_COVERAGE_APPROVAL_REQUIRED",
    });
    await expect(stagingManifestPaths(inputs.workspace)).resolves.toEqual([]);
    await expect(
      readFile(inputs.reportPath, "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      schemaVersion: "baci-source-staging-report-v1",
      status: "approval-required",
      source: {
        baciRelease: "VTEST001",
        sha256:
          "e29a37b682f465e6be73a283d456fc5a5ff04426dccbefea9dae3d24bfa39346",
      },
      annualChecks: [
        { year: 2023, rowCount: 3 },
        { year: 2024, rowCount: 2 },
      ],
      coverageComparison: {
        approvedAnnualChecks: [
          { year: 2023, rowCount: 999 },
          { year: 2024, rowCount: 2 },
        ],
      },
      staging: null,
    });
  });
});

async function temporaryWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hs-tracker-baci-"));
  temporaryDirectories.push(path);
  return path;
}

async function mutableFixtureInputs(archiveName: string): Promise<{
  descriptorPath: string;
  approvalPath: string;
  archivePath: string;
  workspace: string;
  reportPath: string;
}> {
  const workspace = await temporaryWorkspace();
  const archivePath = resolve(
    "test/fixtures/pipeline/v1/archives",
    archiveName,
  );
  const archiveBytes = await readFile(archivePath);
  const descriptor = JSON.parse(
    await readFile(
      resolve("test/fixtures/pipeline/v1/safe-source.json"),
      "utf8",
    ),
  ) as MutableSourceDescriptor;
  descriptor.expectedBytes = (await stat(archivePath)).size;
  descriptor.expectedSha256 = createHash("sha256")
    .update(archiveBytes)
    .digest("hex");
  const approval = JSON.parse(
    await readFile(
      resolve("test/fixtures/pipeline/v1/safe-coverage-approval.json"),
      "utf8",
    ),
  ) as MutableCoverageApproval;
  approval.sourceSha256 = descriptor.expectedSha256;
  const descriptorPath = join(workspace, "source.json");
  const approvalPath = join(workspace, "approval.json");
  const reportPath = join(workspace, "source-report.json");
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  await writeFile(approvalPath, JSON.stringify(approval));
  return {
    descriptorPath,
    approvalPath,
    archivePath,
    workspace,
    reportPath,
  };
}

async function runStagingCli({
  descriptorPath,
  approvalPath,
  archivePath,
  workspace,
  reportPath,
}: {
  descriptorPath: string;
  approvalPath: string;
  archivePath?: string;
  workspace: string;
  reportPath: string;
}): Promise<{ status: string; stagingManifestPath: string }> {
  return runStagingCliArguments([
    "--descriptor",
    descriptorPath,
    "--approval",
    approvalPath,
    "--workspace",
    workspace,
    "--report",
    reportPath,
    ...(archivePath === undefined
      ? []
      : ["--archive", archivePath]),
  ]);
}

async function runStagingCliArguments(
  arguments_: string[],
): Promise<{ status: string; stagingManifestPath: string }> {
  try {
    const { stdout } = await execFileAsync(
      "npm",
      [
        "run",
        "--silent",
        "stage:baci",
        "--",
        ...arguments_,
      ],
      { timeout: 60_000 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string"
    ) {
      const jsonLine = error.stderr
        .split("\n")
        .find((line) => line.startsWith('{"error":'));
      if (jsonLine === undefined) {
        throw error;
      }
      const parsed = JSON.parse(jsonLine) as {
        error: { code: string; message: string };
      };
      throw Object.assign(new Error(parsed.error.message), {
        code: parsed.error.code,
      });
    }
    throw error;
  }
}

async function stagingManifestPaths(workspace: string): Promise<string[]> {
  try {
    return (
      await readdir(join(workspace, "staging"), {
        recursive: true,
      })
    ).filter((path) => path.endsWith("staging-manifest.json"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
