import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import { ACCEPTANCE_FIXTURE_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
  type TradeExplorerEquivalenceRow,
} from "../support/runtime-release";

// This proves fixture-vs-production equality at the public
// TradeAnalyticsPlatform.execute seam for Trade Explorer (issue #47),
// mirroring trade-trend-adapter-equivalence.test.ts and
// supplier-competition-adapter-equivalence.test.ts. Trade Explorer has four
// query shapes over the same underlying evidence, and
// fixtures/trade-explorer/v1/evidence.ts independently authors a *different*
// value for the same (year, product, exporter, importer) tuple depending on
// which dimension a given MODELED_COMBOS entry groups (it is a hand-modeled
// table, not a single consistent relation). A real relational DuckDB
// artifact cannot hold two different values for one tuple, so only ONE
// shape's literals can be reproduced against the fixture for any one tuple
// at a time. finalized-trend-v1, using the (156, 528, 010121) tuple, and its
// "all no-recorded-flow" (156, 36, 010121) sibling, are reproduced here
// against the acceptance fixture exactly, matching
// fixtures/trade-explorer/v1/evidence.ts's own literals for those combos.
// importing-markets-v1, supplying-economies-v1, and product-mix-v1 are
// instead checked against independently hand-computed literals (using fresh
// economies/products/years never touched by the finalized-trend-v1 case),
// still demonstrating -- and asserting exact totals/quality-warning
// literals for -- the schema-imposed rule documented at
// DuckDbTradeEvidenceSource.tradeExplorerCoverage: a fixed EXPORT_ECONOMY or
// HS_PRODUCT dimension shares one coverage boolean across every unrecorded
// grouped candidate, while YEAR/IMPORT_ECONOMY-grouped shapes resolve
// coverage per grouped candidate.
const OTHER_PRODUCT_CODE = "999999";
const PRODUCT_CODE = RUNTIME_RELEASE_FIXTURE.productCode;
const EXPORTER_CODE = 156;

const ADDITIONAL_ECONOMIES = [
  { code: 528, displayName: "Netherlands", iso2: "NL", iso3: "NLD" },
  { code: 484, displayName: "Mexico", iso2: "MX", iso3: "MEX" },
  { code: 36, displayName: "Australia", iso2: "AU", iso3: "AUS" },
  { code: 710, displayName: "South Africa", iso2: "ZA", iso3: "ZAF" },
  { code: 76, displayName: "Brazil", iso2: "BR", iso3: "BRA" },
  { code: 124, displayName: "Canada", iso2: "CA", iso3: "CAN" },
  { code: 842, displayName: "United States", iso2: "US", iso3: "USA" },
  // Never referenced by any bilateral row below: has_trade_evidence stays
  // FALSE forever, giving the "empty" (non-enumerable cohort) test a fixed
  // economy production genuinely has no evidence for.
  { code: 901, displayName: "Untouched Economy", iso2: "ZZ", iso3: "ZZZ" },
] as const;

// The candidate-market-v1 startup smoke query (unrelated to Trade Explorer,
// see verifyStartupSmoke) counts every DISTINCT importer economy with any
// recorded market_year activity for exporter 156's benchmark product
// (010121), across all years, regardless of exporter -- 276 (the default
// fixture importer), 484, 528, 76 (Brazil, only via the Canada->Brazil
// supplying-economies-v1 row below, which also uses product 010121), and
// the 25 budget-edge importer codes: 1 + 1 + 1 + 1 + 25 = 29.
const CANDIDATE_MARKET_COHORT_SIZE = 29;

const BUDGET_IMPORTER_CODES = Array.from({ length: 25 }, (_, index) => index + 1);

const BUDGET_ECONOMIES = BUDGET_IMPORTER_CODES.map((code) => ({
  code,
  displayName: `Fixture Economy ${code}`,
  iso2: null,
  iso3: null,
}));

const ADDITIONAL_PRODUCTS = [
  {
    productId: 2,
    code: "010129",
    description: "Horses: live, other than pure-bred breeding animals",
  },
  {
    productId: 3,
    code: "010130",
    description: "Asses: live",
  },
  {
    productId: 4,
    code: OTHER_PRODUCT_CODE,
    description: "Synthetic other-product placeholder for Trade Explorer evidence.",
  },
] as const;

function row(
  year: number,
  productCode: string,
  exporterCode: number,
  importerCode: number,
  valueKusd: string,
): TradeExplorerEquivalenceRow {
  return { year, productCode, exporterCode, importerCode, valueKusd };
}

const ADDITIONAL_ROWS: readonly TradeExplorerEquivalenceRow[] = [
  // finalized-trend-v1 (156 -> 528, product 010121): mirrors
  // fixtures/trade-explorer/v1/evidence.ts combo "156:528:010121:*" exactly
  // -- recorded, recorded, no-flow, missing, recorded. 2021 gets only an
  // other-product filler row (market_year coverage without a positive
  // 010121 flow); 2022 gets no row at all.
  row(2019, PRODUCT_CODE, EXPORTER_CODE, 528, "40.000"),
  row(2020, PRODUCT_CODE, EXPORTER_CODE, 528, "50.000"),
  row(2021, OTHER_PRODUCT_CODE, EXPORTER_CODE, 528, "5.000"),
  row(2023, PRODUCT_CODE, EXPORTER_CODE, 528, "80.000"),

  // finalized-trend-v1, all no-recorded-flow (156 -> 36, product 010121):
  // mirrors fixtures/trade-explorer/v1/evidence.ts combo
  // "156:36:010121:*" -- other-product coverage every finalized year, never
  // a positive 010121 flow, so every year is NO_RECORDED_POSITIVE_FLOW.
  row(2019, OTHER_PRODUCT_CODE, EXPORTER_CODE, 36, "1.000"),
  row(2020, OTHER_PRODUCT_CODE, EXPORTER_CODE, 36, "1.000"),
  row(2021, OTHER_PRODUCT_CODE, EXPORTER_CODE, 36, "1.000"),
  row(2022, OTHER_PRODUCT_CODE, EXPORTER_CODE, 36, "1.000"),
  row(2023, OTHER_PRODUCT_CODE, EXPORTER_CODE, 36, "1.000"),

  // importing-markets-v1 (export 156, product 010121, year 2020): 484
  // recorded; 36 no-flow (covered by the filler rows above, which also
  // touch 2020); 710 missing (never referenced at all).
  row(2020, PRODUCT_CODE, EXPORTER_CODE, 484, "20.000"),

  // supplying-economies-v1 (import 76, product 010121, year 2021): 124
  // recorded; 276 (the default fixture exporter) no-flow, covered only by
  // 124's positive row establishing market_year(2021, *, 76) presence.
  row(2021, PRODUCT_CODE, 124, 76, "25.000"),

  // product-mix-v1 (export 156, import 124, year 2022): 010129 recorded;
  // 010130 no-flow, covered only by 010129's positive row establishing
  // market_year(2022, *, 124) presence -- HS_PRODUCT is not part of
  // market_year, so this is the single-shared-coverage-boolean case.
  row(2022, "010129", EXPORTER_CODE, 124, "12.000"),

  // importing-markets-v1 budget boundary: exactly 25 grouped importer
  // codes, each independently recorded.
  ...BUDGET_IMPORTER_CODES.map((code) =>
    row(2023, PRODUCT_CODE, EXPORTER_CODE, code, "1.000"),
  ),
];

const temporaryDirectories: string[] = [];
const runtimes: VerifiedReleaseRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function buildActivatedRuntime(): Promise<{
  runtime: VerifiedReleaseRuntime;
  analysisBuildId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "hs-tracker-trade-explorer-equiv-"));
  temporaryDirectories.push(root);
  const candidate = await writeRuntimeReleaseCandidate(join(root, "candidate"), {
    benchmarkCandidateCount: CANDIDATE_MARKET_COHORT_SIZE,
    additionalTradeExplorerEconomies: [...ADDITIONAL_ECONOMIES, ...BUDGET_ECONOMIES],
    additionalTradeExplorerProducts: ADDITIONAL_PRODUCTS,
    additionalTradeExplorerRows: ADDITIONAL_ROWS,
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
  return { runtime, analysisBuildId: published.analysisBuildId };
}

function baseRequest(analysisBuildId: string) {
  return { recipe: "trade-explorer-v1" as const, analysisBuildId };
}

describe("Trade Explorer fixture-vs-production adapter equivalence", () => {
  it("agrees with the acceptance fixture on finalized-trend-v1's recorded/no-flow/missing states and SPARSE_COHORT quality warning", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const fixtureRuntime = createFixtureApplicationRuntime();
    const fixtureBuildId = ACCEPTANCE_FIXTURE_BUILD_IDS.core;

    function finalizedTrendRequest(
      analysisBuildIdForRequest: string,
      importEconomy: string,
    ) {
      return {
        ...baseRequest(analysisBuildIdForRequest),
        shape: "finalized-trend-v1" as const,
        dimensions: ["YEAR" as const],
        measures: ["TRADE_VALUE_USD" as const],
        filters: {
          year: { mode: "list" as const, years: [] },
          exportEconomy: ["156"],
          importEconomy: [importEconomy],
          hsProduct: [PRODUCT_CODE],
        },
        sort: null,
      };
    }

    async function successPayload(
      platform: ReturnType<typeof createFixtureApplicationRuntime>["tradeAnalytics"],
      analysisBuildIdForRequest: string,
      importEconomy: string,
    ) {
      const outcome = await platform.execute(
        finalizedTrendRequest(analysisBuildIdForRequest, importEconomy),
      );
      if (outcome.state !== "success") {
        throw new TypeError(
          `Expected success for importer ${importEconomy}, received ${outcome.state}.`,
        );
      }
      return outcome.payload;
    }

    // "156:528:010121:*" -- recorded, recorded, no-flow, missing, recorded.
    {
      const [fixture, production] = await Promise.all([
        successPayload(fixtureRuntime.tradeAnalytics, fixtureBuildId, "528"),
        successPayload(runtime.tradeAnalytics, analysisBuildId, "528"),
      ]);
      expect(production.rows).toEqual(fixture.rows);
      expect(production.rows.map((r) => r.state)).toEqual([
        "RECORDED_POSITIVE",
        "RECORDED_POSITIVE",
        "NO_RECORDED_POSITIVE_FLOW",
        "MISSING_OBSERVATION",
        "RECORDED_POSITIVE",
      ]);
      expect(production.rows.map((r) => r.tradeValueUsd)).toEqual([
        "40000",
        "50000",
        null,
        null,
        "80000",
      ]);
      expect(production.totalRow).toBeNull();
      expect(production.qualityWarnings).toEqual(fixture.qualityWarnings);
      // 2022 is MISSING_OBSERVATION, so the cohort is incomplete (but not
      // sparse, since 2019/2020/2023 are recorded positive).
      expect(production.qualityWarnings).toEqual(["INCOMPLETE_COHORT"]);
    }

    // "156:36:010121:*" -- every year no-recorded-flow, hence SPARSE_COHORT.
    {
      const [fixture, production] = await Promise.all([
        successPayload(fixtureRuntime.tradeAnalytics, fixtureBuildId, "36"),
        successPayload(runtime.tradeAnalytics, analysisBuildId, "36"),
      ]);
      expect(production.rows).toEqual(fixture.rows);
      expect(
        production.rows.every((r) => r.state === "NO_RECORDED_POSITIVE_FLOW"),
      ).toBe(true);
      expect(production.qualityWarnings).toEqual(fixture.qualityWarnings);
      expect(production.qualityWarnings).toEqual(["SPARSE_COHORT"]);
    }
  }, 30_000);

  it("returns independently-computed literals for importing-markets-v1, supplying-economies-v1, and product-mix-v1, demonstrating per-candidate vs. shared coverage", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();

    // importing-markets-v1: coverage is per grouped importer, so the
    // freeform recorded/no-flow/missing mix below is faithfully reproduced.
    {
      const outcome = await runtime.tradeAnalytics.execute({
        ...baseRequest(analysisBuildId),
        shape: "importing-markets-v1",
        dimensions: ["IMPORT_ECONOMY"],
        measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
        filters: {
          year: { mode: "list", years: [2020] },
          exportEconomy: ["156"],
          importEconomy: ["484", "36", "710"],
          hsProduct: [PRODUCT_CODE],
        },
        sort: null,
      });
      if (outcome.state !== "success") {
        throw new TypeError(`Expected success, received ${outcome.state}.`);
      }
      const byCode = new Map(
        outcome.payload.rows.map((r) => [
          r.dimensionValue.dimension === "IMPORT_ECONOMY"
            ? r.dimensionValue.economy.code
            : null,
          r,
        ]),
      );
      expect(byCode.get("484")).toMatchObject({
        state: "RECORDED_POSITIVE",
        tradeValueUsd: "20000",
        recordedFlowCount: 1,
      });
      expect(byCode.get("36")).toMatchObject({
        state: "NO_RECORDED_POSITIVE_FLOW",
        tradeValueUsd: null,
        recordedFlowCount: 0,
      });
      expect(byCode.get("710")).toMatchObject({
        state: "MISSING_OBSERVATION",
        tradeValueUsd: null,
        recordedFlowCount: null,
      });
      // Hand-computed: only 484 is RECORDED_POSITIVE (20000, count 1); 36
      // contributes a zero count but no value; 710 is excluded entirely.
      expect(outcome.payload.totalRow).toEqual({
        tradeValueUsd: "20000",
        recordedFlowCount: 1,
        includedRowCount: 1,
        missingRowCount: 1,
      });
      expect(outcome.payload.qualityWarnings).toEqual(["INCOMPLETE_COHORT"]);
    }

    // supplying-economies-v1: EXPORT_ECONOMY is grouped while IMPORT_ECONOMY
    // and YEAR are both fixed, so 276 (never given a positive flow into 76)
    // shares 124's coverage and reports NO_RECORDED_POSITIVE_FLOW rather
    // than MISSING_OBSERVATION.
    {
      const outcome = await runtime.tradeAnalytics.execute({
        ...baseRequest(analysisBuildId),
        shape: "supplying-economies-v1",
        dimensions: ["EXPORT_ECONOMY"],
        measures: ["TRADE_VALUE_USD"],
        filters: {
          year: { mode: "list", years: [2021] },
          exportEconomy: ["124", "276"],
          importEconomy: ["76"],
          hsProduct: [PRODUCT_CODE],
        },
        sort: { key: "EXPORT_ECONOMY", direction: "asc" },
      });
      if (outcome.state !== "success") {
        throw new TypeError(`Expected success, received ${outcome.state}.`);
      }
      expect(
        outcome.payload.rows.map((r) =>
          r.dimensionValue.dimension === "EXPORT_ECONOMY"
            ? [r.dimensionValue.economy.code, r.state, r.tradeValueUsd]
            : null,
        ),
      ).toEqual([
        ["124", "RECORDED_POSITIVE", "25000"],
        ["276", "NO_RECORDED_POSITIVE_FLOW", null],
      ]);
      expect(outcome.payload.totalRow).toEqual({
        tradeValueUsd: "25000",
        recordedFlowCount: null,
        includedRowCount: 1,
        missingRowCount: 0,
      });
      expect(outcome.payload.qualityWarnings).toEqual([]);
    }

    // product-mix-v1: HS_PRODUCT is grouped while EXPORT_ECONOMY,
    // IMPORT_ECONOMY, and YEAR are all fixed, so 010130 (never given a
    // positive flow) shares 010129's coverage and reports
    // NO_RECORDED_POSITIVE_FLOW rather than MISSING_OBSERVATION -- the same
    // schema-imposed rule as supplying-economies-v1 above.
    {
      const outcome = await runtime.tradeAnalytics.execute({
        ...baseRequest(analysisBuildId),
        shape: "product-mix-v1",
        dimensions: ["HS_PRODUCT"],
        measures: ["TRADE_VALUE_USD"],
        filters: {
          year: { mode: "list", years: [2022] },
          exportEconomy: ["156"],
          importEconomy: ["124"],
          hsProduct: ["010129", "010130"],
        },
        sort: null,
      });
      if (outcome.state !== "success") {
        throw new TypeError(`Expected success, received ${outcome.state}.`);
      }
      expect(
        outcome.payload.rows.map((r) =>
          r.dimensionValue.dimension === "HS_PRODUCT"
            ? [r.dimensionValue.product.code, r.state, r.tradeValueUsd]
            : null,
        ),
      ).toEqual([
        ["010129", "RECORDED_POSITIVE", "12000"],
        ["010130", "NO_RECORDED_POSITIVE_FLOW", null],
      ]);
      expect(outcome.payload.totalRow).toEqual({
        tradeValueUsd: "12000",
        recordedFlowCount: null,
        includedRowCount: 1,
        missingRowCount: 0,
      });
      expect(outcome.payload.qualityWarnings).toEqual([]);
    }
  }, 30_000);

  it("reports a typed empty outcome for a fixed economy with no recorded trade evidence at all", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const fixtureRuntime = createFixtureApplicationRuntime();
    const request = (buildId: string) => ({
      ...baseRequest(buildId),
      shape: "finalized-trend-v1" as const,
      dimensions: ["YEAR" as const],
      measures: ["TRADE_VALUE_USD" as const],
      filters: {
        year: { mode: "list" as const, years: [] },
        exportEconomy: ["156"],
        importEconomy: ["842"],
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    const [fixture, outcome] = await Promise.all([
      fixtureRuntime.tradeAnalytics.execute(
        request(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
      ),
      runtime.tradeAnalytics.execute(request(analysisBuildId)),
    ]);
    expect(outcome.state).toBe("empty");
    if (outcome.state !== "empty") {
      throw new Error(`Expected empty, received ${outcome.state}.`);
    }
    expect(outcome.emptyReason).toBe("NO_ENUMERABLE_COHORT");
    expect(outcome.payload.rows).toEqual([]);
    expect(fixture).toMatchObject({
      state: "empty",
      emptyReason: outcome.emptyReason,
      payload: { rows: [] },
    });
  }, 30_000);

  it("fails closed with the exact unknown code for unregistered export/import economies and HS products", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const fixtureRuntime = createFixtureApplicationRuntime();

    const unknownExport = await runtime.tradeAnalytics.execute({
      ...baseRequest(analysisBuildId),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["888"],
        importEconomy: ["528"],
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    expect(unknownExport).toMatchObject({
      state: "invalid-input",
      error: { code: "UNKNOWN_EXPORT_ECONOMY", economyCode: "888" },
    });

    const unknownImport = await runtime.tradeAnalytics.execute({
      ...baseRequest(analysisBuildId),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["999"],
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    expect(unknownImport).toMatchObject({
      state: "invalid-input",
      error: { code: "UNKNOWN_IMPORT_ECONOMY", economyCode: "999" },
    });

    const unknownProduct = await runtime.tradeAnalytics.execute({
      ...baseRequest(analysisBuildId),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["000001"],
      },
      sort: null,
    });
    expect(unknownProduct).toMatchObject({
      state: "invalid-input",
      error: { code: "UNKNOWN_HS_PRODUCT", productCode: "000001" },
    });

    for (const [fixture, production] of await Promise.all([
      Promise.all([
        fixtureRuntime.tradeAnalytics.execute({
          ...baseRequest(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["888"],
            importEconomy: ["528"],
            hsProduct: [PRODUCT_CODE],
          },
          sort: null,
        }),
        Promise.resolve(unknownExport),
      ]),
      Promise.all([
        fixtureRuntime.tradeAnalytics.execute({
          ...baseRequest(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156"],
            importEconomy: ["999"],
            hsProduct: [PRODUCT_CODE],
          },
          sort: null,
        }),
        Promise.resolve(unknownImport),
      ]),
      Promise.all([
        fixtureRuntime.tradeAnalytics.execute({
          ...baseRequest(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["000001"],
          },
          sort: null,
        }),
        Promise.resolve(unknownProduct),
      ]),
    ])) {
      expect(fixture).toMatchObject({
        state: production.state,
        error: "error" in production ? production.error : undefined,
      });
    }
  }, 30_000);

  it("succeeds at exactly the 25-code grouped-cohort budget boundary", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const fixtureRuntime = createFixtureApplicationRuntime();
    const request = (buildId: string) => ({
      ...baseRequest(buildId),
      shape: "importing-markets-v1" as const,
      dimensions: ["IMPORT_ECONOMY" as const],
      measures: ["TRADE_VALUE_USD" as const],
      filters: {
        year: { mode: "list" as const, years: [2023] },
        exportEconomy: ["156"],
        importEconomy: BUDGET_IMPORTER_CODES.map(String),
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    const [fixture, outcome] = await Promise.all([
      fixtureRuntime.tradeAnalytics.execute(
        request(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
      ),
      runtime.tradeAnalytics.execute(request(analysisBuildId)),
    ]);
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }
    if (fixture.state !== "success") {
      throw new TypeError(
        `Expected fixture success, received ${fixture.state}.`,
      );
    }
    expect(outcome.payload.rows).toHaveLength(25);
    expect(outcome.payload.rows).toEqual(fixture.payload.rows);
    expect(outcome.payload.totalRow).toEqual(fixture.payload.totalRow);
    expect(outcome.payload.qualityWarnings).toEqual(
      fixture.payload.qualityWarnings,
    );
    expect(outcome.payload.rows.every((r) => r.state === "RECORDED_POSITIVE")).toBe(
      true,
    );
    const first = outcome.payload.rows.find(
      (r) =>
        r.dimensionValue.dimension === "IMPORT_ECONOMY" &&
        r.dimensionValue.economy.code === "1",
    );
    expect(first).toMatchObject({ tradeValueUsd: "1000" });
  }, 30_000);

  it("agrees with the fixture when the grouped cohort exceeds the 25-code budget", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const fixtureRuntime = createFixtureApplicationRuntime();
    const request = (buildId: string) => ({
      ...baseRequest(buildId),
      shape: "importing-markets-v1" as const,
      dimensions: ["IMPORT_ECONOMY" as const],
      measures: ["TRADE_VALUE_USD" as const],
      filters: {
        year: { mode: "list" as const, years: [2023] },
        exportEconomy: ["156"],
        importEconomy: [...BUDGET_IMPORTER_CODES, 26].map(String),
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    const [fixture, production] = await Promise.all([
      fixtureRuntime.tradeAnalytics.execute(
        request(ACCEPTANCE_FIXTURE_BUILD_IDS.core),
      ),
      runtime.tradeAnalytics.execute(request(analysisBuildId)),
    ]);

    expect(production).toMatchObject({
      state: "budget",
      error: { code: "ANALYSIS_BUDGET_EXCEEDED" },
    });
    expect(fixture).toMatchObject({
      state: production.state,
      error: "error" in production ? production.error : undefined,
    });
  }, 30_000);

  it("propagates an already-aborted signal instead of returning a result", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.tradeAnalytics.execute(
        {
          ...baseRequest(analysisBuildId),
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: [PRODUCT_CODE],
          },
          sort: null,
        },
        { signal: controller.signal },
      ),
    ).rejects.toBeTruthy();
  }, 30_000);

  it("reuses evidence resources across sequential requests on the same runtime", async () => {
    const { runtime, analysisBuildId } = await buildActivatedRuntime();
    const request = {
      ...baseRequest(analysisBuildId),
      shape: "finalized-trend-v1" as const,
      dimensions: ["YEAR" as const],
      measures: ["TRADE_VALUE_USD" as const],
      filters: {
        year: { mode: "list" as const, years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    };
    const first = await runtime.tradeAnalytics.execute(request);
    const second = await runtime.tradeAnalytics.execute(request);
    if (first.state !== "success" || second.state !== "success") {
      throw new TypeError(
        `Expected two successes, received ${first.state} and ${second.state}.`,
      );
    }
    expect(second.payload.rows).toEqual(first.payload.rows);
    expect(second.payload.rows.map((r) => r.tradeValueUsd)).toEqual([
      "40000",
      "50000",
      null,
      null,
      "80000",
    ]);
  }, 30_000);
});

describe("Trade Explorer Recommended Dataset Mapping activation", () => {
  it("stays retired when the artifact declaration is incompatible", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-trade-explorer-retired-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(join(root, "candidate"), {
      benchmarkCandidateCount: CANDIDATE_MARKET_COHORT_SIZE,
      additionalTradeExplorerEconomies: [...ADDITIONAL_ECONOMIES, ...BUDGET_ECONOMIES],
      additionalTradeExplorerProducts: ADDITIONAL_PRODUCTS,
      additionalTradeExplorerRows: ADDITIONAL_ROWS,
      tradeExplorerDatasetPackage: {
        schemaVersion: "trade-explorer-dataset-capabilities-v1",
        capabilities: [],
      },
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
    const outcome = await runtime.tradeAnalytics.execute({
      ...baseRequest(published.analysisBuildId),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: [PRODUCT_CODE],
      },
      sort: null,
    });
    expect(outcome.state).toBe("retired");
  }, 30_000);
});
