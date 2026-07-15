import type { TradeTrendV1Payload } from "../domain/trade-analytics/trade-trend-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  TRADE_TRENDS_CSV_SCHEMA_VERSION,
  tradeTrendCsvUrl,
} from "../export/trade-trend-csv-contract";
import {
  assertTradeTrendExportContext,
  TradeTrendExportContextError,
} from "../export/trade-trend-export-context";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";

export class TradeTrendExportPreparationError extends Error {
  readonly code = "STALE_ANALYSIS";

  constructor(
    message: string,
    readonly manifest: CurrentAnalysisManifest,
  ) {
    super(message);
    this.name = "TradeTrendExportPreparationError";
  }
}

export async function prepareTradeTrendExport({
  result,
  fetcher,
  signal,
}: {
  result: TradeTrendV1Payload;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<{ manifest: CurrentAnalysisManifest; url: string }> {
  const manifest = await loadCurrentAnalysisManifest({
    fetcher,
    signal,
    revalidate: true,
  });
  try {
    assertTradeTrendExportContext(result, manifest);
  } catch (error) {
    if (error instanceof TradeTrendExportContextError) {
      throw new TradeTrendExportPreparationError(
        error.message,
        manifest,
      );
    }
    throw error;
  }

  return {
    manifest,
    url: tradeTrendCsvUrl({
      analysisBuildId: result.analysisBuildId,
      importerCode: result.query.importer.code,
      productCode: result.query.product.code,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshness.freshnessStatusId,
      schemaVersion: TRADE_TRENDS_CSV_SCHEMA_VERSION,
    }),
  };
}
