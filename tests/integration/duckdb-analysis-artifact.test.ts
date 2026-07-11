import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

import { CmsV1CandidateMarketAnalysis } from "../../src/domain/candidate-market/analyze-candidate-markets";
import { DuckDbTradeEvidenceSource } from "../../src/evidence/duckdb-trade-evidence-source";
import type {
  CmsV1Inputs,
  TradeEvidenceSource,
} from "../../src/evidence/trade-evidence-source";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("immutable DuckDB analysis artifact CLI", () => {
  it("builds reconciled ordered tables from accepted staging", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const artifactWorkspace = join(root, "artifact-work");
    const reportPath = join(root, "artifact-report.json");

    const outcome = await runArtifactCli({
      stagingManifestPath: staging.stagingManifestPath,
      workspace: artifactWorkspace,
      reportPath,
    });
    const manifestBytes = await readFile(outcome.artifactManifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    expect(outcome.status).toBe("accepted");
    expect(manifest).toMatchObject({
      schemaVersion: "candidate-market-artifact-manifest-v1",
      baciRelease: "VTEST001",
      sourceSha256:
        "e29a37b682f465e6be73a283d456fc5a5ff04426dccbefea9dae3d24bfa39346",
      artifact: {
        schemaVersion: "candidate-market-artifact-v1",
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      tableRowCounts: {
        bilateral_year: 5,
        market_year: 5,
        product_year: 4,
        economy: 3,
        product: 2,
      },
      benchmarkQueries: [
        {
          role: "sparse",
          productCode: "851712",
          exporterCode: "276",
          completeRowCount: 2,
          primaryWindowRowCount: 1,
          candidateCount: 1,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "median",
          productCode: "851712",
          exporterCode: "276",
          completeRowCount: 2,
          primaryWindowRowCount: 1,
          candidateCount: 1,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "upper-quartile",
          productCode: "851712",
          exporterCode: "276",
          completeRowCount: 2,
          primaryWindowRowCount: 1,
          candidateCount: 1,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "maximum-row",
          productCode: "010121",
          exporterCode: "156",
          completeRowCount: 3,
          primaryWindowRowCount: 2,
          candidateCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
      ],
    });
    expect(report).toMatchObject({
      schemaVersion: "candidate-market-artifact-build-report-v1",
      status: "accepted",
      artifactManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reconciliation: {
        sourceRows: 5,
        bilateralRows: 5,
        sourceValueTotalKusd: "49.000",
        bilateralValueTotalKusd: "49.000",
        sourceQuantityPresentCount: 3,
        marketQuantityPresentCount: 3,
        sourceQuantityTotalTons: "3.375",
        marketQuantityTotalTons: "3.375",
        annual: [
          {
            year: 2023,
            sourceRows: 3,
            bilateralRows: 3,
            sourceValueTotalKusd: "33.375",
            bilateralValueTotalKusd: "33.375",
            marketValueTotalKusd: "33.375",
            productValueTotalKusd: "33.375",
            sourceQuantityPresentCount: 2,
            marketQuantityPresentCount: 2,
            sourceQuantityTotalTons: "1.625",
            marketQuantityTotalTons: "1.625",
          },
          {
            year: 2024,
            sourceRows: 2,
            bilateralRows: 2,
            sourceValueTotalKusd: "15.625",
            bilateralValueTotalKusd: "15.625",
            marketValueTotalKusd: "15.625",
            productValueTotalKusd: "15.625",
            sourceQuantityPresentCount: 1,
            marketQuantityPresentCount: 1,
            sourceQuantityTotalTons: "1.750",
            marketQuantityTotalTons: "1.750",
          },
        ],
      },
      maximumRowSmokeResult: {
        status: "accepted",
        productCode: "010121",
        exporterCode: "156",
        candidateCount: 2,
        resultBytes: expect.any(Number),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(report.benchmarkQueries).toEqual(manifest.benchmarkQueries);
    expect(report.artifactManifest).toEqual(manifest);
    expect(report.artifactManifestSha256).toBe(
      createHash("sha256").update(manifestBytes).digest("hex"),
    );
    expect((await stat(outcome.artifactPath)).size).toBe(
      manifest.artifact.bytes,
    );
    expect(await sha256File(outcome.artifactPath)).toBe(
      manifest.artifact.sha256,
    );

    const instance = await DuckDBInstance.create(outcome.artifactPath, {
      access_mode: "READ_ONLY",
    });
    const connection = await instance.connect();
    try {
      await expect(
        connection.run("CREATE TABLE forbidden_write(value INTEGER)"),
      ).rejects.toThrow();
      const schema = await connection.runAndReadAll(
        "DESCRIBE bilateral_year",
      );
      expect(
        schema
          .getRowObjectsJson()
          .map(({ column_name, column_type }) => ({
            column_name,
            column_type,
          })),
      ).toEqual([
        { column_name: "year", column_type: "USMALLINT" },
        { column_name: "product_id", column_type: "USMALLINT" },
        { column_name: "exporter_code", column_type: "USMALLINT" },
        { column_name: "importer_code", column_type: "USMALLINT" },
        { column_name: "value_kusd", column_type: "DECIMAL(38,3)" },
      ]);
      const bilateral = await connection.runAndReadAll(
        "SELECT * FROM bilateral_year",
      );
      expect(bilateral.getRowObjectsJson()).toEqual([
        {
          year: 2023,
          product_id: 1,
          exporter_code: 156,
          importer_code: 276,
          value_kusd: "10.125",
        },
        {
          year: 2023,
          product_id: 1,
          exporter_code: 156,
          importer_code: 842,
          value_kusd: "20.250",
        },
        {
          year: 2024,
          product_id: 1,
          exporter_code: 156,
          importer_code: 276,
          value_kusd: "11.125",
        },
        {
          year: 2023,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "3.000",
        },
        {
          year: 2024,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "4.500",
        },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const mixedManifestPath = join(root, "mixed-release-manifest.json");
    await writeFile(
      mixedManifestPath,
      JSON.stringify({ ...manifest, baciRelease: "VOTHER" }),
    );
    await expect(
      DuckDbTradeEvidenceSource.open({
        artifactPath: outcome.artifactPath,
        artifactManifestPath: mixedManifestPath,
        analysisBuildId: "mixed-release-build",
        analysisReleaseCatalogSha256: "a".repeat(64),
      }),
    ).rejects.toThrow(
      "Artifact metadata baci_release does not match its manifest.",
    );
  });

  it("matches fixture evidence and public results through the production adapter", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const outcome = await runArtifactCli({
      stagingManifestPath: staging.stagingManifestPath,
      workspace: join(root, "artifact-work"),
      reportPath: join(root, "artifact-report.json"),
    });
    const manifest = JSON.parse(
      await readFile(outcome.artifactManifestPath, "utf8"),
    );
    const query = {
      analysisBuildId: "safe-analysis-build",
      exporterCode: "156",
      productCode: "010121",
    };
    const expected: CmsV1Inputs = {
      analysisBuildId: query.analysisBuildId,
      analysisReleaseCatalogSha256: "a".repeat(64),
      artifact: {
        baciRelease: "VTEST001",
        buildId: manifest.artifact.buildId,
        schemaVersion: "candidate-market-artifact-v1",
        sha256: manifest.artifact.sha256,
      },
      release: {
        baciRelease: "VTEST001",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        ingestedYears: { start: 2023, end: 2024 },
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
      exporter: {
        code: "156",
        name: "China",
        iso3: "CHN",
        identityNote: null,
      },
      product: {
        hsRevision: "HS12",
        code: "010121",
        descriptionEn: "Horses: live, pure-bred breeding animals",
      },
      marketYears: [
        {
          year: 2023,
          candidateMarket: {
            code: "276",
            name: "Germany",
            iso3: "DEU",
            identityNote: null,
          },
          worldValueKusd: "10.125",
          selectedExporter: { state: "RECORDED", valueKusd: "10.125" },
          alternativeSuppliers: {
            count: 0,
            valueKusd: "0.000",
            valueSquareSumKusdSquared: "0.000000",
          },
          sourceFlowCount: 1,
          quantityPresentCount: 1,
        },
        {
          year: 2023,
          candidateMarket: {
            code: "842",
            name: "United States of America",
            iso3: "USA",
            identityNote: null,
          },
          worldValueKusd: "20.250",
          selectedExporter: { state: "RECORDED", valueKusd: "20.250" },
          alternativeSuppliers: {
            count: 0,
            valueKusd: "0.000",
            valueSquareSumKusdSquared: "0.000000",
          },
          sourceFlowCount: 1,
          quantityPresentCount: 0,
        },
      ],
      provisionalMarketYears: [
        {
          year: 2024,
          candidateMarket: {
            code: "276",
            name: "Germany",
            iso3: "DEU",
            identityNote: null,
          },
          worldValueKusd: "11.125",
          selectedExporter: { state: "RECORDED", valueKusd: "11.125" },
          alternativeSuppliers: {
            count: 0,
            valueKusd: "0.000",
            valueSquareSumKusdSquared: "0.000000",
          },
          sourceFlowCount: 1,
          quantityPresentCount: 1,
        },
      ],
      productYearTotals: [{ year: 2023, worldValueKusd: "30.375" }],
    };
    const source = await DuckDbTradeEvidenceSource.open({
      artifactPath: outcome.artifactPath,
      artifactManifestPath: outcome.artifactManifestPath,
      analysisBuildId: query.analysisBuildId,
      analysisReleaseCatalogSha256: expected.analysisReleaseCatalogSha256,
    });
    try {
      await expect(source.loadCmsV1Inputs(query)).resolves.toEqual(expected);
      await expect(
        source.loadCmsV1Inputs({
          ...query,
          analysisBuildId: "retired-build",
        }),
      ).rejects.toMatchObject({ code: "ANALYSIS_BUILD_RETIRED" });
      await expect(
        source.loadCmsV1Inputs({ ...query, exporterCode: "999" }),
      ).rejects.toMatchObject({ code: "UNKNOWN_EXPORTER" });
      await expect(
        source.loadCmsV1Inputs({ ...query, productCode: "999999" }),
      ).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
      const productionAnalysis = new CmsV1CandidateMarketAnalysis(source);
      const fixtureSource: TradeEvidenceSource = {
        async loadCmsV1Inputs() {
          return expected;
        },
      };
      const fixtureAnalysis = new CmsV1CandidateMarketAnalysis(fixtureSource);

      await expect(productionAnalysis.analyze(query)).resolves.toEqual(
        await fixtureAnalysis.analyze(query),
      );
    } finally {
      source.close();
    }
  });

  it("fails closed before publishing from changed accepted staging", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const stagingManifest = JSON.parse(
      await readFile(staging.stagingManifestPath, "utf8"),
    );
    const partitionPath = join(
      dirname(staging.stagingManifestPath),
      stagingManifest.partitions[0].relativePath,
    );
    await writeFile(partitionPath, Buffer.from("changed"), { flag: "a" });
    const artifactWorkspace = join(root, "artifact-work");
    const reportPath = join(root, "artifact-report.json");

    await expect(
      runArtifactCli({
        stagingManifestPath: staging.stagingManifestPath,
        workspace: artifactWorkspace,
        reportPath,
      }),
    ).rejects.toMatchObject({ code: "STAGING_INPUT_INVALID" });
    await expect(access(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(join(artifactWorkspace, "artifacts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hs-tracker-artifact-"));
  temporaryDirectories.push(path);
  return path;
}

async function stageSafeFixture(
  workspace: string,
): Promise<{ stagingManifestPath: string }> {
  const { stdout } = await execFileAsync(
    "npm",
    [
      "run",
      "--silent",
      "stage:baci",
      "--",
      "--descriptor",
      resolve("test/fixtures/pipeline/v1/safe-source.json"),
      "--approval",
      resolve("test/fixtures/pipeline/v1/safe-coverage-approval.json"),
      "--archive",
      resolve("test/fixtures/pipeline/v1/archives/safe-baci.zip"),
      "--workspace",
      workspace,
      "--report",
      join(workspace, "source-report.json"),
    ],
    { timeout: 60_000 },
  );
  return JSON.parse(stdout);
}

async function runArtifactCli({
  stagingManifestPath,
  workspace,
  reportPath,
}: {
  stagingManifestPath: string;
  workspace: string;
  reportPath: string;
}): Promise<{
  status: string;
  artifactPath: string;
  artifactManifestPath: string;
}> {
  try {
    const { stdout } = await execFileAsync(
      "npm",
      [
        "run",
        "--silent",
        "build:analysis-artifact",
        "--",
        "--staging-manifest",
        stagingManifestPath,
        "--workspace",
        workspace,
        "--report",
        reportPath,
        "--pipeline-git-sha",
        "0".repeat(40),
        "--built-at",
        "2026-01-22T00:00:00Z",
      ],
      { timeout: 120_000 },
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
      if (jsonLine !== undefined) {
        const parsed = JSON.parse(jsonLine) as {
          error: { code: string; message: string };
        };
        throw Object.assign(new Error(parsed.error.message), {
          code: parsed.error.code,
        });
      }
    }
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}
