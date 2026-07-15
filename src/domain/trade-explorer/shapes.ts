import type { TradeExplorerDimension, TradeExplorerShape } from "./result";

// The closed allowlist of business shapes Trade Explorer v1 accepts. Each
// entry fixes which single dimension is grouped (produces one row per
// value) and requires every other dimension to resolve to exactly one
// value. This table -- not a combinatorial validator -- is the single
// source of truth for "is this combination allowed", matching the issue's
// preference for "a small explicit allowlist of useful business
// shapes/templates over a combinatorial validator".
export type TradeExplorerShapeDefinition = Readonly<{
  shape: TradeExplorerShape;
  groupedDimension: TradeExplorerDimension;
  fixedDimensions: readonly TradeExplorerDimension[];
}>;

export const TRADE_EXPLORER_SHAPES: readonly TradeExplorerShapeDefinition[] = [
  {
    shape: "finalized-trend-v1",
    groupedDimension: "YEAR",
    fixedDimensions: ["EXPORT_ECONOMY", "IMPORT_ECONOMY", "HS_PRODUCT"],
  },
  {
    shape: "importing-markets-v1",
    groupedDimension: "IMPORT_ECONOMY",
    fixedDimensions: ["EXPORT_ECONOMY", "HS_PRODUCT", "YEAR"],
  },
  {
    shape: "supplying-economies-v1",
    groupedDimension: "EXPORT_ECONOMY",
    fixedDimensions: ["IMPORT_ECONOMY", "HS_PRODUCT", "YEAR"],
  },
  {
    shape: "product-mix-v1",
    groupedDimension: "HS_PRODUCT",
    fixedDimensions: ["EXPORT_ECONOMY", "IMPORT_ECONOMY", "YEAR"],
  },
];

const SHAPES_BY_ID: ReadonlyMap<TradeExplorerShape, TradeExplorerShapeDefinition> =
  new Map(TRADE_EXPLORER_SHAPES.map((definition) => [definition.shape, definition]));

export function tradeExplorerShapeDefinition(
  shape: string,
): TradeExplorerShapeDefinition | null {
  return SHAPES_BY_ID.get(shape as TradeExplorerShape) ?? null;
}
