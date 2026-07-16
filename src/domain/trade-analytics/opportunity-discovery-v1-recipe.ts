import type {
  OpportunityCandidateIndex,
  OpportunityEvidenceLoadOptions,
} from "../../evidence/opportunity-evidence-source";
import type {
  MarketInvestigationPage,
  OpportunityDiscoveryV1RecipeInput,
} from "../opportunity-discovery/result";

// The bound execution for one retained analysisBuildId. Unlike the other
// recipes, the ordered/paginated feed needs the Analysis Identity so the
// backing index can bind and validate every cursor to the exact analytical
// feed; the platform computes that identity before calling this.
export type OpportunityDiscoveryV1RecipeExecution = (
  query: OpportunityDiscoveryV1RecipeInput,
  analysisIdentity: string,
  options?: OpportunityEvidenceLoadOptions,
) => Promise<MarketInvestigationPage>;

export function createOpportunityDiscoveryV1RecipeExecution(
  index: OpportunityCandidateIndex,
): OpportunityDiscoveryV1RecipeExecution {
  return async (query, analysisIdentity, options) => {
    options?.signal?.throwIfAborted();
    const page = await index.page(query, analysisIdentity, options);
    options?.signal?.throwIfAborted();
    return page;
  };
}
