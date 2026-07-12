import { describe, expect, it } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/current/route";

const currentUrl = "http://localhost/api/v1/analyses/current";

describe("current analysis manifest route", () => {
  it("binds current immutable builds to one effective freshness snapshot", async () => {
    const response = await GET(new Request(currentUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, must-revalidate",
    );
    expect(response.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "current-analysis-manifest-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      productSearchBuildId: "acceptance-product-search-v3",
      analysisReleaseCatalogSha256:
        "3b1ff899c301d11a2bb5c29e3040e9261a68633b54a7d94f4b15338129d4fcff",
      source: {
        baciRelease: "V202601",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        ingestedYears: { start: 2012, end: 2024 },
        finalizedCutoffYear: 2023,
        windows: {
          threeYear: { start: 2021, end: 2023 },
          score: { start: 2019, end: 2023 },
          tenYear: { start: 2014, end: 2023 },
        },
        provisionalYear: 2024,
        scoreVersion: "cms-v1",
        artifact: {
          buildId: "acceptance-fixtures-v1-core-artifact",
          schemaVersion: "candidate-market-artifact-v1",
          builtAt: "2026-01-23T00:00:00Z",
          sha256:
            "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
        },
      },
      freshness: {
        sourceStatusSnapshotId: "source-status:acceptance-fixtures-v1",
        checkedAt: "2026-03-01T00:00:00Z",
        state: "LATEST_KNOWN",
        effectiveAt: "2026-03-01T00:00:00Z",
        servedBaciRelease: "V202601",
        latestKnownBaciRelease: "V202601",
      },
      revisionComparison: {
        comparisonRelease: null,
        previousArtifactSha256: null,
        notComparedReason: "NO_PREVIOUS_ARTIFACT",
      },
    });
  });

  it("supports validators and matching HEAD metadata", async () => {
    const initial = await GET(new Request(currentUrl));
    const etag = initial.headers.get("etag")!;
    const notModified = await GET(
      new Request(currentUrl, { headers: { "If-None-Match": etag } }),
    );
    const head = await HEAD(new Request(currentUrl, { method: "HEAD" }));

    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(etag);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("cache-control")).toBe(
      initial.headers.get("cache-control"),
    );
  });
});
