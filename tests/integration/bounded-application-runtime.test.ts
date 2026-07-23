import { describe, expect, it } from "vitest";

import {
  createFixtureApplicationRuntime,
  type ApplicationRuntime,
} from "../../src/runtime/application-runtime";
import type {
  AnalysisExecutionOptions,
  AnalysisOutcome,
  AnalysisRequest,
  CandidateMarketV1AnalysisRequest,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import { createMarketAnalysis } from "../../src/domain/market-analysis/market-analysis";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { RUNTIME_RESOURCE_POLICY } from "../../src/runtime-resource-policy";
import { createAnonymousSourceHttpAdapter } from "../../src/http/anonymous-source-adapter";

const query = {
  recipe: "candidate-market-v1" as const,
  analysisBuildId: "acceptance-fixtures-v1",
  exporterCode: "156",
  productCode: "010121",
};
const tradeTrendQuery = {
  recipe: "trade-trend-v1" as const,
  analysisBuildId: "acceptance-fixtures-v1",
  importerCode: "156",
  productCode: "010121",
};
const supplierCompetitionQuery = {
  recipe: "supplier-competition-v1" as const,
  analysisBuildId: "acceptance-fixtures-v1",
  importerCode: "124",
  productCode: "010121",
};
const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: {
    clientAddressHeader: "x-hs-tracker-client-address",
    trustedProxyHops: 0,
  },
  secret: "bounded-runtime-test-source",
});

function anonymousSource(address: string) {
  return anonymousSourceAdapter.executionOptions(
    new Request("http://localhost", {
      headers: { "X-HS-Tracker-Client-Address": address },
    }),
  ).anonymousSource;
}

describe("bounded application runtime", () => {
  it("uses distinct recipe-aware cache and coalescing keys for Trade Trend and Candidate Market", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          request: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          computations += 1;
          return fixture.tradeAnalytics.execute(request, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const cacheStates: string[] = [];
    const observe = (observation: { cacheState: string }) =>
      cacheStates.push(observation.cacheState);

    await runtime.tradeAnalytics.execute(query, { observe });
    await runtime.tradeAnalytics.execute(tradeTrendQuery, { observe });
    await runtime.tradeAnalytics.execute(query, { observe });
    await runtime.tradeAnalytics.execute(tradeTrendQuery, { observe });

    expect(computations).toBe(2);
    expect(cacheStates).toEqual(["miss", "miss", "hit", "hit"]);
  });

  it("extends the same recipe-aware cache and validation protections to a third recipe (Supplier Competition)", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          request: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          computations += 1;
          return fixture.tradeAnalytics.execute(request, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const cacheStates: string[] = [];
    const observe = (observation: { cacheState: string }) =>
      cacheStates.push(observation.cacheState);

    await runtime.tradeAnalytics.execute(query, { observe });
    await runtime.tradeAnalytics.execute(tradeTrendQuery, { observe });
    await runtime.tradeAnalytics.execute(supplierCompetitionQuery, { observe });
    await runtime.tradeAnalytics.execute(query, { observe });
    await runtime.tradeAnalytics.execute(tradeTrendQuery, { observe });
    await runtime.tradeAnalytics.execute(supplierCompetitionQuery, { observe });

    expect(computations).toBe(3);
    expect(cacheStates).toEqual([
      "miss",
      "miss",
      "miss",
      "hit",
      "hit",
      "hit",
    ]);

    const malformed = await runtime.tradeAnalytics.execute({
      ...supplierCompetitionQuery,
      productCode: "malformed",
    });
    expect(malformed).toMatchObject({
      state: "invalid-input",
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("rejects a Supplier Competition result-row budget before caching it or admitting more analytical work", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          request: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          computations += 1;
          return fixture.tradeAnalytics.execute(request, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      analysisBudget: { maxResultRows: 1 },
    });

    await expect(
      runtime.tradeAnalytics.execute(supplierCompetitionQuery),
    ).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "RESULT_ROWS",
      },
    });

    expect(computations).toBe(1);
    expect(runtime.resources().caches.analysis.entries).toBe(0);
  });

  it("counts overlapping finalized and provisional suppliers as one logical result row", async () => {
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
      {
        analysisBudget: { maxResultRows: 4 },
      },
    );

    const outcome = await runtime.tradeAnalytics.execute(
      supplierCompetitionQuery,
    );

    expect(outcome).toMatchObject({
      state: "success",
      payload: { cohortSize: 4 },
    });
    if (outcome.state !== "success") {
      throw new TypeError("Expected Supplier Competition to succeed.");
    }
    expect(outcome.payload.supplierShares).toHaveLength(4);
    expect(outcome.payload.provisionalSupplierShares).toHaveLength(4);
    expect(
      outcome.payload.supplierShares.map(({ economy }) => economy.code),
    ).toContain("156");
    expect(
      outcome.payload.provisionalSupplierShares.map(
        ({ economy }) => economy.code,
      ),
    ).toContain("156");
  });

  it("reserves the accepted 128-MiB process-cache allocation", () => {
    expect({
      analysis: RUNTIME_RESOURCE_POLICY.analysisCacheMaxBytes,
      search: RUNTIME_RESOURCE_POLICY.searchCacheMaxBytes,
      status: RUNTIME_RESOURCE_POLICY.statusMicroCacheMaxBytes,
      reserve: RUNTIME_RESOURCE_POLICY.cacheSafetyReserveBytes,
      total:
        RUNTIME_RESOURCE_POLICY.analysisCacheMaxBytes +
        RUNTIME_RESOURCE_POLICY.searchCacheMaxBytes +
        RUNTIME_RESOURCE_POLICY.statusMicroCacheMaxBytes +
        RUNTIME_RESOURCE_POLICY.cacheSafetyReserveBytes,
    }).toEqual({
      analysis: 96 * 1024 * 1024,
      search: 16 * 1024 * 1024,
      status: 1024 * 1024,
      reserve: 15 * 1024 * 1024,
      total: 128 * 1024 * 1024,
    });
  });

  it("coalesces ten identical Candidate Market requests into one computation", async () => {
    const fixture = createFixtureApplicationRuntime();
    const computation = deferred<void>();
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async (request, options) => {
        computations += 1;
        await computation.promise;
        return fixture.tradeAnalytics.execute(request, options);
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);

    const pending = Array.from({ length: 10 }, () =>
      runtime.tradeAnalytics.execute(query),
    );
    await Promise.resolve();

    expect(computations).toBe(1);
    computation.resolve();
    const results = await Promise.all(pending);
    expect(results).toHaveLength(10);
    expect(results.every((result) => result === results[0])).toBe(true);
    expect(results[0]).toMatchObject({
      state: "success",
      payload: { candidates: expect.any(Array) },
    });
  });

  it("partitions analysis cache entries for external probe samples", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async (request, requestOptions) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, requestOptions);
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);
    const cacheStates: string[] = [];
    const options = (cachePartitionKey: string) => ({
      cachePartitionKey,
      observe: (observation: { cacheState: string }) => {
        cacheStates.push(observation.cacheState);
      },
    });

    await runtime.tradeAnalytics.execute(query, options("sample-a"));
    await runtime.tradeAnalytics.execute(query, options("sample-a"));
    await runtime.tradeAnalytics.execute(query, options("sample-b"));

    expect(computations).toBe(2);
    expect(cacheStates).toEqual(["miss", "hit", "miss"]);
  });

  it("isolates a disconnected waiter from a shared computation", async () => {
    const fixture = createFixtureApplicationRuntime();
    const computation = deferred<void>();
    let computations = 0;
    let sharedSignal: AbortSignal | undefined;
    const inner = runtimeWithExecution(
      fixture,
      async (request, options) => {
        computations += 1;
        sharedSignal = options?.signal;
        await computation.promise;
        return fixture.tradeAnalytics.execute(request, options);
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);
    const disconnectedWaiter = new AbortController();

    const first = runtime.tradeAnalytics.execute(query, {
      signal: disconnectedWaiter.signal,
    });
    const second = runtime.tradeAnalytics.execute(query);
    disconnectedWaiter.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(false);
    expect(computations).toBe(1);

    computation.resolve();
    await expect(second).resolves.toMatchObject({
      state: "success",
      payload: {
        analysisBuildId: query.analysisBuildId,
        candidates: expect.any(Array),
      },
    });
  });

  it("runs three workers across four groups and queues sixteen more in FIFO order", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const computation = deferred<void>();
    const starts: string[] = [];
    const inner = runtimeWithExecution(
      fixture,
      async (request) => {
        starts.push(request.productCode);
        await computation.promise;
        return expected;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);
    const productCodes = Array.from({ length: 21 }, (_, index) =>
      String(index).padStart(6, "0"),
    );

    const admitted = productCodes.slice(0, 20).map((productCode) =>
      runtime.tradeAnalytics.execute({
        ...query,
        productCode,
      }),
    );
    const rejected = runtime.tradeAnalytics.execute({
      ...query,
      productCode: productCodes[20]!,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(productCodes.slice(0, 3));
    await expect(rejected).resolves.toMatchObject({
      state: "capacity",
      error: {
        code: "ANALYSIS_CAPACITY_EXCEEDED",
        retryAfterSeconds: 2,
        reason: "queue-full",
      },
    });

    computation.resolve();
    await Promise.all(admitted);
    expect(starts).toEqual(productCodes.slice(0, 20));
  });

  it("admits each composite Market Analysis request as one bounded operation", async () => {
    const fixture = createFixtureApplicationRuntime();
    let starts = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          request: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          starts += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return fixture.tradeAnalytics.execute(request, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 2,
      maxQueuedAnalyses: 16,
      queueWaitTimeoutMs: 1_000,
      analysisTimeoutMs: 1_000,
    });
    const marketAnalysis = createMarketAnalysis(runtime.tradeAnalytics);

    const pending = Array.from({ length: 7 }, (_, index) =>
        marketAnalysis.load(
          {
            analysisBuildId: "acceptance-fixtures-v1",
            exportEconomyCode: "156",
            productCode: "010121",
            marketCode: "528",
          },
          { cachePartitionKey: `market-analysis-capacity-${index}` },
        ),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toBe(3);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 2,
      queued: 5,
      activeMembers: 3,
      queuedMembers: 18,
    });

    const results = await Promise.all(pending);

    expect(results).toHaveLength(7);
    expect(
      results.every((result) => result.schemaVersion === "market-analysis-v1"),
    ).toBe(true);
  });

  it("does not oversubscribe physical executors with composite members", async () => {
    const fixture = createFixtureApplicationRuntime();
    const workers = deferred<void>();
    const starts: AnalysisRequest["recipe"][] = [];
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          request: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          starts.push(request.recipe);
          await workers.promise;
          return fixture.tradeAnalytics.execute(request, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 4,
      maxQueuedAnalyses: 16,
      queueWaitTimeoutMs: 1_000,
      analysisTimeoutMs: 1_000,
    });
    const marketAnalysis = createMarketAnalysis(runtime.tradeAnalytics);

    const pending = Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        marketAnalysis.load(
          {
            analysisBuildId: "acceptance-fixtures-v1",
            exportEconomyCode: "156",
            productCode: "010121",
            marketCode: "528",
          },
          { cachePartitionKey: `market-analysis-workers-${index}` },
        ),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toHaveLength(3);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 4,
      activeMembers: 3,
      queuedMembers: 9,
    });

    workers.resolve();
    await pending;
  });

  it("starts the execution deadline only after a member gets a worker", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const firstComputation = deferred<void>();
    const starts: string[] = [];
    const inner = runtimeWithExecution(
      fixture,
      async (request) => {
        starts.push(request.productCode);
        if (request.productCode === "000001") {
          await firstComputation.promise;
        }
        return expected;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 2,
      maxConcurrentAnalysisMembers: 1,
      queueWaitTimeoutMs: 100,
      analysisTimeoutMs: 10,
    });
    const first = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000001",
    });
    const second = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000002",
    });
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(starts).toEqual(["000001"]);
    expect(secondSettled).toBe(false);

    firstComputation.resolve();
    await expect(first).resolves.toMatchObject({
      state: "capacity",
      error: { reason: "execution-timeout" },
    });
    await expect(second).resolves.toMatchObject({ state: "success" });
    expect(starts).toEqual(["000001", "000002"]);
  });

  it("rejects a computation that exceeds the queue-wait deadline", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const firstComputation = deferred<void>();
    const starts: string[] = [];
    const inner = runtimeWithExecution(
      fixture,
      async (request) => {
        starts.push(request.productCode);
        if (request.productCode === "000001") {
          await firstComputation.promise;
        }
        return expected;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      maxQueuedAnalyses: 1,
      queueWaitTimeoutMs: 10,
    });

    const first = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000001",
    });
    const timedOut = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000002",
    });

    await expect(timedOut).resolves.toMatchObject({
      state: "capacity",
      error: {
        code: "ANALYSIS_CAPACITY_EXCEEDED",
        reason: "queue-timeout",
      },
    });
    expect(starts).toEqual(["000001"]);

    const replacement = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000003",
    });
    firstComputation.resolve();
    await Promise.all([first, replacement]);
    expect(starts).toEqual(["000001", "000003"]);
  });

  it("interrupts an overlong analysis before releasing its slot", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const interrupted = deferred<void>();
    const querySettled = deferred<void>();
    const starts: string[] = [];
    const inner = runtimeWithExecution(
      fixture,
      async (request, options) => {
        starts.push(request.productCode);
        if (request.productCode !== "000001") {
          return expected;
        }

        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              interrupted.resolve();
              resolve();
            },
            { once: true },
          );
        });
        await querySettled.promise;
        throw options?.signal?.reason;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      analysisTimeoutMs: 10,
    });

    const overlong = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000001",
    });
    const next = runtime.tradeAnalytics.execute({
      ...query,
      productCode: "000002",
    });

    await interrupted.promise;
    expect(starts).toEqual(["000001"]);

    querySettled.resolve();
    await expect(overlong).resolves.toMatchObject({
      state: "capacity",
      error: {
        code: "ANALYSIS_CAPACITY_EXCEEDED",
        reason: "execution-timeout",
      },
    });
    await expect(next).resolves.toBe(expected);
    expect(starts).toEqual(["000001", "000002"]);
  });

  it("evicts Candidate Market entries by byte-weighted access order", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const computations: string[] = [];
    const inner = runtimeWithExecution(
      fixture,
      async (request) => {
        computations.push(request.productCode);
        return expected;
      },
    );
    if (expected.state !== "success") {
      throw new TypeError(`Expected success, received ${expected.state}.`);
    }
    const entryWeight =
      new TextEncoder().encode(JSON.stringify(expected.payload)).byteLength +
      1_024;
    const runtime = createBoundedApplicationRuntime(inner, {
      analysisCacheMaxBytes: entryWeight * 2,
    });

    const execute = (productCode: string) =>
      runtime.tradeAnalytics.execute({ ...query, productCode });
    await execute("000001");
    await execute("000002");
    await execute("000001");
    await execute("000003");
    await execute("000002");

    expect(computations).toEqual([
      "000001",
      "000002",
      "000003",
      "000002",
    ]);
  });

  it("caches a valid empty Candidate Market result", async () => {
    const fixture = createFixtureApplicationRuntime();
    const emptyQuery = { ...query, productCode: "851712" };
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);

    await runtime.tradeAnalytics.execute(emptyQuery);
    await runtime.tradeAnalytics.execute(emptyQuery);

    expect(computations).toBe(1);
  });

  it("does not cache an analysis error", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = await fixture.tradeAnalytics.execute(query);
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async () => {
        computations += 1;
        if (computations === 1) {
          throw new Error("query failed");
        }
        return result;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);

    await expect(runtime.tradeAnalytics.execute(query)).rejects.toThrow(
      "query failed",
    );
    await expect(runtime.tradeAnalytics.execute(query)).resolves.toBe(result);
    await expect(runtime.tradeAnalytics.execute(query)).resolves.toBe(result);

    expect(computations).toBe(2);
  });

  it("returns but does not admit an oversized analysis entry", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = await fixture.tradeAnalytics.execute(query);
    if (result.state !== "success") {
      throw new TypeError(`Expected success, received ${result.state}.`);
    }
    const entryWeight =
      new TextEncoder().encode(JSON.stringify(result.payload)).byteLength +
      1_024;
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async () => {
        computations += 1;
        return result;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner, {
      analysisCacheMaxBytes: entryWeight - 1,
    });

    await expect(runtime.tradeAnalytics.execute(query)).resolves.toBe(result);
    await expect(runtime.tradeAnalytics.execute(query)).resolves.toBe(result);

    expect(computations).toBe(2);
  });

  it("invalidates analysis cache entries when the active deployment changes", async () => {
    const fixture = createFixtureApplicationRuntime();
    const originalManifest = fixture.currentAnalysis();
    let currentManifest = originalManifest;
    let computations = 0;
    const inner = runtimeWithExecution(fixture, async (request, options) => {
      computations += 1;
      return fixture.tradeAnalytics.execute(request, options);
    });
    const runtime: ApplicationRuntime = createBoundedApplicationRuntime({
      ...inner,
      currentAnalysis() {
        return currentManifest;
      },
    });

    await runtime.tradeAnalytics.execute(query);
    currentManifest = {
      ...originalManifest,
      analysisBuildId: "replacement-build",
    };
    await runtime.tradeAnalytics.execute(query);
    currentManifest = originalManifest;
    await runtime.tradeAnalytics.execute(query);

    expect(computations).toBe(3);
  });

  it("coalesces semantically identical product searches", async () => {
    const fixture = createFixtureApplicationRuntime();
    const productSearchBuildId =
      fixture.currentAnalysis().productSearchBuildId;
    const search = deferred<void>();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async searchProducts(request) {
        computations += 1;
        await search.promise;
        return fixture.searchProducts(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    const first = runtime.searchProducts({
      productSearchBuildId,
      query: "  LIVE--HORSES ",
      locale: "en",
      limit: 10,
    });
    const second = runtime.searchProducts({
      productSearchBuildId,
      query: "live horses",
      locale: "en",
      limit: 10,
    });
    await Promise.resolve();

    expect(computations).toBe(1);
    search.resolve();
    const [firstResult, secondResult] = await Promise.all([
      first,
      second,
    ]);
    expect(secondResult).toBe(firstResult);
  });

  it("uses the active catalog's bilingual normalization in product-search keys", async () => {
    const fixture = createFixtureApplicationRuntime();
    const productSearchBuildId =
      fixture.currentAnalysis().productSearchBuildId;
    const search = deferred<void>();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async searchProducts(request) {
        computations += 1;
        await search.promise;
        return fixture.searchProducts(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    const traditional = runtime.searchProducts({
      productSearchBuildId,
      query: "馬",
      locale: "zh-Hans",
      limit: 10,
    });
    const simplified = runtime.searchProducts({
      productSearchBuildId,
      query: "马",
      locale: "zh-Hans",
      limit: 10,
    });
    await Promise.resolve();

    expect(computations).toBe(1);
    search.resolve();
    await Promise.all([traditional, simplified]);
  });

  it("shares one byte-weighted cache partition across product and economy searches", async () => {
    const fixture = createFixtureApplicationRuntime();
    const manifest = fixture.currentAnalysis();
    const productResult = await fixture.searchProducts({
      productSearchBuildId: manifest.productSearchBuildId,
      query: "horse",
      locale: "en",
      limit: 10,
    });
    const economyResult = await fixture.searchEconomies({
      analysisBuildId: manifest.analysisBuildId,
      query: "china",
      limit: 10,
    });
    const productWeight =
      new TextEncoder().encode(JSON.stringify(productResult)).byteLength +
      1_024;
    const economyWeight =
      new TextEncoder().encode(JSON.stringify(economyResult)).byteLength +
      1_024;
    let productComputations = 0;
    let economyComputations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async searchProducts() {
        productComputations += 1;
        return productResult;
      },
      async searchEconomies() {
        economyComputations += 1;
        return economyResult;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      searchCacheMaxBytes: productWeight + economyWeight,
    });
    const productSearch = (searchQuery: string) =>
      runtime.searchProducts({
        productSearchBuildId: manifest.productSearchBuildId,
        query: searchQuery,
        locale: "en",
        limit: 10,
      });
    const economySearch = () =>
      runtime.searchEconomies({
        analysisBuildId: manifest.analysisBuildId,
        query: "china",
        limit: 10,
      });

    await productSearch("product one");
    await economySearch();
    await productSearch("product one");
    await productSearch("product two");
    await economySearch();

    expect(productComputations).toBe(2);
    expect(economyComputations).toBe(2);
  });

  it("caches a valid empty search result but not a search error", async () => {
    const fixture = createFixtureApplicationRuntime();
    const productSearchBuildId =
      fixture.currentAnalysis().productSearchBuildId;
    const emptyResult = await fixture.searchProducts({
      productSearchBuildId,
      query: "no-match-expected",
      locale: "en",
      limit: 10,
    });
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async searchProducts() {
        computations += 1;
        if (computations === 1) {
          throw new Error("search failed");
        }
        return emptyResult;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const search = () =>
      runtime.searchProducts({
        productSearchBuildId,
        query: "no-match-expected",
        locale: "en",
        limit: 10,
      });

    await expect(search()).rejects.toThrow("search failed");
    await expect(search()).resolves.toBe(emptyResult);
    await expect(search()).resolves.toBe(emptyResult);

    expect(emptyResult.matches).toEqual([]);
    expect(computations).toBe(2);
  });

  it("returns but does not admit an oversized search entry", async () => {
    const fixture = createFixtureApplicationRuntime();
    const productSearchBuildId =
      fixture.currentAnalysis().productSearchBuildId;
    const result = await fixture.searchProducts({
      productSearchBuildId,
      query: "horse",
      locale: "en",
      limit: 10,
    });
    const entryWeight =
      new TextEncoder().encode(JSON.stringify(result)).byteLength + 1_024;
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async searchProducts() {
        computations += 1;
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      searchCacheMaxBytes: entryWeight - 1,
    });
    const search = () =>
      runtime.searchProducts({
        productSearchBuildId,
        query: "horse",
        locale: "en",
        limit: 10,
      });

    await expect(search()).resolves.toBe(result);
    await expect(search()).resolves.toBe(result);

    expect(computations).toBe(2);
  });

  it("validates malformed analyses before capacity admission", async () => {
    const fixture = createFixtureApplicationRuntime();
    const computation = deferred<void>();
    const inner = runtimeWithExecution(
      fixture,
      async (request, options) => {
        if (request.productCode === query.productCode) {
          await computation.promise;
        }
        return fixture.tradeAnalytics.execute(request, options);
      },
    );
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      maxQueuedAnalyses: 0,
    });
    const active = runtime.tradeAnalytics.execute(query);

    await expect(
      runtime.tradeAnalytics.execute({
        ...query,
        productCode: "malformed",
      }),
    ).resolves.toMatchObject({
      state: "invalid-input",
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });

    computation.resolve();
    await active;
  });

  it("rejects canonical input over budget before it can acquire analytical capacity", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        analysisBudget: { maxInputBytes: 1 },
        maxConcurrentAnalyses: 0,
        maxQueuedAnalyses: 0,
      },
    );

    await expect(runtime.tradeAnalytics.execute(query)).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "INPUT_CARDINALITY",
      },
    });
    expect(computations).toBe(0);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 0,
      queued: 0,
    });
  });

  it("classifies oversized canonical input as a budget rejection before validation can load evidence", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        maxConcurrentAnalyses: 0,
        maxQueuedAnalyses: 0,
      },
    );

    await expect(
      runtime.tradeAnalytics.execute({
        ...query,
        analysisBuildId: "x".repeat(257),
      }),
    ).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "INPUT_CARDINALITY",
      },
    });
    expect(computations).toBe(0);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 0,
      queued: 0,
    });
  });

  it("measures raw economy input before semantic normalization", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
    );

    await expect(
      runtime.tradeAnalytics.execute({
        ...query,
        exporterCode: "1".repeat(257),
      }),
    ).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "INPUT_CARDINALITY",
      },
    });
    expect(computations).toBe(0);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 0,
      queued: 0,
    });
  });

  it("charges every source request, including a cache hit, and recovers after refill", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    let now = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        now: () => now,
        anonymousSourceRateLimit: {
          capacity: 1,
          refillTokensPerSecond: 1,
        },
      },
    );
    const options = { anonymousSource: anonymousSource("198.51.100.18") };

    await expect(runtime.tradeAnalytics.execute(query, options)).resolves.toMatchObject({
      state: "success",
    });
    await expect(runtime.tradeAnalytics.execute(query, options)).resolves.toMatchObject({
      state: "rate-limit",
      error: {
        code: "ANALYSIS_RATE_LIMITED",
        retryAfterSeconds: 1,
      },
    });

    now = 1_000;
    await expect(runtime.tradeAnalytics.execute(query, options)).resolves.toMatchObject({
      state: "success",
    });
    expect(computations).toBe(1);
  });

  it("charges coalesced source requests without duplicating their computation", async () => {
    const fixture = createFixtureApplicationRuntime();
    const release = deferred<void>();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        await release.promise;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        anonymousSourceRateLimit: {
          capacity: 2,
          refillTokensPerSecond: 1,
        },
      },
    );
    const options = { anonymousSource: anonymousSource("198.51.100.19") };

    const first = runtime.tradeAnalytics.execute(query, options);
    const second = runtime.tradeAnalytics.execute(query, options);
    await Promise.resolve();

    expect(computations).toBe(1);
    release.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "success" }),
      expect.objectContaining({ state: "success" }),
    ]);
    await expect(runtime.tradeAnalytics.execute(query, options)).resolves.toMatchObject({
      state: "rate-limit",
      error: { code: "ANALYSIS_RATE_LIMITED" },
    });
    expect(computations).toBe(1);
  });

  it("rejects a result-row budget before caching it or admitting more analytical work", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        analysisBudget: { maxResultRows: 12 },
      },
    );

    await expect(runtime.tradeAnalytics.execute(query)).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "RESULT_ROWS",
      },
    });
    await expect(runtime.tradeAnalytics.execute(query)).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "RESULT_ROWS",
      },
    });

    expect(computations).toBe(2);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 0,
      queued: 0,
    });
    expect(runtime.resources().caches.analysis.entries).toBe(0);
  });

  it("rejects an oversized serialized result before it enters the analysis cache", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const runtime = createBoundedApplicationRuntime(
      runtimeWithExecution(fixture, async (request, options) => {
        computations += 1;
        return fixture.tradeAnalytics.execute(request, options);
      }),
      {
        analysisBudget: { maxResultBytes: 1 },
      },
    );

    await expect(runtime.tradeAnalytics.execute(query)).resolves.toMatchObject({
      state: "budget",
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        budget: "RESULT_BYTES",
      },
    });
    expect(computations).toBe(1);
    expect(runtime.resources().analysisExecution).toMatchObject({
      active: 0,
      queued: 0,
    });
    expect(runtime.resources().caches.analysis.entries).toBe(0);
  });

  it("does not let malformed Trade Explorer inputs collide with a cached normalized code", async () => {
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    );
    const validRequest = {
      recipe: "trade-explorer-v1" as const,
      analysisBuildId: "acceptance-fixtures-v1",
      shape: "finalized-trend-v1" as const,
      dimensions: ["YEAR"] as const,
      measures: ["TRADE_VALUE_USD"] as const,
      filters: {
        year: { mode: "list" as const, years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    };

    await expect(
      runtime.tradeAnalytics.execute(validRequest),
    ).resolves.toMatchObject({ state: "success" });
    await expect(
      runtime.tradeAnalytics.execute({
        ...validRequest,
        filters: {
          ...validRequest.filters,
          exportEconomy: ["0156"],
        },
      }),
    ).resolves.toMatchObject({
      state: "invalid-input",
    });

    for (const malformed of [
      { ...validRequest, dimensions: null },
      { ...validRequest, measures: null },
      { ...validRequest, filters: null },
      { ...validRequest, analysisBuildId: null },
      { ...validRequest, analysisBuildId: 1n },
    ]) {
      const outcome = await runtime.tradeAnalytics.execute(
        malformed as unknown as AnalysisRequest,
      );
      expect(["invalid-input", "retired"]).toContain(outcome.state);
    }
  });

  it("coalesces equivalent Trade Explorer requests by normalized semantic inputs", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          analysisRequest: Request,
          options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          computations += 1;
          return fixture.tradeAnalytics.execute(analysisRequest, options);
        },
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const request = {
      recipe: "trade-explorer-v1" as const,
      analysisBuildId: "acceptance-fixtures-v1",
      shape: "importing-markets-v1" as const,
      dimensions: ["IMPORT_ECONOMY"] as const,
      measures: ["TRADE_VALUE_USD"] as const,
      filters: {
        year: { mode: "range" as const, start: 2023, end: 2023 },
        exportEconomy: ["156"],
        importEconomy: ["076"],
        hsProduct: ["010121"],
      },
      sort: null,
    };

    const first = await runtime.tradeAnalytics.execute(request);
    const second = await runtime.tradeAnalytics.execute({
      ...request,
      filters: {
        ...request.filters,
        year: { mode: "list", years: [2023] },
        importEconomy: ["76"],
      },
      sort: { key: "IMPORT_ECONOMY", direction: "asc" },
    });

    expect(first).toMatchObject({ state: "success" });
    expect(second).toMatchObject({
      state: "success",
      analysisIdentity:
        first.state === "success" ? first.analysisIdentity : undefined,
    });
    expect(computations).toBe(1);
    expect(runtime.resources().caches.analysis.entries).toBe(1);
  });

  it("validates raw search input before a normalized cache lookup", async () => {
    const fixture = createFixtureApplicationRuntime();
    const productSearchBuildId =
      fixture.currentAnalysis().productSearchBuildId;
    const runtime = createBoundedApplicationRuntime(fixture);

    await runtime.searchProducts({
      productSearchBuildId,
      query: "",
      locale: "en",
      limit: 10,
    });
    await expect(
      runtime.searchProducts({
        productSearchBuildId,
        query: "!".repeat(301),
        locale: "en",
        limit: 10,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PRODUCT_SEARCH_QUERY",
      status: 400,
    });
  });

  it("evicts retired product-search builds before cache lookup", async () => {
    const fixture = createFixtureApplicationRuntime();
    const originalManifest = fixture.currentAnalysis();
    const query = {
      productSearchBuildId: originalManifest.productSearchBuildId,
      query: "horse",
      locale: "en" as const,
      limit: 10,
    };
    const result = await fixture.searchProducts(query);
    let currentManifest = originalManifest;
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      currentAnalysis() {
        return currentManifest;
      },
      async searchProducts(request) {
        computations += 1;
        if (
          request.productSearchBuildId !==
          currentManifest.productSearchBuildId
        ) {
          throw new Error("retired product-search build");
        }
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    await runtime.searchProducts(query);
    currentManifest = {
      ...originalManifest,
      productSearchBuildId: "replacement-product-search",
    };
    await expect(runtime.searchProducts(query)).rejects.toThrow(
      "retired product-search build",
    );
    currentManifest = originalManifest;
    await runtime.searchProducts(query);

    expect(computations).toBe(3);
  });

  it("reports cache, queue, query, and result-byte observations without inventing hit query time", async () => {
    const fixture = createFixtureApplicationRuntime();
    const observations: unknown[] = [];
    const runtime = createBoundedApplicationRuntime(fixture);
    const observe = (observation: unknown) => {
      observations.push(observation);
    };
    const expected = await fixture.tradeAnalytics.execute(query);
    if (expected.state !== "success") {
      throw new TypeError(`Expected success, received ${expected.state}.`);
    }
    const resultBytes = new TextEncoder().encode(
      JSON.stringify(expected.payload),
    ).byteLength;

    await runtime.tradeAnalytics.execute(query, { observe });
    await runtime.tradeAnalytics.execute(query, { observe });

    expect(observations).toEqual([
      {
        cacheState: "miss",
        queueWaitMs: expect.any(Number),
        queryMs: expect.any(Number),
        resultBytes,
        recipeVersion: "candidate-market-v1",
        outcomeState: "success",
        rejectionReason: null,
      },
      {
        cacheState: "hit",
        queueWaitMs: null,
        queryMs: null,
        resultBytes,
        recipeVersion: "candidate-market-v1",
        outcomeState: "success",
        rejectionReason: null,
      },
    ]);
  });

  it("does not report queue time for unqueued search work", async () => {
    const fixture = createFixtureApplicationRuntime();
    const observations: unknown[] = [];
    const runtime = createBoundedApplicationRuntime(fixture);
    const search = {
      productSearchBuildId:
        fixture.currentAnalysis().productSearchBuildId,
      query: "horse",
      locale: "en" as const,
      limit: 10,
    };

    await runtime.searchProducts(search, {
      observe: (observation) => observations.push(observation),
    });
    await runtime.searchProducts(search, {
      observe: (observation) => observations.push(observation),
    });

    expect(observations).toEqual([
      {
        cacheState: "miss",
        queueWaitMs: null,
        queryMs: expect.any(Number),
        resultBytes: expect.any(Number),
      },
      {
        cacheState: "hit",
        queueWaitMs: null,
        queryMs: null,
        resultBytes: expect.any(Number),
      },
    ]);
  });

  it("admits the accepted twenty-session hot-key burst without rejection", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute(query);
    const release = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    let computations = 0;
    const inner = runtimeWithExecution(
      fixture,
      async () => {
        computations += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await release.promise;
        active -= 1;
        return expected;
      },
    );
    const runtime = createBoundedApplicationRuntime(inner);
    const hot = Array.from({ length: 16 }, () =>
      runtime.tradeAnalytics.execute(query),
    );
    const uncached = Array.from({ length: 4 }, (_, index) =>
      runtime.tradeAnalytics.execute({
        ...query,
        productCode: String(index + 1).padStart(6, "0"),
      }),
    );
    await Promise.resolve();

    expect(maximumActive).toBe(3);
    release.resolve();
    const outcomes = await Promise.allSettled([...hot, ...uncached]);

    expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(
      true,
    );
    expect(computations).toBe(5);
  });

  it("passes resolveAnalysisManifest through to the inner runtime unmodified", () => {
    const fixture = createFixtureApplicationRuntime();
    const runtime = createBoundedApplicationRuntime(fixture);

    expect(
      runtime.resolveAnalysisManifest("acceptance-fixtures-v1")
        ?.analysisBuildId,
    ).toBe("acceptance-fixtures-v1");
    expect(runtime.resolveAnalysisManifest("never-promoted")).toBeNull();
  });
});

type CandidateExecution = (
  request: CandidateMarketV1AnalysisRequest,
  options?: AnalysisExecutionOptions,
) => Promise<AnalysisOutcome<"candidate-market-v1">>;

function runtimeWithExecution(
  runtime: ApplicationRuntime,
  execute: CandidateExecution,
): ApplicationRuntime {
  return {
    ...runtime,
    tradeAnalytics: {
      execute<Request extends AnalysisRequest>(
        request: Request,
        options?: AnalysisExecutionOptions,
      ): Promise<AnalysisOutcome<Request["recipe"]>> {
        if (request.recipe !== "candidate-market-v1") {
          return runtime.tradeAnalytics.execute(request, options);
        }
        return execute(request, options) as Promise<
          AnalysisOutcome<Request["recipe"]>
        >;
      },
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
