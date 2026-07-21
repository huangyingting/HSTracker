import { describe, expect, it, vi } from "vitest";

import { createMarketAnalysis } from "../../src/domain/market-analysis/market-analysis";
import type { MarketAnalysisV1 } from "../../src/domain/market-analysis/result";
import {
  loadMarketAnalysis,
  MarketAnalysisClientError,
} from "../../src/app/market-analysis-client";
import {
  candidateMarketSuccess,
  supplierCompetitionSuccess,
  tradeTrendSuccess,
  platformReturning,
} from "../support/market-analysis-platform-stub";

// The browser client is the "seam #2" pre-agreed for issue #68: a typed
// fetch wrapper for the existing immutable
// /api/v1/analyses/{id}/market-analysis route (Slice 3), mirroring the
// pattern opportunity-discovery-client.ts already establishes for
// Opportunity Discovery/detail/Recent Momentum. It never re-derives the
// Module's own values -- it only fetches and structurally validates the
// exact market-analysis-v1 JSON shape.

async function fixturePayload(): Promise<MarketAnalysisV1> {
  const platform = platformReturning({
    candidateMarket: candidateMarketSuccess(),
    tradeTrend: tradeTrendSuccess(),
    supplierCompetition: supplierCompetitionSuccess(),
  });
  return createMarketAnalysis(platform).load({
    analysisBuildId: "stub-build",
    exportEconomyCode: "156",
    productCode: "010121",
    marketCode: "528",
  });
}

describe("browser Market Analysis client", () => {
  it("fetches the exact immutable route with exporter/product/market parameters and returns the typed payload", async () => {
    const payload = await fixturePayload();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));

    await expect(
      loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "528",
        fetcher,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(payload);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/analyses/stub-build/market-analysis?exporter=156&product=010121&market=528",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("rejects a malformed market-analysis payload with a typed error", async () => {
    const payload = await fixturePayload();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ...payload, opportunity: {} }),
    );

    await expect(
      loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "528",
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "MarketAnalysisClientError",
      code: "INVALID_MARKET_ANALYSIS",
    });
  });

  it("reports HTTP failures with status", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("retired", { status: 410 }));

    await expect(
      loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "528",
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "MarketAnalysisClientError",
      code: "HTTP_ERROR",
      status: 410,
    });
  });

  it("exposes the route's own public error code alongside HTTP status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "CANDIDATE_MARKET_NOT_FOUND",
            message: "The requested market is not a Candidate Market.",
          },
        },
        { status: 404 },
      ),
    );

    await expect(
      loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "999",
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "MarketAnalysisClientError",
      code: "HTTP_ERROR",
      status: 404,
      publicCode: "CANDIDATE_MARKET_NOT_FOUND",
    });
  });

  it("propagates fetch abort without a client error", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await expect(
      loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "528",
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("is a MarketAnalysisClientError instance", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 503 }));
    try {
      await loadMarketAnalysis({
        analysisBuildId: "stub-build",
        exportEconomyCode: "156",
        productCode: "010121",
        marketCode: "528",
        fetcher,
        signal: new AbortController().signal,
      });
      expect.unreachable("expected loadMarketAnalysis to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketAnalysisClientError);
    }
  });
});
