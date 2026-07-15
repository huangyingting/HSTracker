import { invalidSupplierCompetitionQuery } from "../supplier-competition/errors";
import type { SupplierCompetitionV1AnalysisRequest } from "./trade-analytics-platform";

export function validateSupplierCompetitionV1Request(
  request: SupplierCompetitionV1AnalysisRequest,
): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(request.analysisBuildId)) {
    throw invalidSupplierCompetitionQuery("analysisBuildId is malformed.");
  }
  if (!/^[0-9]{1,3}$/.test(request.importerCode)) {
    throw invalidSupplierCompetitionQuery(
      "importerCode must be a BACI economy code.",
    );
  }
  if (!/^[0-9]{6}$/.test(request.productCode)) {
    throw invalidSupplierCompetitionQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
}
