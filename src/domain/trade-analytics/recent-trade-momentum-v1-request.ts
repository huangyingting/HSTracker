import { invalidRecentTradeMomentumQuery } from "../recent-trade-momentum/errors";
import type { RecentTradeMomentumV1AnalysisRequest } from "./trade-analytics-platform";

export function validateRecentTradeMomentumV1Request(
  request: RecentTradeMomentumV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidRecentTradeMomentumQuery("analysisBuildId is malformed.");
  }
  if (!/^[A-Z]{2}$/.test(request.reporterCode)) {
    throw invalidRecentTradeMomentumQuery(
      "reporterCode must be an ISO alpha-2 reporting market code.",
    );
  }
  if (!/^[0-9]{6}$/.test(request.productCode)) {
    throw invalidRecentTradeMomentumQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
  if (
    request.exporterCode !== undefined &&
    !/^[0-9]{1,3}$/.test(request.exporterCode)
  ) {
    throw invalidRecentTradeMomentumQuery(
      "exporterCode must be a BACI economy code when supplied.",
    );
  }
}
