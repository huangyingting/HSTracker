import { createHash } from "node:crypto";

import { isCandidateMarketAnalysisError } from "../candidate-market/errors";
import type {
  CandidateMarketAnalysisQuery,
  CandidateMarketResult,
} from "../candidate-market/result";
import { isAnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";

declare const analysisIdentityBrand: unique symbol;
declare const datasetPackageIdentityBrand: unique symbol;

export type AnalysisIdentity =
  `analysis-identity-v1-${string}` & {
    readonly [analysisIdentityBrand]: true;
  };

export type DatasetPackageIdentity =
  `dataset-package-v1-${string}` & {
    readonly [datasetPackageIdentityBrand]: true;
  };

export type CandidateMarketV1AnalysisRequest = Readonly<{
  recipe: "candidate-market-v1";
  analysisBuildId: string;
  exporterCode: string;
  productCode: string;
}>;

export type CandidateMarketV1NormalizedInputs = Readonly<{
  exporterCode: string;
  product: Readonly<{
    hsRevision: "HS12";
    code: string;
  }>;
}>;

export type AnalysisExecutionOptions = Readonly<{
  signal?: AbortSignal;
  observe?: (observation: AnalysisOperationObservation) => void;
  cachePartitionKey?: string;
}>;

export type AnalysisOperationObservation = Readonly<{
  cacheState: "hit" | "coalesced" | "miss";
  queueWaitMs: number | null;
  queryMs: number | null;
  resultBytes: number;
}>;

type AnalysisRecipeContracts = {
  "candidate-market-v1": {
    request: CandidateMarketV1AnalysisRequest;
    normalizedInputs: CandidateMarketV1NormalizedInputs;
    payload: CandidateMarketResult;
    emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW";
  };
};

export type AnalysisRecipe = keyof AnalysisRecipeContracts;

export type AnalysisRequest<
  Recipe extends AnalysisRecipe = AnalysisRecipe,
> = AnalysisRecipeContracts[Recipe]["request"];

type NormalizedInputs<Recipe extends AnalysisRecipe> =
  AnalysisRecipeContracts[Recipe]["normalizedInputs"];

type AnalysisPayload<Recipe extends AnalysisRecipe> =
  AnalysisRecipeContracts[Recipe]["payload"];

type CompletedAnalysisOutcome<Recipe extends AnalysisRecipe> = Readonly<{
  recipe: Recipe;
  analysisIdentity: AnalysisIdentity;
  datasetPackageIdentity: DatasetPackageIdentity;
  normalizedInputs: NormalizedInputs<Recipe>;
  payload: AnalysisPayload<Recipe>;
}>;

type UnresolvedAnalysisOutcome<Recipe extends AnalysisRecipe> = Readonly<{
  recipe: Recipe;
  analysisIdentity: null;
  datasetPackageIdentity: null;
  normalizedInputs: null;
}>;

export type AnalysisOutcome<Recipe extends AnalysisRecipe> =
  | (CompletedAnalysisOutcome<Recipe> & Readonly<{ state: "success" }>)
  | (CompletedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "empty";
        emptyReason: AnalysisRecipeContracts[Recipe]["emptyReason"];
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "invalid-input";
        error:
          | Readonly<{ code: "INVALID_ANALYSIS_QUERY" }>
          | Readonly<{
              code: "UNKNOWN_EXPORTER";
              exporterCode: string;
            }>
          | Readonly<{
              code: "UNKNOWN_PRODUCT";
              productCode: string;
            }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "incompatible-package";
        error: Readonly<{
          code: "NO_COMPATIBLE_DATASET_PACKAGE";
          reason:
            | "MISSING_REQUIRED_CAPABILITY"
            | "CAPABILITY_VERSION_MISMATCH"
            | "PACKAGE_IDENTITY_MISMATCH";
        }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "retired";
        error: Readonly<{
          code: "ANALYSIS_BUILD_RETIRED";
          analysisBuildId: string;
        }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "budget";
        error: Readonly<{
          code: "ANALYSIS_BUDGET_EXCEEDED";
          budget:
            | "INPUT_CARDINALITY"
            | "SCAN"
            | "RESULT_ROWS"
            | "RESULT_BYTES"
            | "MEMORY"
            | "EXECUTION_DEADLINE"
            | "EXPORT";
        }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "rate-limit";
        error: Readonly<{
          code: "ANALYSIS_RATE_LIMITED";
          retryAfterSeconds: number;
        }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "capacity";
        error: Readonly<{
          code: "ANALYSIS_CAPACITY_EXCEEDED";
          reason: "queue-full" | "queue-timeout" | "execution-timeout";
          retryAfterSeconds: number;
        }>;
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "temporary-unavailability";
        error: Readonly<{ code: "ANALYSIS_UNAVAILABLE" }>;
      }>);

export interface TradeAnalyticsPlatform {
  execute<Request extends AnalysisRequest>(
    request: Request,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<Request["recipe"]>>;
}

type CandidateMarketExecution = (
  request: CandidateMarketAnalysisQuery,
  options?: AnalysisExecutionOptions,
) => Promise<CandidateMarketResult>;

export class CandidateMarketTradeAnalyticsPlatform
  implements TradeAnalyticsPlatform
{
  constructor(
    private readonly executeCandidateMarket: CandidateMarketExecution,
  ) {}

  async execute(
    request: CandidateMarketV1AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<"candidate-market-v1">> {
    let result: CandidateMarketResult;
    try {
      result = await this.executeCandidateMarket(
        {
          analysisBuildId: request.analysisBuildId,
          exporterCode: request.exporterCode,
          productCode: request.productCode,
        },
        options,
      );
    } catch (error) {
      if (isAnalysisCapacityExceededError(error)) {
        return {
          state: "capacity",
          recipe: request.recipe,
          analysisIdentity: null,
          datasetPackageIdentity: null,
          normalizedInputs: null,
          error: {
            code: error.code,
            reason: error.reason,
            retryAfterSeconds: error.retryAfterSeconds,
          },
        };
      }
      if (!isCandidateMarketAnalysisError(error)) {
        throw error;
      }
      return expectedCandidateMarketFailure(request, error.code);
    }
    const completed = completedOutcome(request.recipe, result);
    if (result.cohortSize === 0) {
      if (
        result.emptyReason !==
          "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW" ||
        result.candidates.length !== 0
      ) {
        throw new TypeError(
          "Candidate Market empty-result invariants were violated.",
        );
      }

      return {
        state: "empty",
        emptyReason: result.emptyReason,
        ...completed,
      };
    }
    if (
      result.emptyReason !== null ||
      result.candidates.length !== result.cohortSize
    ) {
      throw new TypeError(
        "Candidate Market success-result invariants were violated.",
      );
    }
    return {
      state: "success",
      ...completed,
    };
  }
}

function expectedCandidateMarketFailure(
  request: CandidateMarketV1AnalysisRequest,
  code:
    | "INVALID_ANALYSIS_QUERY"
    | "UNKNOWN_EXPORTER"
    | "UNKNOWN_PRODUCT"
    | "ANALYSIS_BUILD_RETIRED"
    | "ANALYSIS_UNAVAILABLE",
): AnalysisOutcome<"candidate-market-v1"> {
  const unresolved: UnresolvedAnalysisOutcome<"candidate-market-v1"> = {
    recipe: request.recipe,
    analysisIdentity: null,
    datasetPackageIdentity: null,
    normalizedInputs: null,
  };
  switch (code) {
    case "INVALID_ANALYSIS_QUERY":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code },
      };
    case "UNKNOWN_EXPORTER":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code, exporterCode: request.exporterCode },
      };
    case "UNKNOWN_PRODUCT":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code, productCode: request.productCode },
      };
    case "ANALYSIS_BUILD_RETIRED":
      return {
        state: "retired",
        ...unresolved,
        error: { code, analysisBuildId: request.analysisBuildId },
      };
    case "ANALYSIS_UNAVAILABLE":
      return {
        state: "temporary-unavailability",
        ...unresolved,
        error: { code },
      };
  }
}

function completedOutcome(
  recipe: "candidate-market-v1",
  payload: CandidateMarketResult,
): CompletedAnalysisOutcome<"candidate-market-v1"> {
  const datasetPackageIdentity = datasetPackageIdentityFor(payload);
  const normalizedInputs: CandidateMarketV1NormalizedInputs = {
    exporterCode: payload.query.exporter.code,
    product: {
      hsRevision: payload.query.product.hsRevision,
      code: payload.query.product.code,
    },
  };
  return {
    recipe,
    analysisIdentity: analysisIdentityFor(
      recipe,
      datasetPackageIdentity,
      normalizedInputs,
    ),
    datasetPackageIdentity,
    normalizedInputs,
    payload,
  };
}

function datasetPackageIdentityFor(
  payload: CandidateMarketResult,
): DatasetPackageIdentity {
  const releaseCatalogSha256 =
    payload.analysisReleaseCatalogSha256;
  const artifactSha256 = payload.provenance.artifactSha256;
  if (
    !/^[a-f0-9]{64}$/u.test(releaseCatalogSha256) ||
    !/^[a-f0-9]{64}$/u.test(artifactSha256)
  ) {
    throw new TypeError(
      "Candidate Market result has an invalid Dataset Package identity.",
    );
  }
  const provenance = payload.provenance;
  const revision = payload.releaseRevisionSummary;
  const canonicalIdentity = JSON.stringify([
    "dataset-package-identity-v1",
    releaseCatalogSha256,
    artifactSha256,
    provenance.artifactSchemaVersion,
    provenance.artifactBuildId,
    provenance.baciRelease,
    provenance.sourceUpdateDate,
    provenance.hsRevision,
    provenance.ingestedYears.start,
    provenance.ingestedYears.end,
    provenance.finalizedCutoffYear,
    provenance.scoreWindow.start,
    provenance.scoreWindow.end,
    provenance.provisionalYear,
    provenance.scoreVersion,
    provenance.valueUnit,
    revision.comparisonRelease,
    revision.previousArtifactSha256,
    revision.notComparedReason,
  ]);
  const digest = createHash("sha256")
    .update(canonicalIdentity)
    .digest("hex");
  return `dataset-package-v1-${digest}` as DatasetPackageIdentity;
}

function analysisIdentityFor(
  recipe: "candidate-market-v1",
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: CandidateMarketV1NormalizedInputs,
): AnalysisIdentity {
  const canonicalIdentity = JSON.stringify([
    "analysis-identity-v1",
    recipe,
    datasetPackageIdentity,
    normalizedInputs.exporterCode,
    normalizedInputs.product.hsRevision,
    normalizedInputs.product.code,
  ]);
  const digest = createHash("sha256")
    .update(canonicalIdentity)
    .digest("hex");
  return `analysis-identity-v1-${digest}` as AnalysisIdentity;
}
