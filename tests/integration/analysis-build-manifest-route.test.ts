import { describe, expect, it } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/manifest/route";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

describe("analysis build manifest route", () => {
  it("serves the current build with current-manifest cache policy and HEAD metadata", async () => {
    const runtime = createFixtureApplicationRuntime();
    const manifest = runtime.currentAnalysis();
    const url = `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/manifest`;
    const response = await GET(
      new Request(url),
      routeContext(manifest.analysisBuildId),
    );
    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext(manifest.analysisBuildId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, must-revalidate",
    );
    await expect(response.json()).resolves.toEqual(manifest);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(response.headers.get("etag"));
  });

  it("serves a retained manifest immutably and rejects retired builds", async () => {
    const fixture = createFixtureApplicationRuntime();
    const retained = {
      ...fixture.currentAnalysis(),
      analysisBuildId: "retained-analysis-v1",
    };
    const restore = installApplicationRuntime({
      ...fixture,
      resolveAnalysisManifest(analysisBuildId) {
        return analysisBuildId === retained.analysisBuildId ? retained : null;
      },
    });

    try {
      const retainedResponse = await GET(
        new Request(
          `http://localhost/api/v1/analyses/${retained.analysisBuildId}/manifest`,
        ),
        routeContext(retained.analysisBuildId),
      );
      expect(retainedResponse.status).toBe(200);
      expect(retainedResponse.headers.get("cache-control")).toBe(
        "public, max-age=60, s-maxage=300, must-revalidate",
      );
      await expect(retainedResponse.json()).resolves.toMatchObject({
        analysisBuildId: retained.analysisBuildId,
      });

      const retiredResponse = await GET(
        new Request("http://localhost/api/v1/analyses/retired-v1/manifest"),
        routeContext("retired-v1"),
      );
      expect(retiredResponse.status).toBe(410);
      await expect(retiredResponse.json()).resolves.toMatchObject({
        error: { code: "ANALYSIS_BUILD_RETIRED" },
      });
    } finally {
      restore();
    }
  });
});
