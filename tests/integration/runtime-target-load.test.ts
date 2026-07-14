import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getCandidateMarkets } from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import { GET as getCandidateMarketCsv } from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets.csv/route";
import { GET as getEconomies } from "../../src/app/api/v1/analyses/[analysisBuildId]/economies/route";
import { GET as getCurrentAnalysis } from "../../src/app/api/v1/analyses/current/route";
import { GET as getProducts } from "../../src/app/api/v1/product-catalogs/[productSearchBuildId]/products/route";
import type { CurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import type {
  AnalysisExecutionOptions,
  AnalysisOutcome,
  AnalysisRequest,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import {
  subscribeRuntimeMetrics,
  type RuntimeRequestMetric,
} from "../../src/runtime/runtime-metrics";

afterEach(() => {
  vi.useRealTimers();
});

describe("accepted public target load", () => {
  it("serves the ten-minute mix, coordinated bursts, and 30-second burst without rejection", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const expected = await fixture.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });
    if (expected.state !== "success") {
      throw new TypeError(`Expected success, received ${expected.state}.`);
    }
    let activeComputations = 0;
    let maximumActiveComputations = 0;
    const runtime = createBoundedApplicationRuntime({
      ...fixture,
      tradeAnalytics: {
        async execute<Request extends AnalysisRequest>(
          query: Request,
          _options?: AnalysisExecutionOptions,
        ): Promise<AnalysisOutcome<Request["recipe"]>> {
          if (query.recipe !== "candidate-market-v1") {
            return fixture.tradeAnalytics.execute(query, _options);
          }
          activeComputations += 1;
          maximumActiveComputations = Math.max(
            maximumActiveComputations,
            activeComputations,
          );
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          activeComputations -= 1;
          return {
            ...expected,
            payload: {
              ...expected.payload,
              analysisId: `${expected.payload.analysisId}:${query.exporterCode}`,
              query: {
                exporter: {
                  ...expected.payload.query.exporter,
                  code: query.exporterCode,
                },
                product: {
                  ...expected.payload.query.product,
                  code: query.productCode,
                },
              },
            },
          } as AnalysisOutcome<Request["recipe"]>;
        },
      },
    });
    const warmups = HOT_ANALYSIS_KEYS.map((identity) =>
      runtime.tradeAnalytics.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: runtime.currentAnalysis().analysisBuildId,
        ...identity,
      }),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.all(warmups);

    const restore = installApplicationRuntime(runtime);
    const metrics: RuntimeRequestMetric[] = [];
    const unsubscribe = subscribeRuntimeMetrics((metric) => {
      metrics.push(metric);
    });
    const manifest = runtime.currentAnalysis();
    const responses: Promise<number>[] = [];
    const sessionAnalysisKeys: (AnalysisIdentity | undefined)[] =
      Array.from({ length: SESSION_COUNT });
    const simulatedSessions = new Set<number>();
    let regularAnalysisOrdinal = 0;
    let regularHotAnalyses = 0;
    let regularDistinctAnalyses = 0;
    let distinctOrdinal = 0;
    let coordinatedOrdinal = 0;

    const scheduleRequest = (
      atMs: number,
      operation: LoadOperation,
      sessionIndex: number,
    ) => {
      simulatedSessions.add(sessionIndex);
      setTimeout(() => {
        responses.push(
          executeOperation(
            operation,
            manifest,
            sessionIndex,
            sessionAnalysisKeys,
            (forceDistinct) => {
              if (forceDistinct) {
              coordinatedOrdinal += 1;
              return {
                exporterCode: String(700 + coordinatedOrdinal),
                productCode: MAXIMUM_ROW_PRODUCT_CODE,
              };
              }

              const ordinal = regularAnalysisOrdinal++;
              if (ordinal % 5 === 4) {
              regularDistinctAnalyses += 1;
              distinctOrdinal += 1;
              return {
                exporterCode: String(400 + distinctOrdinal),
                productCode: MAXIMUM_ROW_PRODUCT_CODE,
              };
              }

              regularHotAnalyses += 1;
              return HOT_ANALYSIS_KEYS[
              ordinal % HOT_ANALYSIS_KEYS.length
              ]!;
            },
          ).then(async (response) => {
            await response.arrayBuffer();
            return response.status;
          }),
        );
      }, atMs);
    };

    try {
      for (let request = 0; request < 2_400; request += 1) {
        scheduleRequest(
          request * 250,
          operationAt(request),
          request % SESSION_COUNT,
        );
      }
      for (let minute = 1; minute <= 10; minute += 1) {
        const atMs = minute * 60_000;
        for (let burstKey = 0; burstKey < 4; burstKey += 1) {
          scheduleRequest(atMs, "coordinated-analysis", burstKey);
        }
      }
      const burstStartMs = 610_000;
      for (let request = 0; request < 300; request += 1) {
        scheduleRequest(
          burstStartMs + request * 100,
          operationAt(request),
          request % SESSION_COUNT,
        );
      }

      await vi.advanceTimersByTimeAsync(655_000);
      const statuses = await Promise.all(responses);

      expect(responses).toHaveLength(2_740);
      expect(statuses.every((status) => status === 200)).toBe(true);
      expect(simulatedSessions.size).toBe(SESSION_COUNT);
      expect(regularHotAnalyses).toBe(1_184);
      expect(regularDistinctAnalyses).toBe(296);
      expect(coordinatedOrdinal).toBe(40);
      expect(maximumActiveComputations).toBe(2);
      expect(runtime.resources().analysisExecution).toMatchObject({
        active: 0,
        queued: 0,
      });

      expect(routeCount(metrics, "current-analysis")).toBe(272);
      expect(routeCount(metrics, "product-search")).toBe(340);
      expect(routeCount(metrics, "economy-search")).toBe(340);
      expect(routeCount(metrics, "candidate-market")).toBe(1_520);
      expect(routeCount(metrics, "candidate-market-csv")).toBe(268);

      const analyses = metrics.filter(
        (metric) => metric.routeFamily === "candidate-market",
      );
      expect(cacheCount(analyses, "hit")).toBe(1_184);
      expect(cacheCount(analyses, "miss")).toBe(336);
      const exports = metrics.filter(
        (metric) => metric.routeFamily === "candidate-market-csv",
      );
      expect(
        cacheCount(exports, "hit") +
          cacheCount(exports, "coalesced"),
      ).toBe(268);

      expect(routeP95(metrics, "current-analysis")).toBeLessThanOrEqual(
        100,
      );
      expect(routeP95(metrics, "product-search")).toBeLessThanOrEqual(
        200,
      );
      expect(routeP95(metrics, "economy-search")).toBeLessThanOrEqual(
        200,
      );
      expect(routeP95(metrics, "candidate-market")).toBeLessThanOrEqual(
        2_000,
      );
      expect(
        routeP95(metrics, "candidate-market-csv"),
      ).toBeLessThanOrEqual(250);

      expect(
        metrics.every(
          (metric) =>
            metric.resources.analysisExecution.active <= 2 &&
            metric.resources.analysisExecution.queued <= 16,
        ),
      ).toBe(true);
      expect(
        metrics.every(
          (metric) =>
            metric.resources.caches.analysis.bytes <=
              metric.resources.caches.analysis.maxBytes &&
            metric.resources.caches.search.bytes <=
              metric.resources.caches.search.maxBytes,
        ),
      ).toBe(true);
      expect(
        metrics.every(
          (metric) =>
            metric.process.constrainedMemoryBytes === 0 ||
            metric.process.rssBytes <
              metric.process.constrainedMemoryBytes * 0.85,
        ),
      ).toBe(true);
    } finally {
      unsubscribe();
      restore();
    }
  }, 20_000);
});

type LoadOperation =
  | "current"
  | "product"
  | "economy"
  | "analysis"
  | "csv"
  | "coordinated-analysis";

const HOT_EXPORTER_CODES = [
  "156",
  "276",
  "392",
  "842",
] as const;

const SESSION_COUNT = 20;
const MAXIMUM_ROW_PRODUCT_CODE = "010121";

type AnalysisIdentity = {
  exporterCode: string;
  productCode: string;
};

const HOT_ANALYSIS_KEYS: readonly AnalysisIdentity[] =
  HOT_EXPORTER_CODES.map((exporterCode) => ({
    exporterCode,
    productCode: MAXIMUM_ROW_PRODUCT_CODE,
  }));

function operationAt(index: number): LoadOperation {
  const position = index % 40;
  if (position < 4) {
    return "current";
  }
  if (position < 9) {
    return "product";
  }
  if (position < 14) {
    return "economy";
  }
  if (position < 36) {
    return "analysis";
  }
  return "csv";
}

async function executeOperation(
  operation: LoadOperation,
  manifest: CurrentAnalysisManifest,
  sessionIndex: number,
  sessionAnalysisKeys: (AnalysisIdentity | undefined)[],
  nextAnalysisIdentity: (forceDistinct: boolean) => AnalysisIdentity,
): Promise<Response> {
  if (operation === "current") {
    return getCurrentAnalysis(
      new Request("http://localhost/api/v1/analyses/current"),
    );
  }
  if (operation === "product") {
    return getProducts(
      new Request(
        `http://localhost/api/v1/product-catalogs/${manifest.productSearchBuildId}/products?q=horse&locale=en&limit=20`,
      ),
      productCatalogRouteContext(manifest.productSearchBuildId),
    );
  }
  if (operation === "economy") {
    return getEconomies(
      new Request(
        `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/economies?q=china`,
      ),
      analysisRouteContext(manifest.analysisBuildId),
    );
  }
  if (operation === "csv") {
    const analysisIdentity = sessionAnalysisKeys[sessionIndex];
    if (analysisIdentity === undefined) {
      throw new Error(
        `Session ${sessionIndex} has no Candidate Market analysis to export.`,
      );
    }
    const parameters = new URLSearchParams({
      exporter: analysisIdentity.exporterCode,
      product: analysisIdentity.productCode,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshness.freshnessStatusId,
      schema: "candidate-markets-csv-v1",
    });
    return getCandidateMarketCsv(
      new Request(
        `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/candidate-markets.csv?${parameters}`,
      ),
      analysisRouteContext(manifest.analysisBuildId),
    );
  }

  const analysisIdentity = nextAnalysisIdentity(
    operation === "coordinated-analysis",
  );
  if (operation === "analysis") {
    sessionAnalysisKeys[sessionIndex] = analysisIdentity;
  }
  return getCandidateMarkets(
    new Request(
      `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/candidate-markets?exporter=${analysisIdentity.exporterCode}&product=${analysisIdentity.productCode}`,
    ),
    analysisRouteContext(manifest.analysisBuildId),
  );
}

function analysisRouteContext(analysisBuildId: string): {
  params: Promise<{ analysisBuildId: string }>;
} {
  return { params: Promise.resolve({ analysisBuildId }) };
}

function productCatalogRouteContext(productSearchBuildId: string): {
  params: Promise<{ productSearchBuildId: string }>;
} {
  return { params: Promise.resolve({ productSearchBuildId }) };
}

function routeCount(
  metrics: readonly RuntimeRequestMetric[],
  routeFamily: RuntimeRequestMetric["routeFamily"],
): number {
  return metrics.filter((metric) => metric.routeFamily === routeFamily).length;
}

function cacheCount(
  metrics: readonly RuntimeRequestMetric[],
  cacheState: RuntimeRequestMetric["cacheState"],
): number {
  return metrics.filter((metric) => metric.cacheState === cacheState).length;
}

function routeP95(
  metrics: readonly RuntimeRequestMetric[],
  routeFamily: RuntimeRequestMetric["routeFamily"],
): number {
  const durations = metrics
    .filter((metric) => metric.routeFamily === routeFamily)
    .map((metric) => metric.routeMs)
    .sort((left, right) => left - right);
  return durations[Math.ceil(durations.length * 0.95) - 1]!;
}
