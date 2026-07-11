import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import { ANALYSIS_ROUTE_ERROR_CASES } from "../../test/fixtures/acceptance/v1/expected/error-cases";
import { FIXTURE_ADAPTER_TEST_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioned Candidate Market route", () => {
  it("serves deterministic immutable GET and HEAD representations", async () => {
    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";

    const first = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
    const firstBody = await first.text();
    const second = await GET(
      new Request(url),
      routeContext("acceptance-fixtures-v1"),
    );
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
      schemaVersion: "candidate-market-result-v1",
      cohortSize: 13,
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

  it("returns a cacheable empty representation for a valid empty query", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=851712",
      ),
      routeContext("acceptance-fixtures-v1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    await expect(response.json()).resolves.toMatchObject({
      cohortSize: 0,
      emptyReason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      candidates: [],
    });
  });

  it.each(ANALYSIS_ROUTE_ERROR_CASES)(
    "returns a typed no-store error for $name",
    async (fixture) => {
      const response = await GET(
        new Request(
          `http://localhost/api/v1/analyses/${fixture.build}/candidate-markets?${fixture.query}`,
        ),
        routeContext(fixture.build),
      );

      expect(response.status).toBe(fixture.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(response.json()).resolves.toMatchObject({
        error: { code: fixture.code, message: fixture.message },
      });
    },
  );

  it("keeps unexpected adapter failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${FIXTURE_ADAPTER_TEST_BUILD_IDS.failing}/candidate-markets?exporter=156&product=010121`,
      ),
      routeContext(FIXTURE_ADAPTER_TEST_BUILD_IDS.failing),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Candidate Market analysis could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain("fixture adapter failure");
    expect(errorLog).toHaveBeenCalledWith(
      "Candidate Market analysis request failed",
      expect.objectContaining({
        correlationId: body.error.correlationId,
        error: expect.any(Error),
      }),
    );
  });
});
