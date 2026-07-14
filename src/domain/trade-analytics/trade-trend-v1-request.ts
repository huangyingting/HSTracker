import { invalidTradeTrendQuery } from "../trade-trend/errors";
import type { TradeTrendV1AnalysisRequest } from "./trade-analytics-platform";

export function validateTradeTrendV1Request(
  request: TradeTrendV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidTradeTrendQuery("analysisBuildId is malformed.");
  }
  if (!/^[0-9]{1,3}$/.test(request.importerCode)) {
    throw invalidTradeTrendQuery("importerCode must be a BACI economy code.");
  }
  if (!/^[0-9]{6}$/.test(request.productCode)) {
    throw invalidTradeTrendQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
}
