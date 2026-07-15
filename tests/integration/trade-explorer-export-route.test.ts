import { describe, expect, it } from "vitest";

import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer.csv/route";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { serializeTradeExplorerCsv } from "../../src/export/trade-explorer-csv";
import { TRADE_EXPLORERS_CSV_SCHEMA_VERSION } from "../../src/export/trade-explorer-csv-contract";

const manifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);
const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});

function exportUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    shape: "finalized-trend-v1",
    measures: "TRADE_VALUE_USD",
    exportEconomy: "156",
    importEconomy: "528",
    hsProduct: "010121",
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schema: TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
    ...overrides,
  });
  return `http://localhost/api/v1/analyses/${manifest.analysisBuildId}/trade-explorer.csv?${params}`;
}

describe("versioned Trade Explorer CSV route", () => {
  it("serves matching deterministic GET, conditional GET, and HEAD metadata", async () => {
    const fixture = createFixtureApplicationRuntime();
    const outcome = await fixture.tradeAnalytics.execute({
      recipe: "trade-explorer-v1",
      analysisBuildId: manifest.analysisBuildId,
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
    const freshness = fixture.resolveFreshnessStatus(
      manifest.freshness.freshnessStatusId,
    );
    if (freshness === null) {
      throw new TypeError("Expected the fixture freshness dependency.");
    }
    const platformCsv = serializeTradeExplorerCsv({
      result: {
        ...outcome.payload,
        analysisIdentity: outcome.analysisIdentity,
        datasetPackageIdentity: outcome.datasetPackageIdentity,
      },
      manifest: { ...manifest, freshness },
    });

    const first = await GET(
      new Request(exportUrl()),
      routeContext(manifest.analysisBuildId),
    );
    const bytes = new Uint8Array(await first.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8; header=present",
    );
    expect(first.headers.get("content-disposition")).toBe(
      `attachment; filename="${platformCsv.filename}"`,
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(bytes).toEqual(platformCsv.bytes);

    const etag = first.headers.get("etag")!;
    const notModified = await GET(
      new Request(exportUrl(), { headers: { "If-None-Match": etag } }),
      routeContext(manifest.analysisBuildId),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const head = await HEAD(
      new Request(exportUrl(), { method: "HEAD" }),
      routeContext(manifest.analysisBuildId),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
  });

  it("returns 404 when the freshness status is unknown", async () => {
    const response = await GET(
      new Request(exportUrl({ freshnessStatusId: "freshness:unknown" })),
      routeContext(manifest.analysisBuildId),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FRESHNESS_STATUS_NOT_FOUND" },
    });
  });

  it("returns 400 for an unsupported export schema", async () => {
    const response = await GET(
      new Request(exportUrl({ schema: "trade-explorers-csv-v0" })),
      routeContext(manifest.analysisBuildId),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_EXPORT_SCHEMA" },
    });
  });

  it("rejects an unrecognized query parameter", async () => {
    const response = await GET(
      new Request(exportUrl({ extra: "1" })),
      routeContext(manifest.analysisBuildId),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ANALYSIS_QUERY" },
    });
  });

  it("exposes only GET and HEAD", async () => {
    const routeModule = await import(
      "../../src/app/api/v1/analyses/[analysisBuildId]/trade-explorer.csv/route"
    );
    expect(Object.keys(routeModule).sort()).toEqual(
      ["GET", "HEAD", "dynamic", "runtime"].sort(),
    );
  });
});
