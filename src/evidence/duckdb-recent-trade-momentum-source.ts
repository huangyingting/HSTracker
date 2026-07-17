import { DuckDBInstance } from "@duckdb/node-api";

import {
  retiredRecentTradeMomentumAnalysisBuild,
  unknownRecentTradeMomentumProduct,
  unknownRecentTradeMomentumReporter,
} from "../domain/recent-trade-momentum/errors";
import type {
  RecentTradeMomentumMonthObservation,
  RecentTradeMomentumV1Input,
} from "../domain/recent-trade-momentum/recent-trade-momentum-v1";
import type {
  RecentTradeMomentumDatasetPackage,
} from "../domain/trade-analytics/recent-trade-momentum-v1-dataset-package";
import type {
  RecentTradeMomentumEvidenceLoadOptions,
  RecentTradeMomentumEvidenceSource,
  RecentTradeMomentumV1RecipeInput,
} from "./recent-trade-momentum-evidence-source";

type DuckDbRecentTradeMomentumEvidenceSourceOptions = Readonly<{
  artifactPath: string;
  analysisBuildId: string;
  datasetPackage: RecentTradeMomentumDatasetPackage;
}>;

export class DuckDbRecentTradeMomentumEvidenceSource
  implements RecentTradeMomentumEvidenceSource
{
  private closed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly analysisBuildId: string,
    private readonly datasetPackage: RecentTradeMomentumDatasetPackage,
  ) {}

  static async open(
    options: DuckDbRecentTradeMomentumEvidenceSourceOptions,
  ): Promise<DuckDbRecentTradeMomentumEvidenceSource> {
    const instance = await DuckDBInstance.create(options.artifactPath, {
      access_mode: "READ_ONLY",
    });
    return new DuckDbRecentTradeMomentumEvidenceSource(
      instance,
      options.analysisBuildId,
      options.datasetPackage,
    );
  }

  async loadRecentTradeMomentumV1Input(
    query: RecentTradeMomentumV1RecipeInput,
    options?: RecentTradeMomentumEvidenceLoadOptions,
  ): Promise<RecentTradeMomentumV1Input> {
    options?.signal?.throwIfAborted();
    if (this.closed) {
      throw new Error("The Recent Trade Momentum evidence source is closed.");
    }
    if (query.analysisBuildId !== this.analysisBuildId) {
      throw retiredRecentTradeMomentumAnalysisBuild(query.analysisBuildId);
    }
    const connection = await this.instance.connect();
    try {
      const reporterRows = await connection.runAndReadAll(`
        SELECT reporter_id, iso2
        FROM reporter
        WHERE iso2 = ${sqlString(query.reporterCode)}
      `);
      const reporter = reporterRows.getRowObjectsJson()[0] as
        | Record<string, unknown>
        | undefined;
      if (reporter === undefined) {
        throw unknownRecentTradeMomentumReporter(query.reporterCode);
      }
      const reporterId = Number(reporter.reporter_id);
      const productRows = await connection.runAndReadAll(`
        SELECT COUNT(*) AS row_count
        FROM market_month
        WHERE hs12_code = ${sqlString(query.productCode)}
      `);
      if (Number(productRows.getRowObjectsJson()[0]?.row_count ?? 0) === 0) {
        throw unknownRecentTradeMomentumProduct(query.productCode);
      }
      const rows = await readMarketMonthRows(
        connection,
        reporterId,
        query.productCode,
      );
      if (rows.length === 0) {
        throw unknownRecentTradeMomentumReporter(query.reporterCode);
      }
      const states = new Set(rows.map((row) => row.observationState));
      const marketStatus =
        states.size === 1 && states.has("SOURCE_UNAVAILABLE")
          ? "SOURCE_UNAVAILABLE"
          : states.size === 1 && states.has("UNSUPPORTED_MARKET")
            ? "UNSUPPORTED_MARKET"
            : "SUPPORTED";
      const productMappingStatus = states.has("UNSUPPORTED_PRODUCT_MAPPING")
        ? "UNSUPPORTED_PRODUCT_MAPPING"
        : "EXACT_REVIEWED";
      return {
        recipe: "recent-trade-momentum-v1",
        resultSchemaVersion: "recent-trade-momentum-result-v1",
        monthlyPackageId: this.datasetPackage.identity,
        sourceVintageId: this.datasetPackage.manifest.sourceVintageId,
        reporterIso2: query.reporterCode,
        hs12Code: query.productCode,
        cutoffMonth:
          this.datasetPackage.manifest.newestEligibleMonthByReporter[
            query.reporterCode
          ] ?? this.datasetPackage.manifest.referenceMonthRange.end,
        eligibleCompleteMonths: rows.map((row) => row.referenceMonth),
        marketStatus,
        productMappingStatus,
        observations: rows,
        revisionComparisonWindowChangeRate: 0,
      };
    } finally {
      connection.closeSync();
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.instance.closeSync();
  }
}

async function readMarketMonthRows(
  connection: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  reporterId: number,
  productCode: string,
): Promise<RecentTradeMomentumMonthObservation[]> {
  const query = (includeMappingChain: boolean) => `
    SELECT
      reference_month,
      observation_state,
      value_eur,
      update_state${includeMappingChain ? ", mapping_chain" : ""}
    FROM market_month
    WHERE reporter_id = ${reporterId}
      AND hs12_code = ${sqlString(productCode)}
    ORDER BY reference_month
  `;
  let reader;
  try {
    reader = await connection.runAndReadAll(query(true));
  } catch {
    reader = await connection.runAndReadAll(query(false));
  }
  return reader.getRowObjectsJson().map((row) => ({
    referenceMonth: String(row.reference_month),
    observationState: String(
      row.observation_state,
    ) as RecentTradeMomentumMonthObservation["observationState"],
    valueEur: row.value_eur === null ? null : Number(row.value_eur),
    updateState: String(
      row.update_state,
    ) as RecentTradeMomentumMonthObservation["updateState"],
    mappingChain:
      row.mapping_chain === "MULTI_STEP_EXACT"
        ? "MULTI_STEP_EXACT"
        : "DIRECT_EXACT",
  }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}
