import { describe, expect, it } from "vitest";

import {
  computeOpportunityCohort,
  type OpportunityCohort,
} from "../../src/domain/opportunity-discovery/opportunity-discovery-v1";
import { unavailableOpportunityAnalysisBuild } from "../../src/domain/opportunity-discovery/errors";
import type {
  OpportunityCandidateIndex,
  OpportunityDiscoveryV1CohortInputs,
  OpportunityMarketEvidence,
  OpportunityProductEvidence,
} from "../../src/evidence/opportunity-evidence-source";
import type {
  EconomyIdentity,
  MarketInvestigationPage,
  ProductIdentity,
} from "../../src/domain/opportunity-discovery/result";
import {
  createFixtureOpportunityDiscoveryDatasetPackages,
  FixtureOpportunityCandidateIndex,
  FixtureOpportunityEvidenceSource,
  OPPORTUNITY_FIXTURE_CONTENT_SHA256,
} from "../../src/evidence/fixture-opportunity-source";
import {
  createOpportunityDiscoveryDatasetPackage,
  OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/opportunity-discovery-v1-dataset-package";
import {
  createTradeAnalyticsPlatform,
  type OpportunityDiscoveryV1AnalysisRequest,
  type TradeAnalyticsPlatform,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  OPPORTUNITY_FIXTURE_BUILD_ID,
  OPPORTUNITY_FIXTURE_COHORTS,
} from "../../fixtures/opportunity-discovery/v1/cohort";

// --- compact cohort builders for focused domain oracles ---

const W5 = [2019, 2020, 2021, 2022, 2023];
const eco = (code: string): EconomyIdentity => ({
  code,
  name: `E${code}`,
  iso3: null,
  identityNote: null,
});
const prod = (code: string): ProductIdentity => ({
  hsRevision: "HS12",
  code,
  descriptionEn: `P${code}`,
});
const productEvidence = (
  product: ProductIdentity,
  exportPerYear: number,
): OpportunityProductEvidence => ({
  product,
  worldYearTotals: W5.map((year) => ({ year, worldValueKusd: "10000" })),
  exporterExportTotals: W5.map((year) => ({
    year,
    valueKusd: String(exportPerYear),
  })),
});
const marketEvidence = (
  product: ProductIdentity,
  market: EconomyIdentity,
  world: readonly number[],
  bilateral: number | null,
): OpportunityMarketEvidence => ({
  product,
  market,
  marketYears: W5.map((year, index) => ({
    year,
    worldValueKusd: String(world[index]),
    bilateralValueKusd: bilateral === null ? null : String(bilateral),
  })),
});
function focusCohort(
  products: readonly OpportunityProductEvidence[],
  markets: readonly OpportunityMarketEvidence[],
): OpportunityCohort {
  return computeOpportunityCohort({
    analysisBuildId: "focus",
    artifact: {
      baciRelease: "x",
      buildId: "focus",
      schemaVersion: "opportunity-index-v1",
      sha256: "f".repeat(64),
    },
    release: {
      baciRelease: "x",
      sourceUpdateDate: "2026-01-01",
      hsRevision: "HS12",
      ingestedYears: { start: 2019, end: 2024 },
      finalizedCutoffYear: 2023,
      provisionalYear: 2024,
    },
    exporter: eco("100"),
    products,
    markets,
  });
}

const keyOf = (candidate: { product: { code: string }; market: { code: string } }) =>
  `${candidate.product.code}|${candidate.market.code}`;

// --- fixture platform helper ---

function fixturePlatform(
  index: OpportunityCandidateIndex = new FixtureOpportunityCandidateIndex(),
): TradeAnalyticsPlatform {
  return createTradeAnalyticsPlatform({
    opportunityDiscovery: {
      candidateIndex: index,
      datasetPackages: createFixtureOpportunityDiscoveryDatasetPackages(),
    },
  });
}

function request(
  overrides: Partial<OpportunityDiscoveryV1AnalysisRequest> = {},
): OpportunityDiscoveryV1AnalysisRequest {
  return {
    recipe: "opportunity-discovery-v1",
    analysisBuildId: OPPORTUNITY_FIXTURE_BUILD_ID,
    exportEconomyCode: "100",
    ...overrides,
  };
}

async function expectSuccess(
  platform: TradeAnalyticsPlatform,
  overrides: Partial<OpportunityDiscoveryV1AnalysisRequest> = {},
): Promise<MarketInvestigationPage> {
  const outcome = await platform.execute(request(overrides));
  if (outcome.state !== "success") {
    throw new Error(`Expected success, received ${outcome.state}.`);
  }
  return outcome.payload;
}

describe("opportunity-discovery-v1 domain oracle (recipe doc 10.1)", () => {
  const cohort = computeOpportunityCohort(OPPORTUNITY_FIXTURE_COHORTS[0]);

  it("emits exactly the six eligible exporter-100 rows in canonical order", () => {
    expect(cohort.candidates.map(keyOf)).toEqual([
      "010001|400",
      "010001|300",
      "010002|500",
      "010002|300",
      "010003|500",
      "010003|400",
    ]);
  });

  it("pins every axis display, type, confidence, rank, and bilateral state", () => {
    const pinned = cohort.candidates.map((candidate) => ({
      key: keyOf(candidate),
      priority: candidate.investigationPriority.display,
      attractiveness: candidate.marketAttractiveness.display,
      fit: candidate.exporterFit.display,
      type: candidate.opportunityType,
      confidence: candidate.confidence.score,
      band: candidate.confidence.label,
      bilateral: candidate.bilateralFlowState,
      rank: candidate.competitionRank,
      tie: candidate.competitionRankTieSize,
    }));
    expect(pinned).toEqual([
      {
        key: "010001|400",
        priority: 78,
        attractiveness: 71,
        fit: 87,
        type: "EXPANSION_EVIDENCE",
        confidence: 100,
        band: "HIGH",
        bilateral: "RECORDED",
        rank: 1,
        tie: 1,
      },
      {
        key: "010001|300",
        priority: 75,
        attractiveness: 90,
        fit: 57,
        type: "UNVALIDATED_MARKET_GAP",
        confidence: 100,
        band: "HIGH",
        bilateral: "NO_RECORDED_POSITIVE_FLOW",
        rank: 2,
        tie: 1,
      },
      {
        key: "010002|500",
        priority: 57,
        attractiveness: 55,
        fit: 60,
        type: "GENERAL_INVESTIGATION_EVIDENCE",
        confidence: 40,
        band: "LOW",
        bilateral: "RECORDED",
        rank: 3,
        tie: 1,
      },
      {
        key: "010002|300",
        priority: 37,
        attractiveness: 23,
        fit: 53,
        type: "GENERAL_INVESTIGATION_EVIDENCE",
        confidence: 90,
        band: "HIGH",
        bilateral: "RECORDED",
        rank: 4,
        tie: 1,
      },
      {
        key: "010003|500",
        priority: 30,
        attractiveness: 40,
        fit: 17,
        type: "GENERAL_INVESTIGATION_EVIDENCE",
        confidence: 80,
        band: "HIGH",
        bilateral: "NO_RECORDED_POSITIVE_FLOW",
        rank: 5,
        tie: 1,
      },
      {
        key: "010003|400",
        priority: 23,
        attractiveness: 21,
        fit: 27,
        type: "GENERAL_INVESTIGATION_EVIDENCE",
        confidence: 80,
        band: "HIGH",
        bilateral: "RECORDED",
        rank: 6,
        tie: 1,
      },
    ]);
  });

  it("pins the unrounded investigation priority decimals", () => {
    const byKey = new Map(
      cohort.candidates.map((candidate) => [
        keyOf(candidate),
        candidate.investigationPriority.rawUnrounded,
      ]),
    );
    expect(byKey.get("010001|400")).toBe("77.843750");
    expect(byKey.get("010001|300")).toBe("75.114583");
    expect(byKey.get("010002|500")).toBe("57.479167");
    expect(byKey.get("010002|300")).toBe("36.604167");
    expect(byKey.get("010003|500")).toBe("29.614583");
    expect(byKey.get("010003|400")).toBe("23.343750");
  });

  it("shares an exact average midrank for the tied zero-foothold rows", () => {
    const gap = cohort.candidates.find((c) => keyOf(c) === "010001|300");
    const general = cohort.candidates.find((c) => keyOf(c) === "010003|500");
    expect(gap?.components.recordedFoothold.percentileUnrounded).toBe(
      "16.666667",
    );
    expect(general?.components.recordedFoothold.percentileUnrounded).toBe(
      "16.666667",
    );
    expect(gap?.components.recordedFoothold.evidenceTag).toBe(
      "NO_RECORDED_POSITIVE_FLOW",
    );
  });

  it("keeps the Market Size pool strictly ordered", () => {
    const sizes = cohort.candidates.map(
      (c) => c.components.marketSize.percentileUnrounded,
    );
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("records one two-year and one small-base growth neutral", () => {
    const twoYear = cohort.candidates.find((c) => keyOf(c) === "010002|500");
    const smallBase = cohort.candidates.find((c) => keyOf(c) === "010002|300");
    expect(twoYear?.components.marketGrowth.state).toBe("NEUTRAL");
    expect(twoYear?.components.marketGrowth.neutralReasonCodes).toEqual([
      "TOO_FEW_OBSERVED_YEARS",
    ]);
    expect(smallBase?.components.marketGrowth.neutralReasonCodes).toEqual([
      "SMALL_MARKET_BASE",
    ]);
  });

  it("flags the no-exporter-product-history rows", () => {
    for (const key of ["010003|500", "010003|400"]) {
      const row = cohort.candidates.find((c) => keyOf(c) === key);
      expect(row?.components.exporterProductPresence.evidenceTag).toBe(
        "NO_RECORDED_PRODUCT_EXPORT",
      );
    }
  });

  it("applies the at-most-two-year confidence cap with its deductions", () => {
    const capped = cohort.candidates.find((c) => keyOf(c) === "010002|500");
    expect(capped?.confidence.score).toBe(40);
    expect(capped?.confidence.sparseEvidenceCapApplied).toBe(true);
    expect(capped?.confidence.deductions).toEqual([
      { code: "MISSING_FINALIZED_MARKET_YEARS", points: 30 },
      { code: "NEUTRAL_MARKET_GROWTH", points: 10 },
    ]);
  });

  it("hits the Exporter Fit threshold exactly at 60", () => {
    const boundary = cohort.candidates.find((c) => keyOf(c) === "010002|500");
    expect(boundary?.exporterFit.rawUnrounded).toBe("60.000000");
  });
});

describe("opportunity-discovery-v1 focused domain oracles", () => {
  it("resolves gap precedence over expansion when a row satisfies both", () => {
    const products = Array.from({ length: 8 }, (_unused, index) =>
      productEvidence(
        prod(`0100${String(10 + index).padStart(2, "0")}`),
        [9000, 800, 700, 600, 500, 400, 300, 200][index],
      ),
    );
    const markets: OpportunityMarketEvidence[] = [
      marketEvidence(products[0].product, eco("300"), [2000, 2400, 2800, 3200, 4000], 30),
      marketEvidence(products[1].product, eco("400"), [500, 500, 500, 500, 500], 1),
    ];
    for (let index = 2; index < 8; index += 1) {
      markets.push(
        marketEvidence(products[index].product, eco("500"), [600, 600, 600, 600, 600], 300),
      );
    }
    const target = focusCohort(products, markets).candidates.find(
      (c) => keyOf(c) === "010010|300",
    );
    expect(target).toBeDefined();
    // Satisfies expansion (RECORDED, MA>=60, EF>=60) AND gap (MA>=70, foothold<=20).
    expect(target?.bilateralFlowState).toBe("RECORDED");
    expect(Number(target?.marketAttractiveness.rawUnrounded)).toBeGreaterThanOrEqual(70);
    expect(Number(target?.exporterFit.rawUnrounded)).toBeGreaterThanOrEqual(60);
    expect(Number(target?.components.recordedFoothold.percentileUnrounded)).toBeLessThanOrEqual(20);
    expect(target?.opportunityType).toBe("UNVALIDATED_MARKET_GAP");
  });

  it("deducts the identity-proxy penalty for economy code 490", () => {
    const products = [
      productEvidence(prod("010001"), 3000),
      productEvidence(prod("010002"), 2000),
    ];
    const markets = [
      marketEvidence(products[0].product, eco("490"), [1000, 1100, 1200, 1300, 1500], 200),
      marketEvidence(products[1].product, eco("300"), [1000, 1100, 1200, 1300, 1500], 200),
    ];
    const cohort = focusCohort(products, markets);
    const proxied = cohort.candidates.find((c) => c.market.code === "490");
    const plain = cohort.candidates.find((c) => c.market.code === "300");
    expect(proxied?.evidenceFlags).toContain("IDENTITY_PROXY");
    expect(proxied?.confidence.deductions).toContainEqual({
      code: "IDENTITY_PROXY",
      points: 10,
    });
    expect(plain?.evidenceFlags).not.toContain("IDENTITY_PROXY");
  });

  it("assigns competition ranks 1,2,2,4 with importer-ascending tie order", () => {
    const A = prod("010001");
    const B = prod("010002");
    const C = prod("010003");
    const products = [
      productEvidence(A, 5000),
      productEvidence(B, 2000),
      productEvidence(C, 500),
    ];
    const markets = [
      marketEvidence(A, eco("300"), [3000, 3200, 3400, 3600, 4000], 800),
      marketEvidence(B, eco("400"), [1000, 1000, 1000, 1000, 1000], 300),
      marketEvidence(B, eco("500"), [1000, 1000, 1000, 1000, 1000], 300),
      marketEvidence(C, eco("600"), [600, 600, 600, 600, 600], 50),
    ];
    const cohort = focusCohort(products, markets);
    expect(cohort.candidates.map(keyOf)).toEqual([
      "010001|300",
      "010002|400",
      "010002|500",
      "010003|600",
    ]);
    expect(cohort.candidates.map((c) => c.competitionRank)).toEqual([1, 2, 2, 4]);
    expect(cohort.candidates.map((c) => c.competitionRankTieSize)).toEqual([
      1, 2, 2, 1,
    ]);
    const [, first, second] = cohort.candidates;
    expect(first.investigationPriority.rawUnrounded).toBe(
      second.investigationPriority.rawUnrounded,
    );
  });

  it("leaves finalized fields unchanged when only the Provisional Year moves", () => {
    const base = OPPORTUNITY_FIXTURE_COHORTS[0];
    const moved: OpportunityDiscoveryV1CohortInputs = {
      ...base,
      release: { ...base.release, provisionalYear: base.release.provisionalYear + 1 },
    };
    const baseline = computeOpportunityCohort(base);
    const shifted = computeOpportunityCohort(moved);
    expect(shifted.candidates).toEqual(baseline.candidates);
    expect(shifted.provenance.provisionalYear).toBe(
      base.release.provisionalYear + 1,
    );
  });
});

describe("opportunity-discovery-v1 platform integration (recipe doc 10.2, 10.4)", () => {
  it("returns a success page bound to a stable Analysis Identity", async () => {
    const outcome = await fixturePlatform().execute(request());
    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") return;
    expect(outcome.recipe).toBe("opportunity-discovery-v1");
    expect(outcome.normalizedInputs).toEqual({ exportEconomyCode: "100" });
    expect(outcome.payload.cohortSize).toBe(6);
    expect(outcome.payload.candidates).toHaveLength(6);
    expect(outcome.payload.page.returnedCount).toBe(6);
    expect(outcome.analysisIdentity).toMatch(/^analysis-identity-v1-[a-f0-9]{64}$/);
  });

  it("keeps the page bytes unchanged when source rows are reordered", async () => {
    const base = OPPORTUNITY_FIXTURE_COHORTS[0];
    const reordered: OpportunityDiscoveryV1CohortInputs = {
      ...base,
      markets: [...base.markets].reverse(),
      products: [...base.products].reverse(),
    };
    const original = await expectSuccess(fixturePlatform());
    const shuffled = await expectSuccess(
      fixturePlatform(new FixtureOpportunityCandidateIndex([reordered])),
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(original));
  });

  it("projects a product filter to the matching subset without changing identity", async () => {
    const platform = fixturePlatform();
    const [full, filtered] = await Promise.all([
      platform.execute(request()),
      platform.execute(request({ productFilter: { hsRevision: "HS12", codes: ["010001"] } })),
    ]);
    if (full.state !== "success" || filtered.state !== "success") {
      throw new Error("Expected both feeds to succeed.");
    }
    const expected = full.payload.candidates.filter(
      (candidate) => candidate.product.code === "010001",
    );
    expect(filtered.payload.candidates).toEqual(expected);
    expect(filtered.payload.projection.productCodes).toEqual(["010001"]);
    expect(filtered.payload.cohortSize).toBe(6);
    expect(filtered.analysisIdentity).toBe(full.analysisIdentity);
  });

  it("normalizes duplicate/unsorted product filters into one projection", async () => {
    const platform = fixturePlatform();
    const [sorted, scrambled] = await Promise.all([
      platform.execute(request({ productFilter: { hsRevision: "HS12", codes: ["010001", "010002"] } })),
      platform.execute(request({ productFilter: { hsRevision: "HS12", codes: ["010002", "010001", "010002"] } })),
    ]);
    if (sorted.state !== "success" || scrambled.state !== "success") {
      throw new Error("Expected both feeds to succeed.");
    }
    expect(JSON.stringify(scrambled.payload)).toBe(JSON.stringify(sorted.payload));
  });

  it("returns byte-identical pages for two callers of the same feed", async () => {
    const platform = fixturePlatform();
    const [a, b] = await Promise.all([
      platform.execute(request()),
      platform.execute(request()),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("concatenates page sizes 1, 2, and 6 into the exact canonical order", async () => {
    const platform = fixturePlatform();
    const full = await expectSuccess(platform);
    for (const limit of [1, 2, 6]) {
      const collected: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const page = await expectSuccess(platform, { page: { limit, cursor } });
        collected.push(...page.candidates.map(keyOf));
        cursor = page.page.nextCursor;
        guard += 1;
        if (guard > 20) throw new Error("pagination did not terminate");
      } while (cursor !== null);
      expect(collected).toEqual(full.candidates.map(keyOf));
      expect(new Set(collected).size).toBe(collected.length);
    }
  });

  it("rejects a cursor replayed against a different exporter feed", async () => {
    const platform = fixturePlatform();
    const first = await expectSuccess(platform, { page: { limit: 1 } });
    expect(first.page.nextCursor).not.toBeNull();
    const outcome = await platform.execute(
      request({ exportEconomyCode: "200", page: { cursor: first.page.nextCursor } }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error.code).toBe("INVALID_CURSOR");
    }
  });

  it("rejects a cursor replayed under a different product filter", async () => {
    const platform = fixturePlatform();
    const first = await expectSuccess(platform, { page: { limit: 1 } });
    const outcome = await platform.execute(
      request({
        page: { cursor: first.page.nextCursor },
        productFilter: { hsRevision: "HS12", codes: ["010001"] },
      }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error.code).toBe("INVALID_CURSOR");
    }
  });

  it("keeps exporter 100 unchanged when exporter 200 evidence is present", async () => {
    const soloHundred = new FixtureOpportunityCandidateIndex([
      OPPORTUNITY_FIXTURE_COHORTS[0],
    ]);
    const both = new FixtureOpportunityCandidateIndex();
    const [solo, combined] = await Promise.all([
      expectSuccess(fixturePlatform(soloHundred)),
      expectSuccess(fixturePlatform(both)),
    ]);
    expect(JSON.stringify(combined)).toBe(JSON.stringify(solo));
  });

  it("links detail evidence to the exact Candidate Market drill-down", async () => {
    const detail = await new FixtureOpportunityEvidenceSource().loadDetail({
      analysisBuildId: OPPORTUNITY_FIXTURE_BUILD_ID,
      exportEconomyCode: "100",
      productCode: "010001",
      marketCode: "300",
    });
    expect(detail.candidateMarketDrillDown).toEqual({
      recipe: "candidate-market-v1",
      exporterCode: "100",
      product: expect.objectContaining({ code: "010001", hsRevision: "HS12" }),
      focusMarketCode: "300",
    });
    expect(detail.marketYears).toHaveLength(5);
    expect(detail.scoreWindow).toEqual({ start: 2019, end: 2023 });
  });
});

describe("opportunity-discovery-v1 distinct outcome states (recipe doc 10.4)", () => {
  it("reports invalid-input for a malformed export economy", async () => {
    const outcome = await fixturePlatform().execute(
      request({ exportEconomyCode: "abc" }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error.code).toBe("INVALID_ANALYSIS_QUERY");
    }
  });

  it("reports invalid-input for an unknown export economy", async () => {
    const outcome = await fixturePlatform().execute(
      request({ exportEconomyCode: "999" }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error).toEqual({
        code: "UNKNOWN_EXPORT_ECONOMY",
        exportEconomyCode: "999",
      });
    }
  });

  it("reports invalid-input for an unknown HS product filter code", async () => {
    const outcome = await fixturePlatform().execute(
      request({ productFilter: { hsRevision: "HS12", codes: ["999999"] } }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error).toEqual({
        code: "UNKNOWN_HS_PRODUCT",
        productCode: "999999",
      });
    }
  });

  it("reports invalid-input for a structurally corrupt cursor", async () => {
    const outcome = await fixturePlatform().execute(
      request({ page: { cursor: "not-a-real-cursor" } }),
    );
    expect(outcome.state).toBe("invalid-input");
    if (outcome.state === "invalid-input") {
      expect(outcome.error.code).toBe("INVALID_CURSOR");
    }
  });

  it("reports an empty outcome when the exporter has no eligible rows", async () => {
    // Positive evidence, but every observation predates the W5 score window
    // (2019-2023), so no product-market pair has an eligible row.
    const preWindow = [2010, 2011, 2012, 2013, 2014];
    const emptyInputs: OpportunityDiscoveryV1CohortInputs = {
      ...OPPORTUNITY_FIXTURE_COHORTS[0],
      exporter: eco("700"),
      products: [
        {
          product: prod("010001"),
          worldYearTotals: preWindow.map((year) => ({
            year,
            worldValueKusd: "10000",
          })),
          exporterExportTotals: preWindow.map((year) => ({
            year,
            valueKusd: "100",
          })),
        },
      ],
      markets: [
        {
          product: prod("010001"),
          market: eco("300"),
          marketYears: preWindow.map((year) => ({
            year,
            worldValueKusd: "1000",
            bilateralValueKusd: null,
          })),
        },
      ],
    };
    const platform = fixturePlatform(
      new FixtureOpportunityCandidateIndex([emptyInputs]),
    );
    const outcome = await platform.execute(request({ exportEconomyCode: "700" }));
    expect(outcome.state).toBe("empty");
    if (outcome.state === "empty") {
      expect(outcome.emptyReason).toBe(
        "NO_ELIGIBLE_MARKET_INVESTIGATION_CANDIDATES",
      );
      expect(outcome.payload.cohortSize).toBe(0);
      expect(outcome.payload.candidates).toHaveLength(0);
    }
  });

  it("reports retired for an undeclared analysis build", async () => {
    const outcome = await fixturePlatform().execute(
      request({ analysisBuildId: "retired-build" }),
    );
    expect(outcome.state).toBe("retired");
    if (outcome.state === "retired") {
      expect(outcome.error).toEqual({
        code: "ANALYSIS_BUILD_RETIRED",
        analysisBuildId: "retired-build",
      });
    }
  });

  it("reports incompatible-package when a required capability is missing", async () => {
    const incompatible = createOpportunityDiscoveryDatasetPackage({
      schemaVersion: "opportunity-discovery-dataset-package-manifest-v1",
      baciRelease: "BACI-HS12-fixture",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      evidenceSha256: OPPORTUNITY_FIXTURE_CONTENT_SHA256,
      capabilities: OPPORTUNITY_DISCOVERY_V1_CAPABILITY_REQUIREMENTS.slice(1),
    });
    const platform = createTradeAnalyticsPlatform({
      opportunityDiscovery: {
        candidateIndex: new FixtureOpportunityCandidateIndex(),
        datasetPackages: new Map([[OPPORTUNITY_FIXTURE_BUILD_ID, incompatible]]),
      },
    });
    const outcome = await platform.execute(request());
    expect(outcome.state).toBe("incompatible-package");
    if (outcome.state === "incompatible-package") {
      expect(outcome.error).toEqual({
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "MISSING_REQUIRED_CAPABILITY",
      });
    }
  });

  it("reports temporary-unavailability when the index is unavailable", async () => {
    const unavailableIndex: OpportunityCandidateIndex = {
      async page(): Promise<MarketInvestigationPage> {
        throw unavailableOpportunityAnalysisBuild(OPPORTUNITY_FIXTURE_BUILD_ID);
      },
    };
    const outcome = await fixturePlatform(unavailableIndex).execute(request());
    expect(outcome.state).toBe("temporary-unavailability");
    if (outcome.state === "temporary-unavailability") {
      expect(outcome.error).toEqual({ code: "ANALYSIS_UNAVAILABLE" });
    }
  });
});
