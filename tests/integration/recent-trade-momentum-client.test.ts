import { describe, expect, it, vi } from "vitest";

import { loadRecentTradeMomentum } from "../../src/app/recent-trade-momentum-client";
import {
  executeRecentTradeMomentumV1,
  type RecentTradeMomentumV1Payload,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-adapter";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";

async function fixturePayload(): Promise<RecentTradeMomentumV1Payload> {
  return executeRecentTradeMomentumV1(
    createFixtureApplicationRuntime().tradeAnalytics,
    {
      analysisBuildId: "acceptance-fixtures-v1",
      reporterCode: "NL",
      productCode: "010121",
    },
  );
}

describe("browser Recent Trade Momentum client", () => {
  it("loads the reporter/product route without adding exporter identity", async () => {
    const payload = await fixturePayload();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));

    await expect(
      loadRecentTradeMomentum({
        analysisBuildId: "acceptance-fixtures-v1",
        reporterIso2: "NL",
        productCode: "010121",
        expectedDatasetPackageIdentity: payload.datasetPackageIdentity,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(payload);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/analyses/acceptance-fixtures-v1/recent-trade-momentum?reporter=NL&product=010121",
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each([
    ["UNKNOWN_REPORTER", "UNKNOWN_REPORTER"],
    ["UNKNOWN_PRODUCT", "UNKNOWN_PRODUCT"],
  ] as const)("preserves the bounded route state %s", async (routeCode, clientCode) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: routeCode, message: "Not available." } },
        { status: 404 },
      ),
    );
    const payload = await fixturePayload();

    await expect(
      loadRecentTradeMomentum({
        analysisBuildId: "acceptance-fixtures-v1",
        reporterIso2: "NL",
        productCode: "010121",
        expectedDatasetPackageIdentity: payload.datasetPackageIdentity,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "RecentTradeMomentumClientError",
      code: clientCode,
      status: 404,
    });
  });

  it.each([
    ["unknown reason code", { reasonCodes: ["UNREVIEWED_REASON"] }],
    [
      "unknown confidence reason",
      { confidenceReasons: ["UNREVIEWED_CONFIDENCE_REASON"] },
    ],
    ["malformed Analysis Identity", { analysisIdentity: "analysis-identity-v1-x" }],
    [
      "malformed Dataset Package identity",
      { datasetPackageIdentity: "dataset-package-v1-x" },
    ],
    [
      "a different well-formed Dataset Package identity",
      { datasetPackageIdentity: `dataset-package-v1-${"0".repeat(64)}` },
    ],
    ["a conflicting monthly package identity", { monthlyPackageId: "stale-package" }],
  ])("rejects a payload with %s", async (_label, mutation) => {
    const payload = await fixturePayload();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ...payload, ...mutation }),
    );

    await expect(
      loadRecentTradeMomentum({
        analysisBuildId: "acceptance-fixtures-v1",
        reporterIso2: "NL",
        productCode: "010121",
        expectedDatasetPackageIdentity: payload.datasetPackageIdentity,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "RecentTradeMomentumClientError",
      code: "INVALID_PAYLOAD",
    });
  });
});
