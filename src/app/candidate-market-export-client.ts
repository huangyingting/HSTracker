import type { CandidateMarketResult } from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  candidateMarketCsvUrl,
} from "../export/candidate-market-csv-contract";
import {
  assertCandidateMarketExportContext,
  CandidateMarketExportContextError,
} from "../export/candidate-market-export-context";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";

export class CandidateMarketExportPreparationError extends Error {
  readonly code = "STALE_ANALYSIS";

  constructor(
    message: string,
    readonly manifest: CurrentAnalysisManifest,
  ) {
    super(message);
    this.name = "CandidateMarketExportPreparationError";
  }
}

export async function prepareCandidateMarketExport({
  result,
  fetcher,
  signal,
}: {
  result: CandidateMarketResult;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<{ manifest: CurrentAnalysisManifest; url: string }> {
  const manifest = await loadCurrentAnalysisManifest({
    fetcher,
    signal,
    revalidate: true,
  });
  try {
    assertCandidateMarketExportContext(result, manifest);
  } catch (error) {
    if (error instanceof CandidateMarketExportContextError) {
      throw new CandidateMarketExportPreparationError(
        error.message,
        manifest,
      );
    }
    throw error;
  }

  return {
    manifest,
    url: candidateMarketCsvUrl({
      analysisBuildId: result.analysisBuildId,
      exporterCode: result.query.exporter.code,
      productCode: result.query.product.code,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshness.freshnessStatusId,
      schemaVersion: CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
    }),
  };
}
