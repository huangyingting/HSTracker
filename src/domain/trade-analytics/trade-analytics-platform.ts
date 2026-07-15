import { createHash } from "node:crypto";

import {
  isCandidateMarketAnalysisError,
} from "../candidate-market/errors";
import type {
  CandidateMarketV1RecipeInput,
  CandidateMarketResult,
} from "../candidate-market/result";
import {
  isSupplierCompetitionAnalysisError,
} from "../supplier-competition/errors";
import type {
  SupplierCompetitionResult,
  SupplierCompetitionV1RecipeInput,
} from "../supplier-competition/result";
import {
  isTradeTrendAnalysisError,
} from "../trade-trend/errors";
import type {
  TradeTrendResult,
  TradeTrendV1RecipeInput,
} from "../trade-trend/result";
import type { TradeEvidenceSource } from "../../evidence/trade-evidence-source";
import { isAnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import type { AnonymousSourceIdentity } from "../../runtime/anonymous-source";
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
import {
  createSupplierCompetitionV1RecipeExecution,
} from "./supplier-competition-v1-recipe";
import { validateSupplierCompetitionV1Request } from "./supplier-competition-v1-request";
import {
  evaluateSupplierCompetitionV1DatasetPackage,
  type SupplierCompetitionDatasetPackage,
} from "./supplier-competition-v1-dataset-package";
import {
  createTradeTrendV1RecipeExecution,
} from "./trade-trend-v1-recipe";
import { validateTradeTrendV1Request } from "./trade-trend-v1-request";
import {
  evaluateTradeTrendV1DatasetPackage,
  type TradeTrendDatasetPackage,
} from "./trade-trend-v1-dataset-package";

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

export type TradeTrendV1AnalysisRequest = Readonly<{
  recipe: "trade-trend-v1";
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
}>;

export type SupplierCompetitionV1AnalysisRequest = Readonly<{
  recipe: "supplier-competition-v1";
  analysisBuildId: string;
  importerCode: string;
  productCode: string;
}>;

export type CandidateMarketV1NormalizedInputs = Readonly<{
  exporterCode: string;
  product: Readonly<{
    hsRevision: "HS12";
    code: string;
  }>;
}>;

export type TradeTrendV1NormalizedInputs = Readonly<{
  importerCode: string;
  product: Readonly<{
    hsRevision: "HS12";
    code: string;
  }>;
}>;

export type SupplierCompetitionV1NormalizedInputs = Readonly<{
  importerCode: string;
  product: Readonly<{
    hsRevision: "HS12";
    code: string;
  }>;
}>;

export type AnalysisExecutionOptions = Readonly<{
  signal?: AbortSignal;
  observe?: (observation: AnalysisOperationObservation) => void;
  cachePartitionKey?: string;
  anonymousSource?: AnonymousSourceIdentity;
}>;

export type AnalysisOperationObservation = Readonly<{
  cacheState: "hit" | "coalesced" | "miss" | "bypass";
  queueWaitMs: number | null;
  queryMs: number | null;
  resultBytes: number;
  recipeVersion?: AnalysisRecipe;
  outcomeState?: AnalysisOutcome<AnalysisRecipe>["state"];
  rejectionReason?:
    | "INPUT_CARDINALITY"
    | "SCAN"
    | "RESULT_ROWS"
    | "RESULT_BYTES"
    | "MEMORY"
    | "EXECUTION_DEADLINE"
    | "EXPORT"
    | "SOURCE_REQUEST_LIMIT"
    | "queue-full"
    | "queue-timeout"
    | "execution-timeout"
    | null;
}>;

type AnalysisRecipeContracts = {
  "candidate-market-v1": {
    request: CandidateMarketV1AnalysisRequest;
    normalizedInputs: CandidateMarketV1NormalizedInputs;
    payload: CandidateMarketResult;
    emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW";
    invalidError:
      | Readonly<{ code: "INVALID_ANALYSIS_QUERY" }>
      | Readonly<{ code: "UNKNOWN_EXPORTER"; exporterCode: string }>
      | Readonly<{ code: "UNKNOWN_PRODUCT"; productCode: string }>;
  };
  "trade-trend-v1": {
    request: TradeTrendV1AnalysisRequest;
    normalizedInputs: TradeTrendV1NormalizedInputs;
    payload: TradeTrendResult;
    emptyReason: never;
    invalidError:
      | Readonly<{ code: "INVALID_ANALYSIS_QUERY" }>
      | Readonly<{ code: "UNKNOWN_IMPORTER"; importerCode: string }>
      | Readonly<{ code: "UNKNOWN_PRODUCT"; productCode: string }>;
  };
  "supplier-competition-v1": {
    request: SupplierCompetitionV1AnalysisRequest;
    normalizedInputs: SupplierCompetitionV1NormalizedInputs;
    payload: SupplierCompetitionResult;
    emptyReason: "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW";
    invalidError:
      | Readonly<{ code: "INVALID_ANALYSIS_QUERY" }>
      | Readonly<{ code: "UNKNOWN_IMPORTER"; importerCode: string }>
      | Readonly<{ code: "UNKNOWN_PRODUCT"; productCode: string }>;
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

type AnalysisOutcomeFor<Recipe extends AnalysisRecipe> =
  | (CompletedAnalysisOutcome<Recipe> & Readonly<{ state: "success" }>)
  | (CompletedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "empty";
        emptyReason: AnalysisRecipeContracts[Recipe]["emptyReason"];
      }>)
  | (UnresolvedAnalysisOutcome<Recipe> &
      Readonly<{
        state: "invalid-input";
        error: AnalysisRecipeContracts[Recipe]["invalidError"];
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

export type AnalysisOutcome<Recipe extends AnalysisRecipe> =
  Recipe extends AnalysisRecipe ? AnalysisOutcomeFor<Recipe> : never;

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

export type TradeTrendV1PlatformInput = Readonly<{
  evidenceSource: TradeEvidenceSource;
  datasetPackages: ReadonlyMap<string, TradeTrendDatasetPackage>;
}>;

export type SupplierCompetitionV1PlatformInput = Readonly<{
  evidenceSource: TradeEvidenceSource;
  datasetPackages: ReadonlyMap<string, SupplierCompetitionDatasetPackage>;
}>;

export type TradeAnalyticsPlatformInput = Readonly<{
  candidateMarket?: CandidateMarketV1PlatformInput;
  tradeTrend?: TradeTrendV1PlatformInput;
  supplierCompetition?: SupplierCompetitionV1PlatformInput;
}>;

export type {
  CandidateMarketV1PreviousReleaseEvidence,
} from "./candidate-market-v1-recipe";

export function createCandidateMarketV1TradeAnalyticsPlatform(
  input: CandidateMarketV1PlatformInput,
): TradeAnalyticsPlatform {
  return createTradeAnalyticsPlatform({ candidateMarket: input });
}

export function createTradeAnalyticsPlatform({
  candidateMarket,
  tradeTrend,
  supplierCompetition,
}: TradeAnalyticsPlatformInput): TradeAnalyticsPlatform {
  return new InternalTradeAnalyticsPlatform(
    candidateMarket,
    tradeTrend,
    supplierCompetition,
  );
}

type CandidateMarketExecution = (
  request: CandidateMarketV1RecipeInput,
  options?: AnalysisExecutionOptions,
) => Promise<CandidateMarketResult>;

type TradeTrendExecution = (
  request: TradeTrendV1RecipeInput,
  options?: AnalysisExecutionOptions,
) => Promise<TradeTrendResult>;

type SupplierCompetitionExecution = (
  request: SupplierCompetitionV1RecipeInput,
  options?: AnalysisExecutionOptions,
) => Promise<SupplierCompetitionResult>;

class InternalTradeAnalyticsPlatform implements TradeAnalyticsPlatform {
  private readonly executeCandidateMarket: CandidateMarketExecution | null;
  private readonly executeTradeTrend: TradeTrendExecution | null;
  private readonly executeSupplierCompetition: SupplierCompetitionExecution | null;

  constructor(
    private readonly candidateMarket: CandidateMarketV1PlatformInput | undefined,
    private readonly tradeTrend: TradeTrendV1PlatformInput | undefined,
    private readonly supplierCompetition:
      | SupplierCompetitionV1PlatformInput
      | undefined,
  ) {
    this.executeCandidateMarket =
      candidateMarket === undefined
        ? null
        : createCandidateMarketV1RecipeExecution(
            candidateMarket.evidenceSource,
            candidateMarket.previousRelease ?? null,
          );
    this.executeTradeTrend =
      tradeTrend === undefined
        ? null
        : createTradeTrendV1RecipeExecution(tradeTrend.evidenceSource);
    this.executeSupplierCompetition =
      supplierCompetition === undefined
        ? null
        : createSupplierCompetitionV1RecipeExecution(
            supplierCompetition.evidenceSource,
          );
  }

  async execute<Request extends AnalysisRequest>(
    request: Request,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<Request["recipe"]>> {
    switch (request.recipe) {
      case "candidate-market-v1": {
        const outcome = await this.executeCandidateMarketV1(request, options);
        return outcome as AnalysisOutcome<Request["recipe"]>;
      }
      case "trade-trend-v1": {
        const outcome = await this.executeTradeTrendV1(request, options);
        return outcome as AnalysisOutcome<Request["recipe"]>;
      }
      case "supplier-competition-v1": {
        const outcome = await this.executeSupplierCompetitionV1(
          request,
          options,
        );
        return outcome as AnalysisOutcome<Request["recipe"]>;
      }
      default:
        throw new TypeError(
          `Unsupported Analysis Recipe: ${String((request as AnalysisRequest).recipe)}`,
        );
    }
  }

  private async executeCandidateMarketV1(
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
    const datasetPackage = this.candidateMarket?.datasetPackages.get(
      request.analysisBuildId,
    );
    if (datasetPackage === undefined || this.executeCandidateMarket === null) {
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
        ...unresolvedOutcome<"candidate-market-v1">(request),
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
        return capacityOutcome(request, error.reason, error.retryAfterSeconds);
      }
      if (!isCandidateMarketAnalysisError(error)) {
        throw error;
      }
      return expectedCandidateMarketFailure(request, error.code);
    }
    const completed = completedCandidateMarketOutcome(
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
    return { state: "success", ...completed };
  }

  private async executeTradeTrendV1(
    request: TradeTrendV1AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<"trade-trend-v1">> {
    try {
      validateTradeTrendV1Request(request);
    } catch (error) {
      if (!isTradeTrendAnalysisError(error)) {
        throw error;
      }
      return expectedTradeTrendFailure(request, error.code);
    }
    const datasetPackage = this.tradeTrend?.datasetPackages.get(
      request.analysisBuildId,
    );
    if (datasetPackage === undefined || this.executeTradeTrend === null) {
      return expectedTradeTrendFailure(request, "ANALYSIS_BUILD_RETIRED");
    }
    const compatibility = evaluateTradeTrendV1DatasetPackage(datasetPackage);
    if (!compatibility.compatible) {
      return {
        state: "incompatible-package",
        ...unresolvedOutcome<"trade-trend-v1">(request),
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: compatibility.reason,
        },
      };
    }
    const normalizedInputs: TradeTrendV1NormalizedInputs = {
      importerCode: String(Number(request.importerCode)),
      product: {
        hsRevision: "HS12",
        code: request.productCode,
      },
    };
    let result: TradeTrendResult;
    try {
      result = await this.executeTradeTrend(
        {
          analysisBuildId: request.analysisBuildId,
          importerCode: request.importerCode,
          productCode: request.productCode,
        },
        options,
      );
    } catch (error) {
      if (isAnalysisCapacityExceededError(error)) {
        return capacityOutcome(request, error.reason, error.retryAfterSeconds);
      }
      if (!isTradeTrendAnalysisError(error)) {
        throw error;
      }
      return expectedTradeTrendFailure(request, error.code);
    }
    return {
      state: "success",
      ...completedTradeTrendOutcome(
        request.recipe,
        result,
        datasetPackage.identity,
        normalizedInputs,
      ),
    };
  }

  private async executeSupplierCompetitionV1(
    request: SupplierCompetitionV1AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<"supplier-competition-v1">> {
    try {
      validateSupplierCompetitionV1Request(request);
    } catch (error) {
      if (!isSupplierCompetitionAnalysisError(error)) {
        throw error;
      }
      return expectedSupplierCompetitionFailure(request, error.code);
    }
    const datasetPackage = this.supplierCompetition?.datasetPackages.get(
      request.analysisBuildId,
    );
    if (
      datasetPackage === undefined ||
      this.executeSupplierCompetition === null
    ) {
      return expectedSupplierCompetitionFailure(
        request,
        "ANALYSIS_BUILD_RETIRED",
      );
    }
    const compatibility =
      evaluateSupplierCompetitionV1DatasetPackage(datasetPackage);
    if (!compatibility.compatible) {
      return {
        state: "incompatible-package",
        ...unresolvedOutcome<"supplier-competition-v1">(request),
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: compatibility.reason,
        },
      };
    }
    const normalizedInputs: SupplierCompetitionV1NormalizedInputs = {
      importerCode: String(Number(request.importerCode)),
      product: {
        hsRevision: "HS12",
        code: request.productCode,
      },
    };
    let result: SupplierCompetitionResult;
    try {
      result = await this.executeSupplierCompetition(
        {
          analysisBuildId: request.analysisBuildId,
          importerCode: request.importerCode,
          productCode: request.productCode,
        },
        options,
      );
    } catch (error) {
      if (isAnalysisCapacityExceededError(error)) {
        return capacityOutcome(request, error.reason, error.retryAfterSeconds);
      }
      if (!isSupplierCompetitionAnalysisError(error)) {
        throw error;
      }
      return expectedSupplierCompetitionFailure(request, error.code);
    }
    const completed = completedSupplierCompetitionOutcome(
      request.recipe,
      result,
      datasetPackage.identity,
      normalizedInputs,
    );
    if (result.cohortSize === 0) {
      if (
        result.emptyReason !==
          "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW" ||
        result.supplierShares.length !== 0
      ) {
        throw new TypeError(
          "Supplier Competition empty-result invariants were violated.",
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
      result.supplierShares.length !== result.cohortSize
    ) {
      throw new TypeError(
        "Supplier Competition success-result invariants were violated.",
      );
    }
    return { state: "success", ...completed };
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
  const unresolved = unresolvedOutcome<"candidate-market-v1">(request);
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

function expectedTradeTrendFailure(
  request: TradeTrendV1AnalysisRequest,
  code:
    | "INVALID_ANALYSIS_QUERY"
    | "UNKNOWN_IMPORTER"
    | "UNKNOWN_PRODUCT"
    | "ANALYSIS_BUILD_RETIRED"
    | "ANALYSIS_UNAVAILABLE",
): AnalysisOutcome<"trade-trend-v1"> {
  const unresolved = unresolvedOutcome<"trade-trend-v1">(request);
  switch (code) {
    case "INVALID_ANALYSIS_QUERY":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code },
      };
    case "UNKNOWN_IMPORTER":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code, importerCode: request.importerCode },
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

function expectedSupplierCompetitionFailure(
  request: SupplierCompetitionV1AnalysisRequest,
  code:
    | "INVALID_ANALYSIS_QUERY"
    | "UNKNOWN_IMPORTER"
    | "UNKNOWN_PRODUCT"
    | "ANALYSIS_BUILD_RETIRED"
    | "ANALYSIS_UNAVAILABLE"
    | "SUPPLIER_COHORT_BUDGET_EXCEEDED",
): AnalysisOutcome<"supplier-competition-v1"> {
  const unresolved = unresolvedOutcome<"supplier-competition-v1">(request);
  switch (code) {
    case "INVALID_ANALYSIS_QUERY":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code },
      };
    case "UNKNOWN_IMPORTER":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code, importerCode: request.importerCode },
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
    case "SUPPLIER_COHORT_BUDGET_EXCEEDED":
      return {
        state: "budget",
        ...unresolved,
        error: {
          code: "ANALYSIS_BUDGET_EXCEEDED",
          budget: "RESULT_ROWS",
        },
      };
  }
}

function unresolvedOutcome<Recipe extends AnalysisRecipe>(
  request: AnalysisRequest<Recipe>,
): UnresolvedAnalysisOutcome<Recipe> {
  return {
    recipe: request.recipe as Recipe,
    analysisIdentity: null,
    datasetPackageIdentity: null,
    normalizedInputs: null,
  };
}

function capacityOutcome<Recipe extends AnalysisRecipe>(
  request: AnalysisRequest<Recipe>,
  reason: "queue-full" | "queue-timeout" | "execution-timeout",
  retryAfterSeconds: number,
): AnalysisOutcome<Recipe> {
  return {
    state: "capacity",
    ...unresolvedOutcome(request),
    error: {
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      reason,
      retryAfterSeconds,
    },
  } as AnalysisOutcome<Recipe>;
}

function completedCandidateMarketOutcome(
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

function completedTradeTrendOutcome(
  recipe: "trade-trend-v1",
  payload: TradeTrendResult,
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: TradeTrendV1NormalizedInputs,
): CompletedAnalysisOutcome<"trade-trend-v1"> {
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

function completedSupplierCompetitionOutcome(
  recipe: "supplier-competition-v1",
  payload: SupplierCompetitionResult,
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: SupplierCompetitionV1NormalizedInputs,
): CompletedAnalysisOutcome<"supplier-competition-v1"> {
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
): AnalysisIdentity;
function analysisIdentityFor(
  recipe: "trade-trend-v1",
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: TradeTrendV1NormalizedInputs,
): AnalysisIdentity;
function analysisIdentityFor(
  recipe: "supplier-competition-v1",
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: SupplierCompetitionV1NormalizedInputs,
): AnalysisIdentity;
function analysisIdentityFor(
  recipe: AnalysisRecipe,
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs:
    | CandidateMarketV1NormalizedInputs
    | TradeTrendV1NormalizedInputs
    | SupplierCompetitionV1NormalizedInputs,
): AnalysisIdentity {
  const economyCode =
    recipe === "candidate-market-v1"
      ? (normalizedInputs as CandidateMarketV1NormalizedInputs).exporterCode
      : (normalizedInputs as TradeTrendV1NormalizedInputs | SupplierCompetitionV1NormalizedInputs)
          .importerCode;
  const canonicalIdentity = JSON.stringify([
    "analysis-identity-v1",
    recipe,
    datasetPackageIdentity,
    economyCode,
    normalizedInputs.product.hsRevision,
    normalizedInputs.product.code,
  ]);
  const digest = createHash("sha256")
    .update(canonicalIdentity)
    .digest("hex");
  return `analysis-identity-v1-${digest}` as AnalysisIdentity;
}
