import { invalidTradeExplorerQuery } from "../trade-explorer/errors";
import type { TradeExplorerV1RecipeInput } from "../trade-explorer/result";

const TOP_LEVEL_KEYS = ["shape", "dimensions", "measures", "filters", "sort"] as const;
const FILTER_KEYS = ["year", "exportEconomy", "importEconomy", "hsProduct"] as const;
const YEAR_LIST_KEYS = ["mode", "years"] as const;
const YEAR_RANGE_KEYS = ["mode", "start", "end"] as const;
const SORT_KEYS = ["key", "direction"] as const;

/**
 * Parses one Trade Explorer v1 POST request body into its closed public
 * shape (`recipe`/`analysisBuildId` excluded -- the route supplies those),
 * rejecting any object carrying an unrecognized top-level, `filters`,
 * `filters.year`, or `sort` key. This is a structural gate only: it never
 * inspects value *content* for SQL/table/column names (there is no such
 * vocabulary anywhere in this shape to inspect) and defers all semantic
 * validation to normalizeTradeExplorerV1Request.
 */
export function parseTradeExplorerRequestBody(
  value: unknown,
): Omit<TradeExplorerV1RecipeInput, "analysisBuildId"> {
  assertExactKeys(value, TOP_LEVEL_KEYS, "request body");
  const body = value as Record<string, unknown>;

  if (typeof body.shape !== "string") {
    throw invalidTradeExplorerQuery("shape must be a string.");
  }
  if (
    !Array.isArray(body.dimensions) ||
    body.dimensions.some((entry) => typeof entry !== "string")
  ) {
    throw invalidTradeExplorerQuery("dimensions must be an array of strings.");
  }
  if (
    !Array.isArray(body.measures) ||
    body.measures.some((entry) => typeof entry !== "string")
  ) {
    throw invalidTradeExplorerQuery("measures must be an array of strings.");
  }
  assertExactKeys(body.filters, FILTER_KEYS, "filters");
  const filters = body.filters as Record<string, unknown>;
  const year = parseYearFilter(filters.year);
  for (const dimension of ["exportEconomy", "importEconomy", "hsProduct"] as const) {
    if (
      !Array.isArray(filters[dimension]) ||
      filters[dimension].some((entry: unknown) => typeof entry !== "string")
    ) {
      throw invalidTradeExplorerQuery(`filters.${dimension} must be an array of strings.`);
    }
  }
  const sort = parseSort(body.sort);

  return {
    shape: body.shape as TradeExplorerV1RecipeInput["shape"],
    dimensions: body.dimensions as TradeExplorerV1RecipeInput["dimensions"],
    measures: body.measures as TradeExplorerV1RecipeInput["measures"],
    filters: {
      year,
      exportEconomy: filters.exportEconomy as readonly string[],
      importEconomy: filters.importEconomy as readonly string[],
      hsProduct: filters.hsProduct as readonly string[],
    },
    sort,
  };
}

function parseYearFilter(value: unknown): TradeExplorerV1RecipeInput["filters"]["year"] {
  if (typeof value !== "object" || value === null) {
    throw invalidTradeExplorerQuery("filters.year must be an object.");
  }
  const year = value as Record<string, unknown>;
  if (year.mode === "list") {
    assertExactKeys(value, YEAR_LIST_KEYS, "filters.year");
    if (
      !Array.isArray(year.years) ||
      year.years.some((entry) => typeof entry !== "number")
    ) {
      throw invalidTradeExplorerQuery("filters.year.years must be an array of numbers.");
    }
    return { mode: "list", years: year.years as readonly number[] };
  }
  if (year.mode === "range") {
    assertExactKeys(value, YEAR_RANGE_KEYS, "filters.year");
    if (typeof year.start !== "number" || typeof year.end !== "number") {
      throw invalidTradeExplorerQuery("filters.year.start/end must be numbers.");
    }
    return { mode: "range", start: year.start, end: year.end };
  }
  throw invalidTradeExplorerQuery("filters.year.mode must be 'list' or 'range'.");
}

function parseSort(value: unknown): TradeExplorerV1RecipeInput["sort"] {
  if (value === null) {
    return null;
  }
  assertExactKeys(value, SORT_KEYS, "sort");
  const sort = value as Record<string, unknown>;
  if (typeof sort.key !== "string" || typeof sort.direction !== "string") {
    throw invalidTradeExplorerQuery("sort.key/direction must be strings.");
  }
  return {
    key: sort.key as NonNullable<TradeExplorerV1RecipeInput["sort"]>["key"],
    direction: sort.direction as "asc" | "desc",
  };
}

function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  field: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidTradeExplorerQuery(`${field} must be an object.`);
  }
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowedSet.has(key))
  ) {
    throw invalidTradeExplorerQuery(
      `${field} must contain exactly the fields: ${allowed.join(", ")}.`,
    );
  }
}
