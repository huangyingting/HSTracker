export const TRADE_TRENDS_CSV_SCHEMA_VERSION = "trade-trends-csv-v1";

export type TradeTrendCsvIdentity = {
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
  productSearchBuildId: string;
  freshnessStatusId: string;
  schemaVersion: typeof TRADE_TRENDS_CSV_SCHEMA_VERSION;
};

export function tradeTrendCsvUrl({
  analysisBuildId,
  importerCode,
  productCode,
  productSearchBuildId,
  freshnessStatusId,
  schemaVersion,
}: TradeTrendCsvIdentity): string {
  const parameters = new URLSearchParams({
    importer: importerCode,
    product: productCode,
    productSearchBuildId,
    freshnessStatusId,
    schema: schemaVersion,
  });
  return `/api/v1/analyses/${encodeURIComponent(
    analysisBuildId,
  )}/trade-trends.csv?${parameters}`;
}
