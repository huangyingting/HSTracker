import { invalidAnalysisQuery } from "../candidate-market/errors";
import type { CandidateMarketV1AnalysisRequest } from "./trade-analytics-platform";

export function validateCandidateMarketV1Request(
  request: CandidateMarketV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidAnalysisQuery("analysisBuildId is malformed.");
  }

  if (!/^[0-9]{1,3}$/.test(request.exporterCode)) {
    throw invalidAnalysisQuery("exporterCode must be a BACI economy code.");
  }

  if (!/^[0-9]{6}$/.test(request.productCode)) {
    throw invalidAnalysisQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
}
