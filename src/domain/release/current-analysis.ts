import {
  evaluateSourceFreshness,
  nextSourceFreshnessTransitionAt,
  type EffectiveSourceFreshness,
  type SourceStatusSnapshot,
} from "./source-freshness";
import type {
  AnalysisArtifactBenchmarkQuery,
  TradeExplorerArtifactBenchmarkQuery,
} from "../../evidence/analysis-artifact-manifest";
import type { ReleaseRevisionComparisonIdentity } from "./release-revision";
import type {
  RecommendedDatasetMappingIdentity,
  RecommendedEconomyCatalogIdentity,
  RecommendedProductCatalogIdentity,
} from "../trade-analytics/recommended-dataset-mapping";
import type { DatasetPackageIdentity } from "../trade-analytics/dataset-package";
import type { DeploymentActivation } from "./deployment-activation";

export type DeploymentWindowAnalysisIdentity = {
  analysisBuildId: string;
  recommendation: CurrentAnalysisDeployment["recommendation"];
  // Lets a client validate a retained execution's result provenance with
  // the same rigor as current's (see CandidateMarket/TradeTrend/Supplier
  // Competition workspace analyze() flows), without any extra network
  // lookup: the exact BACI Release and analysis artifact SHA-256 this
  // retained build's own Analysis Identity is bound to.
  baciRelease: string;
  artifactSha256: string;
};

export type CurrentAnalysisDeployment = {
  analysisBuildId: string;
  productSearchBuildId: string;
  analysisReleaseCatalogSha256: string;
  benchmarkQueries: AnalysisArtifactBenchmarkQuery[];
  tradeExplorerBenchmarkQueries: TradeExplorerArtifactBenchmarkQuery[];
  source: {
    baciRelease: string;
    sourceUpdateDate: string;
    hsRevision: "HS12";
    ingestedYears: { start: number; end: number };
    finalizedCutoffYear: number;
    windows: {
      threeYear: { start: number; end: number };
      score: { start: number; end: number };
      tenYear: { start: number; end: number };
    };
    provisionalYear: number;
    scoreVersion: "cms-v1";
    artifact: {
      buildId: string;
      schemaVersion: string;
      builtAt: string;
      sha256: string;
    };
  };
  revisionComparison: ReleaseRevisionComparisonIdentity;
  recommendation: {
    recipe: "candidate-market-v1";
    mappingIdentity: RecommendedDatasetMappingIdentity;
    datasetPackageIdentity: DatasetPackageIdentity;
    productCatalogIdentity: RecommendedProductCatalogIdentity;
    economyCatalogIdentity: RecommendedEconomyCatalogIdentity;
    // Populated only when the same closed Recommended Dataset Mapping also
    // declares and gates trade-trend-v1 (see recommended-dataset-mapping.ts);
    // null for legacy or Candidate-Market-only mappings.
    tradeTrend: {
      recipe: "trade-trend-v1";
      datasetPackageIdentity: DatasetPackageIdentity;
    } | null;
    // Populated only when the same closed Recommended Dataset Mapping also
    // declares and gates supplier-competition-v1; null for legacy,
    // Candidate-Market-only, or Trade-Trend-only mappings.
    supplierCompetition: {
      recipe: "supplier-competition-v1";
      datasetPackageIdentity: DatasetPackageIdentity;
    } | null;
    // Populated only when the same closed Recommended Dataset Mapping
    // declares and gates trade-explorer-v1; null for legacy or undeclared
    // mappings.
    tradeExplorer: {
      recipe: "trade-explorer-v1";
      datasetPackageIdentity: DatasetPackageIdentity;
    } | null;
    // Populated only when the same closed Recommended Dataset Mapping
    // declares and gates opportunity-discovery-v1; null for legacy or
    // undeclared mappings.
    opportunityDiscovery: {
      recipe: "opportunity-discovery-v1";
      datasetPackageIdentity: DatasetPackageIdentity;
    } | null;
  };
  // Every pairing in the active Deployment Retention Window (current
  // first, then up to two retained predecessors), each carrying only its
  // own recipe/package identities. This is enough for the browser's
  // `resolvePinnedContext` (see app/trade-analysis-context.ts) to
  // classify a pinned URL as current, retained, or retired without any
  // network lookup: current-only legacy activations report themselves
  // alone (see issue #44).
  deploymentWindow: readonly DeploymentWindowAnalysisIdentity[];
};

export type CurrentAnalysisManifest = CurrentAnalysisDeployment & {
  schemaVersion: "current-analysis-manifest-v1";
  freshness: EffectiveSourceFreshness;
};

export function resolveCurrentAnalysisManifest(
  deployment: CurrentAnalysisDeployment,
  sourceStatusSnapshot: SourceStatusSnapshot,
  asOf: string,
  activation: DeploymentActivation = { mode: "CURRENT" },
): CurrentAnalysisManifest {
  const freshness = evaluateSourceFreshness(
    sourceStatusSnapshot,
    asOf,
    activation,
  );
  if (freshness.servedBaciRelease !== deployment.source.baciRelease) {
    throw new TypeError(
      "The freshness snapshot does not describe the deployed BACI Release.",
    );
  }

  return {
    schemaVersion: "current-analysis-manifest-v1",
    ...deployment,
    freshness,
  };
}

export function currentManifestCacheControl(
  freshness: EffectiveSourceFreshness,
  asOf: string,
): string {
  const nextDeadline = nextSourceFreshnessTransitionAt(freshness);
  const secondsUntilDeadline =
    nextDeadline === null
      ? Number.POSITIVE_INFINITY
      : Math.max(
          0,
          Math.floor(
            (new Date(nextDeadline).getTime() - new Date(asOf).getTime()) /
              1000,
          ),
        );
  const browserSeconds = Math.min(60, secondsUntilDeadline);
  const sharedSeconds = Math.min(300, secondsUntilDeadline);
  return `public, max-age=${browserSeconds}, s-maxage=${sharedSeconds}, must-revalidate`;
}
