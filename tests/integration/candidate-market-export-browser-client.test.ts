import { describe, expect, it, vi } from "vitest";

import {
  CandidateMarketExportPreparationError,
  prepareCandidateMarketExport,
} from "../../src/app/candidate-market-export-client";
import { createFixtureCandidateMarketAnalysis } from "../../src/evidence/fixture-trade-evidence-source";
import { resolveFixtureCurrentAnalysisManifest } from "../../src/release/fixture-current-analysis";

describe("Candidate Market export browser client", () => {
  it("revalidates current context before creating the exact immutable URL", async () => {
    const result = await fixtureResult();
    const manifest = resolveFixtureCurrentAnalysisManifest();
    const refreshed = {
      ...manifest,
      productSearchBuildId: "acceptance-product-search-v2",
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

    const prepared = await prepareCandidateMarketExport({
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
      `/api/v1/analyses/acceptance-fixtures-v1/candidate-markets.csv?exporter=156&product=010121&productSearchBuildId=acceptance-product-search-v2&freshnessStatusId=${encodeURIComponent(
        refreshed.freshness.freshnessStatusId,
      )}&schema=candidate-markets-csv-v1`,
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
      prepareCandidateMarketExport({
        result,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "CandidateMarketExportPreparationError",
      code: "STALE_ANALYSIS",
    } satisfies Partial<CandidateMarketExportPreparationError>);
  });
});

async function fixtureResult() {
  return createFixtureCandidateMarketAnalysis().analyze({
    analysisBuildId: "acceptance-fixtures-v1",
    exporterCode: "156",
    productCode: "010121",
  });
}
