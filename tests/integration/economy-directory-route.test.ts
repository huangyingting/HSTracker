import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/economies/route";
import { ECONOMY_ROUTE_ERROR_CASES } from "../../test/fixtures/acceptance/v1/expected/error-cases";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  FIXTURE_ADAPTER_TEST_BUILD_IDS,
} from "../../test/fixtures/acceptance/v1/metadata";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";

const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("versioned Economy Directory route", () => {
  it("serves the complete fixture directory in numeric BACI-code order", async () => {
    const build = ACCEPTANCE_FIXTURE_BUILD_IDS.core;
    const url =
      `http://localhost/api/v1/analyses/${build}/economies?q=`;

    const first = await GET(new Request(url), routeContext(build));
    const firstBody = await first.text();
    const second = await GET(new Request(url), routeContext(build));

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("immutable");
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/);
    expect(await second.text()).toBe(firstBody);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    const result = JSON.parse(firstBody);
    expect(result).toMatchObject({
      schemaVersion: "economy-search-result-v1",
      analysisBuildId: build,
      query: { normalized: "", limit: 50 },
      totalMatches: 14,
      truncated: false,
    });
    expect(
      result.matches.map(
        ({ economy }: { economy: { code: string } }) => economy.code,
      ),
    ).toEqual([
      "36",
      "76",
      "124",
      "152",
      "156",
      "392",
      "404",
      "484",
      "490",
      "528",
      "616",
      "699",
      "710",
      "842",
    ]);
    expect(
      result.matches.find(
        ({ economy }: { economy: { code: string } }) =>
          economy.code === "156",
      ),
    ).toEqual({
      economy: {
        code: "156",
        iso2: "CN",
        iso3: "CHN",
        name: "China",
        identityNote: null,
      },
      match: null,
    });

    const head = await HEAD(
      new Request(url, { method: "HEAD" }),
      routeContext(build),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("cancels economy search at the two-second route deadline", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      searchEconomies(_query, options) {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    });
    const build = ACCEPTANCE_FIXTURE_BUILD_IDS.core;

    try {
      let response: Response | undefined;
      const pending = GET(
        new Request(
          `http://localhost/api/v1/analyses/${build}/economies?q=china`,
        ),
        routeContext(build),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(response).toBeDefined();
      await pending;
      expect(response?.status).toBe(503);
      await expect(response?.json()).resolves.toMatchObject({
        error: { code: "REQUEST_DEADLINE_EXCEEDED" },
      });
    } finally {
      restore();
    }
  });

  it.each([
    {
      name: "exact BACI code",
      query: "156",
      expected: [
        {
          code: "156",
          class: "EXACT_CODE",
          field: "CODE",
          matchedText: "156",
        },
      ],
    },
    {
      name: "exact ISO2 crosswalk",
      query: "cn",
      expected: [
        {
          code: "156",
          class: "EXACT_CROSSWALK",
          field: "ISO2",
          matchedText: "CN",
        },
      ],
    },
    {
      name: "exact ISO3 crosswalk",
      query: "ＣＨＮ",
      expected: [
        {
          code: "156",
          class: "EXACT_CROSSWALK",
          field: "ISO3",
          matchedText: "CHN",
        },
      ],
    },
    {
      name: "exact source name",
      query: "  CHINA  ",
      expected: [
        {
          code: "156",
          class: "EXACT_NAME",
          field: "NAME",
          matchedText: "China",
        },
      ],
    },
    {
      name: "crosswalk prefix ordered by numeric code",
      query: "ch",
      expected: [
        {
          code: "152",
          class: "CROSSWALK_PREFIX",
          field: "ISO3",
          matchedText: "CHL",
        },
        {
          code: "156",
          class: "CROSSWALK_PREFIX",
          field: "ISO3",
          matchedText: "CHN",
        },
      ],
    },
    {
      name: "source-name token containment",
      query: "states united",
      expected: [
        {
          code: "842",
          class: "NAME_TOKENS",
          field: "NAME",
          matchedText: "United States",
        },
      ],
    },
    {
      name: "source-name prefix",
      query: "south",
      expected: [
        {
          code: "710",
          class: "NAME_PREFIX",
          field: "NAME",
          matchedText: "South Africa",
        },
      ],
    },
    {
      name: "BACI code prefix",
      query: "15",
      expected: [
        {
          code: "152",
          class: "CODE_PREFIX",
          field: "CODE",
          matchedText: "152",
        },
        {
          code: "156",
          class: "CODE_PREFIX",
          field: "CODE",
          matchedText: "156",
        },
      ],
    },
  ])("searches by $name", async ({ query, expected }) => {
    const build = ACCEPTANCE_FIXTURE_BUILD_IDS.core;
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${build}/economies?q=${encodeURIComponent(query)}`,
      ),
      routeContext(build),
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.matches.map(
      ({
        economy,
        match,
      }: {
        economy: { code: string };
        match: {
          class: string;
          field: string;
          matchedText: string;
        };
      }) => ({
        code: economy.code,
        ...match,
      }),
    )).toEqual(expected);
  });

  it("caps a large prefix tie at 50 records in numeric code order", async () => {
    const build = "acceptance-economy-cap-v1";
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${build}/economies?q=fixture`,
      ),
      routeContext(build),
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.totalMatches).toBe(51);
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(50);
    expect(
      result.matches.map(
        ({ economy }: { economy: { code: string } }) => economy.code,
      ),
    ).toEqual([
      "900",
      "901",
      "902",
      "903",
      "904",
      "905",
      "906",
      "907",
      "908",
      "909",
      "910",
      "911",
      "912",
      "913",
      "914",
      "915",
      "916",
      "917",
      "918",
      "919",
      "920",
      "921",
      "922",
      "923",
      "924",
      "925",
      "926",
      "927",
      "928",
      "929",
      "930",
      "931",
      "932",
      "933",
      "934",
      "935",
      "936",
      "937",
      "938",
      "939",
      "940",
      "941",
      "942",
      "943",
      "944",
      "945",
      "946",
      "947",
      "948",
      "949",
    ]);
  });

  it.each(ECONOMY_ROUTE_ERROR_CASES)(
    "returns a typed no-store error for $name",
    async (fixture) => {
      const response = await GET(
        new Request(
          `http://localhost/api/v1/analyses/${fixture.build}/economies?${fixture.query}`,
        ),
        routeContext(fixture.build),
      );

      expect(response.status).toBe(fixture.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: { code: fixture.code, message: fixture.message },
      });
    },
  );

  it("keeps unexpected directory failures opaque and correlated", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = FIXTURE_ADAPTER_TEST_BUILD_IDS.failing;
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${build}/economies?q=china`,
      ),
      routeContext(build),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Economy search could not be completed.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Economy Directory request failed",
      expect.objectContaining({
        correlationId: body.error.correlationId,
        error: expect.any(Error),
      }),
    );
  });
});
