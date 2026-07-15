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

import {
  createCandidateMarketV1TradeAnalyticsPlatform,
  createTradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createCandidateMarketDatasetPackageFromArtifacts,
  createTradeExplorerDatasetPackageFromArtifacts,
  createTradeTrendDatasetPackageFromArtifacts,
  readAnalysisArtifactManifest,
} from "../../src/evidence/analysis-artifact-manifest";
import { DuckDbTradeEvidenceSource } from "../../src/evidence/duckdb-trade-evidence-source";
import type {
  CmsV1Inputs,
  TradeEvidenceSource,
} from "../../src/evidence/trade-evidence-source";
import type { TradeTrendV1Inputs } from "../../src/domain/trade-trend/result";

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
        "b058b1ee6e128559db7b8768e14594cad216b670bf4d2c5882da0c877d8d2d15",
      artifact: {
        schemaVersion: "candidate-market-artifact-v1",
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      tableRowCounts: {
        bilateral_year: 14,
        market_year: 14,
        product_year: 13,
        economy: 3,
        product: 2,
      },
      benchmarkQueries: [
        {
          role: "sparse",
          productCode: "010121",
          exporterCode: "156",
          completeRowCount: 3,
          primaryWindowRowCount: 2,
          candidateCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "median",
          productCode: "010121",
          exporterCode: "156",
          completeRowCount: 3,
          primaryWindowRowCount: 2,
          candidateCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "upper-quartile",
          productCode: "010121",
          exporterCode: "156",
          completeRowCount: 3,
          primaryWindowRowCount: 2,
          candidateCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
        {
          role: "maximum-row",
          productCode: "851712",
          exporterCode: "276",
          completeRowCount: 11,
          primaryWindowRowCount: 5,
          candidateCount: 1,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "complete-bilateral-row-count-v1",
        },
      ],
      tradeTrendBenchmarkQueries: [
        {
          role: "sparse",
          productCode: "010121",
          importerCode: "276",
          windowRowCount: 2,
          pairRowCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "market-year-importer-row-count-v1",
        },
        {
          role: "median",
          productCode: "010121",
          importerCode: "276",
          windowRowCount: 2,
          pairRowCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "market-year-importer-row-count-v1",
        },
        {
          role: "upper-quartile",
          productCode: "010121",
          importerCode: "276",
          windowRowCount: 2,
          pairRowCount: 2,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "market-year-importer-row-count-v1",
        },
        {
          role: "maximum-row",
          productCode: "851712",
          importerCode: "842",
          windowRowCount: 7,
          pairRowCount: 6,
          resultBytes: expect.any(Number),
          selectionAlgorithm: "market-year-importer-row-count-v1",
        },
      ],
    });
    expect(report).toMatchObject({
      schemaVersion: "candidate-market-artifact-build-report-v1",
      status: "accepted",
      artifactManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reconciliation: {
        sourceRows: 14,
        bilateralRows: 14,
        sourceValueTotalKusd: "140.125",
        bilateralValueTotalKusd: "140.125",
        sourceQuantityPresentCount: 12,
        marketQuantityPresentCount: 12,
        sourceQuantityTotalTons: "16.875",
        marketQuantityTotalTons: "16.875",
      },
      maximumRowSmokeResult: {
        status: "accepted",
        productCode: "851712",
        exporterCode: "276",
        candidateCount: 1,
        resultBytes: expect.any(Number),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(report.reconciliation.annual.slice(-2)).toEqual([
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
    ]);
    expect(report.benchmarkQueries).toEqual(manifest.benchmarkQueries);
    expect(report.tradeTrendBenchmarkQueries).toEqual(
      manifest.tradeTrendBenchmarkQueries,
    );
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
          year: 2014,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2015,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2016,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2017,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2018,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2019,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2020,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2021,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
        },
        {
          year: 2022,
          product_id: 2,
          exporter_code: 276,
          importer_code: 842,
          value_kusd: "10.125",
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
  }, 20_000);

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
        ingestedYears: { start: 2014, end: 2024 },
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
      const fixtureSource: TradeEvidenceSource = {
        async loadCmsV1Inputs() {
          return expected;
        },
      };
      const manifest = await readAnalysisArtifactManifest(
        outcome.artifactManifestPath,
      );
      const datasetPackage =
        createCandidateMarketDatasetPackageFromArtifacts({
          manifest,
          analysisReleaseCatalogSha256:
            expected.analysisReleaseCatalogSha256,
          previousManifest: null,
        });
      const platform = (evidenceSource: TradeEvidenceSource) =>
        createCandidateMarketV1TradeAnalyticsPlatform({
          evidenceSource,
          datasetPackages: new Map([
            [query.analysisBuildId, datasetPackage],
          ]),
        });
      const request = {
        recipe: "candidate-market-v1",
        ...query,
      } as const;
      const [productionOutcome, fixtureOutcome] = await Promise.all([
        platform(source).execute(request),
        platform(fixtureSource).execute(request),
      ]);

      expect(productionOutcome).toEqual(fixtureOutcome);
    } finally {
      source.close();
    }
  }, 20_000);

  it("matches fixture evidence and public results through the production Trade Trend adapter", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const outcome = await runArtifactCli({
      stagingManifestPath: staging.stagingManifestPath,
      workspace: join(root, "artifact-work"),
      reportPath: join(root, "artifact-report.json"),
    });
    const manifestJson = JSON.parse(
      await readFile(outcome.artifactManifestPath, "utf8"),
    );
    const query = {
      analysisBuildId: "safe-analysis-build",
      importerCode: "842",
      productCode: "851712",
    };
    const expected: TradeTrendV1Inputs = {
      analysisBuildId: query.analysisBuildId,
      analysisReleaseCatalogSha256: "a".repeat(64),
      artifact: {
        baciRelease: "VTEST001",
        buildId: manifestJson.artifact.buildId,
        schemaVersion: "candidate-market-artifact-v1",
        sha256: manifestJson.artifact.sha256,
      },
      release: {
        baciRelease: "VTEST001",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        ingestedYears: { start: 2014, end: 2024 },
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
      importer: {
        code: "842",
        name: "United States of America",
        iso3: "USA",
        identityNote: null,
      },
      product: {
        hsRevision: "HS12",
        code: "851712",
        descriptionEn:
          "Telephones for cellular networks or for other wireless networks",
      },
      finalizedObservations: [
        { year: 2019, state: "RECORDED_POSITIVE", valueCurrentUsd: "10125" },
        { year: 2020, state: "RECORDED_POSITIVE", valueCurrentUsd: "10125" },
        { year: 2021, state: "RECORDED_POSITIVE", valueCurrentUsd: "10125" },
        { year: 2022, state: "RECORDED_POSITIVE", valueCurrentUsd: "10125" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "3000" },
      ],
      provisionalObservation: {
        year: 2024,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: "4500",
      },
    };
    const source = await DuckDbTradeEvidenceSource.open({
      artifactPath: outcome.artifactPath,
      artifactManifestPath: outcome.artifactManifestPath,
      analysisBuildId: query.analysisBuildId,
      analysisReleaseCatalogSha256: expected.analysisReleaseCatalogSha256,
    });
    try {
      await expect(
        source.loadTradeTrendV1Inputs!(query),
      ).resolves.toEqual(expected);
      await expect(
        source.loadTradeTrendV1Inputs!({
          ...query,
          analysisBuildId: "retired-build",
        }),
      ).rejects.toMatchObject({ code: "ANALYSIS_BUILD_RETIRED" });
      await expect(
        source.loadTradeTrendV1Inputs!({ ...query, importerCode: "999" }),
      ).rejects.toMatchObject({ code: "UNKNOWN_IMPORTER" });
      await expect(
        source.loadTradeTrendV1Inputs!({
          ...query,
          productCode: "999999",
        }),
      ).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });

      // A sparse pairing exercises MISSING_OBSERVATION and
      // NO_RECORDED_POSITIVE_FLOW alongside RECORDED_POSITIVE, from the
      // same production evidence.
      const sparse = await source.loadTradeTrendV1Inputs!({
        ...query,
        importerCode: "276",
        productCode: "010121",
      });
      expect(sparse.finalizedObservations).toEqual([
        { year: 2019, state: "MISSING_OBSERVATION" },
        { year: 2020, state: "MISSING_OBSERVATION" },
        { year: 2021, state: "MISSING_OBSERVATION" },
        { year: 2022, state: "MISSING_OBSERVATION" },
        { year: 2023, state: "RECORDED_POSITIVE", valueCurrentUsd: "10125" },
      ]);
      const noFlow = await source.loadTradeTrendV1Inputs!({
        ...query,
        importerCode: "842",
        productCode: "010121",
      });
      expect(noFlow.finalizedObservations[0]).toEqual({
        year: 2019,
        state: "NO_RECORDED_POSITIVE_FLOW",
      });

      const fixtureSource: TradeEvidenceSource = {
        async loadCmsV1Inputs() {
          throw new Error("not used");
        },
        async loadTradeTrendV1Inputs() {
          return expected;
        },
      };
      const manifest = await readAnalysisArtifactManifest(
        outcome.artifactManifestPath,
      );
      const tradeTrendDatasetPackage =
        createTradeTrendDatasetPackageFromArtifacts(manifest);
      const platform = (evidenceSource: TradeEvidenceSource) =>
        createTradeAnalyticsPlatform({
          tradeTrend: {
            evidenceSource,
            datasetPackages: new Map([
              [query.analysisBuildId, tradeTrendDatasetPackage],
            ]),
          },
        });
      const request = {
        recipe: "trade-trend-v1",
        ...query,
      } as const;
      const [productionOutcome, fixtureOutcome] = await Promise.all([
        platform(source).execute(request),
        platform(fixtureSource).execute(request),
      ]);

      expect(productionOutcome).toEqual(fixtureOutcome);
    } finally {
      source.close();
    }
  }, 20_000);

  it(
    "resolves every sparse/median/upper-quartile/maximum-row Trade Trend package query",
    async () => {
      // This is a functional completeness check only. Wall-clock timing on
      // a shared development machine is not a valid Machine-class
      // performance gate (see docs/research/2026-07-11-mvp-performance-and-
      // caching-targets.md: "Developer-laptop results are smoke evidence
      // only"). Measured, accept/block latency gates for these same four
      // package-query identities run through the existing
      // src/promotion/performance-gates.ts pipeline against a deployed
      // candidate on the intended Machine class (see
      // tests/integration/performance-gates.test.ts).
      const root = await temporaryWorkspace();
      const staging = await stageSafeFixture(join(root, "staging-work"));
      const outcome = await runArtifactCli({
        stagingManifestPath: staging.stagingManifestPath,
        workspace: join(root, "artifact-work"),
        reportPath: join(root, "artifact-report.json"),
      });
      const manifest = await readAnalysisArtifactManifest(
        outcome.artifactManifestPath,
      );
      expect(manifest.tradeTrendBenchmarkQueries).toHaveLength(4);
      expect(
        manifest.tradeTrendBenchmarkQueries.map(({ role }) => role).sort(),
      ).toEqual(
        ["maximum-row", "median", "sparse", "upper-quartile"].sort(),
      );

      const source = await DuckDbTradeEvidenceSource.open({
        artifactPath: outcome.artifactPath,
        artifactManifestPath: outcome.artifactManifestPath,
        analysisBuildId: "safe-analysis-build",
        analysisReleaseCatalogSha256: "a".repeat(64),
      });
      try {
        for (const benchmark of manifest.tradeTrendBenchmarkQueries) {
          const inputs = await source.loadTradeTrendV1Inputs!({
            analysisBuildId: "safe-analysis-build",
            importerCode: benchmark.importerCode,
            productCode: benchmark.productCode,
          });

          expect(inputs.finalizedObservations, `${benchmark.role} query`).toHaveLength(5);
        }
      } finally {
        source.close();
      }
    },
    20_000,
  );

  it(
    "resolves every sparse/median/upper-quartile/maximum-row Supplier Competition package query",
    async () => {
      // This is a functional completeness check only, for the same reason
      // documented on the equivalent Trade Trend test above: wall-clock
      // timing on a shared development machine is not a valid Machine-class
      // performance gate. Measured, accept/block latency gates for these
      // same four package-query identities run through the existing
      // src/promotion/performance-gates.ts pipeline (see
      // tests/integration/performance-gates.test.ts).
      const root = await temporaryWorkspace();
      const staging = await stageSafeFixture(join(root, "staging-work"));
      const outcome = await runArtifactCli({
        stagingManifestPath: staging.stagingManifestPath,
        workspace: join(root, "artifact-work"),
        reportPath: join(root, "artifact-report.json"),
      });
      const manifest = await readAnalysisArtifactManifest(
        outcome.artifactManifestPath,
      );
      expect(manifest.supplierCompetitionBenchmarkQueries).toHaveLength(4);
      expect(
        manifest.supplierCompetitionBenchmarkQueries
          .map(({ role }) => role)
          .sort(),
      ).toEqual(
        ["maximum-row", "median", "sparse", "upper-quartile"].sort(),
      );

      const source = await DuckDbTradeEvidenceSource.open({
        artifactPath: outcome.artifactPath,
        artifactManifestPath: outcome.artifactManifestPath,
        analysisBuildId: "safe-analysis-build",
        analysisReleaseCatalogSha256: "a".repeat(64),
      });
      try {
        for (const benchmark of manifest.supplierCompetitionBenchmarkQueries) {
          const inputs = await source.loadSupplierCompetitionV1Inputs!({
            analysisBuildId: "safe-analysis-build",
            importerCode: benchmark.importerCode,
            productCode: benchmark.productCode,
          });

          expect(
            inputs.suppliers.length,
            `${benchmark.role} query`,
          ).toBeGreaterThanOrEqual(0);
          for (const supplier of inputs.suppliers) {
            expect(
              supplier.annualObservations,
              `${benchmark.role} query supplier ${supplier.economy.code}`,
            ).toHaveLength(5);
          }
        }
      } finally {
        source.close();
      }
    },
    20_000,
  );

  it(
    "publishes every sparse/median/upper-quartile/maximum-row Trade Explorer package query",
    async () => {
      const root = await temporaryWorkspace();
      const staging = await stageSafeFixture(join(root, "staging-work"));
      const outcome = await runArtifactCli({
        stagingManifestPath: staging.stagingManifestPath,
        workspace: join(root, "artifact-work"),
        reportPath: join(root, "artifact-report.json"),
      });
      const manifest = await readAnalysisArtifactManifest(
        outcome.artifactManifestPath,
      );
      expect(manifest.tradeExplorerDatasetPackage).toEqual({
        schemaVersion: "trade-explorer-dataset-capabilities-v1",
        capabilities: expect.arrayContaining([
          {
            id: "trade-explorer/bilateral-annual-value",
            version: "1",
          },
        ]),
      });
      expect(manifest.tradeExplorerBenchmarkQueries).toHaveLength(4);
      expect(
        manifest.tradeExplorerBenchmarkQueries.map(({ role }) => role).sort(),
      ).toEqual(
        ["maximum-row", "median", "sparse", "upper-quartile"].sort(),
      );

      const source = await DuckDbTradeEvidenceSource.open({
        artifactPath: outcome.artifactPath,
        artifactManifestPath: outcome.artifactManifestPath,
        analysisBuildId: "safe-analysis-build",
        analysisReleaseCatalogSha256: "a".repeat(64),
      });
      try {
        const platform = createTradeAnalyticsPlatform({
          tradeExplorer: {
            evidenceSource: source,
            datasetPackages: new Map([
              [
                "safe-analysis-build",
                createTradeExplorerDatasetPackageFromArtifacts(manifest),
              ],
            ]),
          },
        });
        for (const benchmark of manifest.tradeExplorerBenchmarkQueries) {
          const outcome = await platform.execute({
            recipe: "trade-explorer-v1",
            analysisBuildId: "safe-analysis-build",
            shape: benchmark.shape,
            dimensions: ["YEAR"],
            measures: benchmark.measures,
            filters: {
              year: { mode: "list", years: [] },
              exportEconomy: [benchmark.exportEconomyCode],
              importEconomy: [benchmark.importEconomyCode],
              hsProduct: [benchmark.hsProductCode],
            },
            sort: null,
          });

          expect(outcome.state, `${benchmark.role} query`).toBe("success");
          if (outcome.state !== "success") {
            throw new Error(`${benchmark.role} query did not succeed.`);
          }
          expect(outcome.payload.rowCount, `${benchmark.role} query`).toBe(
            benchmark.groupedRowCount,
          );
        }
      } finally {
        source.close();
      }
    },
    20_000,
  );

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
  }, 20_000);
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
      resolve("fixtures/pipeline/v1/analysis-safe-source.json"),
      "--approval",
      resolve(
        "fixtures/pipeline/v1/analysis-safe-coverage-approval.json",
      ),
      "--archive",
      resolve("fixtures/pipeline/v1/archives/analysis-safe-baci.zip"),
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
