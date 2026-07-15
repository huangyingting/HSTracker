import { describe, expect, it } from "vitest";

import {
  isTradeExplorerAnalysisError,
} from "../../src/domain/trade-explorer/errors";
import {
  assertTradeExplorerResultByteBudget,
  assertTradeExplorerResultRowBudget,
  assertTradeExplorerScanBudget,
  computeTradeExplorerV1,
} from "../../src/domain/trade-explorer/trade-explorer-v1";
import {
  TRADE_EXPLORER_MAX_RESULT_BYTES,
  TRADE_EXPLORER_MAX_RESULT_ROWS,
  TRADE_EXPLORER_MAX_SCAN_ROWS,
} from "../../src/domain/trade-explorer/result";
import type {
  TradeExplorerCellEvidence,
  TradeExplorerV1Inputs,
} from "../../src/domain/trade-explorer/result";

const RELEASE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2012, end: 2024 },
  finalizedCutoffYear: 2023,
  provisionalYear: 2024,
};

const ARTIFACT = {
  baciRelease: "V202601",
  buildId: "trade-explorer-fixture-artifact",
  schemaVersion: "trade-explorer-fixture-v1",
  sha256: "d".repeat(64),
};

const CHINA = { code: "156", name: "China", iso3: "CHN", identityNote: null };
const NETHERLANDS = {
  code: "528",
  name: "Netherlands",
  iso3: "NLD",
  identityNote: null,
};
const AUSTRALIA = {
  code: "36",
  name: "Australia",
  iso3: "AUS",
  identityNote: null,
};
const MEXICO = { code: "484", name: "Mexico", iso3: "MEX", identityNote: null };

const PRODUCT = {
  hsRevision: "HS12" as const,
  code: "010121",
  descriptionEn: "Horses: live, pure-bred breeding animals",
};

function baseInputs(
  overrides: Partial<TradeExplorerV1Inputs>,
): TradeExplorerV1Inputs {
  return {
    analysisBuildId: "acceptance-fixtures-v1",
    analysisReleaseCatalogSha256: "a".repeat(64),
    evidenceSha256: "e".repeat(64),
    artifact: ARTIFACT,
    release: RELEASE,
    exportEconomies: [CHINA],
    importEconomies: [NETHERLANDS],
    products: [PRODUCT],
    cohortEnumerable: true,
    cells: [],
    query: {
      shape: "finalized-trend-v1",
      dimension: "YEAR",
      measures: ["TRADE_VALUE_USD"],
      years: [2019, 2020, 2021, 2022, 2023],
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
      sort: { key: "YEAR", direction: "asc" },
    },
    ...overrides,
  };
}

function recorded(valueCurrentUsd: string, sourceFlowCount = 1): TradeExplorerCellEvidence {
  return { state: "RECORDED_POSITIVE", valueCurrentUsd, sourceFlowCount };
}
const noFlow: TradeExplorerCellEvidence = { state: "NO_RECORDED_POSITIVE_FLOW" };
const missing: TradeExplorerCellEvidence = { state: "MISSING_OBSERVATION" };

describe("computeTradeExplorerV1", () => {
  it("rejects evidence identities that do not match the normalized request", () => {
    expect(() =>
      computeTradeExplorerV1(
        baseInputs({
          importEconomies: [MEXICO],
        }),
      ),
    ).toThrow(
      "Trade Explorer evidence import economies do not match the normalized request.",
    );
  });

  it("builds one row per finalized year in ascending order for the finalized-trend-v1 shape", () => {
    const result = computeTradeExplorerV1(
      baseInputs({
        query: {
          shape: "finalized-trend-v1",
          dimension: "YEAR",
          measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
          years: [2019, 2020, 2021, 2022, 2023],
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
          sort: { key: "YEAR", direction: "asc" },
        },
        cells: [
          recorded("40000"),
          recorded("50000"),
          noFlow,
          missing,
          recorded("80000"),
        ],
      }),
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => row.dimensionValue)).toEqual([
      { dimension: "YEAR", year: 2019 },
      { dimension: "YEAR", year: 2020 },
      { dimension: "YEAR", year: 2021 },
      { dimension: "YEAR", year: 2022 },
      { dimension: "YEAR", year: 2023 },
    ]);
    expect(result.rows.map((row) => row.state)).toEqual([
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "NO_RECORDED_POSITIVE_FLOW",
      "MISSING_OBSERVATION",
      "RECORDED_POSITIVE",
    ]);
    expect(result.rows[2]!.tradeValueUsd).toBeNull();
    expect(result.rows[2]!.recordedFlowCount).toBe(0);
    expect(result.rows[3]!.tradeValueUsd).toBeNull();
    expect(result.rows[3]!.recordedFlowCount).toBeNull();
    // The trend shape's cross-year total is not semantically useful (like
    // Trade Trend, which has no cross-year total either).
    expect(result.totalRow).toBeNull();
    expect(result.emptyReason).toBeNull();
    expect(result.columns).toEqual(["YEAR", "TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"]);
  });

  it("builds one row per importing economy, sorted ascending by code by default, with a meaningful total row", () => {
    const result = computeTradeExplorerV1(
      baseInputs({
        importEconomies: [AUSTRALIA, MEXICO, NETHERLANDS],
        cells: [recorded("7000"), missing, recorded("160000")],
        query: {
          shape: "importing-markets-v1",
          dimension: "IMPORT_ECONOMY",
          measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
          years: [2023],
          exportEconomy: ["156"],
          importEconomy: ["36", "484", "528"],
          hsProduct: ["010121"],
          sort: { key: "IMPORT_ECONOMY", direction: "asc" },
        },
      }),
    );
    expect(result.rows.map((row) => row.dimensionValue)).toEqual([
      { dimension: "IMPORT_ECONOMY", economy: AUSTRALIA },
      { dimension: "IMPORT_ECONOMY", economy: MEXICO },
      { dimension: "IMPORT_ECONOMY", economy: NETHERLANDS },
    ]);
    expect(result.totalRow).toEqual({
      tradeValueUsd: "167000",
      recordedFlowCount: 2,
      includedRowCount: 2,
      missingRowCount: 1,
    });
    expect(result.qualityWarnings).toEqual(["INCOMPLETE_COHORT"]);
  });

  it("sorts by a requested measure descending with a deterministic dimension tie-breaker", () => {
    const result = computeTradeExplorerV1(
      baseInputs({
        importEconomies: [AUSTRALIA, MEXICO, NETHERLANDS],
        cells: [recorded("7000"), noFlow, recorded("160000")],
        query: {
          shape: "importing-markets-v1",
          dimension: "IMPORT_ECONOMY",
          measures: ["TRADE_VALUE_USD"],
          years: [2023],
          exportEconomy: ["156"],
          importEconomy: ["36", "484", "528"],
          hsProduct: ["010121"],
          sort: { key: "TRADE_VALUE_USD", direction: "desc" },
        },
      }),
    );
    expect(result.rows.map((row) => row.dimensionValue.dimension === "IMPORT_ECONOMY" ? row.dimensionValue.economy.code : null)).toEqual([
      "528",
      "36",
      "484",
    ]);
  });

  it("reports a typed empty outcome when the fixed-dimension combination is not enumerable", () => {
    const result = computeTradeExplorerV1(
      baseInputs({ cohortEnumerable: false, cells: [] }),
    );
    expect(result.emptyReason).toBe("NO_ENUMERABLE_COHORT");
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.totalRow).toBeNull();
  });

  it("reports SPARSE_COHORT when no row in the cohort is recorded positive", () => {
    const result = computeTradeExplorerV1(
      baseInputs({ cells: [noFlow, noFlow, missing, noFlow, missing] }),
    );
    expect(result.qualityWarnings).toContain("SPARSE_COHORT");
  });

  it("throws a defect if evidence supplies a cell count that does not match the grouped cohort length", () => {
    expect(() =>
      computeTradeExplorerV1(baseInputs({ cells: [recorded("1")] })),
    ).toThrow(TypeError);
  });

  it("rejects mixing BACI Releases between artifact and release as a defect", () => {
    expect(() =>
      computeTradeExplorerV1(
        baseInputs({
          cells: [recorded("1"), recorded("1"), recorded("1"), recorded("1"), recorded("1")],
          artifact: { ...ARTIFACT, baciRelease: "V202512" },
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe("Trade Explorer defensive result budgets", () => {
  it("accepts exactly the maximum result row count and rejects one beyond it", () => {
    expect(() => assertTradeExplorerResultRowBudget(TRADE_EXPLORER_MAX_RESULT_ROWS)).not.toThrow();
    try {
      assertTradeExplorerResultRowBudget(TRADE_EXPLORER_MAX_RESULT_ROWS + 1);
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("RESULT_ROWS_BUDGET_EXCEEDED");
      }
    }
  });

  it("accepts exactly the maximum scan row count and rejects one beyond it", () => {
    expect(() => assertTradeExplorerScanBudget(TRADE_EXPLORER_MAX_SCAN_ROWS)).not.toThrow();
    try {
      assertTradeExplorerScanBudget(TRADE_EXPLORER_MAX_SCAN_ROWS + 1);
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
    }
  });

  it("accepts exactly the maximum result byte count and rejects one beyond it", () => {
    expect(() =>
      assertTradeExplorerResultByteBudget(TRADE_EXPLORER_MAX_RESULT_BYTES),
    ).not.toThrow();
    try {
      assertTradeExplorerResultByteBudget(TRADE_EXPLORER_MAX_RESULT_BYTES + 1);
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("RESULT_BYTES_BUDGET_EXCEEDED");
      }
    }
  });
});
