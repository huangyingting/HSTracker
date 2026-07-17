import type {
  OpportunityDetailEvidence,
  OpportunityDetailRequest,
  OpportunityEvidenceLoadOptions,
  OpportunityEvidenceSource,
} from "../../evidence/opportunity-evidence-source";

// The bound execution for one retained analysisBuildId's Opportunity Detail.
// It reconstructs one Market Investigation Candidate's evidence from the detail
// evidence source; unlike the feed it is not paginated and needs no Analysis
// Identity, so the platform maps the outcome directly.
export type OpportunityDetailV1RecipeExecution = (
  request: OpportunityDetailRequest,
  options?: OpportunityEvidenceLoadOptions,
) => Promise<OpportunityDetailEvidence>;

export function createOpportunityDetailV1RecipeExecution(
  evidenceSource: OpportunityEvidenceSource,
): OpportunityDetailV1RecipeExecution {
  return async (request, options) => {
    options?.signal?.throwIfAborted();
    const detail = await evidenceSource.loadDetail(request, options);
    options?.signal?.throwIfAborted();
    return detail;
  };
}
