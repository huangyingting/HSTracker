import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import {
  CANDIDATE_MARKET_V1_DATASET_DECLARATION,
  type CandidateMarketDatasetCapabilityDeclaration,
} from "../../src/domain/trade-analytics/dataset-package";
import {
  TRADE_TREND_V1_DATASET_DECLARATION,
  type TradeTrendDatasetCapabilityDeclaration,
} from "../../src/domain/trade-analytics/trade-trend-v1-dataset-package";
import { releaseJsonBytes } from "../../src/release/release-manifest";
import { releaseObjectIdentity } from "../../src/release/release-object-store";

const BACI_RELEASE = "V202601";
const SOURCE_SHA256 = "a".repeat(64);
const PRODUCT_SEARCH_BUILD_ID = "product-search-v1-1111111111111111";
const PRODUCT_CODE = "010121";
const PRODUCT_DESCRIPTION = "Horses: live, pure-bred breeding animals";

export const RUNTIME_RELEASE_FIXTURE = {
  baciRelease: BACI_RELEASE,
  exporterCode: "156",
  productCode: PRODUCT_CODE,
  productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
} as const;

export type TradeTrendEquivalenceEconomy = {
  code: number;
  displayName: string;
  iso2: string;
  iso3: string;
};

export type TradeTrendEquivalenceRow = {
  year: number;
  productCode: string;
  exporterCode: number;
  importerCode: number;
  valueKusd: string;
};

export async function writeRuntimeReleaseCandidate(
  root: string,
  options: {
    baciRelease?: string;
    valueOffset?: number;
    finalizedCutoffYear?: number;
    benchmarkCandidateCount?: number;
    datasetPackage?: CandidateMarketDatasetCapabilityDeclaration;
    tradeTrendDatasetPackage?: TradeTrendDatasetCapabilityDeclaration;
    legacyDatasetPackageManifest?: boolean;
    sourceSha256?: string;
    sourceUpdateDate?: string;
    builtAt?: string;
    analysisArtifactBuildId?: string;
    productSearchBuildId?: string;
    productSourceArchiveSha256?: string;
    productCatalogVersion?: string;
    productManifestCatalogSchemaVersion?: string;
    // Layers extra economies/products/trade rows onto the default fixture
    // DuckDB so a test can reproduce specific Trade Trend observation-state
    // combinations (sparse/no-recorded-flow/missing/provisional) without a
    // second BACI archive: see trade-trend-adapter-equivalence.test.ts.
    additionalTradeTrendEconomies?: readonly TradeTrendEquivalenceEconomy[];
    additionalTradeTrendProducts?: readonly Readonly<{
      productId: number;
      code: string;
      description: string;
    }>[];
    additionalTradeTrendRows?: readonly TradeTrendEquivalenceRow[];
  } = {},
): Promise<{
  analysisDirectoryPath: string;
  productCatalogDirectoryPath: string;
}> {
  const analysisDirectoryPath = join(root, "analysis");
  const productCatalogDirectoryPath = join(root, "product-catalog");
  await Promise.all([
    mkdir(analysisDirectoryPath, { recursive: true }),
    mkdir(productCatalogDirectoryPath, { recursive: true }),
  ]);

  const artifactPath = join(
    analysisDirectoryPath,
    "candidate-market.duckdb",
  );
  const baciRelease = options.baciRelease ?? BACI_RELEASE;
  const finalizedCutoffYear =
    options.finalizedCutoffYear ?? 2023;
  const valueOffset = options.valueOffset ?? 0;
  const sourceSha256 = options.sourceSha256 ?? SOURCE_SHA256;
  const sourceUpdateDate =
    options.sourceUpdateDate ?? "2026-01-22";
  const productSearchBuildId =
    options.productSearchBuildId ?? PRODUCT_SEARCH_BUILD_ID;
  const ingestedYears = Array.from(
    { length: 11 },
    (_, index) => finalizedCutoffYear - 9 + index,
  );
  const finalizedYears = ingestedYears.slice(0, -1);
  const provisionalYear = ingestedYears.at(-1)!;
  await writeRuntimeDuckDb(
    artifactPath,
    baciRelease,
    valueOffset,
    finalizedCutoffYear,
    sourceUpdateDate,
    options.additionalTradeTrendEconomies ?? [],
    options.additionalTradeTrendProducts ?? [],
    options.additionalTradeTrendRows ?? [],
  );
  const artifactBytes = await readFile(artifactPath);
  const artifactIdentity = releaseObjectIdentity(artifactBytes);
  const artifactBuildId =
    `candidate-market-artifact-v1-${artifactIdentity.sha256.slice(0, 16)}`;
  const artifactManifest = {
    schemaVersion: "candidate-market-artifact-manifest-v1",
    baciRelease,
    sourceUrl: `https://fixtures.invalid/${baciRelease}.zip`,
    sourceBytes: 0,
    sourceSha256,
    sourceUpdateDate,
    license: {
      name: "Test fixture",
      url: "https://fixtures.invalid/license",
    },
    attribution: "Runtime fixture with CEPII BACI semantics.",
    hsRevision: "HS12",
    ingestedYears,
    finalizedYears,
    provisionalYears: [provisionalYear],
    finalizedCutoffYear,
    scoreWindow: {
      start: finalizedCutoffYear - 4,
      end: finalizedCutoffYear,
    },
    annualSourceChecks: ingestedYears.map((year, index) => ({
      year,
      rowCount: 1,
      exporterCount: 1,
      importerCount: 1,
      observedProductCount: 1,
      quantityPresentCount: 1,
      quantityNullCount: 0,
      valueTotalKusd: `${100 + valueOffset + index * 10}.000`,
      quantityTotalTons: "1.000",
    })),
    stagingManifestSha256: sourceSha256,
    coverageApprovalSha256: sourceSha256,
    ...(options.legacyDatasetPackageManifest === true
      ? {}
      : {
          sourceReportSha256: sourceSha256,
          datasetPackage:
            options.datasetPackage ??
            CANDIDATE_MARKET_V1_DATASET_DECLARATION,
          tradeTrendDatasetPackage:
            options.tradeTrendDatasetPackage ??
            TRADE_TREND_V1_DATASET_DECLARATION,
        }),
    scoreVersionsSupported: ["cms-v1"],
    artifact: {
      schemaVersion: "candidate-market-artifact-v1",
      buildId:
        options.analysisArtifactBuildId ?? artifactBuildId,
      relativePath: "candidate-market.duckdb",
      ...artifactIdentity,
    },
    builtAt: options.builtAt ?? "2026-07-12T01:00:00Z",
    benchmarkQueries: [
      {
        role: "maximum-row",
        productCode: PRODUCT_CODE,
        exporterCode: "156",
        completeRowCount: 11,
        primaryWindowRowCount: 5,
        candidateCount: options.benchmarkCandidateCount ?? 1,
        resultBytes: 1,
        selectionAlgorithm: "complete-bilateral-row-count-v1",
      },
    ],
  };
  const artifactManifestBytes = releaseJsonBytes(artifactManifest);
  const artifactReport = {
    schemaVersion: "candidate-market-artifact-build-report-v1",
    status: "accepted",
    artifactManifestSha256:
      releaseObjectIdentity(artifactManifestBytes).sha256,
    artifactManifest,
    artifact: artifactManifest.artifact,
  };

  const productCatalog = {
    schemaVersion: "product-catalog-artifact-v1",
    productSearchBuildId,
    searchAlgorithmVersion: "deterministic-lexical-product-search-v3",
    searchResponseSchemaVersion: "product-search-result-v1",
    translationAttribution:
      `Runtime fixture auxiliary translation ${options.productCatalogVersion ?? "v1"}.`,
    products: [
      {
        hsRevision: "HS12",
        code: PRODUCT_CODE,
        sourceDescriptionEn: PRODUCT_DESCRIPTION,
        sourceDescriptionSha256: createHash("sha256")
          .update(PRODUCT_DESCRIPTION)
          .digest("hex"),
        auxiliaryDescriptionZhHans: "纯种繁殖用活马",
        normalizedSourceDescriptionEn:
          "horses live pure bred breeding animals",
        normalizedAuxiliaryDescriptionZhHans: "纯种繁殖用活马",
        translationStatus: "reviewed",
        translationVersion: "runtime-fixture-v1",
      },
    ],
    aliases: [],
    traditionalToSimplified: {},
  };
  const catalogBytes = releaseJsonBytes(productCatalog);
  const catalogIdentity = releaseObjectIdentity(catalogBytes);
  const catalogManifest = {
    schemaVersion: "product-catalog-manifest-v1",
    baciRelease,
    sourceArchiveSha256:
      options.productSourceArchiveSha256 ?? sourceSha256,
    hsRevision: "HS12",
    productSearchBuildId,
    catalog: {
      schemaVersion:
        options.productManifestCatalogSchemaVersion ??
        "product-catalog-artifact-v1",
      relativePath: "product-catalog.json",
      ...catalogIdentity,
    },
    builtAt: options.builtAt ?? "2026-07-12T01:00:00Z",
  };
  const catalogManifestBytes = releaseJsonBytes(catalogManifest);
  const catalogReport = {
    schemaVersion: "product-catalog-build-report-v1",
    status: "accepted",
    catalogManifestSha256:
      releaseObjectIdentity(catalogManifestBytes).sha256,
    catalogManifest,
  };

  await Promise.all([
    writeFile(
      join(analysisDirectoryPath, "artifact-manifest.json"),
      artifactManifestBytes,
    ),
    writeFile(
      join(analysisDirectoryPath, "artifact-build-report.json"),
      releaseJsonBytes(artifactReport),
    ),
    writeFile(
      join(productCatalogDirectoryPath, "product-catalog.json"),
      catalogBytes,
    ),
    writeFile(
      join(productCatalogDirectoryPath, "catalog-manifest.json"),
      catalogManifestBytes,
    ),
    writeFile(
      join(productCatalogDirectoryPath, "catalog-build-report.json"),
      releaseJsonBytes(catalogReport),
    ),
  ]);

  return { analysisDirectoryPath, productCatalogDirectoryPath };
}

async function writeRuntimeDuckDb(
  path: string,
  baciRelease: string,
  valueOffset: number,
  finalizedCutoffYear: number,
  sourceUpdateDate: string,
  additionalEconomies: readonly TradeTrendEquivalenceEconomy[],
  additionalProducts: readonly Readonly<{
    productId: number;
    code: string;
    description: string;
  }>[],
  additionalTradeRows: readonly TradeTrendEquivalenceRow[],
): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  try {
    await connection.run(
      await readFile(
        resolve("data/schemas/candidate-market-artifact-v1.sql"),
        "utf8",
      ),
    );
    await connection.run(`
      INSERT INTO product VALUES
        (1, '${PRODUCT_CODE}', '${PRODUCT_DESCRIPTION.replaceAll("'", "''")}')
    `);
    await connection.run(`
      INSERT INTO economy VALUES
        (156, 'China', 'CN', 'CHN', 'ECONOMY', FALSE, NULL, TRUE),
        (276, 'Germany', 'DE', 'DEU', 'ECONOMY', FALSE, NULL, TRUE)
    `);
    for (const economy of additionalEconomies) {
      await connection.run(
        `
          INSERT INTO economy VALUES
            ($code, $display_name, $iso2, $iso3, 'ECONOMY', FALSE, NULL, TRUE)
        `,
        {
          code: economy.code,
          display_name: economy.displayName,
          iso2: economy.iso2,
          iso3: economy.iso3,
        },
      );
    }
    for (const product of additionalProducts) {
      await connection.run(
        `
          INSERT INTO product VALUES ($product_id, $code, $description)
        `,
        {
          product_id: product.productId,
          code: product.code,
          description: product.description,
        },
      );
    }
    const ingestedYears = Array.from(
      { length: 11 },
      (_, index) => finalizedCutoffYear - 9 + index,
    );
    for (const [index, year] of ingestedYears.entries()) {
      const value = `${100 + valueOffset + index * 10}.000`;
      await connection.run(`
        INSERT INTO bilateral_year VALUES
          (${year}, 1, 156, 276, ${value});
        INSERT INTO market_year VALUES
          (${year}, 1, 276, ${value}, 1, ${value} * ${value}, 1, 1, 1.000);
        INSERT INTO product_year VALUES
          (${year}, 1, ${value});
      `);
    }
    const productIdByCode = new Map<string, number>([[PRODUCT_CODE, 1]]);
    for (const product of additionalProducts) {
      productIdByCode.set(product.code, product.productId);
    }
    for (const row of additionalTradeRows) {
      const productId = productIdByCode.get(row.productCode);
      if (productId === undefined) {
        throw new Error(
          `Trade Trend equivalence row references an undeclared product ${row.productCode}.`,
        );
      }
      await connection.run(
        `
          INSERT INTO bilateral_year VALUES
            ($year, $product_id, $exporter_code, $importer_code,
              CAST($value_kusd AS DECIMAL(38,3)))
        `,
        {
          year: row.year,
          product_id: productId,
          exporter_code: row.exporterCode,
          importer_code: row.importerCode,
          value_kusd: row.valueKusd,
        },
      );
      await connection.run(
        `
          INSERT INTO market_year VALUES
            ($year, $product_id, $importer_code,
              CAST($value_kusd AS DECIMAL(38,3)), 1,
              CAST($value_kusd AS DECIMAL(38,3)) *
                CAST($value_kusd AS DECIMAL(38,3)),
              1, 1, 1.000)
        `,
        {
          year: row.year,
          product_id: productId,
          importer_code: row.importerCode,
          value_kusd: row.valueKusd,
        },
      );
    }
    const metadata = {
      artifact_schema_version: "candidate-market-artifact-v1",
      baci_release: baciRelease,
      finalized_cutoff_year: String(finalizedCutoffYear),
      hs_revision: "HS12",
      source_update_date: sourceUpdateDate,
    };
    for (const [key, value] of Object.entries(metadata)) {
      await connection.run(
        "INSERT INTO artifact_metadata VALUES ($key, $value)",
        { key, value },
      );
    }
    await connection.run("CHECKPOINT");
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
