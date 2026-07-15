import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { DuckDBConnection } from "@duckdb/node-api";

import {
  retiredAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../domain/candidate-market/errors";
import type { CandidateMarketV1RecipeInput } from "../domain/candidate-market/result";
import {
  retiredSupplierCompetitionAnalysisBuild,
  unknownSupplierCompetitionImporter,
  unknownSupplierCompetitionProduct,
} from "../domain/supplier-competition/errors";
import type {
  ProvisionalSupplierEconomyEvidence,
  SupplierAnnualObservation,
  SupplierCompetitionV1Inputs,
  SupplierCompetitionV1RecipeInput,
  SupplierEconomyEvidence,
} from "../domain/supplier-competition/result";
import {
  retiredTradeTrendAnalysisBuild,
  unknownImporter,
  unknownTradeTrendProduct,
} from "../domain/trade-trend/errors";
import type {
  TradeTrendObservation,
  TradeTrendV1Inputs,
  TradeTrendV1RecipeInput,
} from "../domain/trade-trend/result";
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

  async loadTradeTrendV1Inputs(
    query: TradeTrendV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<TradeTrendV1Inputs> {
    if (this.closed) {
      throw new Error("The DuckDB evidence source is closed.");
    }

    if (query.analysisBuildId !== this.analysisBuildId) {
      throw retiredTradeTrendAnalysisBuild(query.analysisBuildId);
    }
    return this.database.withConnection(
      options?.signal,
      (connection) =>
        this.loadTradeTrendWithConnection(connection, query, options?.signal),
    );
  }

  async loadSupplierCompetitionV1Inputs(
    query: SupplierCompetitionV1RecipeInput,
    options?: TradeEvidenceLoadOptions,
  ): Promise<SupplierCompetitionV1Inputs> {
    if (this.closed) {
      throw new Error("The DuckDB evidence source is closed.");
    }

    if (query.analysisBuildId !== this.analysisBuildId) {
      throw retiredSupplierCompetitionAnalysisBuild(query.analysisBuildId);
    }
    return this.database.withConnection(
      options?.signal,
      (connection) =>
        this.loadSupplierCompetitionWithConnection(
          connection,
          query,
          options?.signal,
        ),
    );
  }

  private async loadTradeTrendWithConnection(
    connection: DuckDBConnection,
    query: TradeTrendV1RecipeInput,
    signal: AbortSignal | undefined,
  ): Promise<TradeTrendV1Inputs> {
    signal?.throwIfAborted();
    const importerCode = Number(query.importerCode);
    const importer = await queryOptional(connection, `
      SELECT
        code,
        display_name,
        iso3,
        identity_note
      FROM ${this.tablePrefix}economy
      WHERE code = $importer_code
        AND kind = 'ECONOMY'
    `, { importer_code: importerCode });
    if (importer === undefined) {
      throw unknownImporter(query.importerCode);
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
      throw unknownTradeTrendProduct(query.productCode);
    }
    const productId = requireNumber(product.product_id, "product_id");

    const provisionalYear = requireSingleProvisionalYear(this.manifest);
    const windowStart = this.manifest.finalizedCutoffYear - 4;

    signal?.throwIfAborted();
    // Observation availability for this importer-year is established from
    // market_year activity for ANY product, not only the requested one.
    // BACI is compiled per reporting-country-year: a country that recorded
    // market_year activity for other products this year did submit
    // customs data for the year, so an absent row for THIS product is a
    // genuine recorded zero (NO_RECORDED_POSITIVE_FLOW). A year with zero
    // market_year rows for every product means the importer's data was
    // never observed for that year at all (MISSING_OBSERVATION) -- there is
    // no separate country-year reporting-coverage table, so cross-product
    // market_year activity is the coverage signal artifact-wide. This must
    // stay in sync with the exact same distinction asserted by the fixture
    // evidence in fixtures/trade-trend/v1/evidence.ts.
    const activityRows = await queryRows(connection, `
      SELECT
        market.year AS year,
        MAX(
          CASE WHEN market.product_id = $product_id
            THEN market.world_value_kusd
          END
        ) AS product_value_kusd
      FROM ${this.tablePrefix}market_year AS market
      WHERE market.importer_code = $importer_code
        AND (
          market.year BETWEEN $window_start AND $finalized_cutoff_year
          OR market.year = $provisional_year
        )
      GROUP BY market.year
    `, {
      importer_code: importerCode,
      product_id: productId,
      window_start: windowStart,
      finalized_cutoff_year: this.manifest.finalizedCutoffYear,
      provisional_year: provisionalYear,
    });
    const activityByYear = new Map(
      activityRows.map((row) => [
        requireNumber(row.year, "trade trend activity year"),
        requireNullableString(
          row.product_value_kusd,
          "trade trend product value",
        ),
      ]),
    );

    const finalizedObservations = Array.from(
      { length: 5 },
      (_, index) =>
        tradeTrendObservation(windowStart + index, activityByYear),
    );
    const provisionalObservation = tradeTrendObservation(
      provisionalYear,
      activityByYear,
    );

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
      importer: {
        code: String(requireNumber(importer.code, "importer code")),
        name: requireString(importer.display_name, "importer display_name"),
        iso3: requireNullableString(importer.iso3, "importer iso3"),
        identityNote: requireNullableString(
          importer.identity_note,
          "importer identity_note",
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
      finalizedObservations,
      provisionalObservation,
    };
  }

  private async loadSupplierCompetitionWithConnection(
    connection: DuckDBConnection,
    query: SupplierCompetitionV1RecipeInput,
    signal: AbortSignal | undefined,
  ): Promise<SupplierCompetitionV1Inputs> {
    signal?.throwIfAborted();
    const importerCode = Number(query.importerCode);
    const importer = await queryOptional(connection, `
      SELECT
        code,
        display_name,
        iso3,
        identity_note
      FROM ${this.tablePrefix}economy
      WHERE code = $importer_code
        AND kind = 'ECONOMY'
    `, { importer_code: importerCode });
    if (importer === undefined) {
      throw unknownSupplierCompetitionImporter(query.importerCode);
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
      throw unknownSupplierCompetitionProduct(query.productCode);
    }
    const productId = requireNumber(product.product_id, "product_id");

    const provisionalYear = requireSingleProvisionalYear(this.manifest);
    const windowStart = this.manifest.finalizedCutoffYear - 4;
    const windowEnd = this.manifest.finalizedCutoffYear;

    signal?.throwIfAborted();
    // The finalized supplier cohort is every supplying economy (exporter)
    // that recorded at least one positive bilateral_year flow to this
    // importer for this product somewhere in the five-year finalized
    // window ("cohort" below). For each cohort member, this query then
    // reproduces exactly the same MISSING_OBSERVATION vs
    // NO_RECORDED_POSITIVE_FLOW distinction that
    // loadTradeTrendWithConnection uses, but keyed by (exporter, year)
    // instead of (importer, year): a bilateral_year row from this exporter
    // to ANY importer, for ANY product, in a given year establishes that
    // the exporter's customs data was observed that year at all, so an
    // absent row for THIS importer/product is a genuine recorded zero
    // (NO_RECORDED_POSITIVE_FLOW); a year with zero bilateral_year rows
    // from this exporter to any importer means this exporter-year was
    // never observed at all (MISSING_OBSERVATION). This must stay in sync
    // with the exact same distinction asserted by the fixture evidence in
    // fixtures/supplier-competition/v1/evidence.ts.
    const activityRows = await queryRows(connection, `
      WITH cohort AS (
        SELECT DISTINCT
          bilateral.exporter_code AS exporter_code,
          economy.display_name AS display_name,
          economy.iso3 AS iso3,
          economy.identity_note AS identity_note
        FROM ${this.tablePrefix}bilateral_year AS bilateral
        JOIN ${this.tablePrefix}economy AS economy
          ON economy.code = bilateral.exporter_code
          AND economy.kind = 'ECONOMY'
        WHERE bilateral.importer_code = $importer_code
          AND bilateral.product_id = $product_id
          AND bilateral.year BETWEEN $window_start AND $window_end
      )
      SELECT
        cohort.exporter_code,
        cohort.display_name,
        cohort.iso3,
        cohort.identity_note,
        activity.year AS year,
        MAX(
          CASE WHEN activity.importer_code = $importer_code
            AND activity.product_id = $product_id
            THEN activity.value_kusd
          END
        ) AS product_value_kusd
      FROM cohort
      JOIN ${this.tablePrefix}bilateral_year AS activity
        ON activity.exporter_code = cohort.exporter_code
      WHERE activity.year BETWEEN $window_start AND $window_end
      GROUP BY
        cohort.exporter_code, cohort.display_name, cohort.iso3,
        cohort.identity_note, activity.year
      ORDER BY cohort.exporter_code, activity.year
    `, {
      importer_code: importerCode,
      product_id: productId,
      window_start: windowStart,
      window_end: windowEnd,
    });
    const suppliers = groupSupplierActivityRows(
      activityRows,
      windowStart,
      windowEnd,
    );

    signal?.throwIfAborted();
    // The Provisional Year's market total reuses market_year exactly like
    // Candidate Market and Trade Trend do, so provisionalMarketState
    // distinguishes an importer/product total that was never observed that
    // year (MISSING_OBSERVATION) from one that was observed but recorded
    // no positive flow for this product (NO_RECORDED_POSITIVE_FLOW).
    const provisionalMarketRow = await queryOptional(connection, `
      SELECT
        market.year AS year,
        MAX(
          CASE WHEN market.product_id = $product_id
            THEN market.world_value_kusd
          END
        ) AS product_value_kusd
      FROM ${this.tablePrefix}market_year AS market
      WHERE market.importer_code = $importer_code
        AND market.year = $provisional_year
      GROUP BY market.year
    `, { importer_code: importerCode, product_id: productId, provisional_year: provisionalYear });
    const provisionalWorldValueKusd =
      provisionalMarketRow === undefined
        ? undefined
        : requireNullableString(
            provisionalMarketRow.product_value_kusd,
            "provisional product value",
          );
    const provisionalMarketState: SupplierCompetitionV1Inputs["provisionalMarketState"] =
      provisionalWorldValueKusd === undefined
        ? "MISSING_OBSERVATION"
        : provisionalWorldValueKusd === null
          ? "NO_RECORDED_POSITIVE_FLOW"
          : "RECORDED";

    let provisionalSuppliers: readonly ProvisionalSupplierEconomyEvidence[] =
      [];
    if (provisionalMarketState === "RECORDED") {
      signal?.throwIfAborted();
      // Every positive bilateral_year row for this importer/product in the
      // Provisional Year is a complete supplier: this naturally covers both
      // finalized-cohort members that stayed positive and brand-new
      // entrants, since computeSupplierCompetitionV1 partitions those two
      // cases itself from provisionalSuppliers's economy codes. A
      // finalized-cohort member absent from this list is treated by that
      // same domain code as NO_RECORDED_POSITIVE_FLOW, so no explicit
      // negative rows are required here.
      const provisionalRows = await queryRows(connection, `
        SELECT
          bilateral.exporter_code,
          economy.display_name,
          economy.iso3,
          economy.identity_note,
          bilateral.value_kusd
        FROM ${this.tablePrefix}bilateral_year AS bilateral
        JOIN ${this.tablePrefix}economy AS economy
          ON economy.code = bilateral.exporter_code
          AND economy.kind = 'ECONOMY'
        WHERE bilateral.importer_code = $importer_code
          AND bilateral.product_id = $product_id
          AND bilateral.year = $provisional_year
        ORDER BY bilateral.exporter_code
      `, {
        importer_code: importerCode,
        product_id: productId,
        provisional_year: provisionalYear,
      });
      provisionalSuppliers = provisionalRows.map(
        (row): ProvisionalSupplierEconomyEvidence => ({
          economy: {
            code: String(requireNumber(row.exporter_code, "supplier code")),
            name: requireString(row.display_name, "supplier display_name"),
            iso3: requireNullableString(row.iso3, "supplier iso3"),
            identityNote: requireNullableString(
              row.identity_note,
              "supplier identity_note",
            ),
          },
          bilateral: {
            state: "RECORDED_POSITIVE",
            valueCurrentUsd: kusdToCurrentUsd(
              requireString(row.value_kusd, "provisional supplier value"),
            ),
          },
        }),
      );
    }

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
      importer: {
        code: String(requireNumber(importer.code, "importer code")),
        name: requireString(importer.display_name, "importer display_name"),
        iso3: requireNullableString(importer.iso3, "importer iso3"),
        identityNote: requireNullableString(
          importer.identity_note,
          "importer identity_note",
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
      suppliers,
      provisionalMarketState,
      provisionalSuppliers,
    };
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

// Distinguishes MISSING_OBSERVATION (the importer has no market_year row for
// any product this year: this importer-year was never observed at all) from
// NO_RECORDED_POSITIVE_FLOW (the importer has market_year rows for other
// products this year, so it was observed, but recorded none of this exact
// product). See the query comment in loadTradeTrendWithConnection for the
// full domain rationale.
function tradeTrendObservation(
  year: number,
  activityByYear: ReadonlyMap<number, string | null>,
): TradeTrendObservation {
  if (!activityByYear.has(year)) {
    return { year, state: "MISSING_OBSERVATION" };
  }
  const valueKusd = activityByYear.get(year) ?? null;
  if (valueKusd === null) {
    return { year, state: "NO_RECORDED_POSITIVE_FLOW" };
  }
  return {
    year,
    state: "RECORDED_POSITIVE",
    valueCurrentUsd: kusdToCurrentUsd(valueKusd),
  };
}

// Groups the (exporter, year, product_value_kusd) rows produced by
// loadSupplierCompetitionWithConnection's cohort/activity query into one
// SupplierEconomyEvidence per exporter, with a complete five-year annual
// observation for every finalized window year. See that query's own
// comment for the MISSING_OBSERVATION vs NO_RECORDED_POSITIVE_FLOW
// rationale.
function groupSupplierActivityRows(
  rows: readonly Record<string, unknown>[],
  windowStart: number,
  windowEnd: number,
): SupplierEconomyEvidence[] {
  const byExporter = new Map<
    string,
    {
      economy: SupplierEconomyEvidence["economy"];
      valueByYear: Map<number, string | null>;
    }
  >();
  for (const row of rows) {
    const code = String(requireNumber(row.exporter_code, "supplier code"));
    let entry = byExporter.get(code);
    if (entry === undefined) {
      entry = {
        economy: {
          code,
          name: requireString(row.display_name, "supplier display_name"),
          iso3: requireNullableString(row.iso3, "supplier iso3"),
          identityNote: requireNullableString(
            row.identity_note,
            "supplier identity_note",
          ),
        },
        valueByYear: new Map(),
      };
      byExporter.set(code, entry);
    }
    entry.valueByYear.set(
      requireNumber(row.year, "supplier activity year"),
      requireNullableString(row.product_value_kusd, "supplier product value"),
    );
  }

  return [...byExporter.values()].map(({ economy, valueByYear }) => {
    const annualObservations: SupplierAnnualObservation[] = Array.from(
      { length: windowEnd - windowStart + 1 },
      (_, index) =>
        supplierAnnualObservation(windowStart + index, valueByYear),
    );
    // The immutable bilateral_year/market_year tables do not retain
    // per-bilateral quantity presence (only a market-wide, all-suppliers
    // count exists on market_year), so genuine per-supplier quantity
    // coverage cannot be measured from this schema. Reporting both counts
    // as zero yields quantityCoverageRate === null ("UNKNOWN") rather than
    // fabricating a precise rate this evidence cannot support.
    return {
      economy,
      annualObservations,
      sourceFlowCount: 0,
      quantityPresentCount: 0,
    };
  });
}

function supplierAnnualObservation(
  year: number,
  valueByYear: ReadonlyMap<number, string | null>,
): SupplierAnnualObservation {
  if (!valueByYear.has(year)) {
    return { year, state: "MISSING_OBSERVATION" };
  }
  const valueKusd = valueByYear.get(year) ?? null;
  if (valueKusd === null) {
    return { year, state: "NO_RECORDED_POSITIVE_FLOW" };
  }
  return {
    year,
    state: "RECORDED_POSITIVE",
    valueCurrentUsd: kusdToCurrentUsd(valueKusd),
  };
}

function kusdToCurrentUsd(valueKusd: string): string {
  const match = /^(\d+)\.(\d{3})$/u.exec(valueKusd);
  if (match === null) {
    throw new Error("Market-year world value must have three decimals.");
  }
  const usd = BigInt(`${match[1]}${match[2]}`).toString();
  if (usd === "0") {
    throw new Error("A recorded trade value must be positive.");
  }
  return usd;
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
