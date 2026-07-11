export const CANDIDATE_MARKETS_CSV_SCHEMA_VERSION =
  "candidate-markets-csv-v1";

export type CandidateMarketCsvIdentity = {
  analysisBuildId: string;
  exporterCode: string;
  productCode: string;
  productSearchBuildId: string;
  freshnessStatusId: string;
  schemaVersion: typeof CANDIDATE_MARKETS_CSV_SCHEMA_VERSION;
};

export function candidateMarketCsvUrl({
  analysisBuildId,
  exporterCode,
  productCode,
  productSearchBuildId,
  freshnessStatusId,
  schemaVersion,
}: CandidateMarketCsvIdentity): string {
  const parameters = new URLSearchParams({
    exporter: exporterCode,
    product: productCode,
    productSearchBuildId,
    freshnessStatusId,
    schema: schemaVersion,
  });
  return `/api/v1/analyses/${encodeURIComponent(
    analysisBuildId,
  )}/candidate-markets.csv?${parameters}`;
}
