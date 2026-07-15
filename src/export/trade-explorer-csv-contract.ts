import { encodeTradeExplorerQuery, type TradeExplorerQueryFields } from "../domain/trade-analytics/trade-explorer-v1-query-codec";

export const TRADE_EXPLORERS_CSV_SCHEMA_VERSION = "trade-explorers-csv-v1";

export type TradeExplorerCsvIdentity = Readonly<{
  analysisBuildId: string;
  query: TradeExplorerQueryFields;
  freshnessStatusId: string;
  schemaVersion: typeof TRADE_EXPLORERS_CSV_SCHEMA_VERSION;
}>;

export function tradeExplorerCsvUrl({
  analysisBuildId,
  query,
  freshnessStatusId,
  schemaVersion,
}: TradeExplorerCsvIdentity): string {
  const parameters = encodeTradeExplorerQuery(query);
  parameters.set("freshnessStatusId", freshnessStatusId);
  parameters.set("schema", schemaVersion);
  return `/api/v1/analyses/${encodeURIComponent(
    analysisBuildId,
  )}/trade-explorer.csv?${parameters}`;
}
