import type { SupplierCompetitionV1Payload } from "../domain/trade-analytics/supplier-competition-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
  supplierCompetitionCsvUrl,
} from "../export/supplier-competition-csv-contract";
import {
  assertSupplierCompetitionExportContext,
  SupplierCompetitionExportContextError,
} from "../export/supplier-competition-export-context";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";

export class SupplierCompetitionExportPreparationError extends Error {
  readonly code = "STALE_ANALYSIS";

  constructor(
    message: string,
    readonly manifest: CurrentAnalysisManifest,
  ) {
    super(message);
    this.name = "SupplierCompetitionExportPreparationError";
  }
}

export async function prepareSupplierCompetitionExport({
  result,
  fetcher,
  signal,
}: {
  result: SupplierCompetitionV1Payload;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<{ manifest: CurrentAnalysisManifest; url: string }> {
  const manifest = await loadCurrentAnalysisManifest({
    fetcher,
    signal,
    revalidate: true,
  });
  try {
    assertSupplierCompetitionExportContext(result, manifest);
  } catch (error) {
    if (error instanceof SupplierCompetitionExportContextError) {
      throw new SupplierCompetitionExportPreparationError(
        error.message,
        manifest,
      );
    }
    throw error;
  }

  return {
    manifest,
    url: supplierCompetitionCsvUrl({
      analysisBuildId: result.analysisBuildId,
      importerCode: result.query.importer.code,
      productCode: result.query.product.code,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshness.freshnessStatusId,
      schemaVersion: SUPPLIER_COMPETITIONS_CSV_SCHEMA_VERSION,
    }),
  };
}
