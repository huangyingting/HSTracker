import type { ProductCatalog } from "../catalog/product-catalog";
import { createFixtureProductCatalog } from "../catalog/fixture-product-catalog";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { EffectiveSourceFreshness } from "../domain/release/source-freshness";
import {
  createTradeAnalyticsPlatform,
  type AnalysisOperationObservation,
  type TradeAnalyticsPlatform,
} from "../domain/trade-analytics/trade-analytics-platform";
import type { EconomyDirectory } from "../economy/economy-directory";
import { createFixtureEconomyDirectory } from "../economy/fixture-economy-directory";
import {
  createFixtureCandidateMarketDatasetPackages,
  createFixtureSupplierCompetitionDatasetPackages,
  createFixtureTradeTrendDatasetPackages,
  FixtureTradeEvidenceSource,
} from "../evidence/fixture-trade-evidence-source";
import {
  FIXTURE_CURRENT_AS_OF,
  resolveFixtureCurrentAnalysisManifest,
  resolveFixtureExportFreshnessStatus,
} from "../release/fixture-current-analysis";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";
import { serializedWeight } from "./serialized-size";

export type RuntimeRequestOptions = Readonly<{
  signal?: AbortSignal;
  observe?: (observation: RuntimeOperationObservation) => void;
  cachePartitionKey?: string;
}>;

export type RuntimeOperationObservation = AnalysisOperationObservation;

export type ApplicationRuntimeResources = Readonly<{
  analysisExecution: {
    active: number;
    queued: number;
    maxConcurrent: number;
    maxQueued: number;
  };
  caches: {
    analysis: { entries: number; bytes: number; maxBytes: number };
    search: { entries: number; bytes: number; maxBytes: number };
    statusMicroCache: { bytes: number; maxBytes: number };
    safetyReserveBytes: number;
  };
  duckDb: null | {
    connections: number;
    activeConnections: number;
    queued: number;
    threads: number;
    memoryLimit: string;
    tempDirectory: string;
    maxTempDirectorySize: string;
  };
}>;

export interface ApplicationRuntime {
  readonly tradeAnalytics: TradeAnalyticsPlatform;
  currentAnalysis(): CurrentAnalysisManifest;
  currentAnalysisSnapshot(): {
    manifest: CurrentAnalysisManifest;
    asOf: string;
  };
  resolveFreshnessStatus(
    freshnessStatusId: string,
  ): EffectiveSourceFreshness | null;
  normalizeProductSearchQuery(query: string): string;
  searchProducts(
    query: Parameters<ProductCatalog["search"]>[0],
    options?: RuntimeRequestOptions,
  ): ReturnType<ProductCatalog["search"]>;
  searchEconomies(
    query: Parameters<EconomyDirectory["search"]>[0],
    options?: RuntimeRequestOptions,
  ): ReturnType<EconomyDirectory["search"]>;
  resources(): ApplicationRuntimeResources;
  health(buildId: string): object;
}

type RuntimeGlobal = typeof globalThis & {
  __hsTrackerApplicationRuntime?: ApplicationRuntime;
};

let fixtureRuntime: ApplicationRuntime | undefined;

export function getApplicationRuntime(): ApplicationRuntime {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (runtimeGlobal.__hsTrackerApplicationRuntime !== undefined) {
    return runtimeGlobal.__hsTrackerApplicationRuntime;
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.HS_TRACKER_RUNTIME_MODE !== "fixture"
  ) {
    throw new Error(
      "The verified release runtime has not completed startup.",
    );
  }
  fixtureRuntime ??= createFixtureApplicationRuntime();
  return fixtureRuntime;
}

export function installApplicationRuntime(
  runtime: ApplicationRuntime,
): () => void {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  const previous = runtimeGlobal.__hsTrackerApplicationRuntime;
  runtimeGlobal.__hsTrackerApplicationRuntime = runtime;
  return () => {
    if (runtimeGlobal.__hsTrackerApplicationRuntime !== runtime) {
      return;
    }
    if (previous === undefined) {
      delete runtimeGlobal.__hsTrackerApplicationRuntime;
    } else {
      runtimeGlobal.__hsTrackerApplicationRuntime = previous;
    }
  };
}

export function createFixtureApplicationRuntime(): ApplicationRuntime {
  const productCatalog = createFixtureProductCatalog();
  const economyDirectory = createFixtureEconomyDirectory();
  return {
    tradeAnalytics: createTradeAnalyticsPlatform({
      candidateMarket: {
        evidenceSource: new FixtureTradeEvidenceSource(),
        datasetPackages: createFixtureCandidateMarketDatasetPackages(),
      },
      tradeTrend: {
        evidenceSource: new FixtureTradeEvidenceSource(),
        datasetPackages: createFixtureTradeTrendDatasetPackages(),
      },
      supplierCompetition: {
        evidenceSource: new FixtureTradeEvidenceSource(),
        datasetPackages: createFixtureSupplierCompetitionDatasetPackages(),
      },
    }),
    currentAnalysis: resolveFixtureCurrentAnalysisManifest,
    currentAnalysisSnapshot() {
      return {
        manifest: resolveFixtureCurrentAnalysisManifest(),
        asOf: FIXTURE_CURRENT_AS_OF,
      };
    },
    resolveFreshnessStatus: resolveFixtureExportFreshnessStatus,
    normalizeProductSearchQuery: productCatalog.normalizeQuery.bind(
      productCatalog,
    ),
    searchProducts: productCatalog.search.bind(productCatalog),
    searchEconomies: economyDirectory.search.bind(economyDirectory),
    resources() {
      return {
        analysisExecution: {
          active: 0,
          queued: 0,
          maxConcurrent: 0,
          maxQueued: 0,
        },
        caches: {
          analysis: { entries: 0, bytes: 0, maxBytes: 0 },
          search: { entries: 0, bytes: 0, maxBytes: 0 },
          statusMicroCache: {
            bytes: serializedWeight(
              resolveFixtureCurrentAnalysisManifest(),
            ),
            maxBytes:
              RUNTIME_RESOURCE_POLICY.statusMicroCacheMaxBytes,
          },
          safetyReserveBytes:
            RUNTIME_RESOURCE_POLICY.cacheSafetyReserveBytes,
        },
        duckDb: null,
      };
    },
    health(buildId: string) {
      return { status: "ok", buildId };
    },
  };
}
