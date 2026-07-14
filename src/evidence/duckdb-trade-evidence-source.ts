import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { DuckDBConnection } from "@duckdb/node-api";

import {
  retiredAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../domain/candidate-market/errors";
import type { CandidateMarketV1RecipeInput } from "../domain/candidate-market/result";
import type {
  CmsV1Inputs,
  MarketYearEvidence,
  TradeEvidenceLoadOptions,
  TradeEvidenceSource,
} from "./trade-evidence-source";
import {
  createRuntimeReadStream,
  statRuntimePath,
} from "../runtime-file-access";
import {
  readAnalysisArtifactManifest,
  type AnalysisArtifactManifest,
} from "./analysis-artifact-manifest";
import { DuckDbAnalysisDatabase } from "./duckdb-analysis-database";

type DuckDbTradeEvidenceSourceOptions = {
  artifactPath: string;
  artifactManifestPath: string;
  analysisBuildId: string;
  analysisReleaseCatalogSha256: string;
};

type SharedDuckDbTradeEvidenceSourceOptions =
  DuckDbTradeEvidenceSourceOptions & {
    database: DuckDbAnalysisDatabase;
    databaseName: "current" | "previous";
  };

export class DuckDbTradeEvidenceSource implements TradeEvidenceSource {
  private closed = false;

  private constructor(
    private readonly database: DuckDbAnalysisDatabase,
    private readonly ownsDatabase: boolean,
    private readonly tablePrefix: "main." | "previous.main.",
    private readonly manifest: AnalysisArtifactManifest,
    private readonly analysisBuildId: string,
    private readonly analysisReleaseCatalogSha256: string,
  ) {}

  static async open(
    options: DuckDbTradeEvidenceSourceOptions,
  ): Promise<DuckDbTradeEvidenceSource> {
    const verified = await verifySourceOptions(options);
    const database = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: verified.artifactPath,
      previousArtifactPath: null,
      servingVolumePath: dirname(
        /* turbopackIgnore: true */ verified.artifactPath,
      ),
    });
    try {
      await verifyArtifactMetadata(database, "main.", verified.manifest);
      return new DuckDbTradeEvidenceSource(
        database,
        true,
        "main.",
        verified.manifest,
        options.analysisBuildId,
        options.analysisReleaseCatalogSha256,
      );
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static async openShared(
    options: SharedDuckDbTradeEvidenceSourceOptions,
  ): Promise<DuckDbTradeEvidenceSource> {
    const verified = await verifySourceOptions(options);
    const tablePrefix =
      options.databaseName === "current"
        ? ("main." as const)
        : ("previous.main." as const);
    await verifyArtifactMetadata(
      options.database,
      tablePrefix,
      verified.manifest,
    );
    return new DuckDbTradeEvidenceSource(
      options.database,
      false,
      tablePrefix,
      verified.manifest,
      options.analysisBuildId,
      options.analysisReleaseCatalogSha256,
    );
  }

  async loadCmsV1Inputs(
    query: CandidateMarketV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<CmsV1Inputs> {
    if (this.closed) {
      throw new Error("The DuckDB evidence source is closed.");
    }
    if (query.analysisBuildId !== this.analysisBuildId) {
      throw retiredAnalysisBuild(query.analysisBuildId);
    }
    return this.database.withConnection(
      options?.signal,
      (connection) =>
        this.loadWithConnection(connection, query, options?.signal),
    );
  }

  private async loadWithConnection(
    connection: DuckDBConnection,
    query: CandidateMarketV1RecipeInput,
    signal: AbortSignal | undefined,
  ): Promise<CmsV1Inputs> {
    signal?.throwIfAborted();
    const exporterCode = Number(query.exporterCode);
    const exporter = await queryOptional(connection, `
      SELECT
        code,
        display_name,
        iso3,
        identity_note
      FROM ${this.tablePrefix}economy
      WHERE code = $exporter_code
        AND kind = 'ECONOMY'
    `, { exporter_code: exporterCode });
    if (exporter === undefined) {
      throw unknownExporter(query.exporterCode);
    }

    signal?.throwIfAborted();
    const product = await queryOptional(connection, `
      SELECT
        product_id,
        hs12_code,
        source_description
      FROM ${this.tablePrefix}product
      WHERE hs12_code = $product_code
    `, { product_code: query.productCode });
    if (product === undefined) {
      throw unknownProduct(query.productCode);
    }
    const productId = requireNumber(product.product_id, "product_id");

    signal?.throwIfAborted();
    const marketRows = await queryRows(connection, `
      SELECT
        market.year,
        candidate.code,
        candidate.display_name,
        candidate.iso3,
        candidate.identity_note,
        market.world_value_kusd,
        bilateral.value_kusd AS selected_exporter_value_kusd,
        CAST(
          market.supplier_count -
            CASE WHEN bilateral.value_kusd IS NULL THEN 0 ELSE 1 END
          AS USMALLINT
        ) AS alternative_supplier_count,
        CAST(
          market.world_value_kusd -
            COALESCE(bilateral.value_kusd, 0)
          AS DECIMAL(38,3)
        ) AS alternative_supplier_value_kusd,
        CAST(
          market.supplier_value_square_sum -
            COALESCE(bilateral.value_kusd * bilateral.value_kusd, 0)
          AS DECIMAL(38,6)
        ) AS alternative_supplier_value_square_sum,
        market.source_flow_count,
        market.quantity_present_count
      FROM ${this.tablePrefix}market_year AS market
      JOIN ${this.tablePrefix}economy AS candidate
        ON candidate.code = market.importer_code
      LEFT JOIN ${this.tablePrefix}bilateral_year AS bilateral
        ON bilateral.year = market.year
        AND bilateral.product_id = market.product_id
        AND bilateral.importer_code = market.importer_code
        AND bilateral.exporter_code = $exporter_code
      WHERE market.product_id = $product_id
        AND market.importer_code != $exporter_code
        AND candidate.kind = 'ECONOMY'
      ORDER BY market.year, candidate.code
    `, {
      exporter_code: exporterCode,
      product_id: productId,
    });
    const normalizedRows = marketRows.map(toMarketYearEvidence);
    signal?.throwIfAborted();
    const productYearRows = await queryRows(connection, `
      SELECT year, world_value_kusd
      FROM ${this.tablePrefix}product_year
      WHERE product_id = $product_id
        AND year <= $finalized_cutoff_year
      ORDER BY year
    `, {
      finalized_cutoff_year: this.manifest.finalizedCutoffYear,
      product_id: productId,
    });
    const provisionalYear = requireSingleProvisionalYear(this.manifest);

    return {
      analysisBuildId: this.analysisBuildId,
      analysisReleaseCatalogSha256: this.analysisReleaseCatalogSha256,
      artifact: {
        baciRelease: this.manifest.baciRelease,
        buildId: this.manifest.artifact.buildId,
        schemaVersion: this.manifest.artifact.schemaVersion,
        sha256: this.manifest.artifact.sha256,
      },
      release: {
        baciRelease: this.manifest.baciRelease,
        sourceUpdateDate: this.manifest.sourceUpdateDate,
        hsRevision: this.manifest.hsRevision,
        ingestedYears: {
          start: Math.min(...this.manifest.ingestedYears),
          end: Math.max(...this.manifest.ingestedYears),
        },
        finalizedCutoffYear: this.manifest.finalizedCutoffYear,
        provisionalYear,
      },
      exporter: {
        code: String(requireNumber(exporter.code, "exporter code")),
        name: requireString(exporter.display_name, "exporter display_name"),
        iso3: requireNullableString(exporter.iso3, "exporter iso3"),
        identityNote: requireNullableString(
          exporter.identity_note,
          "exporter identity_note",
        ),
      },
      product: {
        hsRevision: this.manifest.hsRevision,
        code: requireString(product.hs12_code, "product hs12_code"),
        descriptionEn: requireString(
          product.source_description,
          "product source_description",
        ),
      },
      marketYears: normalizedRows.filter(
        ({ year }) => year <= this.manifest.finalizedCutoffYear,
      ),
      provisionalMarketYears: normalizedRows.filter(
        ({ year }) => year === provisionalYear,
      ),
      productYearTotals: productYearRows.map((row) => ({
        year: requireNumber(row.year, "product-year year"),
        worldValueKusd: requireString(
          row.world_value_kusd,
          "product-year world_value_kusd",
        ),
      })),
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.ownsDatabase) {
      this.database.close();
    }
  }
}

function toMarketYearEvidence(
  row: Record<string, unknown>,
): MarketYearEvidence {
  const selectedValue = requireNullableString(
    row.selected_exporter_value_kusd,
    "selected exporter value",
  );
  return {
    year: requireNumber(row.year, "market year"),
    candidateMarket: {
      code: String(requireNumber(row.code, "candidate code")),
      name: requireString(row.display_name, "candidate display_name"),
      iso3: requireNullableString(row.iso3, "candidate iso3"),
      identityNote: requireNullableString(
        row.identity_note,
        "candidate identity_note",
      ),
    },
    worldValueKusd: requireString(
      row.world_value_kusd,
      "market world_value_kusd",
    ),
    selectedExporter:
      selectedValue === null
        ? { state: "NO_RECORDED_POSITIVE_FLOW" }
        : { state: "RECORDED", valueKusd: selectedValue },
    alternativeSuppliers: {
      count: requireNumber(
        row.alternative_supplier_count,
        "alternative supplier count",
      ),
      valueKusd: requireString(
        row.alternative_supplier_value_kusd,
        "alternative supplier value",
      ),
      valueSquareSumKusdSquared: requireString(
        row.alternative_supplier_value_square_sum,
        "alternative supplier square sum",
      ),
    },
    sourceFlowCount: requireNumber(
      row.source_flow_count,
      "source flow count",
    ),
    quantityPresentCount: requireNumber(
      row.quantity_present_count,
      "quantity-present count",
    ),
  };
}

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
  values?: Record<string, string | number>,
): Promise<Record<string, unknown>[]> {
  const result = await connection.runAndReadAll(sql, values);
  return result.getRowObjectsJson();
}

async function queryOptional(
  connection: DuckDBConnection,
  sql: string,
  values?: Record<string, string | number>,
): Promise<Record<string, unknown> | undefined> {
  return (await queryRows(connection, sql, values))[0];
}

async function verifyArtifactMetadata(
  database: DuckDbAnalysisDatabase,
  tablePrefix: "main." | "previous.main.",
  manifest: AnalysisArtifactManifest,
): Promise<void> {
  const rows = await database.withConnection(
    undefined,
    (connection) =>
      queryRows(
        connection,
        `SELECT key, value
         FROM ${tablePrefix}artifact_metadata
         ORDER BY key`,
      ),
  );
  const metadata = new Map(
    rows.map((row) => [
      requireString(row.key, "artifact metadata key"),
      requireString(row.value, "artifact metadata value"),
    ]),
  );
  const expected: Record<string, string> = {
    artifact_schema_version: manifest.artifact.schemaVersion,
    baci_release: manifest.baciRelease,
    finalized_cutoff_year: String(manifest.finalizedCutoffYear),
    hs_revision: manifest.hsRevision,
    source_update_date: manifest.sourceUpdateDate,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata.get(key) !== value) {
      throw new Error(`Artifact metadata ${key} does not match its manifest.`);
    }
  }
}

async function verifySourceOptions(
  options: DuckDbTradeEvidenceSourceOptions,
): Promise<{
  artifactPath: string;
  manifest: AnalysisArtifactManifest;
}> {
  validateRuntimeIdentity(options);
  const artifactPath = resolve(
    /* turbopackIgnore: true */ options.artifactPath,
  );
  const manifest = await readAnalysisArtifactManifest(
    options.artifactManifestPath,
  );
  await verifyArtifactIdentity(artifactPath, manifest.artifact);
  return { artifactPath, manifest };
}

async function verifyArtifactIdentity(
  artifactPath: string,
  expected: AnalysisArtifactManifest["artifact"],
): Promise<void> {
  if ((await statRuntimePath(artifactPath)).size !== expected.bytes) {
    throw new Error("DuckDB artifact size does not match its manifest.");
  }
  const digest = createHash("sha256");
  for await (const chunk of createRuntimeReadStream(artifactPath)) {
    digest.update(chunk);
  }
  if (digest.digest("hex") !== expected.sha256) {
    throw new Error("DuckDB artifact SHA-256 does not match its manifest.");
  }
}

function validateRuntimeIdentity(
  options: DuckDbTradeEvidenceSourceOptions,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/iu.test(options.analysisBuildId)) {
    throw new Error("analysisBuildId is malformed.");
  }
  requireSha256(
    options.analysisReleaseCatalogSha256,
    "analysis release catalog SHA-256",
  );
}

function requireSingleProvisionalYear(
  manifest: AnalysisArtifactManifest,
): number {
  if (manifest.provisionalYears.length !== 1) {
    throw new Error("Artifact manifest must identify one provisional year.");
  }
  return manifest.provisionalYears[0]!;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function requireNullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return number;
}

function requireSha256(value: unknown, label: string): string {
  const sha256 = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return sha256;
}
