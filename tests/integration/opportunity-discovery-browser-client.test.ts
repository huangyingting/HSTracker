import { describe, expect, it, vi } from "vitest";

import {
  loadMarketInvestigationPage,
  loadOpportunityDetail,
  OpportunityDiscoveryClientError,
} from "../../src/app/opportunity-discovery-client";
import type {
  MarketInvestigationCandidate,
  MarketInvestigationPage,
} from "../../src/domain/opportunity-discovery/result";
import type { OpportunityDetailEvidence } from "../../src/evidence/opportunity-evidence-source";

const candidate: MarketInvestigationCandidate = {
  product: {
    hsRevision: "HS12",
    code: "010001",
    descriptionEn: "Fixture product one",
  },
  market: {
    code: "400",
    name: "Beta",
    iso3: "BET",
    identityNote: null,
  },
  investigationPriority: { rawUnrounded: "78.000000", display: 78 },
  marketAttractiveness: { rawUnrounded: "71.000000", display: 71 },
  exporterFit: { rawUnrounded: "87.000000", display: 87 },
  components: {
    marketSize: component(83),
    marketGrowth: component(50),
    exporterProductPresence: component(90),
    recordedFoothold: component(82),
  },
  opportunityType: "EXPANSION_EVIDENCE",
  opportunityTypeCopy:
    "Recorded exporter foothold with supportive public trade evidence.",
  bilateralFlowState: "RECORDED",
  bilateralWording:
    "The selected exporter has recorded positive bilateral flow in the finalized window.",
  observedMarketYears: [2019, 2020, 2021, 2022, 2023],
  missingMarketYears: [],
  confidence: {
    score: 100,
    label: "HIGH",
    deductions: [],
    sparseEvidenceCapApplied: false,
  },
  stability: {
    threeYear: {
      window: { start: 2021, end: 2023 },
      state: "NOT_FLAGGED",
      priorityDelta: null,
    },
    tenYear: {
      window: { start: 2014, end: 2023 },
      state: "NOT_FLAGGED",
      priorityDelta: null,
    },
  },
  releaseRevision: {
    state: "NOT_COMPARED",
    priorityDelta: null,
    rankPercentileDelta: null,
    cohortTransition: null,
  },
  evidenceFlags: [],
  competitionRank: 1,
  competitionRankTieSize: 1,
  candidateMarketDrillDown: {
    recipe: "candidate-market-v1",
    exporterCode: "100",
    product: {
      hsRevision: "HS12",
      code: "010001",
      descriptionEn: "Fixture product one",
    },
    focusMarketCode: "400",
  },
};

const detail: OpportunityDetailEvidence = {
  analysisBuildId: "build-one",
  exporter: {
    code: "100",
    name: "Homeland",
    iso3: "HML",
    identityNote: null,
  },
  product: candidate.product,
  market: candidate.market,
  candidateMarketDrillDown: candidate.candidateMarketDrillDown,
  scoreWindow: { start: 2019, end: 2023 },
  marketYears: [
    { year: 2023, worldValueKusd: "2100", bilateralValueKusd: "500" },
  ],
};

describe("browser Opportunity Discovery client", () => {
  it("loads all-product and confirmed-product projections with the same canonical row values", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      const products = url.searchParams.get("products");
      return Response.json(
        page(products === null ? null : products.split(",")),
      );
    });
    const signal = new AbortController().signal;

    const allProducts = await loadMarketInvestigationPage({
      analysisBuildId: "build-one",
      exporterCode: "100",
      productCodes: null,
      limit: 20,
      cursor: null,
      fetcher,
      signal,
    });
    const capabilityDiscovery = await loadMarketInvestigationPage({
      analysisBuildId: "build-one",
      exporterCode: "100",
      productCodes: ["010001"],
      limit: 20,
      cursor: null,
      fetcher,
      signal,
    });
    const knownProductSearch = await loadMarketInvestigationPage({
      analysisBuildId: "build-one",
      exporterCode: "100",
      productCodes: ["010001"],
      limit: 20,
      cursor: null,
      fetcher,
      signal,
    });

    expect([
      rowValues(allProducts),
      rowValues(capabilityDiscovery),
      rowValues(knownProductSearch),
    ]).toEqual([
      ["010001", "400", 78, 71, 87],
      ["010001", "400", 78, 71, 87],
      ["010001", "400", 78, 71, 87],
    ]);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/v1/analyses/build-one/opportunities?exporter=100&limit=20",
      "/api/v1/analyses/build-one/opportunities?exporter=100&limit=20&products=010001",
      "/api/v1/analyses/build-one/opportunities?exporter=100&limit=20&products=010001",
    ]);
  });

  it("rejects malformed feed payloads with a typed error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...page(null), candidates: [{}] }));

    await expect(
      loadMarketInvestigationPage({
        analysisBuildId: "build-one",
        exporterCode: "100",
        productCodes: null,
        limit: 20,
        cursor: null,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "OpportunityDiscoveryClientError",
      code: "INVALID_PAGE",
    });
  });

  it("loads a selected candidate detail and rejects malformed detail payloads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail));
    await expect(
      loadOpportunityDetail({
        analysisBuildId: "build-one",
        exporterCode: "100",
        productCode: "010001",
        importerCode: "400",
        fetcher,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(detail);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/analyses/build-one/opportunities/010001/400?exporter=100",
      { signal: expect.any(AbortSignal) },
    );

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await expect(
      loadOpportunityDetail({
        analysisBuildId: "build-one",
        exporterCode: "100",
        productCode: "010001",
        importerCode: "400",
        fetcher: malformed,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(OpportunityDiscoveryClientError);
  });

  it("reports HTTP failures with status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("retired", { status: 410 }),
    );

    await expect(
      loadMarketInvestigationPage({
        analysisBuildId: "build-one",
        exporterCode: "100",
        productCodes: null,
        limit: 20,
        cursor: null,
        fetcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 410,
    });
  });
});

function component(percentileDisplay: number) {
  return {
    state: "COMPUTED" as const,
    rawValue: "1",
    percentileUnrounded: String(percentileDisplay),
    percentileBasisPoints: percentileDisplay * 100,
    percentileDisplay,
  };
}

function page(productCodes: readonly string[] | null): MarketInvestigationPage {
  return {
    schemaVersion: "market-investigation-result-v1",
    analysisBuildId: "build-one",
    exporter: detail.exporter,
    provenance: {
      baciRelease: "V202601",
      sourceUpdateDate: "2026-07-16",
      hsRevision: "HS12",
      finalizedCutoffYear: 2023,
      scoreWindow: { start: 2019, end: 2023 },
      provisionalYear: 2024,
      recipeVersion: "opportunity-discovery-v1",
      resultSchemaVersion: "market-investigation-result-v1",
      artifactBuildId: "artifact-one",
      artifactSchemaVersion: "opportunity-index-v1",
      artifactSha256: "f".repeat(64),
      valueUnit: "CURRENT_USD",
    },
    cohortSize: 6,
    projection: { productCodes },
    page: {
      limit: 20,
      requestedCursor: null,
      nextCursor: null,
      returnedCount: 1,
    },
    candidates: [candidate],
    nonClaims: [
      "Candidates are ranked from public BACI trade evidence, not forecasts or success probabilities.",
    ],
    discoveryDisclaimer:
      "Market Investigation Candidates are public BACI trade evidence for further investigation.",
  };
}

function rowValues(page: MarketInvestigationPage) {
  const first = page.candidates[0]!;
  return [
    first.product.code,
    first.market.code,
    first.investigationPriority.display,
    first.marketAttractiveness.display,
    first.exporterFit.display,
  ] as const;
}
