import {
  evaluateSourceFreshness,
  nextSourceFreshnessTransitionAt,
  type EffectiveSourceFreshness,
  type SourceStatusSnapshot,
} from "./source-freshness";
import type { ReleaseRevisionComparisonIdentity } from "./release-revision";

export type CurrentAnalysisDeployment = {
  analysisBuildId: string;
  productSearchBuildId: string;
  analysisReleaseCatalogSha256: string;
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
};

export type CurrentAnalysisManifest = CurrentAnalysisDeployment & {
  schemaVersion: "current-analysis-manifest-v1";
  freshness: EffectiveSourceFreshness;
};

export function resolveCurrentAnalysisManifest(
  deployment: CurrentAnalysisDeployment,
  sourceStatusSnapshot: SourceStatusSnapshot,
  asOf: string,
): CurrentAnalysisManifest {
  const freshness = evaluateSourceFreshness(sourceStatusSnapshot, asOf);
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
