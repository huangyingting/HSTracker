import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";

import { CANDIDATE_MARKET_V1_DATASET_DECLARATION } from "../../src/domain/trade-analytics/dataset-package";
import { createCandidateMarketV1TradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createCandidateMarketDatasetPackageFromArtifacts,
  readAnalysisArtifactManifest,
} from "../../src/evidence/analysis-artifact-manifest";
import { DuckDbTradeEvidenceSource } from "../../src/evidence/duckdb-trade-evidence-source";

const ARTIFACT_SCHEMA_VERSION = "candidate-market-artifact-v1";
const ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "candidate-market-artifact-manifest-v1";
const ARTIFACT_REPORT_SCHEMA_VERSION =
  "candidate-market-artifact-build-report-v1";
const ARTIFACT_SIZE_TARGET_BYTES = 8 * 1024 * 1024 * 1024;
const ARTIFACT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const TAIWAN_PROXY_NOTE =
  "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.";
const AGGREGATE_ECONOMY_CODES = [697, 711] as const;

type StagingFile = {
  relativePath: string;
  rowCount: number;
  bytes: number;
  sha256: string;
};

type StagingManifest = {
  schemaVersion: "baci-parquet-staging-v1";
  sourceSha256: string;
  baciRelease: string;
  hsRevision: "HS12";
  sourceUpdateDate: string;
  ingestedYears: number[];
  finalizedYears: number[];
  provisionalYears: number[];
  scoreWindow: { start: number; end: number };
  partitions: (StagingFile & { year: number })[];
  dimensionFiles: {
    products: StagingFile;
    economies: StagingFile;
  };
  rowCount: number;
  dimensions: { products: number; economies: number };
  duckdbVersion: string;
  coverageApprovalSha256: string;
};

type AnnualSourceCheck = {
  year: number;
  rowCount: number;
  exporterCount: number;
  importerCount: number;
  observedProductCount: number;
  quantityPresentCount: number;
  quantityNullCount: number;
  valueTotalKusd: string;
  quantityTotalTons: string;
};

type SourceReport = {
  schemaVersion: "baci-source-staging-report-v1";
  status: "accepted";
  source: {
    baciRelease: string;
    url: string;
    archiveFilename: string;
    bytes: number;
    sha256: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    license: { name: string; url: string };
    attribution: string;
  };
  annualChecks: AnnualSourceCheck[];
  staging: {
    manifestSha256: string;
  };
};

type ArtifactReconciliation = {
  sourceRows: number;
  bilateralRows: number;
  sourceValueTotalKusd: string;
  bilateralValueTotalKusd: string;
  sourceQuantityPresentCount: number;
  marketQuantityPresentCount: number;
  sourceQuantityTotalTons: string;
  marketQuantityTotalTons: string;
  annual: {
    year: number;
    sourceRows: number;
    bilateralRows: number;
    sourceValueTotalKusd: string;
    bilateralValueTotalKusd: string;
    marketValueTotalKusd: string;
    productValueTotalKusd: string;
    sourceQuantityPresentCount: number;
    marketQuantityPresentCount: number;
    sourceQuantityTotalTons: string;
    marketQuantityTotalTons: string;
  }[];
};

type BenchmarkRole = "sparse" | "median" | "upper-quartile" | "maximum-row";

type BenchmarkQuery = {
  role: BenchmarkRole;
  productCode: string;
  exporterCode: string;
  completeRowCount: number;
  primaryWindowRowCount: number;
  candidateCount: number;
  resultBytes: number;
  selectionAlgorithm: "complete-bilateral-row-count-v1";
};

type MaximumRowSmokeResult = {
  status: "accepted";
  productCode: string;
  exporterCode: string;
  candidateCount: number;
  resultBytes: number;
  resultSha256: string;
};

export type BuildAnalysisArtifactOptions = {
  stagingManifestPath: string;
  workspacePath: string;
  reportPath: string;
  pipelineGitSha: string;
  builtAt: string;
};

export type BuildAnalysisArtifactOutcome = {
  status: "accepted";
  artifactPath: string;
  artifactManifestPath: string;
  reportPath: string;
};

export type AnalysisArtifactBuildErrorCode =
  | "ARTIFACT_BUILD_FAILED"
  | "ARTIFACT_PUBLICATION_FAILED"
  | "ARTIFACT_RECONCILIATION_FAILED"
  | "ARTIFACT_SIZE_LIMIT_EXCEEDED"
  | "CLI_ARGUMENT_INVALID"
  | "STAGING_INPUT_INVALID";

export class AnalysisArtifactBuildError extends Error {
  constructor(
    readonly code: AnalysisArtifactBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisArtifactBuildError";
  }
}

export async function buildAnalysisArtifact(
  options: BuildAnalysisArtifactOptions,
): Promise<BuildAnalysisArtifactOutcome> {
  const stagingManifestPath = resolve(options.stagingManifestPath);
  const stagingPath = dirname(stagingManifestPath);
  const workspacePath = resolve(options.workspacePath);
  const reportPath = resolve(options.reportPath);
  validateBuildIdentity(options.pipelineGitSha, options.builtAt);
  const stagingManifestBytes = await readFile(stagingManifestPath);
  const stagingManifest = parseStagingManifest(
    stagingManifestBytes,
    stagingManifestPath,
  );
  const sourceReportPath = join(stagingPath, "source-report.json");
  const sourceReportBytes = await readFile(sourceReportPath);
  const sourceReport = parseSourceReport(sourceReportBytes, sourceReportPath);
  await validateStagingInput({
    stagingPath,
    stagingManifest,
    stagingManifestBytes,
    sourceReport,
  });

  const temporaryPath = join(workspacePath, "temporary");
  const spillPath = join(temporaryPath, "duckdb-spill");
  const partialArtifactPath = join(
    temporaryPath,
    `${stagingManifest.sourceSha256}-${process.pid}.duckdb.partial`,
  );
  await mkdir(spillPath, { recursive: true });
  await rm(partialArtifactPath, { force: true });

  const timings: Record<string, number> = {};
  const buildStarted = performance.now();
  let tableRowCounts: Record<string, number>;
  let reconciliation: ArtifactReconciliation;
  let duckdbVersion: string;
  try {
    const instance = await DuckDBInstance.create(partialArtifactPath, {
      threads: "2",
      memory_limit: "4GB",
      temp_directory: spillPath,
    });
    const connection = await instance.connect();
    try {
      await connection.run("SET preserve_insertion_order = true");
      const schemaStarted = performance.now();
      await connection.run(
        await readFile(
          resolve("data/schemas/candidate-market-artifact-v1.sql"),
          "utf8",
        ),
      );
      timings.schemaMs = elapsedMilliseconds(schemaStarted);

      const tablesStarted = performance.now();
      await populateArtifactTables(
        connection,
        stagingPath,
        stagingManifest,
        sha256(stagingManifestBytes),
      );
      timings.tablesMs = elapsedMilliseconds(tablesStarted);

      const reconciliationStarted = performance.now();
      ({ tableRowCounts, reconciliation } = await reconcileArtifact(
        connection,
        stagingManifest,
        sourceReport,
      ));
      timings.reconciliationMs = elapsedMilliseconds(reconciliationStarted);

      const optimizeStarted = performance.now();
      await connection.run("ANALYZE");
      await connection.run("CHECKPOINT");
      timings.optimizeMs = elapsedMilliseconds(optimizeStarted);
      const version = await queryOne(
        connection,
        "SELECT version() AS version",
      );
      duckdbVersion = requireQueryString(version, "version");
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  } catch (error) {
    await rm(partialArtifactPath, { force: true });
    if (error instanceof AnalysisArtifactBuildError) {
      throw error;
    }
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_BUILD_FAILED",
      `DuckDB artifact build failed: ${errorMessage(error)}`,
    );
  }

  const readOnlyStarted = performance.now();
  await verifyReadOnlyArtifact(partialArtifactPath, tableRowCounts);
  timings.readOnlyReopenMs = elapsedMilliseconds(readOnlyStarted);
  const artifactIdentity = await fileIdentity(partialArtifactPath);
  if (artifactIdentity.bytes > ARTIFACT_SIZE_LIMIT_BYTES) {
    await rm(partialArtifactPath, { force: true });
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_SIZE_LIMIT_EXCEEDED",
      `Artifact is ${artifactIdentity.bytes} bytes; the limit is ${ARTIFACT_SIZE_LIMIT_BYTES}.`,
    );
  }

  const artifactBuildId =
    `${ARTIFACT_SCHEMA_VERSION}-${artifactIdentity.sha256.slice(0, 16)}`;
  const artifactManifestBase = {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    baciRelease: stagingManifest.baciRelease,
    sourceUrl: sourceReport.source.url,
    sourceBytes: sourceReport.source.bytes,
    sourceSha256: stagingManifest.sourceSha256,
    sourceUpdateDate: stagingManifest.sourceUpdateDate,
    license: sourceReport.source.license,
    attribution: sourceReport.source.attribution,
    hsRevision: stagingManifest.hsRevision,
    ingestedYears: stagingManifest.ingestedYears,
    finalizedYears: stagingManifest.finalizedYears,
    provisionalYears: stagingManifest.provisionalYears,
    finalizedCutoffYear: Math.max(...stagingManifest.finalizedYears),
    scoreWindow: stagingManifest.scoreWindow,
    annualSourceChecks: sourceReport.annualChecks,
    stagingManifestSha256: sha256(stagingManifestBytes),
    coverageApprovalSha256: stagingManifest.coverageApprovalSha256,
    sourceReportSha256: sha256(sourceReportBytes),
    datasetPackage: CANDIDATE_MARKET_V1_DATASET_DECLARATION,
    pipelineGitSha: options.pipelineGitSha,
    duckdbVersion,
    artifact: {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      buildId: artifactBuildId,
      relativePath: "candidate-market.duckdb",
      bytes: artifactIdentity.bytes,
      sha256: artifactIdentity.sha256,
    },
    tableRowCounts,
    scoreVersionsSupported: ["cms-v1"],
    builtAt: options.builtAt,
  };
  const preliminaryManifestPath = join(
    temporaryPath,
    `${artifactIdentity.sha256}.manifest.partial.json`,
  );
  let benchmarkQueries: BenchmarkQuery[];
  let maximumRowSmokeResult: MaximumRowSmokeResult;
  const benchmarkStarted = performance.now();
  try {
    await rm(preliminaryManifestPath, { force: true });
    await writeFile(
      preliminaryManifestPath,
      jsonBytes({ ...artifactManifestBase, benchmarkQueries: [] }),
      { flag: "wx" },
    );
    ({ benchmarkQueries, maximumRowSmokeResult } =
      await selectBenchmarkQueries({
        artifactPath: partialArtifactPath,
        artifactManifestPath: preliminaryManifestPath,
        artifactBuildId,
        analysisReleaseCatalogSha256: sha256(stagingManifestBytes),
        scoreWindow: stagingManifest.scoreWindow,
      }));
  } catch (error) {
    await rm(partialArtifactPath, { force: true });
    if (error instanceof AnalysisArtifactBuildError) {
      throw error;
    }
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_BUILD_FAILED",
      `Artifact benchmark selection failed: ${errorMessage(error)}`,
    );
  } finally {
    await rm(preliminaryManifestPath, { force: true });
  }
  timings.benchmarkSelectionMs = elapsedMilliseconds(benchmarkStarted);
  const artifactManifest = {
    ...artifactManifestBase,
    benchmarkQueries,
  };
  const artifactManifestBytes = jsonBytes(artifactManifest);
  const report = {
    schemaVersion: ARTIFACT_REPORT_SCHEMA_VERSION,
    status: "accepted",
    sourceSha256: stagingManifest.sourceSha256,
    stagingManifestSha256: sha256(stagingManifestBytes),
    artifactManifestSha256: sha256(artifactManifestBytes),
    artifactManifest,
    artifact: artifactManifest.artifact,
    tableRowCounts,
    reconciliation,
    sizeGate: {
      targetBytes: ARTIFACT_SIZE_TARGET_BYTES,
      limitBytes: ARTIFACT_SIZE_LIMIT_BYTES,
      status:
        artifactIdentity.bytes <= ARTIFACT_SIZE_TARGET_BYTES
          ? "accepted"
          : "review-required",
    },
    benchmarkQueries,
    maximumRowSmokeResult,
    timingsMs: {
      ...timings,
      total: elapsedMilliseconds(buildStarted),
    },
    builtAt: options.builtAt,
  };
  const reportBytes = jsonBytes(report);
  const publicationPath = join(
    workspacePath,
    "artifacts",
    artifactIdentity.sha256,
  );
  const partialPublicationPath = join(
    workspacePath,
    "artifacts",
    `.${artifactIdentity.sha256}-${process.pid}.partial`,
  );
  const preparedReport = await prepareExternalReport(reportPath, reportBytes);
  try {
    await rm(partialPublicationPath, { force: true, recursive: true });
    await mkdir(partialPublicationPath, { recursive: true });
    await rename(
      partialArtifactPath,
      join(partialPublicationPath, "candidate-market.duckdb"),
    );
    await writeFile(
      join(partialPublicationPath, "artifact-manifest.json"),
      artifactManifestBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(partialPublicationPath, "artifact-build-report.json"),
      reportBytes,
      { flag: "wx" },
    );
    await publishArtifact(
      partialPublicationPath,
      publicationPath,
      artifactIdentity,
      artifactManifestBytes,
    );
    await rename(preparedReport.temporaryPath, preparedReport.targetPath);
  } catch (error) {
    await rm(preparedReport.temporaryPath, { force: true });
    await rm(partialPublicationPath, { force: true, recursive: true });
    if (error instanceof AnalysisArtifactBuildError) {
      throw error;
    }
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_PUBLICATION_FAILED",
      `Artifact publication failed: ${errorMessage(error)}`,
    );
  }

  return {
    status: "accepted",
    artifactPath: join(publicationPath, "candidate-market.duckdb"),
    artifactManifestPath: join(publicationPath, "artifact-manifest.json"),
    reportPath,
  };
}

async function populateArtifactTables(
  connection: DuckDBConnection,
  stagingPath: string,
  staging: StagingManifest,
  stagingManifestSha256: string,
): Promise<void> {
  const productsPath = join(
    stagingPath,
    staging.dimensionFiles.products.relativePath,
  );
  const economiesPath = join(
    stagingPath,
    staging.dimensionFiles.economies.relativePath,
  );
  const tradeGlob = join(stagingPath, "year=*", "trade.parquet");
  const tradeSource =
    `read_parquet(${sqlString(tradeGlob)}, hive_partitioning = false)`;

  await connection.run(`
    INSERT INTO product (
      product_id,
      hs12_code,
      source_description
    )
    SELECT
      CAST(row_number() OVER (ORDER BY hs12_code) AS USMALLINT),
      hs12_code,
      source_description
    FROM read_parquet(${sqlString(productsPath)})
    ORDER BY hs12_code
  `);
  const aggregateEconomyCodes = AGGREGATE_ECONOMY_CODES.join(", ");
  await connection.run(`
    INSERT INTO economy (
      code,
      display_name,
      iso2,
      iso3,
      kind,
      is_taiwan_proxy,
      identity_note,
      has_trade_evidence
    )
    SELECT
      economy_code,
      display_name,
      iso2,
      iso3,
      CASE
        WHEN economy_code IN (${aggregateEconomyCodes}) THEN 'AGGREGATE'
        ELSE 'ECONOMY'
      END,
      economy_code = 490,
      CASE
        WHEN economy_code = 490 THEN ${sqlString(TAIWAN_PROXY_NOTE)}
        ELSE NULL
      END,
      FALSE
    FROM read_parquet(${sqlString(economiesPath)})
    ORDER BY economy_code
  `);
  await connection.run(`
    INSERT INTO bilateral_year (
      year,
      product_id,
      exporter_code,
      importer_code,
      value_kusd
    )
    SELECT
      trade.year,
      product.product_id,
      trade.exporter_code,
      trade.importer_code,
      trade.value_kusd
    FROM ${tradeSource} AS trade
    JOIN product
      ON product.hs12_code = trade.product_code
    ORDER BY
      product.product_id,
      trade.exporter_code,
      trade.year,
      trade.importer_code
  `);
  await connection.run(`
    INSERT INTO market_year (
      year,
      product_id,
      importer_code,
      world_value_kusd,
      supplier_count,
      supplier_value_square_sum,
      source_flow_count,
      quantity_present_count,
      quantity_sum_tons
    )
    SELECT
      trade.year,
      product.product_id,
      trade.importer_code,
      CAST(SUM(trade.value_kusd) AS DECIMAL(38,3)),
      CAST(COUNT(*) AS USMALLINT),
      CAST(
        SUM(trade.value_kusd * trade.value_kusd)
        AS DECIMAL(38,6)
      ),
      CAST(COUNT(*) AS USMALLINT),
      CAST(COUNT(trade.quantity_tons) AS USMALLINT),
      CAST(SUM(trade.quantity_tons) AS DECIMAL(38,3))
    FROM ${tradeSource} AS trade
    JOIN product
      ON product.hs12_code = trade.product_code
    GROUP BY trade.year, product.product_id, trade.importer_code
    ORDER BY product.product_id, trade.year, trade.importer_code
  `);
  await connection.run(`
    INSERT INTO product_year (
      year,
      product_id,
      world_value_kusd
    )
    SELECT
      year,
      product_id,
      CAST(SUM(world_value_kusd) AS DECIMAL(38,3))
    FROM market_year
    GROUP BY year, product_id
    ORDER BY product_id, year
  `);
  await connection.run(`
    UPDATE economy
    SET has_trade_evidence = TRUE
    WHERE code IN (
      SELECT exporter_code FROM bilateral_year
      UNION
      SELECT importer_code FROM bilateral_year
    )
  `);

  const metadata: Record<string, string> = {
    artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
    baci_release: staging.baciRelease,
    coverage_approval_sha256: staging.coverageApprovalSha256,
    finalized_cutoff_year: String(Math.max(...staging.finalizedYears)),
    hs_revision: staging.hsRevision,
    provisional_year: String(staging.provisionalYears[0]),
    score_versions_supported: "cms-v1",
    score_window_end: String(staging.scoreWindow.end),
    score_window_start: String(staging.scoreWindow.start),
    source_sha256: staging.sourceSha256,
    source_update_date: staging.sourceUpdateDate,
    staging_manifest_sha256: stagingManifestSha256,
  };
  for (const [key, value] of Object.entries(metadata).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    await connection.run(
      "INSERT INTO artifact_metadata (key, value) VALUES ($key, $value)",
      { key, value },
    );
  }
}

async function reconcileArtifact(
  connection: DuckDBConnection,
  staging: StagingManifest,
  sourceReport: SourceReport,
): Promise<{
  tableRowCounts: Record<string, number>;
  reconciliation: ArtifactReconciliation;
}> {
  const tableNames = [
    "bilateral_year",
    "market_year",
    "product_year",
    "economy",
    "product",
    "artifact_metadata",
  ] as const;
  const tableRowCounts: Record<string, number> = {};
  for (const table of tableNames) {
    const row = await queryOne(
      connection,
      `SELECT COUNT(*)::UBIGINT AS count FROM ${table}`,
    );
    tableRowCounts[table] = requireQueryCount(row, "count");
  }
  if (
    tableRowCounts.bilateral_year !== staging.rowCount ||
    tableRowCounts.product !== staging.dimensions.products ||
    tableRowCounts.economy !== staging.dimensions.economies
  ) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      "Artifact table counts do not match accepted staging.",
    );
  }

  const bilateralAnnual = await queryRows(
    connection,
    `
      SELECT
        year,
        COUNT(*)::UBIGINT AS "rowCount",
        SUM(value_kusd) AS "valueTotalKusd"
      FROM bilateral_year
      GROUP BY year
      ORDER BY year
    `,
  );
  const marketAnnual = await queryRows(
    connection,
    `
      SELECT
        year,
        SUM(world_value_kusd) AS "valueTotalKusd",
        SUM(quantity_present_count)::UBIGINT AS "quantityPresentCount",
        COALESCE(
          SUM(quantity_sum_tons),
          CAST(0 AS DECIMAL(38,3))
        ) AS "quantityTotalTons"
      FROM market_year
      GROUP BY year
      ORDER BY year
    `,
  );
  const productAnnual = await queryRows(
    connection,
    `
      SELECT year, SUM(world_value_kusd) AS "valueTotalKusd"
      FROM product_year
      GROUP BY year
      ORDER BY year
    `,
  );
  for (const [index, source] of sourceReport.annualChecks.entries()) {
    const bilateral = bilateralAnnual[index];
    const market = marketAnnual[index];
    const product = productAnnual[index];
    if (
      bilateral === undefined ||
      market === undefined ||
      product === undefined ||
      requireQueryCount(bilateral, "year") !== source.year ||
      requireQueryCount(market, "year") !== source.year ||
      requireQueryCount(product, "year") !== source.year ||
      requireQueryCount(bilateral, "rowCount") !== source.rowCount ||
      requireQueryString(bilateral, "valueTotalKusd") !==
        source.valueTotalKusd ||
      requireQueryString(market, "valueTotalKusd") !== source.valueTotalKusd ||
      requireQueryString(product, "valueTotalKusd") !== source.valueTotalKusd ||
      requireQueryCount(market, "quantityPresentCount") !==
        source.quantityPresentCount ||
      requireQueryString(market, "quantityTotalTons") !==
        source.quantityTotalTons
    ) {
      throw new AnalysisArtifactBuildError(
        "ARTIFACT_RECONCILIATION_FAILED",
        `Artifact totals do not reconcile for ${source.year}.`,
      );
    }
  }
  if (
    bilateralAnnual.length !== sourceReport.annualChecks.length ||
    marketAnnual.length !== sourceReport.annualChecks.length ||
    productAnnual.length !== sourceReport.annualChecks.length
  ) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      "Artifact annual coverage does not match accepted staging.",
    );
  }

  const totals = await queryOne(
    connection,
    `
      SELECT
        (SELECT COUNT(*)::UBIGINT FROM bilateral_year) AS "bilateralRows",
        (SELECT SUM(value_kusd) FROM bilateral_year)
          AS "bilateralValueTotalKusd",
        (SELECT SUM(quantity_present_count)::UBIGINT FROM market_year)
          AS "marketQuantityPresentCount",
        (
          SELECT COALESCE(
            SUM(quantity_sum_tons),
            CAST(0 AS DECIMAL(38,3))
          )
          FROM market_year
        ) AS "marketQuantityTotalTons"
    `,
  );
  return {
    tableRowCounts,
    reconciliation: {
      sourceRows: sourceReport.annualChecks.reduce(
        (sum, annual) => sum + annual.rowCount,
        0,
      ),
      bilateralRows: requireQueryCount(totals, "bilateralRows"),
      sourceValueTotalKusd: sumFixed3(
        sourceReport.annualChecks.map(({ valueTotalKusd }) => valueTotalKusd),
      ),
      bilateralValueTotalKusd: requireQueryString(
        totals,
        "bilateralValueTotalKusd",
      ),
      sourceQuantityPresentCount: sourceReport.annualChecks.reduce(
        (sum, annual) => sum + annual.quantityPresentCount,
        0,
      ),
      marketQuantityPresentCount: requireQueryCount(
        totals,
        "marketQuantityPresentCount",
      ),
      sourceQuantityTotalTons: sumFixed3(
        sourceReport.annualChecks.map(
          ({ quantityTotalTons }) => quantityTotalTons,
        ),
      ),
      marketQuantityTotalTons: requireQueryString(
        totals,
        "marketQuantityTotalTons",
      ),
      annual: sourceReport.annualChecks.map((source, index) => {
        const bilateral = bilateralAnnual[index]!;
        const market = marketAnnual[index]!;
        const product = productAnnual[index]!;
        return {
          year: source.year,
          sourceRows: source.rowCount,
          bilateralRows: requireQueryCount(bilateral, "rowCount"),
          sourceValueTotalKusd: source.valueTotalKusd,
          bilateralValueTotalKusd: requireQueryString(
            bilateral,
            "valueTotalKusd",
          ),
          marketValueTotalKusd: requireQueryString(
            market,
            "valueTotalKusd",
          ),
          productValueTotalKusd: requireQueryString(
            product,
            "valueTotalKusd",
          ),
          sourceQuantityPresentCount: source.quantityPresentCount,
          marketQuantityPresentCount: requireQueryCount(
            market,
            "quantityPresentCount",
          ),
          sourceQuantityTotalTons: source.quantityTotalTons,
          marketQuantityTotalTons: requireQueryString(
            market,
            "quantityTotalTons",
          ),
        };
      }),
    },
  };
}

async function verifyReadOnlyArtifact(
  path: string,
  expectedCounts: Record<string, number>,
): Promise<void> {
  const instance = await DuckDBInstance.create(path, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  try {
    const row = await queryOne(
      connection,
      "SELECT COUNT(*)::UBIGINT AS count FROM bilateral_year",
    );
    if (requireQueryCount(row, "count") !== expectedCounts.bilateral_year) {
      throw new AnalysisArtifactBuildError(
        "ARTIFACT_RECONCILIATION_FAILED",
        "Read-only artifact reopen returned an incompatible row count.",
      );
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function selectBenchmarkQueries({
  artifactPath,
  artifactManifestPath,
  artifactBuildId,
  analysisReleaseCatalogSha256,
  scoreWindow,
}: {
  artifactPath: string;
  artifactManifestPath: string;
  artifactBuildId: string;
  analysisReleaseCatalogSha256: string;
  scoreWindow: { start: number; end: number };
}): Promise<{
  benchmarkQueries: BenchmarkQuery[];
  maximumRowSmokeResult: MaximumRowSmokeResult;
}> {
  const instance = await DuckDBInstance.create(artifactPath, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  let selected: {
    role: BenchmarkRole;
    productId: number;
    productCode: string;
    exporterCode: string;
    completeRowCount: number;
    primaryWindowRowCount: number;
  }[];
  try {
    const products = await queryRows(
      connection,
      `
        SELECT
          product.product_id,
          product.hs12_code,
          COUNT(bilateral.year)::UBIGINT AS complete_row_count,
          COUNT(bilateral.year) FILTER (
            WHERE bilateral.year BETWEEN $score_start AND $score_end
          )::UBIGINT AS primary_window_row_count
        FROM product
        LEFT JOIN bilateral_year AS bilateral
          ON bilateral.product_id = product.product_id
        GROUP BY product.product_id, product.hs12_code
        HAVING COUNT(bilateral.year) FILTER (
          WHERE bilateral.year BETWEEN $score_start AND $score_end
        ) > 0
        ORDER BY complete_row_count, product.hs12_code
      `,
      {
        score_start: scoreWindow.start,
        score_end: scoreWindow.end,
      },
    );
    if (products.length === 0) {
      throw new AnalysisArtifactBuildError(
        "ARTIFACT_BUILD_FAILED",
        "Artifact has no benchmarkable primary-window products.",
      );
    }

    const selectors: readonly {
      role: BenchmarkRole;
      index: number;
    }[] = [
      { role: "sparse", index: 0 },
      { role: "median", index: Math.floor((products.length - 1) / 2) },
      {
        role: "upper-quartile",
        index: Math.floor(0.75 * (products.length - 1)),
      },
      { role: "maximum-row", index: products.length - 1 },
    ];
    selected = [];
    for (const selector of selectors) {
      const product = products[selector.index]!;
      const productId = requireQueryCount(product, "product_id");
      const exporter = await queryOne(
        connection,
        `
          SELECT
            bilateral.exporter_code,
            COUNT(*)::UBIGINT AS primary_window_row_count
          FROM bilateral_year AS bilateral
          JOIN economy AS exporter
            ON exporter.code = bilateral.exporter_code
            AND exporter.kind = 'ECONOMY'
          WHERE bilateral.product_id = $product_id
            AND bilateral.year BETWEEN $score_start AND $score_end
          GROUP BY bilateral.exporter_code
          ORDER BY primary_window_row_count DESC, bilateral.exporter_code
          LIMIT 1
        `,
        {
          product_id: productId,
          score_start: scoreWindow.start,
          score_end: scoreWindow.end,
        },
      );
      selected.push({
        role: selector.role,
        productId,
        productCode: requireQueryString(product, "hs12_code"),
        exporterCode: String(
          requireQueryCount(exporter, "exporter_code"),
        ),
        completeRowCount: requireQueryCount(product, "complete_row_count"),
        primaryWindowRowCount: requireQueryCount(
          product,
          "primary_window_row_count",
        ),
      });
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const evidenceSource = await DuckDbTradeEvidenceSource.open({
    artifactPath,
    artifactManifestPath,
    analysisBuildId: artifactBuildId,
    analysisReleaseCatalogSha256,
  });
  const resultFacts = new Map<
    string,
    {
      candidateCount: number;
      resultBytes: number;
      resultSha256: string;
    }
  >();
  try {
    const manifest = await readAnalysisArtifactManifest(
      artifactManifestPath,
    );
    const datasetPackage =
      createCandidateMarketDatasetPackageFromArtifacts({
        manifest,
        analysisReleaseCatalogSha256,
        previousManifest: null,
      });
    const tradeAnalytics =
      createCandidateMarketV1TradeAnalyticsPlatform({
        evidenceSource,
        datasetPackages: new Map([
          [artifactBuildId, datasetPackage],
        ]),
      });
    for (const benchmark of selected) {
      const key = `${benchmark.exporterCode}:${benchmark.productCode}`;
      if (resultFacts.has(key)) {
        continue;
      }
      const outcome = await tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: artifactBuildId,
        exporterCode: benchmark.exporterCode,
        productCode: benchmark.productCode,
      });
      if (outcome.state !== "success" && outcome.state !== "empty") {
        throw new AnalysisArtifactBuildError(
          "ARTIFACT_BUILD_FAILED",
          `Artifact benchmark analysis failed: ${outcome.state} (${outcome.error.code}${
            "reason" in outcome.error
              ? `: ${outcome.error.reason}`
              : ""
          }).`,
        );
      }
      const result = outcome.payload;
      const resultBytes = Buffer.from(JSON.stringify(result), "utf8");
      resultFacts.set(key, {
        candidateCount: result.cohortSize,
        resultBytes: resultBytes.length,
        resultSha256: sha256(resultBytes),
      });
    }
  } finally {
    evidenceSource.close();
  }

  const benchmarkQueries = selected.map((benchmark): BenchmarkQuery => {
    const facts = resultFacts.get(
      `${benchmark.exporterCode}:${benchmark.productCode}`,
    );
    if (facts === undefined) {
      throw new AnalysisArtifactBuildError(
        "ARTIFACT_BUILD_FAILED",
        "A selected benchmark query has no smoke result.",
      );
    }
    return {
      role: benchmark.role,
      productCode: benchmark.productCode,
      exporterCode: benchmark.exporterCode,
      completeRowCount: benchmark.completeRowCount,
      primaryWindowRowCount: benchmark.primaryWindowRowCount,
      candidateCount: facts.candidateCount,
      resultBytes: facts.resultBytes,
      selectionAlgorithm: "complete-bilateral-row-count-v1",
    };
  });
  const maximum = benchmarkQueries.find(
    ({ role }) => role === "maximum-row",
  )!;
  const maximumFacts = resultFacts.get(
    `${maximum.exporterCode}:${maximum.productCode}`,
  )!;
  return {
    benchmarkQueries,
    maximumRowSmokeResult: {
      status: "accepted",
      productCode: maximum.productCode,
      exporterCode: maximum.exporterCode,
      candidateCount: maximum.candidateCount,
      resultBytes: maximum.resultBytes,
      resultSha256: maximumFacts.resultSha256,
    },
  };
}

async function validateStagingInput({
  stagingPath,
  stagingManifest,
  stagingManifestBytes,
  sourceReport,
}: {
  stagingPath: string;
  stagingManifest: StagingManifest;
  stagingManifestBytes: Buffer;
  sourceReport: SourceReport;
}): Promise<void> {
  if (
    sourceReport.source.sha256 !== stagingManifest.sourceSha256 ||
    sourceReport.source.baciRelease !== stagingManifest.baciRelease ||
    sourceReport.source.hsRevision !== stagingManifest.hsRevision ||
    sourceReport.source.sourceUpdateDate !== stagingManifest.sourceUpdateDate ||
    sourceReport.staging.manifestSha256 !== sha256(stagingManifestBytes)
  ) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      "Staging manifest and source report identities do not match.",
    );
  }
  const files = [
    ...stagingManifest.partitions,
    stagingManifest.dimensionFiles.products,
    stagingManifest.dimensionFiles.economies,
  ];
  for (const file of files) {
    const identity = await fileIdentity(join(stagingPath, file.relativePath));
    if (identity.bytes !== file.bytes || identity.sha256 !== file.sha256) {
      throw new AnalysisArtifactBuildError(
        "STAGING_INPUT_INVALID",
        `Staging file ${file.relativePath} does not match its identity.`,
      );
    }
  }
  if (
    stagingManifest.partitions.reduce(
      (sum, partition) => sum + partition.rowCount,
      0,
    ) !== stagingManifest.rowCount ||
    sourceReport.annualChecks.reduce(
      (sum, annual) => sum + annual.rowCount,
      0,
    ) !== stagingManifest.rowCount
  ) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      "Staging row coverage is internally inconsistent.",
    );
  }
}

async function publishArtifact(
  partialPath: string,
  acceptedPath: string,
  artifactIdentity: { bytes: number; sha256: string },
  manifestBytes: Buffer,
): Promise<void> {
  await mkdir(dirname(acceptedPath), { recursive: true });
  if (!(await pathExists(acceptedPath))) {
    await rename(partialPath, acceptedPath);
    return;
  }
  const [acceptedArtifact, acceptedManifest] = await Promise.all([
    fileIdentity(join(acceptedPath, "candidate-market.duckdb")),
    readFile(join(acceptedPath, "artifact-manifest.json")),
  ]);
  if (
    acceptedArtifact.bytes !== artifactIdentity.bytes ||
    acceptedArtifact.sha256 !== artifactIdentity.sha256 ||
    !acceptedManifest.equals(manifestBytes)
  ) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_PUBLICATION_FAILED",
      "An incompatible artifact publication already exists.",
    );
  }
  await rm(partialPath, { force: true, recursive: true });
}

async function prepareExternalReport(
  path: string,
  bytes: Uint8Array,
): Promise<{ targetPath: string; temporaryPath: string }> {
  const temporaryPath = `${path}.${process.pid}.partial`;
  try {
    await mkdir(dirname(path), { recursive: true });
    if ((await pathExists(path)) && !(await stat(path)).isFile()) {
      throw new Error("The report destination is not a regular file.");
    }
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    return { targetPath: path, temporaryPath };
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      throw new AnalysisArtifactBuildError(
        "ARTIFACT_PUBLICATION_FAILED",
        `Artifact report preparation failed (${errorMessage(error)}) and its temporary file could not be removed (${errorMessage(cleanupError)}).`,
      );
    }
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_PUBLICATION_FAILED",
      `Artifact report could not be prepared: ${errorMessage(error)}`,
    );
  }
}

function parseStagingManifest(bytes: Buffer, path: string): StagingManifest {
  const object = requireRecord(parseJson(bytes, path), "staging manifest");
  const dimensions = requireRecord(object.dimensions, "staging dimensions");
  const dimensionFiles = requireRecord(
    object.dimensionFiles,
    "staging dimension files",
  );
  const products = parseStagingFile(
    dimensionFiles.products,
    "product dimension file",
  );
  const economies = parseStagingFile(
    dimensionFiles.economies,
    "economy dimension file",
  );
  const scoreWindow = requireRecord(object.scoreWindow, "score window");
  return {
    schemaVersion: requireLiteral(
      object.schemaVersion,
      "baci-parquet-staging-v1",
      "staging schema",
    ),
    sourceSha256: requireSha256(object.sourceSha256, "source SHA-256"),
    baciRelease: requireString(object.baciRelease, "BACI Release"),
    hsRevision: requireLiteral(object.hsRevision, "HS12", "HS revision"),
    sourceUpdateDate: requireString(
      object.sourceUpdateDate,
      "source update date",
    ),
    ingestedYears: requireNumberArray(object.ingestedYears, "ingested years"),
    finalizedYears: requireNumberArray(object.finalizedYears, "finalized years"),
    provisionalYears: requireNumberArray(
      object.provisionalYears,
      "provisional years",
    ),
    scoreWindow: {
      start: requireInteger(scoreWindow.start, "score window start"),
      end: requireInteger(scoreWindow.end, "score window end"),
    },
    partitions: requireArray(object.partitions, "staging partitions").map(
      (value, index) => {
        const file = parseStagingFile(value, `staging partition ${index}`);
        const record = requireRecord(value, `staging partition ${index}`);
        return {
          ...file,
          year: requireInteger(record.year, `staging partition ${index} year`),
        };
      },
    ),
    dimensionFiles: { products, economies },
    rowCount: requireInteger(object.rowCount, "staging row count"),
    dimensions: {
      products: requireInteger(dimensions.products, "staging product count"),
      economies: requireInteger(dimensions.economies, "staging economy count"),
    },
    duckdbVersion: requireString(object.duckdbVersion, "staging DuckDB version"),
    coverageApprovalSha256: requireSha256(
      object.coverageApprovalSha256,
      "coverage approval SHA-256",
    ),
  };
}

function parseStagingFile(value: unknown, name: string): StagingFile {
  const object = requireRecord(value, name);
  return {
    relativePath: requireSafeRelativePath(object.relativePath, `${name} path`),
    rowCount: requireInteger(object.rowCount, `${name} row count`),
    bytes: requireInteger(object.bytes, `${name} bytes`),
    sha256: requireSha256(object.sha256, `${name} SHA-256`),
  };
}

function parseSourceReport(bytes: Buffer, path: string): SourceReport {
  const object = requireRecord(parseJson(bytes, path), "source report");
  const source = requireRecord(object.source, "source report identity");
  const license = requireRecord(source.license, "source license");
  const staging = requireRecord(object.staging, "source report staging");
  return {
    schemaVersion: requireLiteral(
      object.schemaVersion,
      "baci-source-staging-report-v1",
      "source report schema",
    ),
    status: requireLiteral(object.status, "accepted", "source report status"),
    source: {
      baciRelease: requireString(source.baciRelease, "source BACI Release"),
      url: requireString(source.url, "source URL"),
      archiveFilename: requireString(
        source.archiveFilename,
        "source archive filename",
      ),
      bytes: requireInteger(source.bytes, "source bytes"),
      sha256: requireSha256(source.sha256, "source SHA-256"),
      sourceUpdateDate: requireString(
        source.sourceUpdateDate,
        "source update date",
      ),
      hsRevision: requireLiteral(source.hsRevision, "HS12", "HS revision"),
      license: {
        name: requireString(license.name, "license name"),
        url: requireString(license.url, "license URL"),
      },
      attribution: requireString(source.attribution, "source attribution"),
    },
    annualChecks: requireArray(
      object.annualChecks,
      "annual source checks",
    ).map((value, index) => parseAnnualSourceCheck(value, index)),
    staging: {
      manifestSha256: requireSha256(
        staging.manifestSha256,
        "staging manifest SHA-256",
      ),
    },
  };
}

function parseAnnualSourceCheck(
  value: unknown,
  index: number,
): AnnualSourceCheck {
  const object = requireRecord(value, `annual source check ${index}`);
  return {
    year: requireInteger(object.year, "annual source year"),
    rowCount: requireInteger(object.rowCount, "annual source row count"),
    exporterCount: requireInteger(
      object.exporterCount,
      "annual source exporter count",
    ),
    importerCount: requireInteger(
      object.importerCount,
      "annual source importer count",
    ),
    observedProductCount: requireInteger(
      object.observedProductCount,
      "annual source product count",
    ),
    quantityPresentCount: requireInteger(
      object.quantityPresentCount,
      "annual source quantity-present count",
    ),
    quantityNullCount: requireInteger(
      object.quantityNullCount,
      "annual source quantity-null count",
    ),
    valueTotalKusd: requireFixed3(
      object.valueTotalKusd,
      "annual source value total",
    ),
    quantityTotalTons: requireFixed3(
      object.quantityTotalTons,
      "annual source quantity total",
    ),
  };
}

function validateBuildIdentity(pipelineGitSha: string, builtAt: string): void {
  if (
    !/^[a-f0-9]{40}$/u.test(pipelineGitSha) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(builtAt)
  ) {
    throw new AnalysisArtifactBuildError(
      "CLI_ARGUMENT_INVALID",
      "Pipeline Git SHA or build timestamp is malformed.",
    );
  }
}

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
  values?: Record<string, DuckDBValue>,
): Promise<Record<string, unknown>[]> {
  const result = await connection.runAndReadAll(sql, values);
  return result.getRowObjectsJson();
}

async function queryOne(
  connection: DuckDBConnection,
  sql: string,
  values?: Record<string, DuckDBValue>,
): Promise<Record<string, unknown>> {
  const row = (await queryRows(connection, sql, values))[0];
  if (row === undefined) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      "Artifact query returned no result.",
    );
  }
  return row;
}

function requireQueryCount(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      `Artifact query returned an invalid ${key}.`,
    );
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      `Artifact query returned an unsafe ${key}.`,
    );
  }
  return count;
}

function requireQueryString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new AnalysisArtifactBuildError(
      "ARTIFACT_RECONCILIATION_FAILED",
      `Artifact query returned an invalid ${key}.`,
    );
  }
  return value;
}

function parseJson(bytes: Buffer, path: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${path} is not valid JSON: ${errorMessage(error)}`,
    );
  }
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be an array.`,
    );
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be a non-empty string.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be a nonnegative safe integer.`,
    );
  }
  return Number(value);
}

function requireNumberArray(value: unknown, name: string): number[] {
  return requireArray(value, name).map((entry) =>
    requireInteger(entry, name),
  );
}

function requireLiteral<const Value extends string>(
  value: unknown,
  expected: Value,
  name: string,
): Value {
  if (value !== expected) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be ${expected}.`,
    );
  }
  return expected;
}

function requireSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function requireFixed3(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d+\.\d{3}$/u.test(value)) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must have exactly three decimal places.`,
    );
  }
  return value;
}

function requireSafeRelativePath(value: unknown, name: string): string {
  const path = requireString(value, name);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${name} must be a safe relative path.`,
    );
  }
  return path;
}

function sumFixed3(values: readonly string[]): string {
  const total = values.reduce((sum, value) => {
    const [whole, fraction] = value.split(".");
    return sum + BigInt(whole!) * 1000n + BigInt(fraction!);
  }, 0n);
  return `${total / 1000n}.${(total % 1000n).toString().padStart(3, "0")}`;
}

async function fileIdentity(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new AnalysisArtifactBuildError(
      "STAGING_INPUT_INVALID",
      `${path} is not a regular file.`,
    );
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return { bytes: metadata.size, sha256: digest.digest("hex") };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function elapsedMilliseconds(started: number): number {
  return Math.round((performance.now() - started) * 1000) / 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
