import { describe, expect, it, vi } from "vitest";

import {
  prepareTradeExplorerExport,
  TradeExplorerExportPreparationError,
} from "../../src/app/trade-explorer-export-client";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";

describe("Trade Explorer export browser client", () => {
  it("preflights retained results against their exact manifest without replacing the current manifest", async () => {
    const runtime = createFixtureApplicationRuntime();
    const current = runtime.currentAnalysis();
    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "trade-explorer-v1",
      analysisBuildId: current.analysisBuildId,
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });
    if (outcome.state !== "success") {
      throw new TypeError("Expected the fixture platform oracle to succeed.");
    }

    const retainedBuildId = "retained-analysis-v1";
    const retainedFreshnessStatusId = "freshness:retained-analysis-v1";
    const retained = {
      ...current,
      analysisBuildId: retainedBuildId,
      freshness: {
        ...current.freshness,
        freshnessStatusId: retainedFreshnessStatusId,
      },
    };
    const result = {
      ...outcome.payload,
      analysisBuildId: retainedBuildId,
      analysisIdentity: outcome.analysisIdentity,
      datasetPackageIdentity: outcome.datasetPackageIdentity,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/analyses/current") {
        return Response.json(current);
      }
      if (
        url ===
        `/api/v1/analyses/${encodeURIComponent(retainedBuildId)}/manifest`
      ) {
        return Response.json(retained);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const prepared = await prepareTradeExplorerExport({
      result,
      fetcher,
      signal: new AbortController().signal,
    });

    expect(prepared.manifest).toEqual(current);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(prepared.url).toContain(
      `/api/v1/analyses/${retainedBuildId}/trade-explorer.csv?`,
    );
    expect(new URL(prepared.url, "http://localhost").searchParams.get(
      "freshnessStatusId",
    )).toBe(retainedFreshnessStatusId);

    const retiredFetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/v1/analyses/current"
        ? Response.json(current)
        : Response.json(
            {
              error: {
                code: "ANALYSIS_BUILD_RETIRED",
                message: "The analysis build is no longer retained.",
              },
            },
            { status: 410 },
          ),
    ) as unknown as typeof fetch;
    await expect(
      prepareTradeExplorerExport({
        result,
        fetcher: retiredFetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: TradeExplorerExportPreparationError.name,
      manifest: current,
    });
  });
});
