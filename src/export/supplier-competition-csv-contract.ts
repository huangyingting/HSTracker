export const SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION =
  "supplier-competitions-csv-v1";

export type SupplierCompetitionCsvIdentity = {
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
  productSearchBuildId: string;
  freshnessStatusId: string;
  schemaVersion: typeof SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION;
};

export function supplierCompetitionCsvUrl({
  analysisBuildId,
  importerCode,
  productCode,
  productSearchBuildId,
  freshnessStatusId,
  schemaVersion,
}: SupplierCompetitionCsvIdentity): string {
  const parameters = new URLSearchParams({
    importer: importerCode,
    product: productCode,
    productSearchBuildId,
    freshnessStatusId,
    schema: schemaVersion,
  });
  return `/api/v1/analyses/${encodeURIComponent(
    analysisBuildId,
  )}/supplier-competitions.csv?${parameters}`;
}
