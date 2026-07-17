import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/opportunities/[productCode]/[importerCode]/route";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import type { MarketInvestigationCandidate } from "../../src/domain/opportunity-discovery/result";

const FIXTURE_BUILD_ID = "opportunity-discovery-fixtures-v1";

const routeContext = (
  analysisBuildId: string,
  productCode: string,
  importerCode: string,
) => ({
  params: Promise.resolve({ analysisBuildId, productCode, importerCode }),
});

const detailUrl = (
  productCode: string,
  importerCode: string,
  query: string,
): string =>
  `http://localhost/api/v1/analyses/${FIXTURE_BUILD_ID}/opportunities/${productCode}/${importerCode}?${query}`;

async function firstCandidate(
  exportEconomyCode: string,
): Promise<MarketInvestigationCandidate> {
  const fixture = createFixtureApplicationRuntime();
  const oracle = await fixture.tradeAnalytics.execute({
    recipe: "opportunity-discovery-v1",
    analysisBuildId: FIXTURE_BUILD_ID,
    exportEconomyCode,
  });
  if (oracle.state !== "success") {
    throw new TypeError("Expected the fixture platform feed oracle to succeed.");
  }
  const candidate = oracle.payload.candidates[0];
  if (candidate === undefined) {
    throw new TypeError("Expected the fixture feed to contain a candidate.");
  }
  return candidate;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("versioned Opportunity detail route", () => {
  it("serves deterministic immutable GET, HEAD, and 304 representations", async () => {
    const candidate = await firstCandidate("100");
    const productCode = candidate.product.code;
    const marketCode = candidate.market.code;

    const fixture = createFixtureApplicationRuntime();
    const oracle = await fixture.tradeAnalytics.execute({
      recipe: "opportunity-detail-v1",
      analysisBuildId: FIXTURE_BUILD_ID,
      exportEconomyCode: "100",
      productCode,
      marketCode,
    });
    if (oracle.state !== "success") {
      throw new TypeError("Expected the fixture detail oracle to succeed.");
    }

    const url = detailUrl(productCode, marketCode, "exporter=100");
    const context = () => routeContext(FIXTURE_BUILD_ID, productCode, marketCode);
    const first = await GET(new Request(url), context());
    const firstBody = await first.text();
    const second = await GET(new Request(url), context());

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(firstBody).toBe(JSON.stringify(oracle.payload));
    expect(await second.text()).toBe(firstBody);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(JSON.parse(firstBody)).toMatchObject({
      candidateMarketDrillDown: { recipe: "candidate-market-v1" },
    });

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      context(),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));

    const head = await HEAD(new Request(url, { method: "HEAD" }), context());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("returns 404 for an exporter absent from the analysis build", async () => {
    const candidate = await firstCandidate("100");
    const productCode = candidate.product.code;
    const marketCode = candidate.market.code;
    const response = await GET(
      new Request(detailUrl(productCode, marketCode, "exporter=999")),
      routeContext(FIXTURE_BUILD_ID, productCode, marketCode),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "UNKNOWN_EXPORT_ECONOMY" },
    });
  });

  it("returns 404 for a product or market absent from the exporter cohort", async () => {
    const response = await GET(
      new Request(detailUrl("999999", "100", "exporter=100")),
      routeContext(FIXTURE_BUILD_ID, "999999", "100"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "UNKNOWN_HS_PRODUCT" },
    });
  });

  it("returns 400 for a malformed exporter code", async () => {
    const candidate = await firstCandidate("100");
    const productCode = candidate.product.code;
    const marketCode = candidate.market.code;
    const response = await GET(
      new Request(detailUrl(productCode, marketCode, "exporter=abc")),
      routeContext(FIXTURE_BUILD_ID, productCode, marketCode),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("returns 400 when the exporter parameter is missing", async () => {
    const candidate = await firstCandidate("100");
    const productCode = candidate.product.code;
    const marketCode = candidate.market.code;
    const response = await GET(
      new Request(detailUrl(productCode, marketCode, "")),
      routeContext(FIXTURE_BUILD_ID, productCode, marketCode),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("returns 400 for an unsupported query parameter", async () => {
    const candidate = await firstCandidate("100");
    const productCode = candidate.product.code;
    const marketCode = candidate.market.code;
    const response = await GET(
      new Request(detailUrl(productCode, marketCode, "exporter=100&products=010001")),
      routeContext(FIXTURE_BUILD_ID, productCode, marketCode),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("retires an undeclared analysis build", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/unknown-build/opportunities/010001/100?exporter=100",
      ),
      routeContext("unknown-build", "010001", "100"),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: { code: "ANALYSIS_BUILD_RETIRED" },
    });
  });
});
