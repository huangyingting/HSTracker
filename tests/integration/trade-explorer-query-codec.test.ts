import { describe, expect, it } from "vitest";

import {
  decodeTradeExplorerQuery,
  encodeTradeExplorerQuery,
  type TradeExplorerQueryFields,
} from "../../src/domain/trade-analytics/trade-explorer-v1-query-codec";
import { AnalysisBudgetExceededError } from "../../src/runtime/analysis-budget-error";

function request(
  overrides: Partial<TradeExplorerQueryFields> = {},
): TradeExplorerQueryFields {
  return {
    shape: "importing-markets-v1",
    dimensions: ["IMPORT_ECONOMY"],
    measures: ["TRADE_VALUE_USD"],
    filters: {
      year: { mode: "list", years: [2023] },
      exportEconomy: ["156"],
      importEconomy: ["528", "484"],
      hsProduct: ["010121"],
    },
    sort: { key: "TRADE_VALUE_USD", direction: "desc" },
    ...overrides,
  };
}

describe("Trade Explorer v1 URL query codec", () => {
  it("round-trips every field through explicit semantic parameters", () => {
    const original = request();
    const params = encodeTradeExplorerQuery(original);
    const decoded = decodeTradeExplorerQuery(params);
    expect(decoded).toEqual(original);
  });

  it("never encodes SQL, JSON, or base64 -- only named semantic parameters", () => {
    const params = encodeTradeExplorerQuery(request());
    expect([...params.keys()].sort()).toEqual([
      "exportEconomy",
      "hsProduct",
      "importEconomy",
      "measures",
      "shape",
      "sortDirection",
      "sortKey",
      "years",
    ]);
    for (const value of params.values()) {
      expect(value).not.toMatch(/[{}[\]]/u);
      expect(value).not.toMatch(/select|insert|update|delete/iu);
    }
  });

  it("omits years entirely for the default full-window finalized-trend-v1 request", () => {
    const original = request({
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });
    const params = encodeTradeExplorerQuery(original);
    expect(params.has("years")).toBe(false);
    expect(params.has("sortKey")).toBe(false);
    expect(decodeTradeExplorerQuery(params)).toEqual(original);
  });

  it("derives dimensions from shape alone, never encoding a separate parameter", () => {
    const params = encodeTradeExplorerQuery(request());
    expect(params.has("dimensions")).toBe(false);
    const decoded = decodeTradeExplorerQuery(params);
    expect(decoded?.dimensions).toEqual(["IMPORT_ECONOMY"]);
  });

  it("returns null for a malformed or incomplete query", () => {
    expect(decodeTradeExplorerQuery(new URLSearchParams())).toBeNull();
    expect(
      decodeTradeExplorerQuery(
        new URLSearchParams({ shape: "unknown-shape" }),
      ),
    ).toBeNull();
  });

  it("returns null when an extra unrecognized parameter is present", () => {
    const params = encodeTradeExplorerQuery(request());
    params.set("sql", "DROP TABLE trades");
    expect(decodeTradeExplorerQuery(params)).toBeNull();
  });

  it("rejects duplicate semantic parameters instead of accepting the first value", () => {
    const params = encodeTradeExplorerQuery(request());
    params.append("shape", "product-mix-v1");
    expect(decodeTradeExplorerQuery(params)).toBeNull();
  });

  it("reports an oversized code list as a typed budget excess before splitting it into tokens", () => {
    const params = encodeTradeExplorerQuery(request());
    params.set(
      "importEconomy",
      Array.from({ length: 26 }, () => "528").join(","),
    );
    expect(() => decodeTradeExplorerQuery(params)).toThrow(
      AnalysisBudgetExceededError,
    );
  });

  it("encodes the maximum five-year range and rejects max-plus-one", () => {
    const atMaximum = request({
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      filters: {
        year: { mode: "range", start: 2019, end: 2023 },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
    });
    expect(encodeTradeExplorerQuery(atMaximum).get("years")).toBe(
      "2019,2020,2021,2022,2023",
    );
    expect(() =>
      encodeTradeExplorerQuery({
        ...atMaximum,
        filters: {
          ...atMaximum.filters,
          year: { mode: "range", start: 2018, end: 2023 },
        },
      }),
    ).toThrow(RangeError);
  });

  it("rejects a hostile safe-integer range without attempting to allocate it", () => {
    const original = request();
    expect(() =>
      encodeTradeExplorerQuery({
        ...original,
        filters: {
          ...original.filters,
          year: {
            mode: "range",
            start: Number.MIN_SAFE_INTEGER,
            end: Number.MAX_SAFE_INTEGER,
          },
        },
      }),
    ).toThrow(RangeError);
  });
});
