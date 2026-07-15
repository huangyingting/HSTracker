import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
  type TradeTrendEquivalenceRow,
} from "../support/runtime-release";

// This proves fixture-vs-production equality at the public
// TradeAnalyticsPlatform.execute seam (issue #40 requirement 2): the same
// four representative Trade Trend cases already accepted for the
// fixture-backed adapter in fixtures/trade-trend/v1/{evidence,expected}.ts
// -- sparse, no-recorded-flow, unavailable/missing, and provisional-present
// -- are independently reproduced against a tiny hand-built production
// DuckDB artifact queried through DuckDbTradeEvidenceSource. Both sides are
// asserted equal on their normalized observation/summary/query shape rather
// than only asserting the production output in isolation.
const OTHER_PRODUCT_CODE = "999999";
const PRODUCT_CODE = RUNTIME_RELEASE_FIXTURE.productCode;
const EXPORTER_CODE = 842;

const ADDITIONAL_ECONOMIES = [
  { code: 528, displayName: "Netherlands", iso2: "NL", iso3: "NLD" },
  { code: 484, displayName: "Mexico", iso2: "MX", iso3: "MEX" },
  { code: 36, displayName: "Australia", iso2: "AU", iso3: "AUS" },
  { code: 710, displayName: "South Africa", iso2: "ZA", iso3: "ZAF" },
] as const;

const ADDITIONAL_PRODUCTS = [
  {
    productId: 2,
    code: OTHER_PRODUCT_CODE,
    description: "Synthetic other-product placeholder for Trade Trend evidence.",
  },
] as const;

// Reproduces the exact per-year observation states asserted for these same
// importer codes in fixtures/trade-trend/v1/evidence.ts: 528 is complete
// with a provisional snapshot, 484 is sparse, 36 is all no-recorded-flow,
// and 710 mixes missing/no-flow/recorded with a missing provisional year.
const ADDITIONAL_ROWS: readonly TradeTrendEquivalenceRow[] = [
  // 528 (Netherlands): every finalized year and the provisional year
  // recorded positive.
  row(2019, PRODUCT_CODE, 528, "100.000"),
  row(2020, PRODUCT_CODE, 528, "110.000"),
  row(2021, PRODUCT_CODE, 528, "120.000"),
  row(2022, PRODUCT_CODE, 528, "130.000"),
  row(2023, PRODUCT_CODE, 528, "160.000"),
  row(2024, PRODUCT_CODE, 528, "200.000"),

  // 484 (Mexico): recorded, missing, no-flow, recorded, missing. No 2024
  // row at all: production cannot represent the fixture's "absent"
  // (null) provisional observation, so this year is deliberately left as
  // MISSING_OBSERVATION and excluded from the full-payload comparison.
  row(2019, PRODUCT_CODE, 484, "100.000"),
  row(2021, OTHER_PRODUCT_CODE, 484, "5.000"),
  row(2022, PRODUCT_CODE, 484, "50.000"),

  // 36 (Australia): other-product activity every year, so every finalized
  // and provisional year is a recorded-zero (NO_RECORDED_POSITIVE_FLOW)
  // rather than a missing observation.
  row(2019, OTHER_PRODUCT_CODE, 36, "5.000"),
  row(2020, OTHER_PRODUCT_CODE, 36, "5.000"),
  row(2021, OTHER_PRODUCT_CODE, 36, "5.000"),
  row(2022, OTHER_PRODUCT_CODE, 36, "5.000"),
  row(2023, OTHER_PRODUCT_CODE, 36, "5.000"),
  row(2024, OTHER_PRODUCT_CODE, 36, "5.000"),

  // 710 (South Africa): missing, no-flow, recorded, missing, no-flow, and
  // a missing provisional year (no 2024 row for this importer at all).
  row(2020, OTHER_PRODUCT_CODE, 710, "5.000"),
  row(2021, PRODUCT_CODE, 710, "7.000"),
  row(2023, OTHER_PRODUCT_CODE, 710, "5.000"),
];

function row(
  year: number,
  productCode: string,
  importerCode: number,
  valueKusd: string,
): TradeTrendEquivalenceRow {
  return {
    year,
    productCode,
    exporterCode: EXPORTER_CODE,
    importerCode,
    valueKusd,
  };
}

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

describe("Trade Trend fixture-vs-production adapter equivalence", () => {
  it("agrees on complete, sparse, no-recorded-flow, and unavailable/missing outcomes at TradeAnalyticsPlatform.execute", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-trade-trend-equiv-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
      {
        benchmarkCandidateCount: 4,
        additionalTradeTrendEconomies: ADDITIONAL_ECONOMIES,
        additionalTradeTrendProducts: ADDITIONAL_PRODUCTS,
        additionalTradeTrendRows: ADDITIONAL_ROWS,
      },
    );
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
    const fixtureRuntime = createFixtureApplicationRuntime();

    async function fixtureOutcome(importerCode: string) {
      const outcome = await fixtureRuntime.tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        importerCode,
        productCode: PRODUCT_CODE,
      });
      if (outcome.state !== "success") {
        throw new TypeError(
          `Expected fixture success for importer ${importerCode}, received ${outcome.state}.`,
        );
      }
      return outcome.payload;
    }

    async function productionOutcome(importerCode: string) {
      const outcome = await runtime.tradeAnalytics.execute({
        recipe: "trade-trend-v1",
        analysisBuildId: published.analysisBuildId,
        importerCode,
        productCode: PRODUCT_CODE,
      });
      if (outcome.state !== "success") {
        throw new TypeError(
          `Expected production success for importer ${importerCode}, received ${outcome.state}.`,
        );
      }
      return outcome.payload;
    }

    // Complete: every finalized year and the provisional year recorded
    // positive (mirrors fixtures/trade-trend/v1/evidence.ts "528").
    {
      const [fixture, production] = await Promise.all([
        fixtureOutcome("528"),
        productionOutcome("528"),
      ]);
      expect(production.finalizedObservations).toEqual(
        fixture.finalizedObservations,
      );
      expect(production.provisionalObservation).toEqual(
        fixture.provisionalObservation,
      );
      expect(production.summary).toEqual(fixture.summary);
      expect(production.query.importer).toMatchObject({
        code: "528",
        name: "Netherlands",
        iso3: "NLD",
      });
    }

    // No recorded flow: every finalized and provisional year is a
    // recorded zero, never a missing observation (mirrors fixture "36").
    {
      const [fixture, production] = await Promise.all([
        fixtureOutcome("36"),
        productionOutcome("36"),
      ]);
      expect(production.finalizedObservations).toEqual(
        fixture.finalizedObservations,
      );
      expect(production.finalizedObservations.every(
        (observation) => observation.state === "NO_RECORDED_POSITIVE_FLOW",
      )).toBe(true);
      expect(production.provisionalObservation).toEqual(
        fixture.provisionalObservation,
      );
      expect(production.summary).toEqual(fixture.summary);
    }

    // Unavailable/missing: a mix of missing, no-flow, and one recorded
    // observation, with an explicit missing provisional year (mirrors
    // fixture "710").
    {
      const [fixture, production] = await Promise.all([
        fixtureOutcome("710"),
        productionOutcome("710"),
      ]);
      expect(production.finalizedObservations).toEqual(
        fixture.finalizedObservations,
      );
      expect(production.provisionalObservation).toEqual({
        year: 2024,
        state: "MISSING_OBSERVATION",
      });
      expect(production.provisionalObservation).toEqual(
        fixture.provisionalObservation,
      );
      expect(production.summary).toEqual(fixture.summary);
    }

    // Sparse: recorded/missing/no-flow/recorded/missing. The fixture's
    // provisional year is deliberately absent (null) to model a case with
    // no provisional evidence at all; loadTradeTrendV1Inputs's query
    // always computes a state for the provisional year, so an entirely
    // absent provisional observation cannot be reproduced in production.
    // Every other field -- including the finalized window and the
    // summary derived only from finalized years -- is compared for exact
    // equality (mirrors fixture "484").
    {
      const [fixture, production] = await Promise.all([
        fixtureOutcome("484"),
        productionOutcome("484"),
      ]);
      expect(fixture.provisionalObservation).toBeNull();
      expect(production.provisionalObservation).toEqual({
        year: 2024,
        state: "MISSING_OBSERVATION",
      });
      expect(production.finalizedObservations).toEqual(
        fixture.finalizedObservations,
      );
      expect(production.summary).toEqual(fixture.summary);
    }
  }, 30_000);
});
