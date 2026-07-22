import { describe, expect, it } from "vitest";

import {
  validateOpportunityPageIdentity,
} from "../../src/app/opportunity-feed-pages";
import { resolvePinnedContext } from "../../src/app/trade-analysis-context";
import { executeOpportunityDiscoveryV1 } from "../../src/domain/trade-analytics/opportunity-discovery-v1-adapter";
import { resolveFixtureCurrentAnalysisManifest } from "../../src/release/fixture-current-analysis";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";

describe("Opportunity feed identity", () => {
  it("validates the recipe Dataset Package rather than an unrelated analysis artifact", async () => {
    const manifest = resolveFixtureCurrentAnalysisManifest();
    const runtime = createFixtureApplicationRuntime();
    const page = await executeOpportunityDiscoveryV1(runtime.tradeAnalytics, {
      analysisBuildId: manifest.analysisBuildId,
      exportEconomyCode: "156",
      page: { limit: 20, cursor: null },
    });
    const pin = resolvePinnedContext(
      null,
      manifest,
      "opportunity-discovery",
    );

    expect(page.provenance.artifactSha256).not.toBe(
      manifest.source.artifact.sha256,
    );
    expect(() =>
      validateOpportunityPageIdentity(
        page,
        manifest.analysisBuildId,
        manifest,
        pin,
      ),
    ).not.toThrow();

    expect(() =>
      validateOpportunityPageIdentity(
        {
          ...page,
          datasetPackageIdentity:
            "dataset-package-v1-mismatch" as typeof page.datasetPackageIdentity,
        },
        manifest.analysisBuildId,
        manifest,
        pin,
      ),
    ).toThrow(/declared Dataset Package/u);
  });
});
