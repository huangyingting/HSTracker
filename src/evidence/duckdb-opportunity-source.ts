import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

import {
  invalidOpportunityCursor,
  unknownExportEconomy,
  unknownOpportunityProduct,
} from "../domain/opportunity-discovery/errors";
import {
  buildMarketInvestigationPage,
  decodeAndValidateCursor,
} from "../domain/opportunity-discovery/page";
import { productFilterDigest } from "../domain/opportunity-discovery/cursor";
import type {
  EconomyIdentity,
  MarketInvestigationCandidate,
  MarketInvestigationPage,
  OpportunityDiscoveryV1RecipeInput,
  OpportunityProvenance,
  ProductIdentity,
} from "../domain/opportunity-discovery/result";
import { DuckDbAnalysisDatabase } from "./duckdb-analysis-database";
import {
  decodeIndexRowCells,
  indexRowToCandidate,
  OPPORTUNITY_INDEX_COLUMN_NAMES,
} from "./opportunity-index-row";
import type {
  OpportunityCandidateIndex,
  OpportunityDetailEvidence,
  OpportunityDetailRequest,
  OpportunityEvidenceLoadOptions,
  OpportunityEvidenceSource,
  OpportunityMarketYearEvidence,
} from "./opportunity-evidence-source";

const INDEX_RELATIVE_PATH = "opportunity-index.duckdb";
const INDEX_MANIFEST_RELATIVE_PATH = "opportunity-index-manifest.json";

// The published index manifest fields this adapter reads. The build writes the
// full manifest (scripts/release/opportunity-index.ts publishIndex); the
// adapter only depends on identity/provenance and the previous-release marker.
type IndexManifest = {
  finalizedCutoffYear: number;
  scoreWindow: { start: number; end: number };
  baciRelease: string;
  sourceUpdateDate: string;
  hsRevision: "HS12";
  provisionalYear: number;
  sourceArtifact: {
    schemaVersion: string;
    buildId: string;
    sha256: string;
  };
  previousReleaseArtifact: unknown | null;
};

// Product and economy labels resolved once from the analysis artifact, so every
// reconstructed candidate carries byte-identical identities to the ones the
// offline build read (product.source_description, economy.display_name, ...).
type OpportunityDimensions = {
  productById: Map<number, ProductIdentity>;
  productIdByCode: Map<string, number>;
  economyByCode: Map<number, EconomyIdentity>;
  // Economy codes eligible to be an exporter cohort (kind=ECONOMY with recorded
  // trade evidence), matching the offline build's eligibility exactly.
  eligibleExporterCodes: Set<string>;
};

type WindowBounds = { start: number; end: number };

function normalizeEconomyCode(code: string): string {
  return String(Number(code));
}

function requireInteger(value: unknown, subject: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new TypeError(`${subject} must be an integer, received ${value}.`);
  }
  return parsed;
}

async function loadDimensions(
  connection: DuckDBConnection,
): Promise<OpportunityDimensions> {
  const productById = new Map<number, ProductIdentity>();
  const productIdByCode = new Map<string, number>();
  const productReader = await connection.runAndReadAll(
    "SELECT product_id, hs12_code, source_description FROM product",
  );
  for (const row of productReader.getRows()) {
    const productId = Number(row[0]);
    const code = String(row[1]);
    productById.set(productId, {
      hsRevision: "HS12",
      code,
      descriptionEn: String(row[2]),
    });
    productIdByCode.set(code, productId);
  }

  const economyByCode = new Map<number, EconomyIdentity>();
  const eligibleExporterCodes = new Set<string>();
  const economyReader = await connection.runAndReadAll(
    "SELECT code, display_name, iso3, identity_note, kind, has_trade_evidence FROM economy ORDER BY code",
  );
  for (const row of economyReader.getRows()) {
    const code = Number(row[0]);
    const iso3 = row[2];
    const identityNote = row[3];
    economyByCode.set(code, {
      code: String(code),
      name: String(row[1]),
      iso3: iso3 === null ? null : String(iso3),
      identityNote: identityNote === null ? null : String(identityNote),
    });
    if (row[4] === "ECONOMY" && row[5] === true) {
      eligibleExporterCodes.add(String(code));
    }
  }

  return { productById, productIdByCode, economyByCode, eligibleExporterCodes };
}

async function readIndexManifest(
  indexDirectoryPath: string,
): Promise<IndexManifest> {
  const manifestPath = resolve(
    indexDirectoryPath,
    INDEX_MANIFEST_RELATIVE_PATH,
  );
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as IndexManifest;
}

function provenanceFromManifest(manifest: IndexManifest): OpportunityProvenance {
  return {
    baciRelease: manifest.baciRelease,
    sourceUpdateDate: manifest.sourceUpdateDate,
    hsRevision: manifest.hsRevision,
    finalizedCutoffYear: manifest.finalizedCutoffYear,
    scoreWindow: manifest.scoreWindow,
    provisionalYear: manifest.provisionalYear,
    recipeVersion: "opportunity-discovery-v1",
    resultSchemaVersion: "market-investigation-result-v1",
    artifactBuildId: manifest.sourceArtifact.buildId,
    artifactSchemaVersion: manifest.sourceArtifact.schemaVersion,
    artifactSha256: manifest.sourceArtifact.sha256,
    valueUnit: "CURRENT_USD",
  };
}

// The canonical ORDER BY. product_id is byte-monotonic with hs12_code in the
// analysis artifact (product ids are assigned in ascending hs12 order), so
// ordering by product_id ASC is identical to hs12 ASC without joining the
// product dimension, and importer_code is numeric.
const CANONICAL_ORDER =
  "priority_display DESC, attractiveness_display DESC, exporter_fit_display DESC, product_id ASC, importer_code ASC";

const INDEX_COLUMN_LIST = OPPORTUNITY_INDEX_COLUMN_NAMES.join(", ");

// Serves the ordered Market Investigation feed for one analysis build from a
// published Opportunity Index (opportunity-index.duckdb). Ordering, keyset
// pagination, and the full rich grain are read straight from the index; product
// and economy labels come from the analysis artifact so every reconstructed
// candidate is byte-identical to the offline recipe output. Cursors are bound
// to the platform-supplied Analysis Identity and never replayed across feeds.
export class DuckDbOpportunityCandidateIndex
  implements OpportunityCandidateIndex
{
  private constructor(
    private readonly index: DuckDbAnalysisDatabase,
    private readonly dimensions: OpportunityDimensions,
    private readonly provenance: OpportunityProvenance,
    private readonly analysisBuildId: string,
    private readonly scoreWindow: WindowBounds,
    private readonly hasPreviousRelease: boolean,
  ) {}

  static async open(options: {
    indexDirectoryPath: string;
    analysisArtifactPath: string;
    servingVolumePath: string;
  }): Promise<DuckDbOpportunityCandidateIndex> {
    const manifest = await readIndexManifest(options.indexDirectoryPath);
    const dimensions = await loadArtifactDimensions(
      options.analysisArtifactPath,
    );
    const index = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: join(
        options.indexDirectoryPath,
        INDEX_RELATIVE_PATH,
      ),
      previousArtifactPath: null,
      servingVolumePath: options.servingVolumePath,
    });
    return new DuckDbOpportunityCandidateIndex(
      index,
      dimensions,
      provenanceFromManifest(manifest),
      manifest.sourceArtifact.buildId,
      manifest.scoreWindow,
      manifest.previousReleaseArtifact !== null,
    );
  }

  close(): void {
    this.index.close();
  }

  async page(
    query: OpportunityDiscoveryV1RecipeInput,
    analysisIdentity: string,
    options?: OpportunityEvidenceLoadOptions,
  ): Promise<MarketInvestigationPage> {
    const exporterCode = normalizeEconomyCode(query.exportEconomyCode);
    if (!this.dimensions.eligibleExporterCodes.has(exporterCode)) {
      throw unknownExportEconomy(query.exportEconomyCode);
    }
    const exporterNumber = Number(exporterCode);
    const exporter = this.dimensions.economyByCode.get(exporterNumber);
    if (exporter === undefined) {
      throw unknownExportEconomy(query.exportEconomyCode);
    }

    const productIdFilter = this.resolveProductFilter(query.productCodes);
    const digest = productFilterDigest(query.productCodes);
    const lastKey = decodeAndValidateCursor(
      query.cursor,
      analysisIdentity,
      digest,
    );
    const keysetBound =
      lastKey === null ? null : this.resolveKeysetBound(lastKey);

    const signal = options?.signal;
    const cohortSize = await this.index.withConnection(signal, (connection) =>
      queryCount(
        connection,
        `SELECT COUNT(*) FROM opportunity_candidate WHERE exporter_code = ${exporterNumber}`,
      ),
    );

    const fetched = await this.index.withConnection(signal, (connection) =>
      this.fetchWindow(
        connection,
        exporterNumber,
        productIdFilter,
        keysetBound,
        query.limit + 1,
      ),
    );
    const hasMore = fetched.length > query.limit;
    const windowRows = hasMore ? fetched.slice(0, query.limit) : fetched;

    const window = windowRows.map((entry) => this.reconstruct(entry, exporterCode));

    return buildMarketInvestigationPage({
      analysisBuildId: this.analysisBuildId,
      exporter,
      provenance: this.provenance,
      cohortSize,
      productCodes: query.productCodes,
      limit: query.limit,
      requestedCursor: query.cursor,
      analysisIdentity,
      window,
      hasMore,
    });
  }

  private resolveProductFilter(
    productCodes: readonly string[] | null,
  ): number[] | null {
    if (productCodes === null) {
      return null;
    }
    const ids: number[] = [];
    for (const code of productCodes) {
      const productId = this.dimensions.productIdByCode.get(code);
      if (productId === undefined) {
        throw unknownOpportunityProduct(code);
      }
      ids.push(productId);
    }
    return ids;
  }

  private resolveKeysetBound(lastKey: {
    priorityDisplay: number;
    attractivenessDisplay: number;
    exporterFitDisplay: number;
    productCode: string;
    importerCode: string;
  }): {
    priority: number;
    attractiveness: number;
    fit: number;
    productId: number;
    importer: number;
  } {
    const productId = this.dimensions.productIdByCode.get(lastKey.productCode);
    if (productId === undefined) {
      throw invalidOpportunityCursor(
        "Cursor references a product outside this analysis build.",
      );
    }
    return {
      priority: lastKey.priorityDisplay,
      attractiveness: lastKey.attractivenessDisplay,
      fit: lastKey.exporterFitDisplay,
      productId,
      importer: Number(lastKey.importerCode),
    };
  }

  private async fetchWindow(
    connection: DuckDBConnection,
    exporterNumber: number,
    productIdFilter: number[] | null,
    keysetBound: {
      priority: number;
      attractiveness: number;
      fit: number;
      productId: number;
      importer: number;
    } | null,
    limit: number,
  ): Promise<{ cells: readonly unknown[]; tieSize: number }[]> {
    const filters: string[] = [];
    if (productIdFilter !== null) {
      // An empty projection can never match a candidate; short-circuit to no
      // rows rather than emit `IN ()`, which DuckDB rejects.
      if (productIdFilter.length === 0) {
        return [];
      }
      filters.push(`product_id IN (${productIdFilter.join(", ")})`);
    }
    if (keysetBound !== null) {
      filters.push(keysetPredicate(keysetBound));
    }
    const whereProjection =
      filters.length === 0 ? "" : ` WHERE ${filters.join(" AND ")}`;

    // The tie size is a full-cohort property (rank groups span the whole
    // exporter cohort), so it is computed before the product projection and
    // keyset filter narrow the returned window.
    const sql =
      `WITH exporter_cohort AS (` +
      `SELECT ${INDEX_COLUMN_LIST}, ` +
      `COUNT(*) OVER (PARTITION BY competition_rank) AS competition_rank_tie_size ` +
      `FROM opportunity_candidate WHERE exporter_code = ${exporterNumber}) ` +
      `SELECT ${INDEX_COLUMN_LIST}, competition_rank_tie_size ` +
      `FROM exporter_cohort${whereProjection} ` +
      `ORDER BY ${CANONICAL_ORDER} LIMIT ${limit}`;

    const reader = await connection.runAndReadAll(sql);
    return reader.getRows().map((row) => ({
      cells: row.slice(0, OPPORTUNITY_INDEX_COLUMN_NAMES.length),
      tieSize: requireInteger(
        row[OPPORTUNITY_INDEX_COLUMN_NAMES.length],
        "competition_rank_tie_size",
      ),
    }));
  }

  private reconstruct(
    entry: { cells: readonly unknown[]; tieSize: number },
    exporterCode: string,
  ): MarketInvestigationCandidate {
    const row = decodeIndexRowCells(entry.cells);
    const product = this.dimensions.productById.get(row.productId);
    const market = this.dimensions.economyByCode.get(row.importerCode);
    if (product === undefined || market === undefined) {
      throw new TypeError(
        `Index row references product ${row.productId}/importer ${row.importerCode} absent from the analysis artifact.`,
      );
    }
    return indexRowToCandidate(row, {
      product,
      market,
      exporterCode,
      competitionRankTieSize: entry.tieSize,
      scoreWindow: this.scoreWindow,
      hasPreviousRelease: this.hasPreviousRelease,
    });
  }
}

// Builds the strictly-after keyset predicate for the canonical order
// (priority DESC, attractiveness DESC, fit DESC, product_id ASC, importer ASC).
function keysetPredicate(bound: {
  priority: number;
  attractiveness: number;
  fit: number;
  productId: number;
  importer: number;
}): string {
  const { priority, attractiveness, fit, productId, importer } = bound;
  return (
    "(" +
    [
      `priority_display < ${priority}`,
      `(priority_display = ${priority} AND attractiveness_display < ${attractiveness})`,
      `(priority_display = ${priority} AND attractiveness_display = ${attractiveness} AND exporter_fit_display < ${fit})`,
      `(priority_display = ${priority} AND attractiveness_display = ${attractiveness} AND exporter_fit_display = ${fit} AND product_id > ${productId})`,
      `(priority_display = ${priority} AND attractiveness_display = ${attractiveness} AND exporter_fit_display = ${fit} AND product_id = ${productId} AND importer_code > ${importer})`,
    ].join(" OR ") +
    ")"
  );
}

async function queryCount(
  connection: DuckDBConnection,
  sql: string,
): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  return requireInteger(reader.getRows()[0]?.[0], "count");
}

// Loads the product/economy dimensions from the analysis artifact once and then
// releases the transient connection; dimensions are static per build.
async function loadArtifactDimensions(
  analysisArtifactPath: string,
): Promise<OpportunityDimensions> {
  const instance = await DuckDBInstance.create(
    resolve(/* turbopackIgnore: true */ analysisArtifactPath),
    { access_mode: "READ_ONLY" },
  );
  try {
    const connection = await instance.connect();
    return await loadDimensions(connection);
  } finally {
    instance.closeSync();
  }
}

// Serves raw detail evidence for one candidate straight from the analysis
// artifact's market_year/bilateral_year rows over the score window, carrying the
// canonical Candidate Market (candidate-market-v1) drill-down link. It mirrors
// FixtureOpportunityEvidenceSource so the two detail feeds are byte-identical.
export class DuckDbOpportunityEvidenceSource
  implements OpportunityEvidenceSource
{
  private constructor(
    private readonly artifact: DuckDbAnalysisDatabase,
    private readonly dimensions: OpportunityDimensions,
    private readonly analysisBuildId: string,
    private readonly scoreWindow: WindowBounds,
  ) {}

  static async open(options: {
    indexDirectoryPath: string;
    analysisArtifactPath: string;
    servingVolumePath: string;
  }): Promise<DuckDbOpportunityEvidenceSource> {
    const manifest = await readIndexManifest(options.indexDirectoryPath);
    const artifact = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: options.analysisArtifactPath,
      previousArtifactPath: null,
      servingVolumePath: options.servingVolumePath,
    });
    try {
      const dimensions = await artifact.withConnection(undefined, (connection) =>
        loadDimensions(connection),
      );
      return new DuckDbOpportunityEvidenceSource(
        artifact,
        dimensions,
        manifest.sourceArtifact.buildId,
        manifest.scoreWindow,
      );
    } catch (error) {
      artifact.close();
      throw error;
    }
  }

  close(): void {
    this.artifact.close();
  }

  async loadDetail(
    request: OpportunityDetailRequest,
    options?: OpportunityEvidenceLoadOptions,
  ): Promise<OpportunityDetailEvidence> {
    const exporterCode = normalizeEconomyCode(request.exportEconomyCode);
    if (!this.dimensions.eligibleExporterCodes.has(exporterCode)) {
      throw unknownExportEconomy(request.exportEconomyCode);
    }
    const exporter = this.dimensions.economyByCode.get(Number(exporterCode));
    if (exporter === undefined) {
      throw unknownExportEconomy(request.exportEconomyCode);
    }
    const productId = this.dimensions.productIdByCode.get(request.productCode);
    const product =
      productId === undefined
        ? undefined
        : this.dimensions.productById.get(productId);
    if (productId === undefined || product === undefined) {
      throw unknownOpportunityProduct(request.productCode);
    }
    const importerCode = Number(normalizeEconomyCode(request.marketCode));
    const market = this.dimensions.economyByCode.get(importerCode);
    if (market === undefined) {
      throw unknownOpportunityProduct(request.productCode);
    }

    const marketYears = await this.artifact.withConnection(
      options?.signal,
      (connection) =>
        this.loadMarketYears(
          connection,
          Number(exporterCode),
          productId,
          importerCode,
        ),
    );
    if (marketYears.length === 0) {
      throw unknownOpportunityProduct(request.productCode);
    }

    return {
      analysisBuildId: this.analysisBuildId,
      exporter,
      product,
      market,
      candidateMarketDrillDown: {
        recipe: "candidate-market-v1",
        exporterCode,
        product,
        focusMarketCode: String(importerCode),
      },
      scoreWindow: this.scoreWindow,
      marketYears,
    };
  }

  private async loadMarketYears(
    connection: DuckDBConnection,
    exporterCode: number,
    productId: number,
    importerCode: number,
  ): Promise<OpportunityMarketYearEvidence[]> {
    const reader = await connection.runAndReadAll(
      `SELECT m.year, CAST(m.world_value_kusd AS VARCHAR) AS world, ` +
        `CAST(b.value_kusd AS VARCHAR) AS bilateral ` +
        `FROM market_year m ` +
        `LEFT JOIN bilateral_year b ON b.product_id = m.product_id ` +
        `AND b.importer_code = m.importer_code AND b.year = m.year ` +
        `AND b.exporter_code = ${exporterCode} ` +
        `WHERE m.product_id = ${productId} AND m.importer_code = ${importerCode} ` +
        `AND m.year BETWEEN ${this.scoreWindow.start} AND ${this.scoreWindow.end} ` +
        `ORDER BY m.year`,
    );
    return reader.getRows().map((row) => ({
      year: requireInteger(row[0], "market year"),
      worldValueKusd: String(row[1]),
      bilateralValueKusd: row[2] === null ? null : String(row[2]),
    }));
  }
}
