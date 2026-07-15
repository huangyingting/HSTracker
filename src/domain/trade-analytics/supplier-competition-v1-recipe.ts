import type { TradeEvidenceLoadOptions, TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import { unavailableSupplierCompetitionAnalysisBuild } from "../supplier-competition/errors";
import { computeSupplierCompetitionV1 } from "../supplier-competition/supplier-competition-v1";
import type {
  SupplierCompetitionResult,
  SupplierCompetitionV1RecipeInput,
} from "../supplier-competition/result";

type SupplierCompetitionV1RecipeExecution = (
  query: SupplierCompetitionV1RecipeInput,
  options?: TradeEvidenceLoadOptions,
) => Promise<SupplierCompetitionResult>;

export function createSupplierCompetitionV1RecipeExecution(
  evidenceSource: TradeEvidenceSource,
): SupplierCompetitionV1RecipeExecution {
  return async (query, options) => {
    options?.signal?.throwIfAborted();
    const loadInputs = evidenceSource.loadSupplierCompetitionV1Inputs;
    if (loadInputs === undefined) {
      throw unavailableSupplierCompetitionAnalysisBuild(query.analysisBuildId);
    }
    const inputs = await loadInputs.call(evidenceSource, query, options);
    options?.signal?.throwIfAborted();
    return computeSupplierCompetitionV1(inputs);
  };
}
