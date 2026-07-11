export const CANDIDATE_MARKETS_CSV_SCHEMA_VERSION =
  "candidate-markets-csv-v1";

export function candidateMarketCsvUrl({
  analysisBuildId,
  exporterCode,
  productCode,
  productSearchBuildId,
  freshnessStatusId,
}: {
  analysisBuildId: string;
  exporterCode: string;
  productCode: string;
  productSearchBuildId: string;
  freshnessStatusId: string;
}): string {
  const parameters = new URLSearchParams({
    exporter: exporterCode,
    product: productCode,
    productSearchBuildId,
    freshnessStatusId,
    schema: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  });
  return `/api/v1/analyses/${encodeURIComponent(
    analysisBuildId,
  )}/candidate-markets.csv?${parameters}`;
}
