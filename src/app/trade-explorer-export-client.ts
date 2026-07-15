import type { TradeExplorerV1Payload } from "../domain/trade-analytics/trade-explorer-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
  tradeExplorerCsvUrl,
} from "../export/trade-explorer-csv-contract";
import {
  assertTradeExplorerExportContext,
  TradeExplorerExportContextError,
} from "../export/trade-explorer-export-context";
import {
  CurrentAnalysisDiscoveryError,
  loadAnalysisBuildManifest,
  loadCurrentAnalysisManifest,
} from "./current-analysis-discovery";

export class TradeExplorerExportPreparationError extends Error {
  readonly code = "STALE_ANALYSIS";

  constructor(
    message: string,
    readonly manifest: CurrentAnalysisManifest,
  ) {
    super(message);
    this.name = "TradeExplorerExportPreparationError";
  }
}

export async function prepareTradeExplorerExport({
  result,
  fetcher,
  signal,
}: {
  result: TradeExplorerV1Payload;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<{ manifest: CurrentAnalysisManifest; url: string }> {
  const currentManifest = await loadCurrentAnalysisManifest({
    fetcher,
    signal,
    revalidate: true,
  });
  let exportManifest = currentManifest;
  if (result.analysisBuildId !== currentManifest.analysisBuildId) {
    try {
      exportManifest = await loadAnalysisBuildManifest({
        analysisBuildId: result.analysisBuildId,
        fetcher,
        signal,
      });
    } catch (error) {
      if (
        error instanceof CurrentAnalysisDiscoveryError &&
        (error.status === 404 || error.status === 410)
      ) {
        throw new TradeExplorerExportPreparationError(
          "The retained analysis build is no longer available. Rerun the analysis before exporting.",
          currentManifest,
        );
      }
      throw error;
    }
  }
  try {
    assertTradeExplorerExportContext(result, exportManifest);
  } catch (error) {
    if (error instanceof TradeExplorerExportContextError) {
      throw new TradeExplorerExportPreparationError(
        error.message,
        currentManifest,
      );
    }
    throw error;
  }

  return {
    manifest: currentManifest,
    url: tradeExplorerCsvUrl({
      analysisBuildId: result.analysisBuildId,
      query: {
        shape: result.query.shape,
        dimensions: [result.query.dimension],
        measures: result.query.measures,
        filters: {
          year: { mode: "list", years: result.query.years },
          exportEconomy: result.query.exportEconomy,
          importEconomy: result.query.importEconomy,
          hsProduct: result.query.hsProduct,
        },
        sort: result.query.sort,
      },
      freshnessStatusId: exportManifest.freshness.freshnessStatusId,
      schemaVersion: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
    }),
  };
}
