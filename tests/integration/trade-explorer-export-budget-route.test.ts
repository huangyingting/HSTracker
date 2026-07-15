import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/export/trade-explorer-csv", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/export/trade-explorer-csv")>();
  return {
    ...actual,
    serializeTradeExplorerCsv() {
      throw new actual.TradeExplorerCsvRepresentationError(
        "Trade Explorer export exceeds its representation budget.",
      );
    },
  };
});

import { GET } from "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer.csv/route";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import { TRADE_EXPLORERS_CSV_SCHEMA_VERSION } from "../../src/export/trade-explorer-csv-contract";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";

const manifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);

describe("Trade Explorer export representation budget", () => {
  it("maps CSV representation overflow to the typed export budget response", async () => {
    const params = new URLSearchParams({
      shape: "finalized-trend-v1",
      measures: "TRADE_VALUE_USD",
      exportEconomy: "156",
      importEconomy: "528",
      hsProduct: "010121",
      freshnessStatusId: manifest.freshness.freshnessStatusId,
      schema: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
    });
    const response = await GET(
      new Request(
        `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/trade-explorer.csv?${params}`,
      ),
      { params: Promise.resolve({ analysisBuildId: manifest.analysisBuildId }) },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ANALYSIS_BUDGET_EXCEEDED",
        message:
          "The complete Trade Explorer result exceeds its serving budget.",
      },
    });
  });
});
