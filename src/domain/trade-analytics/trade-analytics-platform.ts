import { createHash } from "node:crypto";

import { isCandidateMarketAnalysisError } from "../candidate-market/errors";
import type {
  CandidateMarketV1RecipeInput,
  CandidateMarketResult,
} from "../candidate-market/result";
import type { TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import { isAnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import {
  createCandidateMarketV1RecipeExecution,
  type CandidateMarketV1PreviousReleaseEvidence,
} from "./candidate-market-v1-recipe";
import { validateCandidateMarketV1Request } from "./candidate-market-v1-request";
import {
  evaluateCandidateMarketV1DatasetPackage,
  type CandidateMarketDatasetPackage,
  type DatasetPackageIdentity,
} from "./dataset-package";

export type { DatasetPackageIdentity } from "./dataset-package";

declare const analysisIdentityBrand: unique symbol;

export type AnalysisIdentity =
  `analysis-identity-v1-${string}` & {
    readonly [analysisIdentityBrand]: true;
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

export type CandidateMarketV1PlatformInput = Readonly<{
  evidenceSource: TradeEvidenceSource;
  previousRelease?: CandidateMarketV1PreviousReleaseEvidence | null;
  datasetPackages: ReadonlyMap<string, CandidateMarketDatasetPackage>;
}>;

export type {
  CandidateMarketV1PreviousReleaseEvidence,
} from "./candidate-market-v1-recipe";

export function createCandidateMarketV1TradeAnalyticsPlatform({
  evidenceSource,
  previousRelease = null,
  datasetPackages,
}: CandidateMarketV1PlatformInput): TradeAnalyticsPlatform {
  return new CandidateMarketTradeAnalyticsPlatform(
    createCandidateMarketV1RecipeExecution(
      evidenceSource,
      previousRelease,
    ),
    datasetPackages,
  );
}

type CandidateMarketExecution = (
  request: CandidateMarketV1RecipeInput,
  options?: AnalysisExecutionOptions,
) => Promise<CandidateMarketResult>;

class CandidateMarketTradeAnalyticsPlatform
  implements TradeAnalyticsPlatform
{
  constructor(
    private readonly executeCandidateMarket: CandidateMarketExecution,
    private readonly datasetPackages: ReadonlyMap<
      string,
      CandidateMarketDatasetPackage
    >,
  ) {}

  async execute(
    request: CandidateMarketV1AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<"candidate-market-v1">> {
    try {
      validateCandidateMarketV1Request(request);
    } catch (error) {
      if (!isCandidateMarketAnalysisError(error)) {
        throw error;
      }

      return expectedCandidateMarketFailure(request, error.code);
    }
    const datasetPackage = this.datasetPackages.get(
      request.analysisBuildId,
    );
    if (datasetPackage === undefined) {
      return expectedCandidateMarketFailure(
        request,
        "ANALYSIS_BUILD_RETIRED",
      );
    }
    const compatibility =
      evaluateCandidateMarketV1DatasetPackage(datasetPackage);
    if (!compatibility.compatible) {
      return {
        state: "incompatible-package",
        ...unresolvedOutcome(request),
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: compatibility.reason,
        },
      };
    }
    const normalizedInputs: CandidateMarketV1NormalizedInputs = {
      exporterCode: String(Number(request.exporterCode)),
      product: {
        hsRevision: "HS12",
        code: request.productCode,
      },
    };
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
    const completed = completedOutcome(
      request.recipe,
      result,
      datasetPackage.identity,
      normalizedInputs,
    );
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

function unresolvedOutcome(
  request: CandidateMarketV1AnalysisRequest,
): UnresolvedAnalysisOutcome<"candidate-market-v1"> {
  return {
    recipe: request.recipe,
    analysisIdentity: null,
    datasetPackageIdentity: null,
    normalizedInputs: null,
  };
}

function completedOutcome(
  recipe: "candidate-market-v1",
  payload: CandidateMarketResult,
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: CandidateMarketV1NormalizedInputs,
): CompletedAnalysisOutcome<"candidate-market-v1"> {
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
