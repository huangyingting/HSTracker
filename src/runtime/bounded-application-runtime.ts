import { validateProductSearchQuery } from "../catalog/validate-product-search-query";
import { validateCandidateMarketAnalysisQuery } from "../domain/candidate-market/analyze-candidate-markets";
import { normalizeEconomyQuery } from "../economy/economy-search";
import { validateEconomySearchQuery } from "../economy/economy-search";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import type {
  ApplicationRuntime,
  RuntimeRequestOptions,
} from "./application-runtime";
import { AnalysisCapacityExceededError } from "./analysis-capacity-error";
import { ByteWeightedLru } from "./byte-weighted-lru";
import {
  CACHE_ENTRY_OVERHEAD_BYTES,
  serializedBytes,
} from "./serialized-size";

type AnalysisQuery = Parameters<ApplicationRuntime["analyze"]>[0];
type AnalysisPromise = ReturnType<ApplicationRuntime["analyze"]>;
type AnalysisResult = Awaited<AnalysisPromise>;
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

  return {
    currentAnalysis: () => inner.currentAnalysis(),
    currentAnalysisSnapshot: () => inner.currentAnalysisSnapshot(),
    resolveFreshnessStatus: (freshnessStatusId) =>
      inner.resolveFreshnessStatus(freshnessStatusId),
    normalizeProductSearchQuery: (query) =>
      inner.normalizeProductSearchQuery(query),
    health: (buildId) => inner.health(buildId),
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
    analyze(query, options) {
      if (options?.signal?.aborted) {
        return Promise.reject(abortError());
      }
      try {
        validateCandidateMarketAnalysisQuery(query);
      } catch (error) {
        return Promise.reject(error);
      }

      const activeDeployment = synchronizeActiveDeployment();
      if (query.analysisBuildId !== activeDeployment.analysisBuildId) {
        return inner.analyze(query, options);
      }

      const key = analysisKey(query);
      const cached = analysisCache.lookup(key);
      if (cached !== undefined) {
        options?.observe?.({
          cacheState: "hit",
          queueWaitMs: null,
          queryMs: null,
          resultBytes: cached.resultBytes,
        });
        return Promise.resolve(cached.value);
      }

      let shared = analyses.get(key);
      let cacheState: "coalesced" | "miss" = "coalesced";
      if (!shared) {
        cacheState = "miss";
        const generation = cacheGeneration;
        const timing = operationTiming();
        shared = startSharedAnalysis(
          inner,
          query,
          key,
          analyses,
          execution,
          (result, resultBytes) => {
            if (cacheGeneration === generation) {
              analysisCache.set(
                key,
                result,
                resultBytes + CACHE_ENTRY_OVERHEAD_BYTES,
              );
            }
          },
          timing,
        );
        analyses.set(key, shared);
      }

      return waitForSharedOperation(shared, options, cacheState);
    },
  };
}

function startSharedAnalysis(
  inner: ApplicationRuntime,
  query: AnalysisQuery,
  key: string,
  analyses: Map<string, SharedAnalysis>,
  execution: AnalysisExecutionCoordinator,
  admitResult: (
    result: Awaited<AnalysisPromise>,
    resultBytes: number,
  ) => void,
  timing: OperationTiming,
): SharedAnalysis {
  const shared = startSharedOperation(
    (controller) =>
      execution.run(
        controller,
        () => inner.analyze(query, { signal: controller.signal }),
        timing,
      ),
    admitResult,
    () => {
      if (analyses.get(key) === shared) {
        analyses.delete(key);
      }
    },
    timing,
  );
  return shared;
}

function startSharedOperation<Result>(
  execute: (controller: AbortController) => Promise<Result>,
  admitResult: (result: Result, resultBytes: number) => void,
  remove: () => void,
  timing: OperationTiming,
  options: { measureQueryTiming?: boolean } = {},
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
        timing.resultBytes = serializedBytes(result);
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

function analysisKey(query: AnalysisQuery): string {
  return [
    query.analysisBuildId,
    query.exporterCode,
    query.productCode,
  ].join("\u0000");
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
    queueWaitMs: 0,
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
  waitTimer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
};

class AnalysisExecutionCoordinator {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly queueWaitTimeoutMs: number;
  private readonly analysisTimeoutMs: number;
  private readonly queue: QueuedAnalysis[] = [];
  private active = 0;

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
    maxConcurrent: number;
    maxQueued: number;
  } {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
    };
  }

  run(
    controller: AbortController,
    execute: () => AnalysisPromise,
    timing: OperationTiming,
  ): AnalysisPromise {
    if (controller.signal.aborted) {
      return Promise.reject(abortError());
    }

    return new Promise((resolve, reject) => {
      const queued: QueuedAnalysis = {
        controller,
        execute,
        resolve,
        reject,
        queuedAt: performance.now(),
        timing,
      };

      if (this.active < this.maxConcurrent) {
        this.start(queued);
        return;
      }
      if (this.queue.length >= this.maxQueued) {
        timing.queueWaitMs = performance.now() - queued.queuedAt;
        reject(new AnalysisCapacityExceededError("queue-full"));
        return;
      }

      const onAbort = () => {
        const index = this.queue.indexOf(queued);
        if (index === -1) {
          return;
        }
        this.queue.splice(index, 1);
        this.clearQueueWait(queued);
        reject(controller.signal.reason ?? abortError());
      };
      queued.onAbort = onAbort;
      controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      queued.waitTimer = setTimeout(() => {
        const index = this.queue.indexOf(queued);
        if (index === -1) {
          return;
        }
        this.queue.splice(index, 1);
        this.clearQueueWait(queued);
        queued.timing.queueWaitMs =
          performance.now() - queued.queuedAt;
        const error = new AnalysisCapacityExceededError("queue-timeout");
        controller.abort(error);
        reject(error);
      }, this.queueWaitTimeoutMs);
      this.queue.push(queued);
    });
  }

  private start(queued: QueuedAnalysis): void {
    this.clearQueueWait(queued);
    queued.timing.queueWaitMs =
      performance.now() - queued.queuedAt;
    this.active += 1;
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
        this.active -= 1;
        this.drain();
      });
  }

  private drain(): void {
    while (
      this.active < this.maxConcurrent &&
      this.queue.length > 0
    ) {
      const queued = this.queue.shift()!;
      if (queued.controller.signal.aborted) {
        this.clearQueueWait(queued);
        queued.reject(queued.controller.signal.reason ?? abortError());
        continue;
      }
      this.start(queued);
    }
  }

  private clearQueueWait(queued: QueuedAnalysis): void {
    if (queued.waitTimer !== undefined) {
      clearTimeout(queued.waitTimer);
      queued.waitTimer = undefined;
    }
    if (queued.onAbort !== undefined) {
      queued.controller.signal.removeEventListener(
        "abort",
        queued.onAbort,
      );
      queued.onAbort = undefined;
    }
  }
}
