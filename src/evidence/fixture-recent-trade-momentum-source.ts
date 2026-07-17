import {
  RECENT_TRADE_MOMENTUM_FIXTURE_ARTIFACT_SHA256,
  RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
  RECENT_TRADE_MOMENTUM_FIXTURE_MONTHS,
  RECENT_TRADE_MOMENTUM_FIXTURE_SOURCE_VINTAGE_ID,
  createRecentTradeMomentumFixtureInputs,
  recentTradeMomentumFixtureKey,
} from "../../fixtures/recent-trade-momentum/v1/evidence";
import {
  retiredRecentTradeMomentumAnalysisBuild,
  unavailableRecentTradeMomentumAnalysisBuild,
  unknownRecentTradeMomentumProduct,
  unknownRecentTradeMomentumReporter,
} from "../domain/recent-trade-momentum/errors";
import {
  createRecentTradeMomentumDatasetPackage,
  RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
  type RecentTradeMomentumDatasetPackage,
} from "../domain/trade-analytics/recent-trade-momentum-v1-dataset-package";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  FIXTURE_ADAPTER_TEST_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import type {
  RecentTradeMomentumEvidenceLoadOptions,
  RecentTradeMomentumEvidenceSource,
  RecentTradeMomentumV1RecipeInput,
} from "./recent-trade-momentum-evidence-source";

const fixtureDatasetPackage = createRecentTradeMomentumDatasetPackage({
  schemaVersion: "monthly-trade-dataset-package-manifest-v1",
  artifactSchemaVersion: "monthly-trade-artifact-v1",
  resultSchemaVersion: "recent-trade-momentum-result-v1",
  recipeId: "recent-trade-momentum-v1",
  capability: "recent-trade-momentum/reporting-market-import-value@1",
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
  sourceOwner: "Eurostat",
  sourceDataset: "EUROSTAT_COMEXT_DETAIL",
  sourceVintageId: RECENT_TRADE_MOMENTUM_FIXTURE_SOURCE_VINTAGE_ID,
  extractionTimestamp: "2026-07-17T00:00:00.000Z",
  sourceObjectsSha256: "1".repeat(64),
  sourceMetadataSha256: "2".repeat(64),
  mappingEvidenceSha256: "3".repeat(64),
  partnerMappingVersion: "synthetic-eurostat-partners-v1",
  reporterAllowlist: ["BE", "CL", "DE", "FR", "MX", "NL", "PL"],
  referenceMonthRange: {
    start: RECENT_TRADE_MOMENTUM_FIXTURE_MONTHS[0],
    end: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
  },
  newestEligibleMonthByReporter: {
    BE: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    CL: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    DE: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    FR: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    MX: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    NL: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    PL: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
  },
  artifact: {
    relativePath: "recent-trade-momentum.duckdb",
    bytes: 4096,
    sha256: RECENT_TRADE_MOMENTUM_FIXTURE_ARTIFACT_SHA256,
  },
  artifactSha256: RECENT_TRADE_MOMENTUM_FIXTURE_ARTIFACT_SHA256,
  rowCounts: {
    reporters: 7,
    partners: 2,
    productMappings: 2,
    marketMonths: 168,
    momentum: 7,
  },
  coverage: {
    expectedHistoryMonths: 24,
    shadowVintagesPassed: 3,
    publicCapabilityActivated: false,
  },
  revisionReportSha256: "4".repeat(64),
  conformanceReportSha256: "5".repeat(64),
  capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
  quality: { status: "accepted", reason: null },
  attribution: {
    statement:
      "Source: Eurostat Comext synthetic fixture, aggregated to HS 2012 by HS Tracker for recent-trade-momentum serving tests.",
    license: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
  },
  supersedesPackageIdentity: null,
});

const FIXTURE_INPUTS = createRecentTradeMomentumFixtureInputs(
  fixtureDatasetPackage.identity,
);

export class FixtureRecentTradeMomentumEvidenceSource
  implements RecentTradeMomentumEvidenceSource
{
  async loadRecentTradeMomentumV1Input(
    query: RecentTradeMomentumV1RecipeInput,
    options?: RecentTradeMomentumEvidenceLoadOptions,
  ) {
    options?.signal?.throwIfAborted();
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture adapter failure");
    }
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable) {
      throw unavailableRecentTradeMomentumAnalysisBuild(query.analysisBuildId);
    }
    if (query.analysisBuildId !== ACCEPTANCE_FIXTURE_BUILD_IDS.core) {
      throw retiredRecentTradeMomentumAnalysisBuild(query.analysisBuildId);
    }
    const input = FIXTURE_INPUTS.get(
      recentTradeMomentumFixtureKey(query.reporterCode, query.productCode),
    );
    if (input !== undefined) {
      return input;
    }
    if (
      [...FIXTURE_INPUTS.keys()].some((key) =>
        key.endsWith(`:${query.productCode}`),
      )
    ) {
      throw unknownRecentTradeMomentumReporter(query.reporterCode);
    }
    throw unknownRecentTradeMomentumProduct(query.productCode);
  }
}

export function createFixtureRecentTradeMomentumDatasetPackages(): ReadonlyMap<
  string,
  RecentTradeMomentumDatasetPackage
> {
  return new Map([
    [ACCEPTANCE_FIXTURE_BUILD_IDS.core, fixtureDatasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.failing, fixtureDatasetPackage],
    [FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable, fixtureDatasetPackage],
  ]);
}
