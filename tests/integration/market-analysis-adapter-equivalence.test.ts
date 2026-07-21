import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMarketAnalysis } from "../../src/domain/market-analysis/market-analysis";
import { computeSupplierCompetitionV1 } from "../../src/domain/supplier-competition/supplier-competition-v1";
import type { SupplierCompetitionV1Inputs } from "../../src/domain/supplier-competition/result";
import { computeTradeTrendV1 } from "../../src/domain/trade-trend/trade-trend-v1";
import type { TradeTrendV1Inputs } from "../../src/domain/trade-trend/result";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import { writeRuntimeReleaseCandidate } from "../support/runtime-release";
import {
  candidateMarketSuccess,
  platformReturning,
  STUB_CANDIDATE,
  supplierCompetitionSuccess,
  tradeTrendSuccess,
} from "../support/market-analysis-platform-stub";

// Proves fixture-vs-production equality at the MarketAnalysis Module seam
// itself (issue #66 acceptance criterion "fixture and immutable production
// platforms are equivalent for accepted projections"), mirroring the
// existing per-recipe adapter-equivalence tests
// (trade-trend-adapter-equivalence.test.ts,
// supplier-competition-adapter-equivalence.test.ts). Both sides consume the
// exact same raw Trade Trend/Supplier Competition evidence -- one hand-built
// "fixture" TradeAnalyticsPlatform wrapping the real recipe compute
// functions, and one genuine immutable-production TradeAnalyticsPlatform
// backed by a tiny hand-built DuckDB artifact queried through
// VerifiedReleaseRuntime -- and are asserted equal on the Module's own
// `demand`/`supplierLandscape`/`exporterPosition.pooledSupplier`
// projections, never only on the production output in isolation.
const PRODUCT_CODE = "010121";
const EXPORTER_CODE = "156";
const IMPORTER_CODE = "410";

const IMPORTER = {
  code: IMPORTER_CODE,
  name: "South Korea",
  iso3: "KOR",
  identityNote: null,
};

const EXPORTER = {
  code: EXPORTER_CODE,
  name: "China",
  iso3: "CHN",
  identityNote: null,
};

const PRODUCT = {
  hsRevision: "HS12" as const,
  code: PRODUCT_CODE,
  descriptionEn: "Horses: live, pure-bred breeding animals",
};

const COMMON = {
  analysisBuildId: "equivalence-stub-build",
  analysisReleaseCatalogSha256: "c".repeat(64),
  artifact: {
    baciRelease: "V202601",
    buildId: "equivalence-stub-artifact",
    schemaVersion: "candidate-market-artifact-v1",
    sha256: "d".repeat(64),
  },
  release: {
    baciRelease: "V202601",
    sourceUpdateDate: "2026-07-12",
    hsRevision: "HS12" as const,
    ingestedYears: { start: 2014, end: 2024 },
    finalizedCutoffYear: 2023,
    provisionalYear: 2024,
  },
};

// Five finalized years plus the Provisional Year, all recorded positive,
// expressed once in BACI's own KUSD storage unit so the exact same numbers
// seed both the production DuckDB artifact (via writeRuntimeReleaseCandidate)
// and the hand-authored recipe inputs below.
const FINALIZED_ROWS = [
  { year: 2019, valueKusd: "100.000" },
  { year: 2020, valueKusd: "110.000" },
  { year: 2021, valueKusd: "120.000" },
  { year: 2022, valueKusd: "130.000" },
  { year: 2023, valueKusd: "160.000" },
] as const;
const PROVISIONAL_ROW = { year: 2024, valueKusd: "200.000" } as const;

function kusdToUsd(valueKusd: string): string {
  const [whole, milli] = valueKusd.split(".");
  return `${whole}${milli}`.replace(/^0+(?=\d)/u, "");
}

const tradeTrendInputs: TradeTrendV1Inputs = {
  ...COMMON,
  importer: IMPORTER,
  product: PRODUCT,
  finalizedObservations: FINALIZED_ROWS.map((row) => ({
    year: row.year,
    state: "RECORDED_POSITIVE",
    valueCurrentUsd: kusdToUsd(row.valueKusd),
  })),
  provisionalObservation: {
    year: PROVISIONAL_ROW.year,
    state: "RECORDED_POSITIVE",
    valueCurrentUsd: kusdToUsd(PROVISIONAL_ROW.valueKusd),
  },
};

const supplierCompetitionInputs: SupplierCompetitionV1Inputs = {
  ...COMMON,
  importer: IMPORTER,
  product: PRODUCT,
  suppliers: [
    {
      economy: EXPORTER,
      annualObservations: FINALIZED_ROWS.map((row) => ({
        year: row.year,
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: kusdToUsd(row.valueKusd),
      })),
      sourceFlowCount: 0,
      quantityPresentCount: 0,
    },
  ],
  provisionalMarketState: "RECORDED",
  provisionalSuppliers: [
    {
      economy: EXPORTER,
      bilateral: {
        state: "RECORDED_POSITIVE",
        valueCurrentUsd: kusdToUsd(PROVISIONAL_ROW.valueKusd),
      },
    },
  ],
};

const temporaryDirectories: string[] = [];
const runtimes: VerifiedReleaseRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("MarketAnalysis module: fixture vs immutable production platform equivalence", () => {
  it("produces equal demand, supplier-landscape, and pooled-supplier projections whether backed by a fixture or an immutable production TradeAnalyticsPlatform", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "hs-tracker-market-analysis-equiv-"),
    );
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(join(root, "candidate"), {
      benchmarkCandidateCount: 2,
      additionalTradeTrendEconomies: [
        { code: 410, displayName: "South Korea", iso2: "KR", iso3: "KOR" },
      ],
      additionalTradeTrendRows: [
        ...FINALIZED_ROWS.map((row) => ({
          year: row.year,
          productCode: PRODUCT_CODE,
          exporterCode: Number(EXPORTER_CODE),
          importerCode: Number(IMPORTER_CODE),
          valueKusd: row.valueKusd,
        })),
        {
          year: PROVISIONAL_ROW.year,
          productCode: PRODUCT_CODE,
          exporterCode: Number(EXPORTER_CODE),
          importerCode: Number(IMPORTER_CODE),
          valueKusd: PROVISIONAL_ROW.valueKusd,
        },
      ],
    });
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);

    const fixturePlatform = platformReturning({
      candidateMarket: candidateMarketSuccess({
        analysisBuildId: COMMON.analysisBuildId,
        candidates: [{ ...STUB_CANDIDATE, economy: IMPORTER }],
      }),
      tradeTrend: tradeTrendSuccess(computeTradeTrendV1(tradeTrendInputs)),
      supplierCompetition: supplierCompetitionSuccess(
        computeSupplierCompetitionV1(supplierCompetitionInputs),
      ),
    });
    const fixtureMarketAnalysis = createMarketAnalysis(fixturePlatform);
    const productionMarketAnalysis = createMarketAnalysis(
      runtime.tradeAnalytics,
    );

    const fixtureResult = await fixtureMarketAnalysis.load({
      analysisBuildId: COMMON.analysisBuildId,
      exportEconomyCode: EXPORTER_CODE,
      productCode: PRODUCT_CODE,
      marketCode: IMPORTER_CODE,
    });
    const productionResult = await productionMarketAnalysis.load({
      analysisBuildId: published.analysisBuildId,
      exportEconomyCode: EXPORTER_CODE,
      productCode: PRODUCT_CODE,
      marketCode: IMPORTER_CODE,
    });

    expect(productionResult.demand).toEqual(fixtureResult.demand);
    expect(productionResult.supplierLandscape).toEqual(
      fixtureResult.supplierLandscape,
    );
    expect(productionResult.exporterPosition.pooledSupplier).toEqual(
      fixtureResult.exporterPosition.pooledSupplier,
    );
    expect(productionResult.exporterPosition.pooledSupplierPosition).toEqual(
      fixtureResult.exporterPosition.pooledSupplierPosition,
    );
    expect(productionResult.exporterPosition.pooledSupplier).not.toBeNull();
  }, 30_000);
});
