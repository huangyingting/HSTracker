import { describe, expect, it } from "vitest";

import {
  createFixtureApplicationRuntime,
  type ApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { isAnalysisCapacityExceededError } from "../../src/runtime/analysis-capacity-error";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { RUNTIME_RESOURCE_POLICY } from "../../src/runtime-resource-policy";

const query = {
  analysisBuildId: "acceptance-fixtures-v1",
  exporterCode: "156",
  productCode: "010121",
};

describe("bounded application runtime", () => {
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
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        computations += 1;
        await computation.promise;
        return fixture.analyze(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    const pending = Array.from({ length: 10 }, () =>
      runtime.analyze(query),
    );
    await Promise.resolve();

    expect(computations).toBe(1);
    computation.resolve();
    const results = await Promise.all(pending);
    expect(results).toHaveLength(10);
    expect(results.every((result) => result === results[0])).toBe(true);
    expect(results[0]?.candidates).toHaveLength(13);
  });

  it("partitions analysis cache entries for external probe samples", async () => {
    const fixture = createFixtureApplicationRuntime();
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        computations += 1;
        return fixture.analyze(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const cacheStates: string[] = [];
    const options = (cachePartitionKey: string) => ({
      cachePartitionKey,
      observe: (observation: { cacheState: string }) => {
        cacheStates.push(observation.cacheState);
      },
    });

    await runtime.analyze(query, options("sample-a"));
    await runtime.analyze(query, options("sample-a"));
    await runtime.analyze(query, options("sample-b"));

    expect(computations).toBe(2);
    expect(cacheStates).toEqual(["miss", "hit", "miss"]);
  });

  it("isolates a disconnected waiter from a shared computation", async () => {
    const fixture = createFixtureApplicationRuntime();
    const computation = deferred<void>();
    let computations = 0;
    let sharedSignal: AbortSignal | undefined;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request, options) {
        computations += 1;
        sharedSignal = options?.signal;
        await computation.promise;
        return fixture.analyze(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const disconnectedWaiter = new AbortController();

    const first = runtime.analyze(query, {
      signal: disconnectedWaiter.signal,
    });
    const second = runtime.analyze(query);
    disconnectedWaiter.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(false);
    expect(computations).toBe(1);

    computation.resolve();
    await expect(second).resolves.toMatchObject({
      analysisBuildId: query.analysisBuildId,
      candidates: expect.any(Array),
    });
  });

  it("runs two distinct analyses and admits sixteen more in FIFO order", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.analyze(query);
    const computation = deferred<void>();
    const starts: string[] = [];
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        starts.push(request.productCode);
        await computation.promise;
        return expected;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const productCodes = Array.from({ length: 19 }, (_, index) =>
      String(index).padStart(6, "0"),
    );

    const admitted = productCodes.slice(0, 18).map((productCode) =>
      runtime.analyze({
        ...query,
        productCode,
      }),
    );
    const rejected = runtime.analyze({
      ...query,
      productCode: productCodes[18]!,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(productCodes.slice(0, 2));
    await expect(rejected).rejects.toSatisfy(
      isAnalysisCapacityExceededError,
    );
    await expect(rejected).rejects.toMatchObject({
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      status: 503,
      retryAfterSeconds: 2,
      reason: "queue-full",
    });

    computation.resolve();
    await Promise.all(admitted);
    expect(starts).toEqual(productCodes.slice(0, 18));
  });

  it("rejects a computation that exceeds the queue-wait deadline", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.analyze(query);
    const firstComputation = deferred<void>();
    const starts: string[] = [];
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        starts.push(request.productCode);
        if (request.productCode === "000001") {
          await firstComputation.promise;
        }
        return expected;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      maxQueuedAnalyses: 1,
      queueWaitTimeoutMs: 10,
    });

    const first = runtime.analyze({
      ...query,
      productCode: "000001",
    });
    const timedOut = runtime.analyze({
      ...query,
      productCode: "000002",
    });

    await expect(timedOut).rejects.toMatchObject({
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      reason: "queue-timeout",
    });
    expect(starts).toEqual(["000001"]);

    const replacement = runtime.analyze({
      ...query,
      productCode: "000003",
    });
    firstComputation.resolve();
    await Promise.all([first, replacement]);
    expect(starts).toEqual(["000001", "000003"]);
  });

  it("interrupts an overlong analysis before releasing its slot", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.analyze(query);
    const interrupted = deferred<void>();
    const querySettled = deferred<void>();
    const starts: string[] = [];
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request, options) {
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
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      analysisTimeoutMs: 10,
    });

    const overlong = runtime.analyze({
      ...query,
      productCode: "000001",
    });
    const next = runtime.analyze({
      ...query,
      productCode: "000002",
    });

    await interrupted.promise;
    expect(starts).toEqual(["000001"]);

    querySettled.resolve();
    await expect(overlong).rejects.toMatchObject({
      code: "ANALYSIS_CAPACITY_EXCEEDED",
      reason: "execution-timeout",
    });
    await expect(next).resolves.toBe(expected);
    expect(starts).toEqual(["000001", "000002"]);
  });

  it("evicts Candidate Market entries by byte-weighted access order", async () => {
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.analyze(query);
    const computations: string[] = [];
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        computations.push(request.productCode);
        return expected;
      },
    };
    const entryWeight =
      new TextEncoder().encode(JSON.stringify(expected)).byteLength + 1_024;
    const runtime = createBoundedApplicationRuntime(inner, {
      analysisCacheMaxBytes: entryWeight * 2,
    });

    const analyze = (productCode: string) =>
      runtime.analyze({ ...query, productCode });
    await analyze("000001");
    await analyze("000002");
    await analyze("000001");
    await analyze("000003");
    await analyze("000002");

    expect(computations).toEqual([
      "000001",
      "000002",
      "000003",
      "000002",
    ]);
  });

  it("caches a valid empty Candidate Market result", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = {
      ...(await fixture.analyze(query)),
      candidates: [],
    };
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze() {
        computations += 1;
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    await runtime.analyze(query);
    await runtime.analyze(query);

    expect(computations).toBe(1);
  });

  it("does not cache an analysis error", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = await fixture.analyze(query);
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze() {
        computations += 1;
        if (computations === 1) {
          throw new Error("query failed");
        }
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    await expect(runtime.analyze(query)).rejects.toThrow("query failed");
    await expect(runtime.analyze(query)).resolves.toBe(result);
    await expect(runtime.analyze(query)).resolves.toBe(result);

    expect(computations).toBe(2);
  });

  it("returns but does not admit an oversized analysis entry", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = await fixture.analyze(query);
    const entryWeight =
      new TextEncoder().encode(JSON.stringify(result)).byteLength + 1_024;
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze() {
        computations += 1;
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      analysisCacheMaxBytes: entryWeight - 1,
    });

    await expect(runtime.analyze(query)).resolves.toBe(result);
    await expect(runtime.analyze(query)).resolves.toBe(result);

    expect(computations).toBe(2);
  });

  it("validates the active build before consulting the analysis cache", async () => {
    const fixture = createFixtureApplicationRuntime();
    const result = await fixture.analyze(query);
    const originalManifest = fixture.currentAnalysis();
    let currentManifest = originalManifest;
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      currentAnalysis() {
        return currentManifest;
      },
      async analyze(request) {
        computations += 1;
        if (
          request.analysisBuildId !== currentManifest.analysisBuildId
        ) {
          throw new Error("retired build");
        }
        return result;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);

    await runtime.analyze(query);
    currentManifest = {
      ...originalManifest,
      analysisBuildId: "replacement-build",
    };
    await expect(runtime.analyze(query)).rejects.toThrow("retired build");
    currentManifest = originalManifest;
    await runtime.analyze(query);

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
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze(request) {
        if (request.productCode === query.productCode) {
          await computation.promise;
        }
        return fixture.analyze(request);
      },
    };
    const runtime = createBoundedApplicationRuntime(inner, {
      maxConcurrentAnalyses: 1,
      maxQueuedAnalyses: 0,
    });
    const active = runtime.analyze(query);

    await expect(
      runtime.analyze({
        ...query,
        productCode: "malformed",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ANALYSIS_QUERY",
      status: 400,
    });

    computation.resolve();
    await active;
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
    const expected = await fixture.analyze(query);
    const resultBytes = new TextEncoder().encode(
      JSON.stringify(expected),
    ).byteLength;

    await runtime.analyze(query, { observe });
    await runtime.analyze(query, { observe });

    expect(observations).toEqual([
      {
        cacheState: "miss",
        queueWaitMs: expect.any(Number),
        queryMs: expect.any(Number),
        resultBytes,
      },
      {
        cacheState: "hit",
        queueWaitMs: null,
        queryMs: null,
        resultBytes,
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
    const expected = await fixture.analyze(query);
    const release = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    let computations = 0;
    const inner: ApplicationRuntime = {
      ...fixture,
      async analyze() {
        computations += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await release.promise;
        active -= 1;
        return expected;
      },
    };
    const runtime = createBoundedApplicationRuntime(inner);
    const hot = Array.from({ length: 16 }, () =>
      runtime.analyze(query),
    );
    const uncached = Array.from({ length: 4 }, (_, index) =>
      runtime.analyze({
        ...query,
        productCode: String(index + 1).padStart(6, "0"),
      }),
    );
    await Promise.resolve();

    expect(maximumActive).toBe(2);
    release.resolve();
    const outcomes = await Promise.allSettled([...hot, ...uncached]);

    expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(
      true,
    );
    expect(computations).toBe(5);
  });
});

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
