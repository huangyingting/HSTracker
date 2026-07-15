import { describe, expect, it } from "vitest";

import { isTradeExplorerAnalysisError } from "../../src/domain/trade-explorer/errors";
import { normalizeTradeExplorerV1Request } from "../../src/domain/trade-explorer/normalize";
import type { TradeExplorerV1RecipeInput } from "../../src/domain/trade-explorer/result";

const FINALIZED_WINDOW = { start: 2019, end: 2023 } as const;

function request(
  overrides: Partial<TradeExplorerV1RecipeInput> = {},
): TradeExplorerV1RecipeInput {
  return {
    analysisBuildId: "acceptance-fixtures-v1",
    shape: "finalized-trend-v1",
    dimensions: ["YEAR"],
    measures: ["TRADE_VALUE_USD"],
    filters: {
      year: { mode: "list", years: [] },
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
    },
    sort: null,
    ...overrides,
  };
}

describe("normalizeTradeExplorerV1Request", () => {
  it("normalizes the finalized-trend-v1 shape to the full finalized window in ascending order", () => {
    const normalized = normalizeTradeExplorerV1Request(
      request(),
      FINALIZED_WINDOW,
    );
    expect(normalized.shape).toBe("finalized-trend-v1");
    expect(normalized.dimension).toBe("YEAR");
    expect(normalized.years).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(normalized.exportEconomy).toEqual(["156"]);
    expect(normalized.importEconomy).toEqual(["528"]);
    expect(normalized.hsProduct).toEqual(["010121"]);
    expect(normalized.measures).toEqual(["TRADE_VALUE_USD"]);
    // No explicit sort: canonical default is ascending by the grouped
    // dimension.
    expect(normalized.sort).toEqual({ key: "YEAR", direction: "asc" });
  });

  it("deduplicates and ascending-sorts a caller-supplied cohort regardless of input order", () => {
    const normalized = normalizeTradeExplorerV1Request(
      request({
        shape: "importing-markets-v1",
        dimensions: ["IMPORT_ECONOMY"],
        filters: {
          year: { mode: "list", years: [2021] },
          exportEconomy: ["156"],
          importEconomy: ["528", "076", "528", "36"],
          hsProduct: ["010121"],
        },
      }),
      FINALIZED_WINDOW,
    );
    expect(normalized.importEconomy).toEqual(["36", "76", "528"]);
  });

  it("normalizes an equivalent year range and an equivalent year list to the identical years array", () => {
    const viaRange = normalizeTradeExplorerV1Request(
      request({
        shape: "importing-markets-v1",
        dimensions: ["IMPORT_ECONOMY"],
        filters: {
          year: { mode: "range", start: 2021, end: 2021 },
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
        },
      }),
      FINALIZED_WINDOW,
    );
    const viaList = normalizeTradeExplorerV1Request(
      request({
        shape: "importing-markets-v1",
        dimensions: ["IMPORT_ECONOMY"],
        filters: {
          year: { mode: "list", years: [2021] },
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
        },
      }),
      FINALIZED_WINDOW,
    );
    expect(viaRange.years).toEqual(viaList.years);
    expect(viaRange).toEqual(viaList);
  });

  it("resolves an explicit sort on a requested measure with a deterministic dimension tie-breaker implied", () => {
    const normalized = normalizeTradeExplorerV1Request(
      request({
        sort: { key: "TRADE_VALUE_USD", direction: "desc" },
      }),
      FINALIZED_WINDOW,
    );
    expect(normalized.sort).toEqual({ key: "TRADE_VALUE_USD", direction: "desc" });
  });

  it("rejects a shape outside the allowlist", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({ shape: "unknown-shape-v1" as never }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("UNSUPPORTED_SHAPE");
      }
    }
  });

  it("rejects dimensions that do not match the shape's own grouped dimension", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({ dimensions: ["EXPORT_ECONOMY"] }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("DIMENSION_MISMATCH");
      }
    }
  });

  it("rejects an empty measures list", () => {
    try {
      normalizeTradeExplorerV1Request(request({ measures: [] }), FINALIZED_WINDOW);
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("UNSUPPORTED_MEASURE");
      }
    }
  });

  it("rejects a sort key that is neither the grouped dimension nor a requested measure", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({ sort: { key: "RECORDED_FLOW_COUNT", direction: "asc" } }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("UNSUPPORTED_SORT_KEY");
      }
    }
  });

  it("rejects a fixed dimension given more than one code", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156", "76"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("FIXED_DIMENSION_CARDINALITY_INVALID");
      }
    }
  });

  it("rejects a grouped dimension given zero codes", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          shape: "importing-markets-v1",
          dimensions: ["IMPORT_ECONOMY"],
          filters: {
            year: { mode: "list", years: [2021] },
            exportEconomy: ["156"],
            importEconomy: [],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("GROUPED_DIMENSION_EMPTY");
      }
    }
  });

  it("rejects a fixed-year shape given more than one year", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          shape: "importing-markets-v1",
          dimensions: ["IMPORT_ECONOMY"],
          filters: {
            year: { mode: "list", years: [2021, 2022] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("YEAR_FILTER_INVALID");
      }
    }
  });

  it("rejects a year filter reaching outside the finalized window", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          shape: "importing-markets-v1",
          dimensions: ["IMPORT_ECONOMY"],
          filters: {
            year: { mode: "list", years: [2024] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("YEAR_OUT_OF_FINALIZED_WINDOW");
      }
    }
  });

  it("accepts exactly the maximum 25 cohort codes", () => {
    const codes = Array.from({ length: 25 }, (_, index) => String(index + 1));
    const normalized = normalizeTradeExplorerV1Request(
      request({
        shape: "importing-markets-v1",
        dimensions: ["IMPORT_ECONOMY"],
        filters: {
          year: { mode: "list", years: [2021] },
          exportEconomy: ["156"],
          importEconomy: codes,
          hsProduct: ["010121"],
        },
      }),
      FINALIZED_WINDOW,
    );
    expect(normalized.importEconomy).toHaveLength(25);
  });

  it("rejects exactly one cohort code beyond the maximum as a budget outcome, not invalid input", () => {
    const codes = Array.from({ length: 26 }, (_, index) => String(index + 1));
    try {
      normalizeTradeExplorerV1Request(
        request({
          shape: "importing-markets-v1",
          dimensions: ["IMPORT_ECONOMY"],
          filters: {
            year: { mode: "list", years: [2021] },
            exportEconomy: ["156"],
            importEconomy: codes,
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INPUT_CARDINALITY_BUDGET_EXCEEDED");
        expect(error.status).toBe(413);
      }
    }
  });

  it("rejects an oversized fixed-dimension array before mapping or deduplicating it", () => {
    const codes = Array.from({ length: 26 }, () => "156");
    try {
      normalizeTradeExplorerV1Request(
        request({
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: codes,
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INPUT_CARDINALITY_BUDGET_EXCEEDED");
      }
    }
  });

  it("accepts exactly the maximum 5 finalized years for the finalized-trend-v1 shape", () => {
    const normalized = normalizeTradeExplorerV1Request(
      request({
        filters: {
          year: { mode: "list", years: [] },
          exportEconomy: ["156"],
          importEconomy: ["528"],
          hsProduct: ["010121"],
        },
      }),
      { start: 2019, end: 2023 },
    );
    expect(normalized.years).toHaveLength(5);
  });

  it("rejects a finalized window wider than 5 years as a budget outcome", () => {
    try {
      normalizeTradeExplorerV1Request(request(), { start: 2018, end: 2023 });
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INPUT_CARDINALITY_BUDGET_EXCEEDED");
      }
    }
  });

  it("rejects exactly one year beyond the maximum before expanding a range", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          filters: {
            year: { mode: "range", start: 2018, end: 2023 },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        { start: 2018, end: 2023 },
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INPUT_CARDINALITY_BUDGET_EXCEEDED");
      }
    }
  });

  it("rejects a hostile safe-integer year range without attempting to allocate it", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({
          filters: {
            year: {
              mode: "range",
              start: Number.MIN_SAFE_INTEGER,
              end: Number.MAX_SAFE_INTEGER,
            },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
        }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INPUT_CARDINALITY_BUDGET_EXCEEDED");
      }
    }
  });

  it("rejects an empty analysisBuildId", () => {
    try {
      normalizeTradeExplorerV1Request(
        request({ analysisBuildId: "" }),
        FINALIZED_WINDOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isTradeExplorerAnalysisError(error)).toBe(true);
      if (isTradeExplorerAnalysisError(error)) {
        expect(error.code).toBe("INVALID_ANALYSIS_QUERY");
      }
    }
  });
});
