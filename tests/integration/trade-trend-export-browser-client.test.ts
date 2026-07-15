import { describe, expect, it, vi } from "vitest";

import {
  TradeTrendExportPreparationError,
  prepareTradeTrendExport,
} from "../../src/app/trade-trend-export-client";
import { resolveFixtureCurrentAnalysisManifest } from "../../src/release/fixture-current-analysis";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";

describe("Trade Trend export browser client", () => {
  it("revalidates current context before creating the exact immutable URL", async () => {
    const result = await fixtureResult();
    const manifest = resolveFixtureCurrentAnalysisManifest();
    const refreshed = {
      ...manifest,
      productSearchBuildId: "acceptance-product-search-v3",
      freshness: {
        ...manifest.freshness,
        freshnessStatusId: `${manifest.freshness.freshnessStatusId}-refreshed`,
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();

    const prepared = await prepareTradeTrendExport({
      result,
      fetcher,
      signal: controller.signal,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/v1/analyses/current", {
      cache: "no-store",
      signal: controller.signal,
    });
    expect(prepared.manifest).toEqual(refreshed);
    expect(prepared.url).toBe(
      `/api/v1/analyses/acceptance-fixtures-v1/trade-trends.csv?importer=528&product=010121&productSearchBuildId=acceptance-product-search-v3&freshnessStatusId=${encodeURIComponent(
        refreshed.freshness.freshnessStatusId,
      )}&schema=trade-trends-csv-v1`,
    );
  });

  it("stops when the revalidated manifest no longer describes the result", async () => {
    const result = await fixtureResult();
    const manifest = resolveFixtureCurrentAnalysisManifest();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...manifest,
          analysisBuildId: "replacement-analysis-v2",
        }),
        { status: 200 },
      ),
    );

    await expect(
      prepareTradeTrendExport({
        result,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "TradeTrendExportPreparationError",
      code: "STALE_ANALYSIS",
    } satisfies Partial<TradeTrendExportPreparationError>);
  });
});

async function fixtureResult() {
  const outcome =
    await createFixtureApplicationRuntime().tradeAnalytics.execute({
      recipe: "trade-trend-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      importerCode: "528",
      productCode: "010121",
    });
  if (outcome.state !== "success") {
    throw new TypeError(`Expected success, received ${outcome.state}.`);
  }
  return {
    ...outcome.payload,
    analysisIdentity: outcome.analysisIdentity,
    datasetPackageIdentity: outcome.datasetPackageIdentity,
  };
}
