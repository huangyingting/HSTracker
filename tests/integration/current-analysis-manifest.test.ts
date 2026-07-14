import { describe, expect, it } from "vitest";

import {
  currentManifestCacheControl,
  resolveCurrentAnalysisManifest,
} from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";

describe("Current Analysis Manifest", () => {
  it("expands the existing manifest with startup-fixed recommendation identities", () => {
    const manifest = resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      "2026-03-01T00:00:00Z",
    );

    expect(manifest).toMatchObject({
      schemaVersion: "current-analysis-manifest-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      productSearchBuildId: "acceptance-product-search-v3",
      recommendation: {
        recipe: "candidate-market-v1",
        mappingIdentity: expect.stringMatching(
          /^recommended-dataset-mapping-v1-[a-f0-9]{64}$/u,
        ),
        datasetPackageIdentity: expect.stringMatching(
          /^dataset-package-v1-[a-f0-9]{64}$/u,
        ),
        productCatalogIdentity: expect.stringMatching(
          /^recommended-product-catalog-v1-[a-f0-9]{64}$/u,
        ),
        economyCatalogIdentity: expect.stringMatching(
          /^recommended-economy-catalog-v1-[a-f0-9]{64}$/u,
        ),
      },
    });
  });

  it("clips browser and shared cache lifetimes at the next status boundary", () => {
    const asOf = "2026-03-14T23:59:59Z";
    const manifest = resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      asOf,
    );

    expect(currentManifestCacheControl(manifest.freshness, asOf)).toBe(
      "public, max-age=1, s-maxage=1, must-revalidate",
    );
  });

  it("rejects a freshness snapshot for a different served release", () => {
    expect(() =>
      resolveCurrentAnalysisManifest(
        FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
        {
          ...FIXTURE_SOURCE_STATUS_SNAPSHOT,
          servedBaciRelease: "V202501",
        },
        "2026-03-01T00:00:00Z",
      ),
    ).toThrow(
      "The freshness snapshot does not describe the deployed BACI Release.",
    );
  });

  it("clips caching at the refresh-due transition", () => {
    const asOf = "2027-03-09T11:59:59Z";
    const manifest = resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      {
        ...FIXTURE_SOURCE_STATUS_SNAPSHOT,
        checkedAt: "2027-03-01T00:00:00Z",
        latestKnownBaciRelease: "V202701",
        newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
        publishedAt: "2027-03-02T12:00:00Z",
      },
      asOf,
    );

    expect(manifest.freshness.state).toBe("UPDATE_IN_PROGRESS");
    expect(currentManifestCacheControl(manifest.freshness, asOf)).toBe(
      "public, max-age=1, s-maxage=1, must-revalidate",
    );
  });
});
