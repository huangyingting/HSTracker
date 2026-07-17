import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  RECENT_TRADE_MOMENTUM_FIXTURE_STATE_CASES,
} from "../../fixtures/recent-trade-momentum/v1/evidence";
import {
  recentTradeMomentumFixtureVintageA,
} from "../../fixtures/recent-trade-momentum/v1/synthetic-oracle";
import {
  buildRecentTradeMomentumPackage,
} from "../../scripts/release/recent-trade-momentum-package";
import {
  GET,
  HEAD,
} from "../../src/app/api/v1/analyses/[analysisBuildId]/recent-trade-momentum/route";
import {
  createRecentTradeMomentumDatasetPackage,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-dataset-package";
import {
  executeRecentTradeMomentumV1,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-adapter";
import { validateRecentTradeMomentumV1Request } from "../../src/domain/trade-analytics/recent-trade-momentum-v1-request";
import {
  createTradeAnalyticsPlatform,
  type AnalysisRequest,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import { DuckDbRecentTradeMomentumEvidenceSource } from "../../src/evidence/duckdb-recent-trade-momentum-source";
import {
  createFixtureRecentTradeMomentumDatasetPackages,
  FixtureRecentTradeMomentumEvidenceSource,
} from "../../src/evidence/fixture-recent-trade-momentum-source";
import {
  createFixtureCandidateMarketDatasetPackages,
  createFixtureSupplierCompetitionDatasetPackages,
  createFixtureTradeExplorerDatasetPackages,
  createFixtureTradeTrendDatasetPackages,
  FixtureTradeEvidenceSource,
} from "../../src/evidence/fixture-trade-evidence-source";
import {
  createFixtureOpportunityDiscoveryDatasetPackages,
  FixtureOpportunityCandidateIndex,
  FixtureOpportunityEvidenceSource,
} from "../../src/evidence/fixture-opportunity-source";

const BUILD_ID = "acceptance-fixtures-v1";
const routeContext = (analysisBuildId: string) => ({
  params: Promise.resolve({ analysisBuildId }),
});
const temporaryDirectories: string[] = [];
let workspaceCounter = 0;

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Recent Trade Momentum serving", () => {
  it("serves adapter and route payloads as deterministic immutable evidence beside annual analytics", async () => {
    const platform = fixturePlatform();
    const outcome = await platform.execute({
      recipe: "recent-trade-momentum-v1",
      analysisBuildId: BUILD_ID,
      reporterCode: "NL",
      productCode: "010121",
    });
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }
    const expectedPayload = {
      ...outcome.payload,
      analysisIdentity: outcome.analysisIdentity,
      datasetPackageIdentity: outcome.datasetPackageIdentity,
    };

    await expect(
      executeRecentTradeMomentumV1(platform, {
        analysisBuildId: BUILD_ID,
        reporterCode: "NL",
        productCode: "010121",
      }),
    ).resolves.toEqual(expectedPayload);
    expect(expectedPayload).toMatchObject({
      reporterIso2: "NL",
      hs12Code: "010121",
      recentMonths: ["2025-12", "2026-01", "2026-02"],
      baselineMonths: ["2024-12", "2025-01", "2025-02"],
      recentValueEur: "1250000",
      baselineValueEur: "1000000",
      growthPercentDisplay: "+25.0",
      coverageState: "SUPPORTED",
      signalState: "RISING_FAST",
      confidence: "HIGH",
      reasonCodes: [],
    });

    const url =
      "http://localhost/api/v1/analyses/acceptance-fixtures-v1/recent-trade-momentum?reporter=NL&product=010121";
    const first = await GET(new Request(url), routeContext(BUILD_ID));
    const firstBody = await first.text();
    const second = await GET(new Request(url), routeContext(BUILD_ID));

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
    );
    expect(first.headers.get("etag")).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    expect(firstBody).toBe(JSON.stringify(expectedPayload));
    expect(await second.text()).toBe(firstBody);

    const notModified = await GET(
      new Request(url, { headers: { "If-None-Match": first.headers.get("etag")! } }),
      routeContext(BUILD_ID),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const head = await HEAD(new Request(url, { method: "HEAD" }), routeContext(BUILD_ID));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("keeps unsupported, supported-no-signal, not-observed, suppressed-reallocated, mapping, and unavailable states distinct", async () => {
    const platform = fixturePlatform();
    const observed = [];

    for (const stateCase of RECENT_TRADE_MOMENTUM_FIXTURE_STATE_CASES) {
      const outcome = await platform.execute({
        recipe: "recent-trade-momentum-v1",
        analysisBuildId: BUILD_ID,
        reporterCode: stateCase.reporterCode,
        productCode: stateCase.productCode,
      });
      if (outcome.state !== "success") {
        throw new TypeError(`Expected success for ${stateCase.label}.`);
      }
      observed.push({
        label: stateCase.label,
        coverageState: outcome.payload.coverageState,
        signalState: outcome.payload.signalState,
        reasonCodes: outcome.payload.reasonCodes,
        recentValueEur: outcome.payload.recentValueEur,
        baselineValueEur: outcome.payload.baselineValueEur,
      });
      expect(outcome.payload).toMatchObject(stateCase.expected);
      expect(outcome.payload.signalState).not.toBe("BROADLY_STABLE");
      expect(outcome.payload.growthPercentDisplay).toBeNull();
    }

    expect(observed).toEqual([
      {
        label: "unsupported",
        coverageState: "UNSUPPORTED_MARKET",
        signalState: null,
        reasonCodes: ["UNSUPPORTED_MARKET"],
        recentValueEur: null,
        baselineValueEur: null,
      },
      {
        label: "supported-no-signal",
        coverageState: "SUPPORTED_NO_SIGNAL",
        signalState: null,
        reasonCodes: ["SMALL_BASE"],
        recentValueEur: "300000",
        baselineValueEur: "249999",
      },
      {
        label: "not-observed",
        coverageState: "SUPPORTED_NO_SIGNAL",
        signalState: null,
        reasonCodes: ["MISSING_COMPARISON_MONTH"],
        recentValueEur: null,
        baselineValueEur: null,
      },
      {
        label: "suppressed-reallocated",
        coverageState: "SUPPORTED_NO_SIGNAL",
        signalState: null,
        reasonCodes: ["SUPPRESSED_OR_REALLOCATED"],
        recentValueEur: null,
        baselineValueEur: null,
      },
      {
        label: "mapping",
        coverageState: "UNSUPPORTED_PRODUCT_MAPPING",
        signalState: null,
        reasonCodes: ["UNSUPPORTED_PRODUCT_MAPPING"],
        recentValueEur: null,
        baselineValueEur: null,
      },
      {
        label: "unavailable",
        coverageState: "SOURCE_UNAVAILABLE",
        signalState: null,
        reasonCodes: ["SOURCE_UNAVAILABLE"],
        recentValueEur: null,
        baselineValueEur: null,
      },
    ]);
  });

  it("treats exporter as navigation context only and never changes the signal", async () => {
    const platform = fixturePlatform();

    const chinaContext = await executeRecentTradeMomentumV1(platform, {
      analysisBuildId: BUILD_ID,
      reporterCode: "NL",
      productCode: "010121",
      exporterCode: "156",
    });
    const japanContext = await executeRecentTradeMomentumV1(platform, {
      analysisBuildId: BUILD_ID,
      reporterCode: "NL",
      productCode: "010121",
      exporterCode: "392",
    });

    expect(japanContext).toEqual(chinaContext);
    expect(japanContext.analysisIdentity).toBe(chinaContext.analysisIdentity);
  });

  it("keeps annual analytical bytes unchanged when monthly evidence is absent, activated, or incompatible", async () => {
    const withoutMonthly = annualOnlyPlatform();
    const withMonthly = fixturePlatform();
    const incompatibleMonthly = platformWithIncompatibleMonthlyPackage();

    for (const request of annualRequests()) {
      const baseline = JSON.stringify(await withoutMonthly.execute(request));
      expect(JSON.stringify(await withMonthly.execute(request))).toBe(baseline);
      expect(JSON.stringify(await incompatibleMonthly.execute(request))).toBe(baseline);
    }

    const recentOutcome = await incompatibleMonthly.execute({
      recipe: "recent-trade-momentum-v1",
      analysisBuildId: BUILD_ID,
      reporterCode: "NL",
      productCode: "010121",
    });
    expect(recentOutcome).toMatchObject({
      state: "incompatible-package",
      error: { code: "NO_COMPATIBLE_DATASET_PACKAGE" },
    });
  });

  it("validates the public request without letting optional exporter become analytical identity", () => {
    expect(() =>
      validateRecentTradeMomentumV1Request({
        recipe: "recent-trade-momentum-v1",
        analysisBuildId: BUILD_ID,
        reporterCode: "NL",
        productCode: "010121",
        exporterCode: "156",
      }),
    ).not.toThrow();
    expect(() =>
      validateRecentTradeMomentumV1Request({
        recipe: "recent-trade-momentum-v1",
        analysisBuildId: BUILD_ID,
        reporterCode: "nl",
        productCode: "010121",
      }),
    ).toThrow("reporterCode must be an ISO alpha-2 reporting market code");
  });

  it("hydrates the same known-good outcome from a DuckDB monthly artifact as the package oracle", async () => {
    const workspace = await temporaryWorkspace();
    const build = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageA,
      workspacePath: workspace,
      reportPath: join(workspace, "report.json"),
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "duckdb-serving-test",
      shadowVintagesPassed: 3,
    });
    const source = await DuckDbRecentTradeMomentumEvidenceSource.open({
      artifactPath: build.artifactPath,
      analysisBuildId: "monthly-duckdb-build",
      datasetPackage: build.datasetPackage,
    });
    try {
      const platform = createTradeAnalyticsPlatform({
        recentTradeMomentum: {
          evidenceSource: source,
          datasetPackages: new Map([["monthly-duckdb-build", build.datasetPackage]]),
        },
      });
      const outcome = await platform.execute({
        recipe: "recent-trade-momentum-v1",
        analysisBuildId: "monthly-duckdb-build",
        reporterCode: "DE",
        productCode: "010121",
      });

      expect(outcome).toMatchObject({
        state: "success",
        payload: {
          reporterIso2: "DE",
          hs12Code: "010121",
          cutoffMonth: "2026-02",
          recentValueEur: "1249999",
          baselineValueEur: "1000000",
          growthRateDecimal: "0.249999000000",
          growthPercentDisplay: "+25.0",
          signalState: "RISING",
          coverageState: "SUPPORTED",
          confidence: "MEDIUM",
          recordedHistoryMonths: 24,
          expectedHistoryMonths: 24,
          reasonCodes: [],
          confidenceReasons: [
            "PRELIMINARY_COMPARISON_MONTH",
            "MULTI_STEP_EXACT_CORRESPONDENCE",
          ],
        },
      });
    } finally {
      source.close();
    }
  }, 30_000);
});

function annualOnlyPlatform() {
  return createTradeAnalyticsPlatform(annualPlatformInput());
}

function fixturePlatform() {
  return createTradeAnalyticsPlatform({
    ...annualPlatformInput(),
    recentTradeMomentum: {
      evidenceSource: new FixtureRecentTradeMomentumEvidenceSource(),
      datasetPackages: createFixtureRecentTradeMomentumDatasetPackages(),
    },
  });
}

function platformWithIncompatibleMonthlyPackage() {
  const packages = createFixtureRecentTradeMomentumDatasetPackages();
  const accepted = packages.get(BUILD_ID)!;
  const incompatible = createRecentTradeMomentumDatasetPackage({
    ...accepted.manifest,
    capabilities: accepted.manifest.capabilities.slice(1),
  });
  return createTradeAnalyticsPlatform({
    ...annualPlatformInput(),
    recentTradeMomentum: {
      evidenceSource: new FixtureRecentTradeMomentumEvidenceSource(),
      datasetPackages: new Map([[BUILD_ID, incompatible]]),
    },
  });
}

function annualPlatformInput() {
  return {
    candidateMarket: {
      evidenceSource: new FixtureTradeEvidenceSource(),
      datasetPackages: createFixtureCandidateMarketDatasetPackages(),
    },
    tradeTrend: {
      evidenceSource: new FixtureTradeEvidenceSource(),
      datasetPackages: createFixtureTradeTrendDatasetPackages(),
    },
    supplierCompetition: {
      evidenceSource: new FixtureTradeEvidenceSource(),
      datasetPackages: createFixtureSupplierCompetitionDatasetPackages(),
    },
    tradeExplorer: {
      evidenceSource: new FixtureTradeEvidenceSource(),
      datasetPackages: createFixtureTradeExplorerDatasetPackages(),
    },
    opportunityDiscovery: {
      candidateIndex: new FixtureOpportunityCandidateIndex(),
      evidenceSource: new FixtureOpportunityEvidenceSource(),
      datasetPackages: createFixtureOpportunityDiscoveryDatasetPackages(),
    },
  } satisfies Parameters<typeof createTradeAnalyticsPlatform>[0];
}

function annualRequests(): AnalysisRequest[] {
  return [
    {
      recipe: "candidate-market-v1",
      analysisBuildId: BUILD_ID,
      exporterCode: "156",
      productCode: "010121",
    },
    {
      recipe: "trade-trend-v1",
      analysisBuildId: BUILD_ID,
      importerCode: "528",
      productCode: "010121",
    },
    {
      recipe: "supplier-competition-v1",
      analysisBuildId: BUILD_ID,
      importerCode: "124",
      productCode: "010121",
    },
    {
      recipe: "opportunity-discovery-v1",
      analysisBuildId: BUILD_ID,
      exportEconomyCode: "156",
      productFilter: { hsRevision: "HS12", codes: ["010121"] },
      page: { limit: 5, cursor: null },
    },
  ];
}

async function temporaryWorkspace(): Promise<string> {
  workspaceCounter += 1;
  const path = join(
    "data",
    "work",
    `recent-trade-momentum-serving-test-${process.pid}-${workspaceCounter}`,
  );
  await rm(path, { force: true, recursive: true });
  await mkdir(path, { recursive: true });
  temporaryDirectories.push(path);
  return path;
}
