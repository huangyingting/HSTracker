import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as marketAnalysisRouteModule from "../../src/app/api/v1/analyses/[analysisBuildId]/market-analysis/route";
import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/market-analysis/route";
import { createMarketAnalysis } from "../../src/domain/market-analysis/market-analysis";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { createTradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createFixtureCandidateMarketDatasetPackages,
  createFixtureSupplierCompetitionDatasetPackages,
  createFixtureTradeTrendDatasetPackages,
} from "../../src/evidence/fixture-trade-evidence-source";
import { CORE_CURRENT_INPUT } from "../../fixtures/acceptance/v1/evidence/core-current";
import { TRADE_TREND_FIXTURE_INPUTS } from "../../fixtures/trade-trend/v1/evidence";
import { SUPPLIER_COMPETITION_FIXTURE_INPUTS } from "../../fixtures/supplier-competition/v1/evidence";
import { FIXTURE_ADAPTER_TEST_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import {
  baseTradeTrendResult,
  budgetOutcome,
  candidateMarketSuccess,
  capacityOutcome,
  platformReturning,
  rateLimitOutcome,
  rejectingOnAbortPlatform,
  retiredOutcome,
  supplierCompetitionSuccess,
  tradeTrendSuccess,
} from "../support/market-analysis-platform-stub";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});
const url =
  "http://localhost/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Market Analysis route", () => {
  it("serves the platform payload as a deterministic immutable GET and HEAD representation", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const marketAnalysis = createMarketAnalysis(platform);
    const expected = await marketAnalysis.load({
      analysisBuildId: "acceptance-fixtures-v1",
      exportEconomyCode: "156",
      productCode: "010121",
      marketCode: "528",
    });

    const first = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
    const firstBody = await first.text();
    const second = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(firstBody).toBe(JSON.stringify(expected));
    expect(await second.text()).toBe(firstBody);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(JSON.parse(firstBody)).toMatchObject({
      schemaVersion: "market-analysis-v1",
      context: {
        analysisBuildId: "acceptance-fixtures-v1",
        exporter: { code: "156" },
        product: { code: "010121" },
        market: { code: "528", name: "Netherlands" },
      },
    });

    const notModified = await GET(
      new Request(url, {
        headers: { "If-None-Match": first.headers.get("etag")! },
      }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(notModified.headers.get("cache-control")).toBe(
      first.headers.get("cache-control"),
    );

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(head.headers.get("cache-control")).toBe(
      first.headers.get("cache-control"),
    );
  });

  it("returns a cacheable empty representation for a valid market with an empty supplier landscape", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=710",
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    await expect(response.json()).resolves.toMatchObject({
      context: { market: { code: "710", name: "South Africa" } },
      supplierLandscape: { cohortSize: 0, supplierShares: [] },
    });
  });
});

const MARKET_ANALYSIS_ROUTE_ERROR_CASES = [
  {
    name: "missing exporter",
    query: "product=010121&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "missing product",
    query: "exporter=156&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "missing market",
    query: "exporter=156&product=010121",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "duplicate exporter",
    query: "exporter=156&exporter=276&product=010121&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "duplicate product",
    query: "exporter=156&product=010121&product=851712&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "duplicate market",
    query: "exporter=156&product=010121&market=528&market=710",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "extra query parameter",
    query: "exporter=156&product=010121&market=528&window=3",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "malformed exporter",
    query: "exporter=abc&product=010121&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "malformed product",
    query: "exporter=156&product=10121&market=528",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "malformed market",
    query: "exporter=156&product=010121&market=abc",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "unknown exporter",
    query: "exporter=999&product=010121&market=528",
    status: 404,
    code: "UNKNOWN_EXPORTER",
    message: "The requested exporter is not available.",
  },
  {
    name: "unknown product",
    query: "exporter=156&product=999999&market=528",
    status: 404,
    code: "UNKNOWN_PRODUCT",
    message: "The requested HS12 product is not available.",
  },
  {
    name: "unknown market",
    query: "exporter=156&product=010121&market=999",
    status: 404,
    code: "UNKNOWN_IMPORTER",
    message: "The requested importing economy is not available.",
  },
  {
    name: "valid identities with a market absent from the complete Candidate Market cohort",
    query: "exporter=156&product=010121&market=826",
    status: 404,
    code: "CANDIDATE_MARKET_NOT_FOUND",
    message:
      "The requested market is not a Candidate Market for this export economy and product.",
  },
] as const;

describe("Market Analysis route: parameter matrix and typed errors", () => {
  it.each(MARKET_ANALYSIS_ROUTE_ERROR_CASES)(
    "returns a typed no-store error for $name",
    async ({ query, status, code, message }) => {
      const response = await GET(
        new Request(
          `http://localhost/api/v1/analyses/acceptance-fixtures-v1/market-analysis?${query}`,
        ),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
    },
  );

  it("returns no body for a typed HEAD error", async () => {
    const response = await HEAD(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=malformed&market=528",
        { method: "HEAD" },
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("returns the retired-build response for a retired analysis build", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/retired-fixture-build/market-analysis?exporter=156&product=010121&market=528",
      ),
      routeContext("retired-fixture-build"),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ANALYSIS_BUILD_RETIRED",
        message: "The requested analysis build is no longer served.",
      },
    });
  });

  it("returns the unavailable-build response for an unavailable analysis build", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/unavailable-fixture-build/market-analysis?exporter=156&product=010121&market=528",
      ),
      routeContext("unavailable-fixture-build"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ANALYSIS_UNAVAILABLE",
        message: "Candidate Market analysis is temporarily unavailable.",
      },
    });
  });
});

const REQUEST_URL =
  "http://localhost/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528";

describe("Market Analysis route: constituent Analysis Outcome families and precedence", () => {
  it("returns the exact retryable response when analysis capacity is exhausted", async () => {
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: capacityOutcome("candidate-market-v1"),
        tradeTrend: tradeTrendSuccess(),
        supplierCompetition: supplierCompetitionSuccess(),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "ANALYSIS_CAPACITY_EXCEEDED",
          message: "Candidate Market analysis is temporarily at capacity.",
        },
      });
    } finally {
      restore();
    }
  });

  it("returns the exact retryable response when the anonymous rate limit is exceeded", async () => {
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: rateLimitOutcome("trade-trend-v1", 7),
        supplierCompetition: supplierCompetitionSuccess(),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("7");
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "ANALYSIS_RATE_LIMITED",
          message:
            "Trade Trend requests are temporarily limited. Please retry shortly.",
        },
      });
    } finally {
      restore();
    }
  });

  it("returns the exact budget-exceeded response without partial annual evidence", async () => {
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: tradeTrendSuccess(),
        supplierCompetition: budgetOutcome("supplier-competition-v1"),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toEqual({
        error: {
          code: "ANALYSIS_BUDGET_EXCEEDED",
          message:
            "The complete Supplier Competition result exceeds its serving budget.",
        },
      });
      expect(Object.keys(body)).toEqual(["error"]);
    } finally {
      restore();
    }
  });

  it("breaks a same-category tie by Candidate Market before Trade Trend before Supplier Competition", async () => {
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: retiredOutcome("candidate-market-v1"),
        tradeTrend: retiredOutcome("trade-trend-v1"),
        supplierCompetition: retiredOutcome("supplier-competition-v1"),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build is no longer served.",
        },
      });
    } finally {
      restore();
    }
  });

  it("never serializes a successful constituent beside a failed annual constituent", async () => {
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: capacityOutcome("trade-trend-v1"),
        supplierCompetition: supplierCompetitionSuccess(),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(Object.keys(body)).toEqual(["error"]);
      expect(JSON.stringify(body)).not.toMatch(
        /candidate|supplier|opportunity|demand/iu,
      );
    } finally {
      restore();
    }
  });
});

describe("Market Analysis route: annual provenance invariant", () => {
  it("fails closed as public 503 ANALYSIS_UNAVAILABLE and logs only correlation-safe detail", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platformReturning({
        candidateMarket: candidateMarketSuccess(),
        tradeTrend: tradeTrendSuccess({
          provenance: {
            ...baseTradeTrendResult().provenance,
            baciRelease: "V202512",
          },
        }),
        supplierCompetition: supplierCompetitionSuccess(),
      }),
    });

    try {
      const response = await GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).toEqual({
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Candidate Market analysis is temporarily unavailable.",
        },
      });

      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
      expect(logged).toMatchObject({
        level: "error",
        event: "market-analysis-annual-evidence-unavailable",
        error: { name: "CandidateMarketAnalysisError" },
      });
      const loggedText = JSON.stringify(logged);
      // Never leaks a Dataset Package, artifact, or Analysis Identity --
      // only the already-public analysisBuildId the caller supplied.
      expect(loggedText).not.toMatch(/dataset-package-v1-/u);
      expect(loggedText).not.toMatch(/analysis-identity-v1-/u);
      expect(loggedText).not.toMatch(/stub-artifact/u);
      expect(loggedText).not.toMatch(/V202601/u);
    } finally {
      restore();
      errorLog.mockRestore();
    }
  });
});

describe("Market Analysis route: deadline, cancellation, and opaque failures", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels Market Analysis work at the twelve-second route deadline", async () => {
    vi.useFakeTimers();
    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: rejectingOnAbortPlatform(),
    });

    try {
      let response: Response | undefined;
      const pending = GET(
        new Request(REQUEST_URL),
        routeContext("acceptance-fixtures-v1"),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(12_000);

      expect(response).toBeDefined();
      await pending;
      expect(response?.status).toBe(503);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      await expect(response?.json()).resolves.toEqual({
        error: {
          code: "REQUEST_DEADLINE_EXCEEDED",
          message: "The request exceeded its processing deadline.",
        },
      });
    } finally {
      restore();
    }
  });

  it("keeps unexpected adapter failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${FIXTURE_ADAPTER_TEST_BUILD_IDS.failing}/market-analysis?exporter=156&product=010121&market=528`,
      ),
      routeContext(FIXTURE_ADAPTER_TEST_BUILD_IDS.failing),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Market Analysis could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain("fixture adapter failure");
    expect(
      JSON.parse(String(errorLog.mock.calls[0]?.[0])),
    ).toMatchObject({
      level: "error",
      event: "market-analysis-request-failed",
      correlationId: body.error.correlationId,
      error: { name: "Error", message: expect.any(String) },
    });
  });

  it("gzips the response body on the wire when the caller advertises gzip support", async () => {
    const response = await GET(
      new Request(REQUEST_URL, {
        headers: { "accept-encoding": "gzip" },
      }),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const decompressed = zlib.gunzipSync(
      Buffer.from(await response.arrayBuffer()),
    );
    const uncompressed = await GET(
      new Request(REQUEST_URL),
      routeContext("acceptance-fixtures-v1"),
    );
    expect(decompressed.toString("utf8")).toBe(await uncompressed.text());
  });
});

describe("Market Analysis route: boundaries", () => {
  it("exposes no locale, POST, write, or export surface", () => {
    expect(marketAnalysisRouteModule).not.toHaveProperty("POST");
    expect(marketAnalysisRouteModule).not.toHaveProperty("PUT");
    expect(marketAnalysisRouteModule).not.toHaveProperty("DELETE");
  });

  it("declares no market-analysis.csv export route directory", async () => {
    await expect(
      readFile(
        resolve(
          "src/app/api/v1/analyses/[analysisBuildId]/market-analysis.csv/route.ts",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("never requires Vary: locale for a GET response", async () => {
    const response = await GET(
      new Request(REQUEST_URL),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/locale/iu);
  });
});

describe("Market Analysis route: retained deployment isolation", () => {
  it("binds a retained analysisBuildId to its own resident recipe bindings, never the current deployment's", async () => {
    const currentBuildId = "acceptance-fixtures-v1";
    const retainedBuildId = "acceptance-fixtures-v1-retained";

    function guarded<Query extends { analysisBuildId: string }, Input>(
      expectedBuildId: string,
      input: Input,
    ): (query: Query) => Promise<Input> {
      return async (query) => {
        if (query.analysisBuildId !== expectedBuildId) {
          throw new TypeError(
            `Evidence bound to ${expectedBuildId} must never see a request for ${query.analysisBuildId}.`,
          );
        }
        return input;
      };
    }

    const currentCmsInput = CORE_CURRENT_INPUT;
    const retainedCmsInput = {
      ...CORE_CURRENT_INPUT,
      analysisBuildId: retainedBuildId,
    };
    const currentTradeTrendInput = TRADE_TREND_FIXTURE_INPUTS.get(
      "528:010121",
    )!;
    const retainedTradeTrendInput = {
      ...currentTradeTrendInput,
      analysisBuildId: retainedBuildId,
    };
    const currentSupplierInput = SUPPLIER_COMPETITION_FIXTURE_INPUTS.get(
      "528:010121",
    )!;
    const retainedSupplierInput = {
      ...currentSupplierInput,
      analysisBuildId: retainedBuildId,
    };

    const candidateMarketDatasetPackage =
      createFixtureCandidateMarketDatasetPackages().get(currentBuildId)!;
    const tradeTrendDatasetPackage =
      createFixtureTradeTrendDatasetPackages().get(currentBuildId)!;
    const supplierCompetitionDatasetPackage =
      createFixtureSupplierCompetitionDatasetPackages().get(currentBuildId)!;

    const platform = createTradeAnalyticsPlatform({
      candidateMarket: {
        evidenceSource: new Map([
          [
            currentBuildId,
            {
              loadCmsV1Inputs: guarded(currentBuildId, currentCmsInput),
            },
          ],
          [
            retainedBuildId,
            {
              loadCmsV1Inputs: guarded(retainedBuildId, retainedCmsInput),
            },
          ],
        ]),
        datasetPackages: new Map([
          [currentBuildId, candidateMarketDatasetPackage],
          [retainedBuildId, candidateMarketDatasetPackage],
        ]),
      },
      tradeTrend: {
        evidenceSource: new Map([
          [
            currentBuildId,
            {
              loadCmsV1Inputs: guarded(currentBuildId, currentCmsInput),
              loadTradeTrendV1Inputs: guarded(
                currentBuildId,
                currentTradeTrendInput,
              ),
            },
          ],
          [
            retainedBuildId,
            {
              loadCmsV1Inputs: guarded(retainedBuildId, retainedCmsInput),
              loadTradeTrendV1Inputs: guarded(
                retainedBuildId,
                retainedTradeTrendInput,
              ),
            },
          ],
        ]),
        datasetPackages: new Map([
          [currentBuildId, tradeTrendDatasetPackage],
          [retainedBuildId, tradeTrendDatasetPackage],
        ]),
      },
      supplierCompetition: {
        evidenceSource: new Map([
          [
            currentBuildId,
            {
              loadCmsV1Inputs: guarded(currentBuildId, currentCmsInput),
              loadSupplierCompetitionV1Inputs: guarded(
                currentBuildId,
                currentSupplierInput,
              ),
            },
          ],
          [
            retainedBuildId,
            {
              loadCmsV1Inputs: guarded(retainedBuildId, retainedCmsInput),
              loadSupplierCompetitionV1Inputs: guarded(
                retainedBuildId,
                retainedSupplierInput,
              ),
            },
          ],
        ]),
        datasetPackages: new Map([
          [currentBuildId, supplierCompetitionDatasetPackage],
          [retainedBuildId, supplierCompetitionDatasetPackage],
        ]),
      },
    });

    const restore = installApplicationRuntime({
      ...createFixtureApplicationRuntime(),
      tradeAnalytics: platform,
    });

    try {
      const retainedUrl = `http://localhost/api/v1/analyses/${retainedBuildId}/market-analysis?exporter=156&product=010121&market=528`;
      const [currentResponse, retainedResponse] = await Promise.all([
        GET(new Request(REQUEST_URL), routeContext(currentBuildId)),
        GET(new Request(retainedUrl), routeContext(retainedBuildId)),
      ]);

      expect(currentResponse.status).toBe(200);
      expect(retainedResponse.status).toBe(200);
      const currentBody = await currentResponse.json();
      const retainedBody = await retainedResponse.json();

      expect(currentBody.context.analysisBuildId).toBe(currentBuildId);
      expect(retainedBody.context.analysisBuildId).toBe(retainedBuildId);
      // Each Map-bound evidence source above throws if it ever receives a
      // request for the other build's analysisBuildId, so a 200 response
      // for both requests -- reached only through the full route, Module,
      // and platform stack -- already proves neither call crossed into the
      // other deployment's own resident recipe binding.
      expect(currentBody.constituentAnalyses).toHaveLength(3);
      expect(retainedBody.constituentAnalyses).toHaveLength(3);
    } finally {
      restore();
    }
  });
});
