import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SupplierCompetitionShare } from "../../src/domain/supplier-competition/result";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
  type SupplierCompetitionEquivalenceEconomy,
  type SupplierCompetitionEquivalenceRow,
} from "../support/runtime-release";

// This proves fixture-vs-production equality at the public
// TradeAnalyticsPlatform.execute seam (issue #42 requirement 3): the same
// six representative Supplier Competition cases already accepted for the
// fixture-backed adapter in
// fixtures/supplier-competition/v1/{evidence,expected}.ts -- dispersed,
// concentrated, single-supplier, sparse, empty, and provisional-changing --
// are independently reproduced against tiny hand-built production DuckDB
// artifacts queried through DuckDbTradeEvidenceSource, using the exact same
// importer/supplier economy codes and values as that fixture evidence.
//
// Five of the six cases (dispersed, concentrated, single-supplier,
// provisional-changing, empty) share one production artifact because every
// reused supplier (China, Netherlands) is "always recorded positive" in
// every one of those cases, so a supplier's real, global per-year activity
// signal (see the query comment in
// loadSupplierCompetitionWithConnection) never conflicts across them. The
// sparse case is deliberately isolated in its own artifact because it
// requires Netherlands to be globally MISSING in two specific finalized
// years, which would otherwise contradict the other cases' requirement that
// Netherlands recorded positive in those same years.
//
// The immutable bilateral_year/market_year tables do not retain
// per-bilateral quantity presence (only a market-wide, all-suppliers count
// exists on market_year -- see the analogous comment in
// groupSupplierActivityRows), so production always reports
// quantityCoverageRate as null ("UNKNOWN"). Every other field is compared
// for exact equality.
const FIXTURE_PRODUCT_CODE = RUNTIME_RELEASE_FIXTURE.productCode;
// A dedicated product code (never the shared candidate-market/trade-trend
// baseline product) so these multi-supplier bilateral rows never pollute
// the Candidate Market startup smoke check's own candidate cohort for the
// baseline product. Production and fixture necessarily query different
// product codes here (the fixture's product identity is fixed inside
// fixtures/supplier-competition/v1/evidence.ts), so this test compares
// supplier structure/shares/HHI/warnings/provisional evidence, never the
// query.product identity itself.
const PRODUCTION_PRODUCT_CODE = "010199";
const OTHER_PRODUCT_CODE = "999998";
const FINALIZED_YEARS = [2019, 2020, 2021, 2022, 2023];
const PROVISIONAL_YEAR = 2024;

const SHARED_ECONOMIES: readonly SupplierCompetitionEquivalenceEconomy[] = [
  { code: 392, displayName: "Japan", iso2: "JP", iso3: "JPN" },
  { code: 528, displayName: "Netherlands", iso2: "NL", iso3: "NLD" },
  { code: 842, displayName: "United States", iso2: "US", iso3: "USA" },
  { code: 76, displayName: "Brazil", iso2: "BR", iso3: "BRA" },
  { code: 124, displayName: "Canada", iso2: "CA", iso3: "CAN" },
  { code: 710, displayName: "South Africa", iso2: "ZA", iso3: "ZAF" },
  { code: 152, displayName: "Chile", iso2: "CL", iso3: "CHL" },
  { code: 699, displayName: "India", iso2: "IN", iso3: "IND" },
  { code: 616, displayName: "Poland", iso2: "PL", iso3: "POL" },
];

const SUPPLIER_COMPETITION_PRODUCT = {
  productId: 2,
  code: PRODUCTION_PRODUCT_CODE,
  description: "Synthetic Supplier Competition equivalence product.",
} as const;

const SHARED_PRODUCTS = [
  SUPPLIER_COMPETITION_PRODUCT,
  {
    productId: 3,
    code: OTHER_PRODUCT_CODE,
    description: "Synthetic other-product placeholder for Poland padding.",
  },
] as const;

function row(
  year: number,
  exporterCode: number,
  importerCode: number,
  valueKusd: string,
  productCode: string = PRODUCTION_PRODUCT_CODE,
): SupplierCompetitionEquivalenceRow {
  return { year, productCode, exporterCode, importerCode, valueKusd };
}

const SHARED_ROWS: SupplierCompetitionEquivalenceRow[] = [
  ...FINALIZED_YEARS.flatMap((year) => [
    // dispersed (Brazil, 76): four equal suppliers.
    row(year, 156, 76, "50.000"),
    row(year, 392, 76, "50.000"),
    row(year, 528, 76, "50.000"),
    row(year, 842, 76, "50.000"),
    // concentrated (Canada, 124): one dominant supplier.
    row(year, 156, 124, "140.000"),
    row(year, 392, 124, "20.000"),
    row(year, 528, 124, "20.000"),
    row(year, 710, 124, "20.000"),
    // single-supplier (Chile, 152).
    row(year, 842, 152, "100.000"),
    // provisional-changing (India, 699): two equal finalized suppliers.
    row(year, 156, 699, "40.000"),
    row(year, 528, 699, "40.000"),
  ]),
  // Provisional Year (2024) snapshots.
  row(PROVISIONAL_YEAR, 156, 76, "60.000"),
  row(PROVISIONAL_YEAR, 392, 76, "60.000"),
  row(PROVISIONAL_YEAR, 528, 76, "60.000"),
  row(PROVISIONAL_YEAR, 842, 76, "60.000"),
  // Japan and South Africa are absent from Canada's 2024 snapshot, so they
  // must resolve to NO_RECORDED_POSITIVE_FLOW rather than needing an
  // explicit negative row.
  row(PROVISIONAL_YEAR, 156, 124, "150.000"),
  row(PROVISIONAL_YEAR, 528, 124, "20.000"),
  row(PROVISIONAL_YEAR, 842, 152, "120.000"),
  // China is absent from India's 2024 snapshot (-> NO_RECORDED_POSITIVE_
  // FLOW); United States is a brand-new entrant.
  row(PROVISIONAL_YEAR, 528, 699, "300.000"),
  row(PROVISIONAL_YEAR, 842, 699, "150.000"),
  // Poland (empty, 616): no supplier ever records a positive flow for
  // product 010121, but China's shipment of an unrelated product in 2024
  // establishes that Poland's 2024 market was observed at all, so its
  // provisionalMarketState resolves to NO_RECORDED_POSITIVE_FLOW rather
  // than MISSING_OBSERVATION.
  row(PROVISIONAL_YEAR, 156, 616, "10.000", OTHER_PRODUCT_CODE),
];

const SPARSE_IMPORTER_CODE = "404";
const PADDING_IMPORTER_CODE = 900;
const SPARSE_ECONOMIES: readonly SupplierCompetitionEquivalenceEconomy[] = [
  { code: 404, displayName: "Kenya", iso2: "KE", iso3: "KEN" },
  { code: 528, displayName: "Netherlands", iso2: "NL", iso3: "NLD" },
  { code: 484, displayName: "Mexico", iso2: "MX", iso3: "MEX" },
  {
    code: PADDING_IMPORTER_CODE,
    displayName: "Padding Importer",
    iso2: "XX",
    iso3: "ZZZ",
  },
];

// sparse (Kenya, 404): Netherlands recorded 2019/2021/2023 and is globally
// MISSING (no bilateral_year row to any importer) in 2020/2022; Mexico
// recorded only 2019, and has unrelated padding activity to a third-party
// importer in every other finalized year, so its non-2019 years resolve to
// NO_RECORDED_POSITIVE_FLOW rather than MISSING_OBSERVATION. Kenya's 2024
// snapshot has zero rows anywhere, so provisionalMarketState is
// MISSING_OBSERVATION.
const SPARSE_ROWS: SupplierCompetitionEquivalenceRow[] = [
  row(2019, 528, 404, "10.000"),
  row(2021, 528, 404, "10.000"),
  row(2023, 528, 404, "10.000"),
  row(2019, 484, 404, "5.000"),
  row(2020, 484, PADDING_IMPORTER_CODE, "1.000"),
  row(2021, 484, PADDING_IMPORTER_CODE, "1.000"),
  row(2022, 484, PADDING_IMPORTER_CODE, "1.000"),
  row(2023, 484, PADDING_IMPORTER_CODE, "1.000"),
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

async function buildRuntime(
  suffix: string,
  economies: readonly SupplierCompetitionEquivalenceEconomy[],
  rows: readonly SupplierCompetitionEquivalenceRow[],
  products: readonly Readonly<{
    productId: number;
    code: string;
    description: string;
  }>[] = [],
): Promise<{
  runtime: VerifiedReleaseRuntime;
  analysisBuildId: string;
}> {
  const root = await mkdtemp(
    join(tmpdir(), `hs-tracker-supplier-competition-equiv-${suffix}-`),
  );
  temporaryDirectories.push(root);
  const candidate = await writeRuntimeReleaseCandidate(
    join(root, "candidate"),
    {
      additionalSupplierCompetitionEconomies: economies,
      additionalSupplierCompetitionProducts: products,
      additionalSupplierCompetitionRows: rows,
    },
  );
  const objectStore = new InMemoryReleaseObjectStore();
  const published = await new ReleasePublisher(objectStore).promote({
    ...candidate,
    activatedAt: "2026-07-15T02:00:00Z",
  });
  const runtime = await VerifiedReleaseRuntime.load({
    objectStore,
    volumePath: join(root, "volume"),
    now: () => "2026-07-15T02:00:00Z",
  });
  runtimes.push(runtime);
  return { runtime, analysisBuildId: published.analysisBuildId };
}

function withoutQuantityCoverageRate(
  share: SupplierCompetitionShare,
): Omit<SupplierCompetitionShare, "quantityCoverageRate"> {
  return {
    economy: share.economy,
    pooledValueCurrentUsd: share.pooledValueCurrentUsd,
    sharePercent: share.sharePercent,
    recordedYears: share.recordedYears,
    noRecordedFlowYears: share.noRecordedFlowYears,
    missingYears: share.missingYears,
  };
}

describe("Supplier Competition fixture-vs-production adapter equivalence", () => {
  it("agrees on dispersed, concentrated, single-supplier, provisional-changing, and empty outcomes at TradeAnalyticsPlatform.execute", async () => {
    const { runtime, analysisBuildId } = await buildRuntime(
      "shared",
      SHARED_ECONOMIES,
      SHARED_ROWS,
      SHARED_PRODUCTS,
    );
    const fixtureRuntime = createFixtureApplicationRuntime();

    async function fixtureOutcome(importerCode: string) {
      const outcome = await fixtureRuntime.tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        importerCode,
        productCode: FIXTURE_PRODUCT_CODE,
      });
      if (outcome.state !== "success" && outcome.state !== "empty") {
        throw new TypeError(
          `Expected fixture success/empty for importer ${importerCode}, received ${outcome.state}.`,
        );
      }
      return outcome.payload;
    }

    async function productionOutcome(importerCode: string) {
      const outcome = await runtime.tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId,
        importerCode,
        productCode: PRODUCTION_PRODUCT_CODE,
      });
      if (outcome.state !== "success" && outcome.state !== "empty") {
        throw new TypeError(
          `Expected production success/empty for importer ${importerCode}, received ${outcome.state}.`,
        );
      }
      return outcome.payload;
    }

    async function expectAgreement(importerCode: string) {
      const [fixture, production] = await Promise.all([
        fixtureOutcome(importerCode),
        productionOutcome(importerCode),
      ]);
      expect(production.cohortSize).toBe(fixture.cohortSize);
      expect(production.emptyReason).toBe(fixture.emptyReason);
      expect(production.finalizedPooledValueCurrentUsd).toBe(
        fixture.finalizedPooledValueCurrentUsd,
      );
      expect(production.supplierShares.map(withoutQuantityCoverageRate)).toEqual(
        fixture.supplierShares.map(withoutQuantityCoverageRate),
      );
      // The immutable schema tracks no per-bilateral quantity signal (see
      // groupSupplierActivityRows), so production always reports quantity
      // coverage as UNKNOWN rather than fabricating a rate.
      expect(
        production.supplierShares.every(
          (share) => share.quantityCoverageRate === null,
        ),
      ).toBe(true);
      expect(production.concentration).toEqual(fixture.concentration);
      expect(production.qualityWarnings).toEqual(fixture.qualityWarnings);
      expect(production.provisionalMarketState).toBe(
        fixture.provisionalMarketState,
      );
      expect(production.provisionalSupplierShares).toEqual(
        fixture.provisionalSupplierShares,
      );
      expect(production.query.importer).toEqual(fixture.query.importer);
      return { fixture, production };
    }

    // dispersed: four equal 25% shares, HHI 2500.000000.
    {
      const { fixture } = await expectAgreement("76");
      expect(fixture.concentration).toEqual({
        state: "COMPUTED",
        herfindahlHirschmanIndex: "2500.000000",
        scale: 10000,
      });
    }

    // concentrated: a dominant 70% supplier alongside three 10% suppliers.
    {
      const { fixture } = await expectAgreement("124");
      expect(fixture.concentration).toEqual({
        state: "COMPUTED",
        herfindahlHirschmanIndex: "5200.000000",
        scale: 10000,
      });
    }

    // single-supplier: a monopoly 100% share, HHI 10000.000000.
    {
      const { fixture } = await expectAgreement("152");
      expect(fixture.supplierShares).toHaveLength(1);
      expect(fixture.concentration).toEqual({
        state: "COMPUTED",
        herfindahlHirschmanIndex: "10000.000000",
        scale: 10000,
      });
    }

    // provisional-changing: finalized 50/50 split, but the Provisional Year
    // snapshot drops China to no recorded flow and introduces a brand-new
    // entrant (United States), without altering the finalized shares/HHI.
    {
      const { fixture } = await expectAgreement("699");
      expect(fixture.provisionalSupplierShares).toEqual([
        { economy: expect.objectContaining({ code: "528" }), bilateralState: "RECORDED_POSITIVE", valueCurrentUsd: "300000" },
        { economy: expect.objectContaining({ code: "842" }), bilateralState: "RECORDED_POSITIVE", valueCurrentUsd: "150000" },
        { economy: expect.objectContaining({ code: "156" }), bilateralState: "NO_RECORDED_POSITIVE_FLOW", valueCurrentUsd: null },
      ]);
    }

    // empty: no supplying economy ever recorded a positive value, so the
    // cohort, pooled value, and concentration are all distinctly empty/
    // unavailable, yet the Provisional Year is a known zero rather than
    // missing entirely.
    {
      const { fixture, production } = await expectAgreement("616");
      expect(fixture.cohortSize).toBe(0);
      expect(fixture.emptyReason).toBe(
        "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW",
      );
      expect(fixture.concentration).toEqual({
        state: "UNAVAILABLE",
        reason: "NO_POOLED_SUPPLIER_VALUE",
      });
      expect(production.provisionalMarketState).toBe(
        "NO_RECORDED_POSITIVE_FLOW",
      );
    }
  }, 30_000);

  it("agrees on the sparse outcome (mixed missing/no-flow/recorded years and a missing Provisional Year) at TradeAnalyticsPlatform.execute", async () => {
    const { runtime, analysisBuildId } = await buildRuntime(
      "sparse",
      SPARSE_ECONOMIES,
      SPARSE_ROWS,
      [SUPPLIER_COMPETITION_PRODUCT],
    );
    const fixtureRuntime = createFixtureApplicationRuntime();

    const [fixtureOutcome, productionOutcome] = await Promise.all([
      fixtureRuntime.tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        importerCode: SPARSE_IMPORTER_CODE,
        productCode: FIXTURE_PRODUCT_CODE,
      }),
      runtime.tradeAnalytics.execute({
        recipe: "supplier-competition-v1",
        analysisBuildId,
        importerCode: SPARSE_IMPORTER_CODE,
        productCode: PRODUCTION_PRODUCT_CODE,
      }),
    ]);
    if (fixtureOutcome.state !== "success") {
      throw new TypeError(
        `Expected fixture success, received ${fixtureOutcome.state}.`,
      );
    }
    if (productionOutcome.state !== "success") {
      throw new TypeError(
        `Expected production success, received ${productionOutcome.state}.`,
      );
    }
    const fixture = fixtureOutcome.payload;
    const production = productionOutcome.payload;

    expect(production.cohortSize).toBe(fixture.cohortSize);
    expect(production.finalizedPooledValueCurrentUsd).toBe(
      fixture.finalizedPooledValueCurrentUsd,
    );
    expect(production.supplierShares.map(withoutQuantityCoverageRate)).toEqual(
      fixture.supplierShares.map(withoutQuantityCoverageRate),
    );
    expect(
      production.supplierShares.every(
        (share) => share.quantityCoverageRate === null,
      ),
    ).toBe(true);
    // Netherlands: recorded/missing/recorded/missing/recorded.
    const netherlands = production.supplierShares.find(
      (share) => share.economy.code === "528",
    )!;
    expect(netherlands.recordedYears).toEqual([2019, 2021, 2023]);
    expect(netherlands.missingYears).toEqual([2020, 2022]);
    expect(netherlands.noRecordedFlowYears).toEqual([]);
    // Mexico: recorded once, then no-recorded-flow for the rest (never
    // missing, thanks to its padding activity elsewhere).
    const mexico = production.supplierShares.find(
      (share) => share.economy.code === "484",
    )!;
    expect(mexico.recordedYears).toEqual([2019]);
    expect(mexico.missingYears).toEqual([]);
    expect(mexico.noRecordedFlowYears).toEqual([2020, 2021, 2022, 2023]);
    expect(production.concentration).toEqual(fixture.concentration);
    expect(production.qualityWarnings).toEqual(fixture.qualityWarnings);
    expect(production.provisionalMarketState).toBe("MISSING_OBSERVATION");
    expect(production.provisionalMarketState).toBe(
      fixture.provisionalMarketState,
    );
    expect(production.provisionalSupplierShares).toEqual(
      fixture.provisionalSupplierShares,
    );
  }, 30_000);

  it("retains a recorded provisional market when only an aggregate supplier recorded flow", async () => {
    const importerCode = "36";
    const { runtime, analysisBuildId } = await buildRuntime(
      "aggregate-provisional",
      [
        {
          code: Number(importerCode),
          displayName: "Australia",
          iso2: "AU",
          iso3: "AUS",
        },
        {
          code: 697,
          displayName: "Unspecified Areas",
          iso2: null,
          iso3: null,
          kind: "AGGREGATE",
        },
      ],
      [
        ...FINALIZED_YEARS.map((year) =>
          row(year, 156, Number(importerCode), "10.000"),
        ),
        row(PROVISIONAL_YEAR, 697, Number(importerCode), "5.000"),
      ],
      [SUPPLIER_COMPETITION_PRODUCT],
    );

    const outcome = await runtime.tradeAnalytics.execute({
      recipe: "supplier-competition-v1",
      analysisBuildId,
      importerCode,
      productCode: PRODUCTION_PRODUCT_CODE,
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new TypeError(`Expected success, received ${outcome.state}.`);
    }
    expect(outcome.payload.provisionalMarketState).toBe("RECORDED");
    expect(outcome.payload.provisionalSupplierShares).toEqual([
      {
        economy: expect.objectContaining({ code: "156" }),
        bilateralState: "NO_RECORDED_POSITIVE_FLOW",
        valueCurrentUsd: null,
      },
    ]);
  }, 30_000);
});
