import type { ProductCatalog } from "../catalog/product-catalog";
import { createFixtureProductCatalog } from "../catalog/fixture-product-catalog";
import type { CandidateMarketAnalysis } from "../domain/candidate-market/analyze-candidate-markets";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { EffectiveSourceFreshness } from "../domain/release/source-freshness";
import type { EconomyDirectory } from "../economy/economy-directory";
import { createFixtureEconomyDirectory } from "../economy/fixture-economy-directory";
import { createFixtureCandidateMarketAnalysis } from "../evidence/fixture-trade-evidence-source";
import {
  FIXTURE_CURRENT_AS_OF,
  resolveFixtureCurrentAnalysisManifest,
  resolveFixtureExportFreshnessStatus,
} from "../release/fixture-current-analysis";

export type RuntimeRequestOptions = Readonly<{
  signal?: AbortSignal;
  observe?: (observation: RuntimeOperationObservation) => void;
}>;

export type RuntimeOperationObservation = Readonly<{
  cacheState: "hit" | "coalesced" | "miss";
  queueWaitMs: number | null;
  queryMs: number | null;
  resultBytes: number;
}>;

export interface ApplicationRuntime {
  currentAnalysis(): CurrentAnalysisManifest;
  currentAnalysisSnapshot(): {
    manifest: CurrentAnalysisManifest;
    asOf: string;
  };
  resolveFreshnessStatus(
    freshnessStatusId: string,
  ): EffectiveSourceFreshness | null;
  normalizeProductSearchQuery(query: string): string;
  analyze(
    query: Parameters<CandidateMarketAnalysis["analyze"]>[0],
    options?: RuntimeRequestOptions,
  ): ReturnType<CandidateMarketAnalysis["analyze"]>;
  searchProducts(
    query: Parameters<ProductCatalog["search"]>[0],
    options?: RuntimeRequestOptions,
  ): ReturnType<ProductCatalog["search"]>;
  searchEconomies(
    query: Parameters<EconomyDirectory["search"]>[0],
    options?: RuntimeRequestOptions,
  ): ReturnType<EconomyDirectory["search"]>;
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
  const analysis = createFixtureCandidateMarketAnalysis();
  const productCatalog = createFixtureProductCatalog();
  const economyDirectory = createFixtureEconomyDirectory();
  return {
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
    analyze: analysis.analyze.bind(analysis),
    searchProducts: productCatalog.search.bind(productCatalog),
    searchEconomies: economyDirectory.search.bind(economyDirectory),
    health(buildId: string) {
      return { status: "ok", buildId };
    },
  };
}
