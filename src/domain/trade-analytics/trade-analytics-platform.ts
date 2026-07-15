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
  invalidTradeExplorerQuery,
  isTradeExplorerAnalysisError,
  retiredTradeExplorerAnalysisBuild,
  type TradeExplorerAnalysisError,
} from "../trade-explorer/errors";
import type {
  TradeExplorerResult,
  TradeExplorerV1EvidenceRequest,
  TradeExplorerV1NormalizedInputs,
  TradeExplorerV1RecipeInput,
} from "../trade-explorer/result";
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
  createTradeExplorerV1RecipeExecution,
} from "./trade-explorer-v1-recipe";
import { validateTradeExplorerV1Request } from "./trade-explorer-v1-request";
import {
  evaluateTradeExplorerV1DatasetPackage,
  type TradeExplorerDatasetPackage,
} from "./trade-explorer-v1-dataset-package";
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

// The closed, public Trade Explorer v1 request. `filters`/`dimensions`/
// `sort` are pre-normalization -- see ../trade-explorer/normalize.ts,
// which validateTradeExplorerV1Request calls -- so caller list/tuple
// order, duplicate codes, and an omitted sort never reach the recipe
// itself. There is deliberately no generic key/value map, arbitrary field
// name, expression, or storage-naming string anywhere in this shape.
export type TradeExplorerV1AnalysisRequest = Readonly<{
  recipe: "trade-explorer-v1";
  analysisBuildId: string;
  sql?: never;
  table?: never;
  tableName?: never;
  column?: never;
  columnName?: never;
  expression?: never;
  path?: never;
  objectKey?: never;
  rawRecord?: never;
  rawRecords?: never;
}> &
  Omit<TradeExplorerV1RecipeInput, "analysisBuildId">;

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

export type { TradeExplorerV1NormalizedInputs } from "../trade-explorer/result";

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
  scanRows?: number;
  resultRows?: number;
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
  "trade-explorer-v1": {
    request: TradeExplorerV1AnalysisRequest;
    normalizedInputs: TradeExplorerV1NormalizedInputs;
    payload: TradeExplorerResult;
    emptyReason: "NO_ENUMERABLE_COHORT";
    invalidError:
      | Readonly<{ code: "INVALID_ANALYSIS_QUERY" }>
      | Readonly<{ code: "UNSUPPORTED_SHAPE"; shape: string }>
      | Readonly<{ code: "DIMENSION_MISMATCH" }>
      | Readonly<{ code: "UNSUPPORTED_MEASURE" }>
      | Readonly<{ code: "UNSUPPORTED_SORT_KEY" }>
      | Readonly<{ code: "YEAR_FILTER_INVALID" }>
      | Readonly<{ code: "YEAR_OUT_OF_FINALIZED_WINDOW" }>
      | Readonly<{
          code: "FIXED_DIMENSION_CARDINALITY_INVALID";
          dimension: string;
        }>
      | Readonly<{ code: "GROUPED_DIMENSION_EMPTY"; dimension: string }>
      | Readonly<{ code: "UNKNOWN_EXPORT_ECONOMY"; economyCode: string }>
      | Readonly<{ code: "UNKNOWN_IMPORT_ECONOMY"; economyCode: string }>
      | Readonly<{ code: "UNKNOWN_HS_PRODUCT"; productCode: string }>;
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

export type CandidateMarketV1EvidenceBinding =
  | TradeEvidenceSource
  | ReadonlyMap<string, TradeEvidenceSource>;

export type CandidateMarketV1PreviousReleaseBinding =
  | CandidateMarketV1PreviousReleaseEvidence
  | ReadonlyMap<string, CandidateMarketV1PreviousReleaseEvidence>
  | null;

export type CandidateMarketV1PlatformInput = Readonly<{
  // A single value binds every declared analysisBuildId to the same
  // evidence source and Release Revision evidence (the legacy
  // current-only shape every existing caller still uses). A
  // `ReadonlyMap` instead binds each retained analysisBuildId to its own
  // evidence source and its own Release Revision evidence, so retained
  // deployments never share one deployment's connection or misuse
  // another deployment's previous-release evidence (see issue #44
  // "deepen its internal binding model rather than adding external
  // per-recipe methods").
  evidenceSource: CandidateMarketV1EvidenceBinding;
  previousRelease?: CandidateMarketV1PreviousReleaseBinding;
  datasetPackages: ReadonlyMap<string, CandidateMarketDatasetPackage>;
}>;

export type TradeTrendV1EvidenceBinding =
  | TradeEvidenceSource
  | ReadonlyMap<string, TradeEvidenceSource>;

export type TradeTrendV1PlatformInput = Readonly<{
  evidenceSource: TradeTrendV1EvidenceBinding;
  datasetPackages: ReadonlyMap<string, TradeTrendDatasetPackage>;
}>;

export type SupplierCompetitionV1EvidenceBinding =
  | TradeEvidenceSource
  | ReadonlyMap<string, TradeEvidenceSource>;

export type SupplierCompetitionV1PlatformInput = Readonly<{
  evidenceSource: SupplierCompetitionV1EvidenceBinding;
  datasetPackages: ReadonlyMap<string, SupplierCompetitionDatasetPackage>;
}>;

export type TradeExplorerV1EvidenceBinding =
  | TradeEvidenceSource
  | ReadonlyMap<string, TradeEvidenceSource>;

export type TradeExplorerV1PlatformInput = Readonly<{
  evidenceSource: TradeExplorerV1EvidenceBinding;
  datasetPackages: ReadonlyMap<string, TradeExplorerDatasetPackage>;
}>;

export type TradeAnalyticsPlatformInput = Readonly<{
  candidateMarket?: CandidateMarketV1PlatformInput;
  tradeTrend?: TradeTrendV1PlatformInput;
  supplierCompetition?: SupplierCompetitionV1PlatformInput;
  // Deliberately omitted by the production verified runtime until #47:
  // an undeclared `tradeExplorer` input leaves every trade-explorer-v1
  // request retired (no dataset package is ever registered for any
  // analysisBuildId), which is the same safe "undeclared" state
  // production keeps for any recipe it has not yet activated. Only the
  // fixture application runtime supplies this (see
  // runtime/application-runtime.ts).
  tradeExplorer?: TradeExplorerV1PlatformInput;
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
  tradeExplorer,
}: TradeAnalyticsPlatformInput): TradeAnalyticsPlatform {
  return new InternalTradeAnalyticsPlatform(
    candidateMarket,
    tradeTrend,
    supplierCompetition,
    tradeExplorer,
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

type TradeExplorerExecution = (
  request: TradeExplorerV1EvidenceRequest,
  options?: AnalysisExecutionOptions,
) => Promise<TradeExplorerResult>;

class InternalTradeAnalyticsPlatform implements TradeAnalyticsPlatform {
  private readonly executeCandidateMarket: ReadonlyMap<
    string,
    CandidateMarketExecution
  >;
  private readonly executeTradeTrend: ReadonlyMap<string, TradeTrendExecution>;
  private readonly executeSupplierCompetition: ReadonlyMap<
    string,
    SupplierCompetitionExecution
  >;
  private readonly executeTradeExplorer: ReadonlyMap<
    string,
    TradeExplorerExecution
  >;

  constructor(
    private readonly candidateMarket: CandidateMarketV1PlatformInput | undefined,
    private readonly tradeTrend: TradeTrendV1PlatformInput | undefined,
    private readonly supplierCompetition:
      | SupplierCompetitionV1PlatformInput
      | undefined,
    private readonly tradeExplorer: TradeExplorerV1PlatformInput | undefined,
  ) {
    this.executeCandidateMarket =
      candidateMarket === undefined
        ? new Map()
        : new Map(
            [...candidateMarket.datasetPackages.keys()].map(
              (analysisBuildId) => [
                analysisBuildId,
                createCandidateMarketV1RecipeExecution(
                  requireEvidenceBinding(
                    candidateMarket.evidenceSource,
                    analysisBuildId,
                    "candidate-market-v1",
                  ),
                  resolvePreviousReleaseBinding(
                    candidateMarket.previousRelease,
                    analysisBuildId,
                  ),
                ),
              ],
            ),
          );
    this.executeTradeTrend =
      tradeTrend === undefined
        ? new Map()
        : new Map(
            [...tradeTrend.datasetPackages.keys()].map((analysisBuildId) => [
              analysisBuildId,
              createTradeTrendV1RecipeExecution(
                requireEvidenceBinding(
                  tradeTrend.evidenceSource,
                  analysisBuildId,
                  "trade-trend-v1",
                ),
              ),
            ]),
          );
    this.executeSupplierCompetition =
      supplierCompetition === undefined
        ? new Map()
        : new Map(
            [...supplierCompetition.datasetPackages.keys()].map(
              (analysisBuildId) => [
                analysisBuildId,
                createSupplierCompetitionV1RecipeExecution(
                  requireEvidenceBinding(
                    supplierCompetition.evidenceSource,
                    analysisBuildId,
                    "supplier-competition-v1",
                  ),
                ),
              ],
            ),
          );
    this.executeTradeExplorer =
      tradeExplorer === undefined
        ? new Map()
        : new Map(
            [...tradeExplorer.datasetPackages.keys()].map(
              (analysisBuildId) => [
                analysisBuildId,
                createTradeExplorerV1RecipeExecution(
                  requireEvidenceBinding(
                    tradeExplorer.evidenceSource,
                    analysisBuildId,
                    "trade-explorer-v1",
                  ),
                ),
              ],
            ),
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
      case "trade-explorer-v1": {
        const outcome = await this.executeTradeExplorerV1(request, options);
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
    const execute = this.executeCandidateMarket.get(request.analysisBuildId);
    if (datasetPackage === undefined || execute === undefined) {
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
      result = await execute(
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
    const execute = this.executeTradeTrend.get(request.analysisBuildId);
    if (datasetPackage === undefined || execute === undefined) {
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
      result = await execute(
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
    const execute = this.executeSupplierCompetition.get(
      request.analysisBuildId,
    );
    if (datasetPackage === undefined || execute === undefined) {
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
      result = await execute(
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

  // Trade Explorer resolves its Dataset Package before full normalization
  // (unlike the other three recipes above, which normalize first): its
  // own year filter can only be validated/expanded against the exact
  // finalized window the resolved Dataset Package declares (manifest.
  // finalizedCutoffYear), so "normalize deterministically... before
  // execution" (issue #46 acceptance criteria) requires the package
  // first. A malformed analysisBuildId is still checked first so an
  // invalid request is never misreported as retired.
  private async executeTradeExplorerV1(
    request: TradeExplorerV1AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<"trade-explorer-v1">> {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/iu.test(request.analysisBuildId)) {
      return expectedTradeExplorerFailure(
        request,
        invalidTradeExplorerQuery("analysisBuildId is malformed."),
      );
    }
    const datasetPackage = this.tradeExplorer?.datasetPackages.get(
      request.analysisBuildId,
    );
    const execute = this.executeTradeExplorer.get(request.analysisBuildId);
    if (datasetPackage === undefined || execute === undefined) {
      return expectedTradeExplorerFailure(
        request,
        retiredTradeExplorerAnalysisBuild(request.analysisBuildId),
      );
    }
    const compatibility = evaluateTradeExplorerV1DatasetPackage(datasetPackage);
    if (!compatibility.compatible) {
      return {
        state: "incompatible-package",
        ...unresolvedOutcome<"trade-explorer-v1">(request),
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: compatibility.reason,
        },
      };
    }
    const finalizedCutoffYear = datasetPackage.manifest.finalizedCutoffYear;
    const finalizedWindow = {
      start: finalizedCutoffYear - 4,
      end: finalizedCutoffYear,
    };
    let normalizedInputs: TradeExplorerV1NormalizedInputs;
    try {
      normalizedInputs = validateTradeExplorerV1Request(
        request,
        finalizedWindow,
      );
    } catch (error) {
      if (!isTradeExplorerAnalysisError(error)) {
        throw error;
      }
      return expectedTradeExplorerFailure(request, error);
    }
    let result: TradeExplorerResult;
    try {
      result = await execute(
        { analysisBuildId: request.analysisBuildId, query: normalizedInputs },
        options,
      );
    } catch (error) {
      if (isAnalysisCapacityExceededError(error)) {
        return capacityOutcome(request, error.reason, error.retryAfterSeconds);
      }
      if (!isTradeExplorerAnalysisError(error)) {
        throw error;
      }
      return expectedTradeExplorerFailure(request, error);
    }
    if (
      result.analysisBuildId !== request.analysisBuildId ||
      JSON.stringify(result.query) !== JSON.stringify(normalizedInputs)
    ) {
      throw new TypeError(
        "Trade Explorer evidence returned a result for a different normalized request.",
      );
    }
    if (
      result.provenance.baciRelease !== datasetPackage.manifest.baciRelease ||
      result.provenance.hsRevision !== datasetPackage.manifest.hsRevision ||
      result.provenance.finalizedWindow.start !== finalizedWindow.start ||
      result.provenance.finalizedWindow.end !== finalizedWindow.end ||
      result.provenance.evidenceSha256 !==
        datasetPackage.manifest.evidenceSha256
    ) {
      return {
        state: "incompatible-package",
        ...unresolvedOutcome<"trade-explorer-v1">(request),
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason: "PACKAGE_IDENTITY_MISMATCH",
        },
      };
    }
    const completed = completedTradeExplorerOutcome(
      request.recipe,
      result,
      datasetPackage.identity,
      normalizedInputs,
    );
    if (result.rowCount === 0) {
      if (result.emptyReason !== "NO_ENUMERABLE_COHORT" || result.rows.length !== 0) {
        throw new TypeError(
          "Trade Explorer empty-result invariants were violated.",
        );
      }
      return { state: "empty", emptyReason: result.emptyReason, ...completed };
    }
    if (result.emptyReason !== null || result.rows.length !== result.rowCount) {
      throw new TypeError(
        "Trade Explorer success-result invariants were violated.",
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

function expectedTradeExplorerFailure(
  request: TradeExplorerV1AnalysisRequest,
  error: TradeExplorerAnalysisError,
): AnalysisOutcome<"trade-explorer-v1"> {
  const unresolved = unresolvedOutcome<"trade-explorer-v1">(request);
  switch (error.code) {
    case "INVALID_ANALYSIS_QUERY":
    case "DIMENSION_MISMATCH":
    case "UNSUPPORTED_MEASURE":
    case "UNSUPPORTED_SORT_KEY":
    case "YEAR_FILTER_INVALID":
    case "YEAR_OUT_OF_FINALIZED_WINDOW":
      return { state: "invalid-input", ...unresolved, error: { code: error.code } };
    case "UNSUPPORTED_SHAPE":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code: error.code, shape: error.detail ?? "" },
      };
    case "FIXED_DIMENSION_CARDINALITY_INVALID":
    case "GROUPED_DIMENSION_EMPTY":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code: error.code, dimension: error.detail ?? "" },
      };
    case "UNKNOWN_EXPORT_ECONOMY":
    case "UNKNOWN_IMPORT_ECONOMY":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code: error.code, economyCode: error.detail ?? "" },
      };
    case "UNKNOWN_HS_PRODUCT":
      return {
        state: "invalid-input",
        ...unresolved,
        error: { code: error.code, productCode: error.detail ?? "" },
      };
    case "ANALYSIS_BUILD_RETIRED":
      return {
        state: "retired",
        ...unresolved,
        error: { code: error.code, analysisBuildId: request.analysisBuildId },
      };
    case "ANALYSIS_UNAVAILABLE":
      return { state: "temporary-unavailability", ...unresolved, error: { code: error.code } };
    case "NO_COMPATIBLE_DATASET_PACKAGE":
      return {
        state: "incompatible-package",
        ...unresolved,
        error: {
          code: error.code,
          reason:
            error.detail === "MISSING_REQUIRED_CAPABILITY" ||
            error.detail === "CAPABILITY_VERSION_MISMATCH" ||
            error.detail === "PACKAGE_IDENTITY_MISMATCH"
              ? error.detail
              : "PACKAGE_IDENTITY_MISMATCH",
        },
      };
    case "INPUT_CARDINALITY_BUDGET_EXCEEDED":
      return {
        state: "budget",
        ...unresolved,
        error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget: "INPUT_CARDINALITY" },
      };
    case "RESULT_ROWS_BUDGET_EXCEEDED":
      return {
        state: "budget",
        ...unresolved,
        error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget: "RESULT_ROWS" },
      };
    case "RESULT_BYTES_BUDGET_EXCEEDED":
      return {
        state: "budget",
        ...unresolved,
        error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget: "RESULT_BYTES" },
      };
    case "SCAN_BUDGET_EXCEEDED":
      return {
        state: "budget",
        ...unresolved,
        error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget: "SCAN" },
      };
  }
}

/**
 * Resolves an evidence-source binding for one retained analysisBuildId: a
 * single value applies to every declared build (legacy shape), while a
 * `ReadonlyMap` binds each retained build to its own evidence source.
 * Throws when a Map binding is missing the requested build, since that
 * signals a construction-time inconsistency between `evidenceSource` and
 * `datasetPackages` rather than an expected retirement (retirement is
 * `datasetPackages` not declaring the build at all).
 */
function requireEvidenceBinding(
  binding: TradeEvidenceSource | ReadonlyMap<string, TradeEvidenceSource>,
  analysisBuildId: string,
  recipe: AnalysisRecipe,
): TradeEvidenceSource {
  if (binding instanceof Map) {
    const source = (
      binding as ReadonlyMap<string, TradeEvidenceSource>
    ).get(analysisBuildId);
    if (source === undefined) {
      throw new TypeError(
        `No ${recipe} evidence source is bound for analysis build ${analysisBuildId}.`,
      );
    }
    return source;
  }
  return binding as TradeEvidenceSource;
}

/**
 * Resolves the Release Revision (previous-BACI-release) evidence bound to
 * one retained analysisBuildId. A single value or `undefined`/`null`
 * applies uniformly (the legacy current-only shape); a `ReadonlyMap`
 * instead scopes each retained build to its own comparison evidence so a
 * historical replay never inherits the current deployment's own
 * previous-release evidence (see CONTEXT.md "Release Revision" and issue
 * #44).
 */
function resolvePreviousReleaseBinding(
  binding: CandidateMarketV1PreviousReleaseBinding | undefined,
  analysisBuildId: string,
): CandidateMarketV1PreviousReleaseEvidence | null {
  if (binding === undefined || binding === null) {
    return null;
  }
  if (binding instanceof Map) {
    return (
      (
        binding as ReadonlyMap<
          string,
          CandidateMarketV1PreviousReleaseEvidence
        >
      ).get(analysisBuildId) ?? null
    );
  }
  return binding as CandidateMarketV1PreviousReleaseEvidence;
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

function completedTradeExplorerOutcome(
  recipe: "trade-explorer-v1",
  payload: TradeExplorerResult,
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: TradeExplorerV1NormalizedInputs,
): CompletedAnalysisOutcome<"trade-explorer-v1"> {
  return {
    recipe,
    analysisIdentity: analysisIdentityForTradeExplorer(
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
// Trade Explorer's normalized inputs have no single economy/product field
// pair -- see TradeExplorerV1NormalizedInputs -- so its identity is kept
// as its own function rather than a fourth analysisIdentityFor overload
// sharing that shape. Every field that must NOT alter Analysis Identity
// (caller list/tuple order, an omitted sort) has already been normalized
// away by normalizeTradeExplorerV1Request before this runs; the declared
// result sort is the one ordering input that legitimately participates.
function analysisIdentityForTradeExplorer(
  datasetPackageIdentity: DatasetPackageIdentity,
  normalizedInputs: TradeExplorerV1NormalizedInputs,
): AnalysisIdentity {
  const canonicalIdentity = JSON.stringify([
    "analysis-identity-v1",
    "trade-explorer-v1",
    datasetPackageIdentity,
    normalizedInputs.shape,
    normalizedInputs.dimension,
    normalizedInputs.measures,
    normalizedInputs.years,
    normalizedInputs.exportEconomy,
    normalizedInputs.importEconomy,
    normalizedInputs.hsProduct,
    normalizedInputs.sort.key,
    normalizedInputs.sort.direction,
  ]);
  const digest = createHash("sha256").update(canonicalIdentity).digest("hex");
  return `analysis-identity-v1-${digest}` as AnalysisIdentity;
}
