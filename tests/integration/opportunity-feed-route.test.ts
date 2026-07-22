import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/opportunities/route";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import type { MarketInvestigationCandidate } from "../../src/domain/opportunity-discovery/result";

const FIXTURE_BUILD_ID = "opportunity-discovery-fixtures-v1";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

const feedUrl = (query: string): string =>
  `http://localhost/api/v1/analyses/${FIXTURE_BUILD_ID}/opportunities?${query}`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("versioned Opportunity feed route", () => {
  it("serves deterministic immutable GET and HEAD representations", async () => {
    const fixture = createFixtureApplicationRuntime();
    const oracle = await fixture.tradeAnalytics.execute({
      recipe: "opportunity-discovery-v1",
      analysisBuildId: FIXTURE_BUILD_ID,
      exportEconomyCode: "100",
    });
    if (oracle.state !== "success") {
      throw new TypeError("Expected the fixture platform oracle to succeed.");
    }

    const url = feedUrl("exporter=100");
    const first = await GET(new Request(url), routeContext(FIXTURE_BUILD_ID));
    const firstBody = await first.text();
    const second = await GET(new Request(url), routeContext(FIXTURE_BUILD_ID));
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(secondBody).toBe(firstBody);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(JSON.parse(firstBody)).toMatchObject({
      schemaVersion: "market-investigation-result-v1",
      analysisIdentity: oracle.analysisIdentity,
      datasetPackageIdentity: oracle.datasetPackageIdentity,
      candidates: oracle.payload.candidates,
    });

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("paginates with keyset cursors without duplicates or omissions", async () => {
    const fixture = createFixtureApplicationRuntime();
    const oracle = await fixture.tradeAnalytics.execute({
      recipe: "opportunity-discovery-v1",
      analysisBuildId: FIXTURE_BUILD_ID,
      exportEconomyCode: "100",
    });
    if (oracle.state !== "success") {
      throw new TypeError("Expected the fixture platform oracle to succeed.");
    }
    const fullFeed = oracle.payload.candidates;
    expect(fullFeed.length).toBeGreaterThanOrEqual(2);

    const collected: MarketInvestigationCandidate[] = [];
    let cursor: string | null = null;
    do {
      const query =
        cursor === null
          ? "exporter=100&limit=1"
          : `exporter=100&limit=1&cursor=${encodeURIComponent(cursor)}`;
      const response = await GET(
        new Request(feedUrl(query)),
        routeContext(FIXTURE_BUILD_ID),
      );
      expect(response.status).toBe(200);
      const page = JSON.parse(await response.text());
      expect(page.candidates.length).toBeLessThanOrEqual(1);
      collected.push(...page.candidates);
      cursor = page.page.nextCursor;
    } while (cursor !== null);

    expect(collected).toStrictEqual([...fullFeed]);
  });

  it("returns 404 for an exporter absent from the analysis build", async () => {
    const response = await GET(
      new Request(feedUrl("exporter=999")),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "UNKNOWN_EXPORT_ECONOMY" },
    });
  });

  it("returns 400 for a malformed exporter code", async () => {
    const response = await GET(
      new Request(feedUrl("exporter=abc")),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("returns 400 when the exporter parameter is missing", async () => {
    const response = await GET(
      new Request(feedUrl("limit=10")),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("rejects a cursor replayed against a different exporter feed", async () => {
    const first = await GET(
      new Request(feedUrl("exporter=100&limit=1")),
      routeContext(FIXTURE_BUILD_ID),
    );
    const firstPage = JSON.parse(await first.text());
    expect(firstPage.page.nextCursor).not.toBeNull();

    const replayed = await GET(
      new Request(
        feedUrl(
          `exporter=200&limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`,
        ),
      ),
      routeContext(FIXTURE_BUILD_ID),
    );
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({
      error: { code: "INVALID_CURSOR" },
    });
  });

  it("retires an undeclared analysis build", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/unknown-build/opportunities?exporter=100`,
      ),
      routeContext("unknown-build"),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: { code: "ANALYSIS_BUILD_RETIRED" },
    });
  });
});
