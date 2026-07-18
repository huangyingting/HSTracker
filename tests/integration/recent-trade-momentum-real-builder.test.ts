import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aggregateEligibleMarketMonths,
  updateStateFor,
} from "../../scripts/release/build-real-eurostat-momentum-package";

// The 18 detailed Comext columns, in source order.
const COLUMNS = [
  "REPORTER", "PARTNER", "TRADE_TYPE", "PRODUCT_NC", "PRODUCT_SITC",
  "PRODUCT_CPA21", "PRODUCT_CPA22", "PRODUCT_BEC", "PRODUCT_BEC5",
  "PRODUCT_SECTION", "FLOW", "STAT_PROCEDURE", "SUPPL_UNIT", "PERIOD",
  "VALUE_EUR", "VALUE_NAC", "QUANTITY_KG", "QUANTITY_SUPPL_UNIT",
] as const;

type RowOverrides = Partial<Record<(typeof COLUMNS)[number], string>>;

/** Build one CSV data line, defaulting every column and overriding the few
 * fields that drive eligibility. */
function row(overrides: RowOverrides): string {
  const defaults: Record<(typeof COLUMNS)[number], string> = {
    REPORTER: "DE", PARTNER: "US", TRADE_TYPE: "E", PRODUCT_NC: "01012100",
    PRODUCT_SITC: "", PRODUCT_CPA21: "", PRODUCT_CPA22: "", PRODUCT_BEC: "",
    PRODUCT_BEC5: "", PRODUCT_SECTION: "", FLOW: "1", STAT_PROCEDURE: "",
    SUPPL_UNIT: "", PERIOD: "202406", VALUE_EUR: "100", VALUE_NAC: "",
    QUANTITY_KG: "", QUANTITY_SUPPL_UNIT: "",
  };
  return COLUMNS.map((column) => overrides[column] ?? defaults[column]).join(",");
}

describe("real builder: aggregateEligibleMarketMonths", () => {
  let workDir: string;
  let datFile: string;
  let instance: DuckDBInstance;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "rtm-real-builder-"));
    datFile = join(workDir, "full_202406.dat");

    const lines = [
      COLUMNS.join(","),
      // Two individual partners for the same market-month cell (DE|010121).
      row({ PARTNER: "US", PRODUCT_NC: "01012100", VALUE_EUR: "100" }),
      row({ PARTNER: "CN", PRODUCT_NC: "01012100", VALUE_EUR: "50" }),
      // Two accepted CN8 codes rolling up to the same HS12 (DE|270900).
      row({ PARTNER: "US", PRODUCT_NC: "27090010", VALUE_EUR: "1000" }),
      row({ PARTNER: "US", PRODUCT_NC: "27090090", VALUE_EUR: "500" }),
      // A second reporter.
      row({ REPORTER: "FR", PARTNER: "US", PRODUCT_NC: "01012100", VALUE_EUR: "200" }),
      // --- rows that must be excluded from the market total ---
      // Export flow.
      row({ FLOW: "2", VALUE_EUR: "999" }),
      // XX-suffixed hierarchical subtotal (not an 8-digit leaf).
      row({ PRODUCT_NC: "010121XX", VALUE_EUR: "999" }),
      // Non-individual (not-specified) partner: excluded from the market total
      // but counted in the excluded-special total.
      row({ PARTNER: "QV", PRODUCT_NC: "01012100", VALUE_EUR: "300" }),
      // CN8 that is not an accepted eligible code.
      row({ PRODUCT_NC: "99999999", VALUE_EUR: "999" }),
      // Reporter outside the allowlist.
      row({ REPORTER: "GB", PRODUCT_NC: "01012100", VALUE_EUR: "999" }),
      // Empty value (cannot be cast to an integer).
      row({ PRODUCT_NC: "01012100", VALUE_EUR: "" }),
    ];
    await writeFile(datFile, `${lines.join("\n")}\n`, "utf8");

    instance = await DuckDBInstance.create(":memory:");
  });

  afterAll(async () => {
    instance.closeSync();
    await rm(workDir, { recursive: true, force: true });
  });

  it("aggregates only eligible import rows and reconciles source totals", async () => {
    const connection = await instance.connect();
    try {
      await connection.run(`CREATE TABLE accepted_cn8 (edition_year INTEGER, cn8 VARCHAR, hs12 VARCHAR)`);
      await connection.run(`
        INSERT INTO accepted_cn8 VALUES
          (2024, '01012100', '010121'),
          (2024, '27090010', '270900'),
          (2024, '27090090', '270900')
      `);
      await connection.run(`CREATE TABLE reporter_allowlist (iso2 VARCHAR)`);
      await connection.run(`INSERT INTO reporter_allowlist VALUES ('DE'), ('FR')`);

      const result = await aggregateEligibleMarketMonths(connection, [datFile]);

      const cell = (period: string, reporter: string, hs12: string) =>
        result.marketMonths.get(`${period}|${reporter}|${hs12}`);

      // DE|010121: 100 (US) + 50 (CN); the QV row is excluded from the market.
      expect(cell("202406", "DE", "010121")).toEqual({ value: 150n, partners: 2, cn8s: 1 });
      // DE|270900: two accepted CN8 leaves, one partner.
      expect(cell("202406", "DE", "270900")).toEqual({ value: 1500n, partners: 1, cn8s: 2 });
      // FR|010121: single partner.
      expect(cell("202406", "FR", "010121")).toEqual({ value: 200n, partners: 1, cn8s: 1 });
      // No other cells (export, subtotal, non-accepted, off-allowlist, null all dropped).
      expect(result.marketMonths.size).toBe(3);

      // Only the QV row's value is excluded as special/aggregate.
      expect(result.sourceIdentifiedValueEur).toBe(1850n);
      expect(result.excludedSpecialValueEur).toBe(300n);

      // Partner dimension records every partner seen in eligible trade
      // (individual + special), regardless of market exclusion.
      expect([...result.partnerCodes].sort()).toEqual(["CN", "QV", "US"]);
    } finally {
      connection.closeSync();
    }
  });
});

describe("real builder: updateStateFor", () => {
  it("treats a month as final only from October of the following year", () => {
    // 2024 reference months are final when extracted in mid-2026.
    expect(updateStateFor("202406", "2026-07")).toBe("FINAL_BY_SOURCE_SCHEDULE");
    // A 2025 month is still preliminary in mid-2026 (before Oct 2026).
    expect(updateStateFor("202511", "2026-07")).toBe("PRELIMINARY");
    // The boundary: a 2025 month becomes final exactly in October 2026.
    expect(updateStateFor("202511", "2026-10")).toBe("FINAL_BY_SOURCE_SCHEDULE");
    expect(updateStateFor("202511", "2026-09")).toBe("PRELIMINARY");
  });
});
