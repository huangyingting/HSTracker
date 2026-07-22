import { describe, expect, it, vi } from "vitest";

import { loadCompleteOpportunityFeed } from "../../src/app/opportunity-feed-pages";
import { executeOpportunityDiscoveryV1 } from "../../src/domain/trade-analytics/opportunity-discovery-v1-adapter";
import {
  OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION,
  serializeOpportunityDiscoveryCsv,
} from "../../src/export/opportunity-discovery-csv";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";

const ANALYSIS_BUILD_ID = "opportunity-discovery-fixtures-v1";

describe("Opportunity Discovery complete CSV", () => {
  it("serializes every canonical row with analytical and Dataset Package identity", async () => {
    const runtime = createFixtureApplicationRuntime();
    const page = await executeOpportunityDiscoveryV1(runtime.tradeAnalytics, {
      analysisBuildId: ANALYSIS_BUILD_ID,
      exportEconomyCode: "100",
      page: { limit: 100, cursor: null },
    });

    const exported = serializeOpportunityDiscoveryCsv({
      page,
      candidateKeys: null,
      scope: "cross-product",
    });
    const text = new TextDecoder().decode(exported.bytes);

    expect(exported.schemaVersion).toBe(
      OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION,
    );
    expect(exported.rowCount).toBe(page.cohortSize);
    expect([...exported.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain(`"${page.analysisIdentity}"`);
    expect(text).toContain(`"${page.datasetPackageIdentity}"`);
    expect(text.split("\r\n")).toHaveLength(page.cohortSize + 2);
    expect(
      serializeOpportunityDiscoveryCsv({
        page,
        candidateKeys: null,
        scope: "cross-product",
      }).bytes,
    ).toEqual(exported.bytes);
  });

  it("exports the complete selected portfolio projection in canonical order", async () => {
    const runtime = createFixtureApplicationRuntime();
    const page = await executeOpportunityDiscoveryV1(runtime.tradeAnalytics, {
      analysisBuildId: ANALYSIS_BUILD_ID,
      exportEconomyCode: "100",
      page: { limit: 100, cursor: null },
    });
    const selected = page.candidates.at(-1)!;

    const exported = serializeOpportunityDiscoveryCsv({
      page,
      candidateKeys: [
        `${selected.product.code}:${selected.market.code}`,
      ],
      scope: "portfolio",
    });
    const text = new TextDecoder().decode(exported.bytes);

    expect(exported.rowCount).toBe(1);
    expect(text).toContain(`"${selected.product.code}"`);
    expect(text).toContain(`"${selected.market.code}"`);
  });

  it("loads every continuation before allowing serialization", async () => {
    const runtime = createFixtureApplicationRuntime();
    const firstPage = await executeOpportunityDiscoveryV1(
      runtime.tradeAnalytics,
      {
        analysisBuildId: ANALYSIS_BUILD_ID,
        exportEconomyCode: "100",
        page: { limit: 1, cursor: null },
      },
    );
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      const next = await executeOpportunityDiscoveryV1(
        runtime.tradeAnalytics,
        {
          analysisBuildId: ANALYSIS_BUILD_ID,
          exportEconomyCode: url.searchParams.get("exporter")!,
          page: {
            limit: Number(url.searchParams.get("limit")),
            cursor: url.searchParams.get("cursor"),
          },
        },
      );
      return Response.json(next);
    });

    expect(() =>
      serializeOpportunityDiscoveryCsv({
        page: firstPage,
        candidateKeys: null,
        scope: "cross-product",
      }),
    ).toThrow(/complete underlying candidate cohort/u);

    const complete = await loadCompleteOpportunityFeed({
      page: firstPage,
      fetcher,
      signal: new AbortController().signal,
    });

    expect(complete.candidates).toHaveLength(complete.cohortSize);
    expect(complete.page.nextCursor).toBeNull();
    expect(fetcher).toHaveBeenCalled();
    expect(
      serializeOpportunityDiscoveryCsv({
        page: complete,
        candidateKeys: null,
        scope: "cross-product",
      }).rowCount,
    ).toBe(complete.cohortSize);
  });
});
