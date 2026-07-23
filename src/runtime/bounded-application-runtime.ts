import { validateProductSearchQuery } from "../catalog/validate-product-search-query";
import { isCandidateMarketAnalysisError } from "../domain/candidate-market/errors";
import { validateCandidateMarketV1Request } from "../domain/trade-analytics/candidate-market-v1-request";
import { validateSupplierCompetitionV1Request } from "../domain/trade-analytics/supplier-competition-v1-request";
import { validateRecentTradeMomentumV1Request } from "../domain/trade-analytics/recent-trade-momentum-v1-request";
import { validateTradeTrendV1Request } from "../domain/trade-analytics/trade-trend-v1-request";
import { validateTradeExplorerV1Request } from "../domain/trade-analytics/trade-explorer-v1-request";
import {
  normalizeOpportunityDiscoveryV1Request,
  validateOpportunityDiscoveryV1Request,
} from "../domain/trade-analytics/opportunity-discovery-v1-request";
import { validateOpportunityDetailV1Request } from "../domain/trade-analytics/opportunity-detail-v1-request";
import { isSupplierCompetitionAnalysisError } from "../domain/supplier-competition/errors";
import { isTradeExplorerAnalysisError } from "../domain/trade-explorer/errors";
import { isOpportunityDiscoveryAnalysisError } from "../domain/opportunity-discovery/errors";
import { isTradeTrendAnalysisError } from "../domain/trade-trend/errors";
import { isRecentTradeMomentumAnalysisError } from "../domain/recent-trade-momentum/errors";
import type {
  AnalysisBatch,
  AnalysisBatchOutcomes,
  AnalysisExecutionOptions,
  AnalysisOperationObservation,
  AnalysisOutcome,
  AnalysisRecipe,
  AnalysisRequest,
  OpportunityDetailV1AnalysisRequest,
  OpportunityDiscoveryV1AnalysisRequest,
  RecentTradeMomentumV1AnalysisRequest,
  TradeAnalyticsPlatform,
  TradeExplorerV1AnalysisRequest,
} from "../domain/trade-analytics/trade-analytics-platform";
import { normalizeEconomyQuery } from "../economy/economy-search";
import { validateEconomySearchQuery } from "../economy/economy-search";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import type {
  ApplicationRuntime,
  RuntimeRequestOptions,
} from "./application-runtime";
import {
  AnalysisCapacityExceededError,
  isAnalysisCapacityExceededError,
} from "./analysis-capacity-error";
import { ByteWeightedLru } from "./byte-weighted-lru";
import {
  CACHE_ENTRY_OVERHEAD_BYTES,
  serializedBytes,
  utf8ByteLength,
} from "./serialized-size";

type AnalysisQuery = AnalysisRequest;
type AnalysisResult =
  | AnalysisOutcome<"candidate-market-v1">
  | AnalysisOutcome<"trade-trend-v1">
  | AnalysisOutcome<"supplier-competition-v1">
  | AnalysisOutcome<"recent-trade-momentum-v1">
  | AnalysisOutcome<"trade-explorer-v1">
  | AnalysisOutcome<"opportunity-discovery-v1">
  | AnalysisOutcome<"opportunity-detail-v1">;
type AnalysisPromise = Promise<AnalysisResult>;
type ProductSearchQuery = Parameters<
  ApplicationRuntime["searchProducts"]
>[0];
type ProductSearchPromise = ReturnType<
  ApplicationRuntime["searchProducts"]
>;
type ProductSearchResult = Awaited<ProductSearchPromise>;
type EconomySearchQuery = Parameters<
  ApplicationRuntime["searchEconomies"]
>[0];
type EconomySearchPromise = ReturnType<
  ApplicationRuntime["searchEconomies"]
>;
type EconomySearchResult = Awaited<EconomySearchPromise>;

export type BoundedApplicationRuntimeOptions = Readonly<{
  maxConcurrentAnalyses?: number;
  maxQueuedAnalyses?: number;
  queueWaitTimeoutMs?: number;
  analysisTimeoutMs?: number;
  analysisCacheMaxBytes?: number;
  searchCacheMaxBytes?: number;
  analysisBudget?: Partial<AnalysisBudgetPolicy>;
  anonymousSourceRateLimit?: Partial<AnonymousSourceRateLimitPolicy>;
  now?: () => number;
}>;

export type AnalysisBudgetPolicy = Readonly<{
  maxInputBytes: number;
  maxTradeExplorerInputBytes: number;
  maxResultRows: number;
  maxResultBytes: number;
}>;

export type AnonymousSourceRateLimitPolicy = Readonly<{
  capacity: number;
  refillTokensPerSecond: number;
  maxTrackedSources: number;
  inactiveSourceRetentionMs: number;
}>;

type SharedOperation<Result> = {
  readonly controller: AbortController;
  readonly promise: Promise<Result>;
  readonly remove: () => void;
  readonly timing: OperationTiming;
  readonly settled: boolean;
  waiters: number;
};

type OperationTiming = {
  queueWaitMs: number | null;
  queryMs: number | null;
  resultBytes: number;
  scanRows?: number;
  resultRows?: number;
  recipeVersion?: AnalysisOperationObservation["recipeVersion"];
  outcomeState?: AnalysisOperationObservation["outcomeState"];
  rejectionReason?: AnalysisOperationObservation["rejectionReason"];
};
type SharedOperationOptions<Result> = {
  measureQueryTiming?: boolean;
  resultBytes?: (result: Result) => number;
  analysisDetails?: (
    result: Result,
  ) => Pick<
    AnalysisOperationObservation,
    | "recipeVersion"
    | "outcomeState"
    | "rejectionReason"
    | "scanRows"
    | "resultRows"
  >;
};

type SharedAnalysis = SharedOperation<AnalysisResult>;
type SharedProductSearch = SharedOperation<ProductSearchResult>;
type SharedEconomySearch = SharedOperation<EconomySearchResult>;
type SearchCacheValue =
  | { readonly kind: "product"; readonly value: ProductSearchResult }
  | { readonly kind: "economy"; readonly value: EconomySearchResult };
type CachedSearchInput<Result> = {
  key: string;
  inFlight: Map<string, SharedOperation<Result>>;
  requestOptions: RuntimeRequestOptions | undefined;
  execute(controller: AbortController): Promise<Result>;
  readCached(value: SearchCacheValue): Result | undefined;
  toCacheValue(value: Result): SearchCacheValue;
};

export function createBoundedApplicationRuntime(
  inner: ApplicationRuntime,
  options: BoundedApplicationRuntimeOptions = {},
): ApplicationRuntime {
  const analyses = new Map<string, SharedAnalysis>();
  const execution = new AnalysisExecutionCoordinator(options);
  const analysisBudget = resolveAnalysisBudget(options.analysisBudget);
  const anonymousSourceRateLimiter = new AnonymousSourceRateLimiter(
    resolveAnonymousSourceRateLimit(options.anonymousSourceRateLimit),
    options.now ?? Date.now,
  );
  const analysisCache = new ByteWeightedLru<Awaited<AnalysisPromise>>(
    options.analysisCacheMaxBytes ??
      RUNTIME_RESOURCE_POLICY.analysisCacheMaxBytes,
  );
  const searchCache = new ByteWeightedLru<SearchCacheValue>(
    options.searchCacheMaxBytes ??
      RUNTIME_RESOURCE_POLICY.searchCacheMaxBytes,
  );
  const productSearches = new Map<string, SharedProductSearch>();
  const economySearches = new Map<string, SharedEconomySearch>();
  let activeDeploymentIdentity: string | undefined;
  let cacheGeneration = 0;

  const synchronizeActiveDeployment = () => {
    const activeDeployment = inner.currentAnalysis();
    const nextIdentity = deploymentIdentity(activeDeployment);
    if (nextIdentity !== activeDeploymentIdentity) {
      activeDeploymentIdentity = nextIdentity;
      cacheGeneration += 1;
      analysisCache.clear();
      searchCache.clear();
    }
    return activeDeployment;
  };

  function runCachedSearch<Result>({
    key,
    inFlight,
    requestOptions,
    execute,
    readCached,
    toCacheValue,
  }: CachedSearchInput<Result>): Promise<Result> {
    const cached = searchCache.lookup(key);
    const cachedValue =
      cached === undefined ? undefined : readCached(cached.value);
    if (cached !== undefined && cachedValue !== undefined) {
      requestOptions?.observe?.({
        cacheState: "hit",
        queueWaitMs: null,
        queryMs: null,
        resultBytes: cached.resultBytes,
      });
      return Promise.resolve(cachedValue);
    }

    let shared = inFlight.get(key);
    let cacheState: "coalesced" | "miss" = "coalesced";
    if (shared === undefined) {
      cacheState = "miss";
      const generation = cacheGeneration;
      const timing = operationTiming();
      shared = startSharedOperation(
        execute,
        (result, resultBytes) => {
          if (cacheGeneration === generation) {
            searchCache.set(
              key,
              toCacheValue(result),
              resultBytes + CACHE_ENTRY_OVERHEAD_BYTES,
            );
          }
        },
        () => {
          if (inFlight.get(key) === shared) {
            inFlight.delete(key);
          }
        },
        timing,
        { measureQueryTiming: true },
      );
      inFlight.set(key, shared);
    }

    return waitForSharedOperation(
      shared,
      requestOptions,
      cacheState,
    );
  }

  function executeAnalysis(
    query: AnalysisQuery,
    requestOptions?: AnalysisExecutionOptions,
    executionGroup?: AnalysisExecutionGroup,
  ): AnalysisPromise {
    if (requestOptions?.signal?.aborted) {
      return Promise.reject(abortError());
    }
    const retryAfterSeconds =
      requestOptions?.anonymousSource === undefined
        ? null
        : anonymousSourceRateLimiter.consume(
            requestOptions.anonymousSource,
          );
    if (retryAfterSeconds !== null) {
      const rejected = rateLimitOutcome(query, retryAfterSeconds);
      requestOptions?.observe?.(
        analysisObservation("bypass", null, null, rejected),
      );
      return Promise.resolve(rejected);
    }
    const preflightBudget = inputBudgetOutcome(query, analysisBudget);
    if (preflightBudget !== null) {
      requestOptions?.observe?.(
        analysisObservation("bypass", null, null, preflightBudget),
      );
      return Promise.resolve(preflightBudget);
    }
    try {
      validateAnalysisRequest(query);
    } catch (error) {
      if (
        !isCandidateMarketAnalysisError(error) &&
        !isTradeTrendAnalysisError(error) &&
        !isSupplierCompetitionAnalysisError(error) &&
        !isRecentTradeMomentumAnalysisError(error) &&
        !isTradeExplorerAnalysisError(error) &&
        !isOpportunityDiscoveryAnalysisError(error)
      ) {
        return Promise.reject(error);
      }
      return inner.tradeAnalytics.execute(query, requestOptions).then(
        (outcome) => {
          requestOptions?.observe?.(
            analysisObservation("bypass", null, null, outcome),
          );
          return outcome;
        },
      );
    }
    const activeDeployment = synchronizeActiveDeployment();
    if (query.analysisBuildId !== activeDeployment.analysisBuildId) {
      return inner.tradeAnalytics.execute(query, requestOptions).then(
        (outcome) => {
          requestOptions?.observe?.(
            analysisObservation("bypass", null, null, outcome),
          );
          return outcome;
        },
      );
    }
    let normalizedTradeExplorer:
      | ReturnType<typeof validateTradeExplorerV1Request>
      | undefined;
    if (query.recipe === "trade-explorer-v1") {
      try {
        const cutoff = activeDeployment.source.finalizedCutoffYear;
        normalizedTradeExplorer = validateTradeExplorerV1Request(query, {
          start: cutoff - 4,
          end: cutoff,
        });
      } catch (error) {
        if (!isTradeExplorerAnalysisError(error)) {
          return Promise.reject(error);
        }
        return inner.tradeAnalytics.execute(query, requestOptions).then(
          (outcome) => {
            requestOptions?.observe?.(
              analysisObservation("bypass", null, null, outcome),
            );
            return outcome;
          },
        );
      }
    }

    const key = analysisKey(
      query,
      requestOptions?.cachePartitionKey,
      normalizedTradeExplorer,
    );
    const cached = analysisCache.lookup(key);
    if (cached !== undefined) {
      requestOptions?.observe?.(
        analysisObservation(
          "hit",
          null,
          null,
          cached.value,
          cached.resultBytes,
        ),
      );
      return Promise.resolve(cached.value);
    }

    let shared = analyses.get(key);
    let cacheState: "coalesced" | "miss" = "coalesced";
    if (!shared) {
      cacheState = "miss";
      const generation = cacheGeneration;
      const timing = operationTiming();
      shared = startSharedOperation(
        (controller) => {
          const execute = () =>
            inner.tradeAnalytics
              .execute(query, {
                signal: controller.signal,
              })
              .then((result) =>
                resultBudgetOutcome(query, result, analysisBudget),
              );
          const operation =
            executionGroup === undefined
              ? execution.run(controller, execute, timing)
              : executionGroup.run(controller, execute, timing);
          return operation.catch((error: unknown) =>
            isAnalysisCapacityExceededError(error)
              ? capacityOutcome(query, error)
              : Promise.reject(error),
          );
        },
        (result, resultBytes) => {
          if (
            cacheGeneration === generation &&
            isCompletedAnalysis(result)
          ) {
            analysisCache.set(
              key,
              result,
              resultBytes + CACHE_ENTRY_OVERHEAD_BYTES,
            );
          }
        },
        () => {
          if (analyses.get(key) === shared) {
            analyses.delete(key);
          }
        },
        timing,
        {
          resultBytes: analysisResultBytes,
          analysisDetails: analysisDetailsFor,
        },
      );
      analyses.set(key, shared);
    }

    return waitForSharedOperation(shared, requestOptions, cacheState);
  }

  const tradeAnalytics: TradeAnalyticsPlatform = {
    execute<Request extends AnalysisRequest>(
      query: Request,
      requestOptions?: AnalysisExecutionOptions,
    ): Promise<AnalysisOutcome<Request["recipe"]>> {
      return executeAnalysis(query, requestOptions) as Promise<
        AnalysisOutcome<Request["recipe"]>
      >;
    },
    executeBatch<Requests extends AnalysisBatch>(
      requests: Requests,
      requestOptions?: AnalysisExecutionOptions,
    ): Promise<AnalysisBatchOutcomes<Requests>> {
      const group = execution.createGroup();
      try {
        const outcomes = requests.map((request) =>
          executeAnalysis(request, requestOptions, group),
        );
        group.seal();
        return Promise.all(outcomes) as Promise<AnalysisBatchOutcomes<Requests>>;
      } catch (error) {
        group.seal();
        return Promise.reject(error);
      }
    },
  };

  return {
    tradeAnalytics,
    currentAnalysis: () => inner.currentAnalysis(),
    currentAnalysisSnapshot: () => inner.currentAnalysisSnapshot(),
    resolveAnalysisManifest: (analysisBuildId) =>
      inner.resolveAnalysisManifest(analysisBuildId),
    resolveFreshnessStatus: (freshnessStatusId) =>
      inner.resolveFreshnessStatus(freshnessStatusId),
    normalizeProductSearchQuery: (query) =>
      inner.normalizeProductSearchQuery(query),
    health: (buildId) => inner.health(buildId),
    activation: () => inner.activation(),
    resources() {
      const resources = inner.resources();
      return {
        ...resources,
        analysisExecution: execution.resources(),
        caches: {
          ...resources.caches,
          analysis: analysisCache.resources(),
          search: searchCache.resources(),
        },
      };
    },
    searchProducts(query, requestOptions) {
      if (requestOptions?.signal?.aborted) {
        return Promise.reject(abortError());
      }
      try {
        validateProductSearchQuery(query);
      } catch (error) {
        return Promise.reject(error);
      }

      const activeDeployment = synchronizeActiveDeployment();
      if (
        query.productSearchBuildId !==
        activeDeployment.productSearchBuildId
      ) {
        return inner.searchProducts(query, requestOptions);
      }

      const key = productSearchKey(
        query,
        inner.normalizeProductSearchQuery(query.query),
      );
      return runCachedSearch({
        key,
        inFlight: productSearches,
        requestOptions,
        execute: (controller) =>
          inner.searchProducts(query, {
            signal: controller.signal,
          }),
        readCached: (value) =>
          value.kind === "product" ? value.value : undefined,
        toCacheValue: (value) => ({ kind: "product", value }),
      });
    },
    searchEconomies(query, requestOptions) {
      if (requestOptions?.signal?.aborted) {
        return Promise.reject(abortError());
      }
      try {
        validateEconomySearchQuery(query);
      } catch (error) {
        return Promise.reject(error);
      }

      const activeDeployment = synchronizeActiveDeployment();
      if (query.analysisBuildId !== activeDeployment.analysisBuildId) {
        return inner.searchEconomies(query, requestOptions);
      }

      const key = economySearchKey(query);
      return runCachedSearch({
        key,
        inFlight: economySearches,
        requestOptions,
        execute: (controller) =>
          inner.searchEconomies(query, {
            signal: controller.signal,
          }),
        readCached: (value) =>
          value.kind === "economy" ? value.value : undefined,
        toCacheValue: (value) => ({ kind: "economy", value }),
      });
    },
  };
}

function startSharedOperation<Result>(
  execute: (controller: AbortController) => Promise<Result>,
  admitResult: (result: Result, resultBytes: number) => void,
  remove: () => void,
  timing: OperationTiming,
  options: SharedOperationOptions<Result> = {},
): SharedOperation<Result> {
  const controller = new AbortController();
  let settled = false;
  const queryStartedAt = performance.now();
  let operation: Promise<Result>;
  try {
    operation = execute(controller);
  } catch (error) {
    operation = Promise.reject(error);
  }
  const finishMeasuredQuery = () => {
    if (options.measureQueryTiming && timing.queryMs === null) {
      timing.queryMs = performance.now() - queryStartedAt;
    }
  };
  const promise = operation
    .then(
      (result) => {
        finishMeasuredQuery();
        timing.resultBytes =
          options.resultBytes?.(result) ?? serializedBytes(result);
        Object.assign(
          timing,
          options.analysisDetails?.(result) ?? {},
        );
        if (!controller.signal.aborted) {
          admitResult(result, timing.resultBytes);
        }
        return result;
      },
      (error: unknown) => {
        finishMeasuredQuery();
        throw error;
      },
    )
    .finally(() => {
      settled = true;
      remove();
    });
  return {
    controller,
    promise,
    remove,
    timing,
    get settled() {
      return settled;
    },
    waiters: 0,
  };
}

function waitForSharedOperation<Result>(
  shared: SharedOperation<Result>,
  options: RuntimeRequestOptions | undefined,
  cacheState: "coalesced" | "miss",
): Promise<Result> {
  const signal = options?.signal;
  shared.waiters += 1;

  return new Promise((resolve, reject) => {
    let waiting = true;

    const observe = () => {
      options?.observe?.({
        cacheState,
        queueWaitMs: shared.timing.queueWaitMs,
        queryMs: shared.timing.queryMs,
        resultBytes: shared.timing.resultBytes,
        scanRows: shared.timing.scanRows,
        resultRows: shared.timing.resultRows,
        recipeVersion: shared.timing.recipeVersion,
        outcomeState: shared.timing.outcomeState,
        rejectionReason: shared.timing.rejectionReason,
      });
    };
    const finishWaiting = () => {
      if (!waiting) {
        return;
      }
      waiting = false;
      signal?.removeEventListener("abort", onAbort);
      shared.waiters -= 1;
      if (shared.waiters === 0 && !shared.settled) {
        shared.remove();
        shared.controller.abort();
      }
    };
    const onAbort = () => {
      observe();
      finishWaiting();
      reject(signal?.reason ?? abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    shared.promise.then(
      (result) => {
        if (waiting) {
          observe();
          finishWaiting();
          resolve(result);
        }
      },
      (error: unknown) => {
        if (waiting) {
          observe();
          finishWaiting();
          reject(error);
        }
      },
    );
  });
}

function productSearchKey(
  query: ProductSearchQuery,
  normalizedQuery: string,
): string {
  return [
    "product",
    query.productSearchBuildId,
    normalizedQuery,
    query.locale,
    query.limit,
  ].join("\u0000");
}

function economySearchKey(query: EconomySearchQuery): string {
  return [
    "economy",
    query.analysisBuildId,
    normalizeEconomyQuery(query.query),
    query.limit,
  ].join("\u0000");
}

function analysisKey(
  query: AnalysisQuery,
  cachePartitionKey: string | undefined,
  normalizedTradeExplorer?: ReturnType<
    typeof validateTradeExplorerV1Request
  >,
): string {
  if (query.recipe === "trade-explorer-v1") {
    if (normalizedTradeExplorer === undefined) {
      throw new TypeError(
        "Trade Explorer cache keys require normalized semantic inputs.",
      );
    }
    return [
      query.recipe,
      query.analysisBuildId,
      JSON.stringify(normalizedTradeExplorer),
      cachePartitionKey ?? "",
    ].join("\u0000");
  }
  if (query.recipe === "opportunity-discovery-v1") {
    // Paging and product projection are representation, but they change the
    // page bytes, so the cache key spans them (normalization already sorted /
    // de-duplicated the product filter and defaulted the limit).
    const recipeInput = normalizeOpportunityDiscoveryV1Request(query);
    return [
      query.recipe,
      query.analysisBuildId,
      String(Number(query.exportEconomyCode)),
      String(recipeInput.limit),
      recipeInput.cursor ?? "",
      recipeInput.productCodes === null
        ? ""
        : recipeInput.productCodes.join(","),
      cachePartitionKey ?? "",
    ].join("\u0000");
  }
  if (query.recipe === "opportunity-detail-v1") {
    // Detail is not paginated; the key spans the exporter/product/market triple
    // that identifies the one candidate whose evidence is reconstructed.
    return [
      query.recipe,
      query.analysisBuildId,
      String(Number(query.exportEconomyCode)),
      query.productCode,
      String(Number(query.marketCode)),
      cachePartitionKey ?? "",
    ].join("\u0000");
  }
  if (query.recipe === "recent-trade-momentum-v1") {
    return [
      query.recipe,
      query.analysisBuildId,
      query.reporterCode,
      query.productCode,
      cachePartitionKey ?? "",
    ].join("\u0000");
  }
  return [
    query.recipe,
    query.analysisBuildId,
    normalizedEconomyCode(query),
    query.productCode,
    cachePartitionKey ?? "",
  ].join("\u0000");
}

function isCompletedAnalysis(
  outcome: AnalysisResult,
): outcome is Extract<AnalysisResult, { state: "success" | "empty" }> {
  return outcome.state === "success" || outcome.state === "empty";
}

function validateAnalysisRequest(query: AnalysisQuery): void {
  if (query.recipe === "candidate-market-v1") {
    validateCandidateMarketV1Request(query);
    return;
  }
  if (query.recipe === "supplier-competition-v1") {
    validateSupplierCompetitionV1Request(query);
    return;
  }
  if (query.recipe === "recent-trade-momentum-v1") {
    validateRecentTradeMomentumV1Request(query);
    return;
  }
  if (query.recipe === "trade-explorer-v1") {
    // Trade Explorer's own normalization needs the resolved Dataset
    // Package's finalized window (see trade-analytics-platform.ts's
    // executeTradeExplorerV1), which this generic preflight bypass check
    // does not have. It is only a caching/coalescing efficiency hint --
    // `inner.tradeAnalytics.execute` always re-validates authoritatively
    // -- so trade-explorer-v1 requests simply always take the normal
    // cached/queued path rather than the invalid-request bypass path.
    return;
  }
  if (query.recipe === "opportunity-discovery-v1") {
    validateOpportunityDiscoveryV1Request(query);
    return;
  }
  if (query.recipe === "opportunity-detail-v1") {
    validateOpportunityDetailV1Request(query);
    return;
  }
  validateTradeTrendV1Request(query);
}

function normalizedEconomyCode(
  query: Exclude<
    AnalysisQuery,
    | TradeExplorerV1AnalysisRequest
    | OpportunityDiscoveryV1AnalysisRequest
    | OpportunityDetailV1AnalysisRequest
    | RecentTradeMomentumV1AnalysisRequest
  >,
): string {
  return String(
    Number(
      query.recipe === "candidate-market-v1"
        ? query.exporterCode
        : query.importerCode,
    ),
  );
}

function tradeExplorerRawInputKey(
  query: TradeExplorerV1AnalysisRequest,
): string | null {
  try {
    return JSON.stringify([
      query.shape,
      [...query.dimensions].sort(),
      [...query.measures].sort(),
      query.filters.year,
      sortedEconomyCodes(query.filters.exportEconomy),
      sortedEconomyCodes(query.filters.importEconomy),
      [...query.filters.hsProduct].sort(),
      query.sort,
    ]);
  } catch {
    return null;
  }
}

function sortedEconomyCodes(codes: readonly string[]): readonly string[] {
  return [...codes].sort();
}

function analysisResultRows(
  outcome: Extract<AnalysisResult, { state: "success" | "empty" }>,
): number {
  if (outcome.recipe === "candidate-market-v1") {
    return outcome.payload.candidates.length;
  }
  if (outcome.recipe === "supplier-competition-v1") {
    return new Set([
      ...outcome.payload.supplierShares.map((share) => share.economy.code),
      ...outcome.payload.provisionalSupplierShares.map(
        (share) => share.economy.code,
      ),
    ]).size;
  }
  if (outcome.recipe === "trade-explorer-v1") {
    return (
      outcome.payload.rows.length +
      (outcome.payload.totalRow === null ? 0 : 1)
    );
  }
  if (outcome.recipe === "opportunity-discovery-v1") {
    return outcome.payload.candidates.length;
  }
  if (outcome.recipe === "opportunity-detail-v1") {
    return outcome.payload.marketYears.length;
  }
  if (outcome.recipe === "recent-trade-momentum-v1") {
    return 1;
  }
  return (
    outcome.payload.finalizedObservations.length +
    (outcome.payload.provisionalObservation === null ? 0 : 1)
  );
}

function inputBudgetOutcome(
  request: AnalysisQuery,
  policy: AnalysisBudgetPolicy,
): AnalysisResult | null {
  const maxInputBytes =
    request.recipe === "trade-explorer-v1"
      ? policy.maxTradeExplorerInputBytes
      : policy.maxInputBytes;
  let canonicalInputs: readonly string[];
  if (request.recipe === "trade-explorer-v1") {
    const tradeExplorerInputKey = tradeExplorerRawInputKey(request);
    if (tradeExplorerInputKey === null) {
      return null;
    }
    canonicalInputs = [
      request.recipe,
      request.analysisBuildId,
      tradeExplorerInputKey,
    ];
  } else if (request.recipe === "opportunity-discovery-v1") {
    const recipeInput = normalizeOpportunityDiscoveryV1Request(request);
    canonicalInputs = [
      request.recipe,
      request.analysisBuildId,
      request.exportEconomyCode,
      recipeInput.cursor ?? "",
      recipeInput.productCodes === null
        ? ""
        : recipeInput.productCodes.join(","),
    ];
  } else if (request.recipe === "opportunity-detail-v1") {
    canonicalInputs = [
      request.recipe,
      request.analysisBuildId,
      request.exportEconomyCode,
      request.productCode,
      request.marketCode,
    ];
  } else if (request.recipe === "recent-trade-momentum-v1") {
    canonicalInputs = [
      request.recipe,
      request.analysisBuildId,
      request.reporterCode,
      request.productCode,
      request.exporterCode ?? "",
    ];
  } else {
    canonicalInputs = [
      request.recipe,
      request.analysisBuildId,
      request.recipe === "candidate-market-v1"
        ? request.exporterCode
        : request.importerCode,
      request.productCode,
    ];
  }
  if (canonicalInputs.some((input) => typeof input !== "string")) {
    return null;
  }
  if (
    canonicalInputs.some(
      (input) => input.length > maxInputBytes,
    )
  ) {
    return budgetOutcome(request, "INPUT_CARDINALITY");
  }
  const canonicalInputBytes = utf8ByteLength(
    JSON.stringify(canonicalInputs),
  );
  return canonicalInputBytes > maxInputBytes
    ? budgetOutcome(request, "INPUT_CARDINALITY")
    : null;
}

function resultBudgetOutcome(
  request: AnalysisQuery,
  outcome: AnalysisResult,
  policy: AnalysisBudgetPolicy,
): AnalysisResult {
  if (!isCompletedAnalysis(outcome)) {
    return outcome;
  }
  if (analysisResultRows(outcome) > policy.maxResultRows) {
    return budgetOutcome(request, "RESULT_ROWS");
  }
  if (serializedBytes(outcome.payload) > policy.maxResultBytes) {
    return budgetOutcome(request, "RESULT_BYTES");
  }
  return outcome;
}

function analysisResultBytes(outcome: AnalysisResult): number {
  return serializedBytes(
    isCompletedAnalysis(outcome) ? outcome.payload : outcome,
  );
}

function analysisObservation(
  cacheState: AnalysisOperationObservation["cacheState"],
  queueWaitMs: number | null,
  queryMs: number | null,
  outcome: AnalysisResult,
  resultBytes = analysisResultBytes(outcome),
): AnalysisOperationObservation {
  return {
    cacheState,
    queueWaitMs,
    queryMs,
    resultBytes,
    ...analysisDetailsFor(outcome),
  };
}

function analysisDetailsFor(
  outcome: AnalysisResult,
): Pick<
  AnalysisOperationObservation,
  | "recipeVersion"
  | "outcomeState"
  | "rejectionReason"
  | "scanRows"
  | "resultRows"
> {
  const tradeExplorerBudget =
    outcome.recipe === "trade-explorer-v1" && outcome.state === "success"
      ? outcome.payload.budget.actual
      : null;
  return {
    recipeVersion: outcome.recipe,
    outcomeState: outcome.state,
    rejectionReason: rejectionReasonFor(outcome),
    scanRows: tradeExplorerBudget?.scanRows,
    resultRows: tradeExplorerBudget?.resultRows,
  };
}

function rejectionReasonFor(
  outcome: AnalysisResult,
): AnalysisOperationObservation["rejectionReason"] {
  switch (outcome.state) {
    case "budget":
      return outcome.error.budget;
    case "rate-limit":
      return "SOURCE_REQUEST_LIMIT";
    case "capacity":
      return outcome.error.reason;
    case "success":
    case "empty":
    case "invalid-input":
    case "incompatible-package":
    case "retired":
    case "temporary-unavailability":
      return null;
  }
}

function budgetOutcome(
  request: AnalysisQuery,
  budget: Extract<
    Extract<AnalysisResult, { state: "budget" }>["error"]["budget"],
    "INPUT_CARDINALITY" | "RESULT_ROWS" | "RESULT_BYTES"
  >,
): AnalysisResult {
  return {
    state: "budget",
    ...unresolvedOutcome(request),
    error: {
      code: "ANALYSIS_BUDGET_EXCEEDED",
      budget,
    },
  };
}

function rateLimitOutcome(
  request: AnalysisQuery,
  retryAfterSeconds: number,
): AnalysisResult {
  return {
    state: "rate-limit",
    ...unresolvedOutcome(request),
    error: {
      code: "ANALYSIS_RATE_LIMITED",
      retryAfterSeconds,
    },
  };
}

function capacityOutcome(
  request: AnalysisQuery,
  error: AnalysisCapacityExceededError,
): AnalysisResult {
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

function unresolvedOutcome(
  request: AnalysisQuery,
): Readonly<{
  recipe: AnalysisRecipe;
  analysisIdentity: null;
  datasetPackageIdentity: null;
  normalizedInputs: null;
}> {
  return {
    recipe: request.recipe,
    analysisIdentity: null,
    datasetPackageIdentity: null,
    normalizedInputs: null,
  };
}

function resolveAnalysisBudget(
  override: Partial<AnalysisBudgetPolicy> | undefined,
): AnalysisBudgetPolicy {
  const policy = {
    ...RUNTIME_RESOURCE_POLICY.analysisBudget,
    ...override,
    maxTradeExplorerInputBytes:
      override?.maxTradeExplorerInputBytes ??
      override?.maxInputBytes ??
      RUNTIME_RESOURCE_POLICY.analysisBudget.maxTradeExplorerInputBytes,
  };
  if (
    !Number.isSafeInteger(policy.maxInputBytes) ||
    policy.maxInputBytes < 1 ||
    !Number.isSafeInteger(policy.maxTradeExplorerInputBytes) ||
    policy.maxTradeExplorerInputBytes < 1 ||
    !Number.isSafeInteger(policy.maxResultRows) ||
    policy.maxResultRows < 0 ||
    !Number.isSafeInteger(policy.maxResultBytes) ||
    policy.maxResultBytes < 1
  ) {
    throw new TypeError("Analysis budget policy is invalid.");
  }
  return policy;
}

function resolveAnonymousSourceRateLimit(
  override: Partial<AnonymousSourceRateLimitPolicy> | undefined,
): AnonymousSourceRateLimitPolicy {
  const policy = {
    ...RUNTIME_RESOURCE_POLICY.anonymousSourceRateLimit,
    ...override,
  };
  if (
    !Number.isFinite(policy.capacity) ||
    policy.capacity <= 0 ||
    !Number.isFinite(policy.refillTokensPerSecond) ||
    policy.refillTokensPerSecond <= 0 ||
    !Number.isSafeInteger(policy.maxTrackedSources) ||
    policy.maxTrackedSources < 1 ||
    !Number.isSafeInteger(policy.inactiveSourceRetentionMs) ||
    policy.inactiveSourceRetentionMs < 0
  ) {
    throw new TypeError("Anonymous source rate-limit policy is invalid.");
  }
  return policy;
}

function deploymentIdentity(
  deployment: ReturnType<ApplicationRuntime["currentAnalysis"]>,
): string {
  return [
    deployment.analysisBuildId,
    deployment.productSearchBuildId,
    deployment.source.baciRelease,
  ].join("\u0000");
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

function operationTiming(): OperationTiming {
  return {
    queueWaitMs: null,
    queryMs: null,
    resultBytes: 0,
  };
}

type QueuedAnalysis = {
  readonly controller: AbortController;
  readonly execute: () => AnalysisPromise;
  readonly resolve: (result: Awaited<AnalysisPromise>) => void;
  readonly reject: (error: unknown) => void;
  readonly queuedAt: number;
  readonly timing: OperationTiming;
  onAbort?: () => void;
};

type QueuedAnalysisGroup = {
  readonly members: QueuedAnalysis[];
  state: "collecting" | "queued" | "running" | "settled";
  waitTimer?: ReturnType<typeof setTimeout>;
};

type AnalysisExecutionGroup = {
  run(
    controller: AbortController,
    execute: () => AnalysisPromise,
    timing: OperationTiming,
  ): AnalysisPromise;
  seal(): void;
};

class AnalysisExecutionCoordinator {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly queueWaitTimeoutMs: number;
  private readonly analysisTimeoutMs: number;
  private readonly queue: QueuedAnalysisGroup[] = [];
  private active = 0;
  private activeMembers = 0;

  constructor(options: BoundedApplicationRuntimeOptions) {
    this.maxConcurrent =
      options.maxConcurrentAnalyses ??
      RUNTIME_RESOURCE_POLICY.maxConcurrentAnalyses;
    this.maxQueued =
      options.maxQueuedAnalyses ??
      RUNTIME_RESOURCE_POLICY.maxQueuedAnalyses;
    this.queueWaitTimeoutMs =
      options.queueWaitTimeoutMs ??
      RUNTIME_RESOURCE_POLICY.queueWaitTimeoutMs;
    this.analysisTimeoutMs =
      options.analysisTimeoutMs ??
      RUNTIME_RESOURCE_POLICY.analysisTimeoutMs;
  }

  resources(): {
    active: number;
    queued: number;
    activeMembers: number;
    queuedMembers: number;
    maxConcurrent: number;
    maxQueued: number;
  } {
    return {
      active: this.active,
      queued: this.queue.length,
      activeMembers: this.activeMembers,
      queuedMembers: this.queue.reduce(
        (total, group) => total + group.members.length,
        0,
      ),
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
    };
  }

  run(
    controller: AbortController,
    execute: () => AnalysisPromise,
    timing: OperationTiming,
  ): AnalysisPromise {
    const group = this.createGroup();
    const operation = group.run(controller, execute, timing);
    group.seal();
    return operation;
  }

  createGroup(): AnalysisExecutionGroup {
    const group: QueuedAnalysisGroup = {
      members: [],
      state: "collecting",
    };
    return {
      run: (controller, execute, timing) =>
        this.addToGroup(group, controller, execute, timing),
      seal: () => this.sealGroup(group),
    };
  }

  private addToGroup(
    group: QueuedAnalysisGroup,
    controller: AbortController,
    execute: () => AnalysisPromise,
    timing: OperationTiming,
  ): AnalysisPromise {
    if (group.state !== "collecting") {
      return Promise.reject(
        new TypeError("Cannot add analysis work to a sealed execution group."),
      );
    }
    if (controller.signal.aborted) {
      return Promise.reject(abortError());
    }

    return new Promise((resolve, reject) => {
      group.members.push({
        controller,
        execute,
        resolve,
        reject,
        queuedAt: performance.now(),
        timing,
      });
    });
  }

  private sealGroup(group: QueuedAnalysisGroup): void {
    if (group.state !== "collecting") {
      return;
    }
    this.removeAbortedMembers(group);
    if (group.members.length === 0) {
      group.state = "settled";
      return;
    }
    if (this.active < this.maxConcurrent) {
      this.startGroup(group);
      return;
    }
    if (this.queue.length >= this.maxQueued) {
      group.state = "settled";
      const now = performance.now();
      for (const member of group.members) {
        member.timing.queueWaitMs = now - member.queuedAt;
        member.reject(new AnalysisCapacityExceededError("queue-full"));
      }
      return;
    }

    group.state = "queued";
    this.queue.push(group);
    for (const member of group.members) {
      const onAbort = () => {
        this.removeQueuedMember(group, member);
      };
      member.onAbort = onAbort;
      member.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
    }
    group.waitTimer = setTimeout(() => {
      if (group.state !== "queued") {
        return;
      }
      const index = this.queue.indexOf(group);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
      this.clearQueueWait(group);
      group.state = "settled";
      const now = performance.now();
      for (const member of group.members) {
        member.timing.queueWaitMs = now - member.queuedAt;
        const error = new AnalysisCapacityExceededError("queue-timeout");
        member.controller.abort(error);
        member.reject(error);
      }
    }, this.queueWaitTimeoutMs);
  }

  private startGroup(group: QueuedAnalysisGroup): void {
    this.clearQueueWait(group);
    this.removeAbortedMembers(group);
    if (group.members.length === 0) {
      group.state = "settled";
      return;
    }
    group.state = "running";
    this.active += 1;
    this.activeMembers += group.members.length;
    let remaining = group.members.length;
    const memberSettled = () => {
      this.activeMembers -= 1;
      remaining -= 1;
      if (remaining !== 0) {
        return;
      }
      group.state = "settled";
      this.active -= 1;
      this.drain();
    };
    for (const member of group.members) {
      this.startMember(member, memberSettled);
    }
  }

  private startMember(
    queued: QueuedAnalysis,
    settled: () => void,
  ): void {
    queued.timing.queueWaitMs =
      performance.now() - queued.queuedAt;
    const queryStartedAt = performance.now();
    let timedOut = false;
    const executionTimer = setTimeout(() => {
      timedOut = true;
      queued.controller.abort(
        new AnalysisCapacityExceededError("execution-timeout"),
      );
    }, this.analysisTimeoutMs);

    void Promise.resolve()
      .then(queued.execute)
      .then(
        (result) => {
          if (timedOut) {
            queued.reject(
              new AnalysisCapacityExceededError("execution-timeout"),
            );
            return;
          }
          queued.resolve(result);
        },
        (error: unknown) => {
          queued.reject(
            timedOut
              ? new AnalysisCapacityExceededError("execution-timeout")
              : error,
          );
        },
      )
      .finally(() => {
        queued.timing.queryMs =
          performance.now() - queryStartedAt;
        clearTimeout(executionTimer);
        settled();
      });
  }

  private drain(): void {
    while (
      this.active < this.maxConcurrent &&
      this.queue.length > 0
    ) {
      const group = this.queue.shift()!;
      if (group.state !== "queued") {
        continue;
      }
      this.startGroup(group);
    }
  }

  private removeQueuedMember(
    group: QueuedAnalysisGroup,
    member: QueuedAnalysis,
  ): void {
    if (group.state !== "queued") {
      return;
    }
    const memberIndex = group.members.indexOf(member);
    if (memberIndex === -1) {
      return;
    }
    group.members.splice(memberIndex, 1);
    this.clearMemberAbort(member);
    member.reject(member.controller.signal.reason ?? abortError());
    if (group.members.length > 0) {
      return;
    }
    const groupIndex = this.queue.indexOf(group);
    if (groupIndex !== -1) {
      this.queue.splice(groupIndex, 1);
    }
    this.clearQueueWait(group);
    group.state = "settled";
  }

  private removeAbortedMembers(group: QueuedAnalysisGroup): void {
    for (let index = group.members.length - 1; index >= 0; index -= 1) {
      const member = group.members[index]!;
      if (!member.controller.signal.aborted) {
        continue;
      }
      group.members.splice(index, 1);
      this.clearMemberAbort(member);
      member.reject(member.controller.signal.reason ?? abortError());
    }
  }

  private clearQueueWait(group: QueuedAnalysisGroup): void {
    if (group.waitTimer !== undefined) {
      clearTimeout(group.waitTimer);
      group.waitTimer = undefined;
    }
    for (const member of group.members) {
      this.clearMemberAbort(member);
    }
  }

  private clearMemberAbort(member: QueuedAnalysis): void {
    if (member.onAbort !== undefined) {
      member.controller.signal.removeEventListener(
        "abort",
        member.onAbort,
      );
      member.onAbort = undefined;
    }
  }
}

type AnonymousSourceBucket = {
  tokens: number;
  refilledAt: number;
  accessedAt: number;
};

class AnonymousSourceRateLimiter {
  private readonly buckets = new Map<string, AnonymousSourceBucket>();

  constructor(
    private readonly policy: AnonymousSourceRateLimitPolicy,
    private readonly now: () => number,
  ) {}

  consume(source: string): number | null {
    const now = this.now();
    this.evictInactive(now);
    let bucket = this.buckets.get(source);
    if (bucket === undefined) {
      this.evictToCapacity();
      bucket = {
        tokens: this.policy.capacity,
        refilledAt: now,
        accessedAt: now,
      };
      this.buckets.set(source, bucket);
    } else {
      const elapsedMs = Math.max(0, now - bucket.refilledAt);
      bucket.tokens = Math.min(
        this.policy.capacity,
        bucket.tokens +
          (elapsedMs * this.policy.refillTokensPerSecond) / 1_000,
      );
      bucket.refilledAt = now;
      bucket.accessedAt = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return null;
    }
    return Math.max(
      1,
      Math.ceil(
        (1 - bucket.tokens) / this.policy.refillTokensPerSecond,
      ),
    );
  }

  private evictInactive(now: number): void {
    for (const [source, bucket] of this.buckets) {
      if (now - bucket.accessedAt > this.policy.inactiveSourceRetentionMs) {
        this.buckets.delete(source);
      }
    }
  }

  private evictToCapacity(): void {
    while (this.buckets.size >= this.policy.maxTrackedSources) {
      const oldest = [...this.buckets.entries()].reduce(
        (current, entry) =>
          current === undefined || entry[1].accessedAt < current[1].accessedAt
            ? entry
            : current,
        undefined as [string, AnonymousSourceBucket] | undefined,
      );
      if (oldest === undefined) {
        return;
      }
      this.buckets.delete(oldest[0]);
    }
  }
}
