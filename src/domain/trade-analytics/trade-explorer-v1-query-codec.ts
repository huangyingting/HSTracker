import { tradeExplorerShapeDefinition } from "../trade-explorer/shapes";
import {
  TRADE_EXPLORER_MAX_FILTER_CODES,
  TRADE_EXPLORER_MAX_YEARS,
  TRADE_EXPLORER_MEASURE_ORDER,
  type TradeExplorerMeasure,
  type TradeExplorerShape,
  type TradeExplorerSortKey,
} from "../trade-explorer/result";
import type { TradeExplorerV1RecipeInput } from "../trade-explorer/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";

// The explicit semantic URL vocabulary for one Trade Explorer v1 query --
// deliberately no opaque JSON or base64 blob -- reused by the canonical
// Trade Analysis Context page URL (see app/trade-analysis-context.ts) and
// by the API route's own GET/HEAD query-string form (see
// app/api/v1/analyses/[analysisBuildId]/trade-explorer/route.ts and its
// .csv sibling), so both surfaces encode/decode one query identically.
// `dimensions` is deliberately never a separate parameter: it is always
// exactly the chosen shape's own grouped dimension, so decoding derives it
// from `shape` rather than trusting a second, potentially inconsistent
// caller-supplied value.
export type TradeExplorerQueryFields = Omit<
  TradeExplorerV1RecipeInput,
  "analysisBuildId"
>;

const QUERY_PARAM_NAMES = [
  "shape",
  "measures",
  "years",
  "exportEconomy",
  "importEconomy",
  "hsProduct",
  "sortKey",
  "sortDirection",
] as const;

const ECONOMY_CODE_PATTERN = /^[0-9]{1,3}$/u;
const PRODUCT_CODE_PATTERN = /^[0-9]{6}$/u;
const YEAR_PATTERN = /^[0-9]{4}$/u;

export function encodeTradeExplorerQuery(
  query: TradeExplorerQueryFields,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("shape", query.shape);
  params.set("measures", query.measures.join(","));
  if (query.filters.year.mode === "list") {
    if (query.filters.year.years.length > 0) {
      params.set("years", query.filters.year.years.join(","));
    }
  } else {
    const { start, end } = query.filters.year;
    const yearCount = end - start + 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(yearCount) ||
      yearCount < 1 ||
      yearCount > TRADE_EXPLORER_MAX_YEARS
    ) {
      throw new RangeError(
        `Trade Explorer year ranges must contain between 1 and ${TRADE_EXPLORER_MAX_YEARS} years.`,
      );
    }
    const years = Array.from(
      { length: yearCount },
      (_, index) => start + index,
    );
    params.set("years", years.join(","));
  }
  params.set("exportEconomy", query.filters.exportEconomy.join(","));
  params.set("importEconomy", query.filters.importEconomy.join(","));
  params.set("hsProduct", query.filters.hsProduct.join(","));
  if (query.sort !== null) {
    params.set("sortKey", query.sort.key);
    params.set("sortDirection", query.sort.direction);
  }
  return params;
}

/**
 * Decodes one Trade Explorer v1 query from explicit semantic parameters,
 * or returns `null` for anything malformed, incomplete, or carrying an
 * unrecognized parameter -- callers (routes, canonical context) decide how
 * to surface that as their own typed rejection rather than this shared
 * codec throwing a transport-specific error.
 */
export function decodeTradeExplorerQuery(
  params: URLSearchParams,
): TradeExplorerQueryFields | null {
  for (const key of params.keys()) {
    if (!(QUERY_PARAM_NAMES as readonly string[]).includes(key)) {
      return null;
    }
  }
  if (QUERY_PARAM_NAMES.some((key) => params.getAll(key).length > 1)) {
    return null;
  }

  const shape = params.get("shape");
  if (shape === null || tradeExplorerShapeDefinition(shape) === null) {
    return null;
  }
  const definition = tradeExplorerShapeDefinition(shape)!;

  const measures = decodeMeasures(params.get("measures"));
  if (measures === null) {
    return null;
  }

  const years = decodeCodes(
    params.get("years") ?? "",
    YEAR_PATTERN,
    true,
    TRADE_EXPLORER_MAX_YEARS,
  );
  const exportEconomy = decodeCodes(
    params.get("exportEconomy"),
    ECONOMY_CODE_PATTERN,
    false,
    TRADE_EXPLORER_MAX_FILTER_CODES,
  );
  const importEconomy = decodeCodes(
    params.get("importEconomy"),
    ECONOMY_CODE_PATTERN,
    false,
    TRADE_EXPLORER_MAX_FILTER_CODES,
  );
  const hsProduct = decodeCodes(
    params.get("hsProduct"),
    PRODUCT_CODE_PATTERN,
    false,
    TRADE_EXPLORER_MAX_FILTER_CODES,
  );
  if (
    years === null ||
    exportEconomy === null ||
    importEconomy === null ||
    hsProduct === null
  ) {
    return null;
  }

  const sort = decodeSort(params.get("sortKey"), params.get("sortDirection"));
  if (sort === undefined) {
    return null;
  }

  return {
    shape: shape as TradeExplorerShape,
    dimensions: [definition.groupedDimension],
    measures,
    filters: {
      year: { mode: "list", years: years.map(Number) },
      exportEconomy,
      importEconomy,
      hsProduct,
    },
    sort,
  };
}

function decodeMeasures(
  value: string | null,
): readonly TradeExplorerMeasure[] | null {
  if (value === null || value.length === 0) {
    return null;
  }
  if (value.length > 2 * "RECORDED_FLOW_COUNT".length + 1) {
    return null;
  }
  const tokens = value.split(",");
  if (tokens.length > TRADE_EXPLORER_MEASURE_ORDER.length) {
    return null;
  }
  for (const token of tokens) {
    if (!TRADE_EXPLORER_MEASURE_ORDER.includes(token as TradeExplorerMeasure)) {
      return null;
    }
  }
  return tokens as readonly TradeExplorerMeasure[];
}

function decodeCodes(
  value: string | null,
  pattern: RegExp,
  allowEmpty: boolean,
  maxCodes: number,
): readonly string[] | null {
  if (value === null || value.length === 0) {
    return allowEmpty ? [] : null;
  }
  const maxTokenLength =
    pattern === PRODUCT_CODE_PATTERN ? 6 : pattern === YEAR_PATTERN ? 4 : 3;
  if (value.length > maxCodes * maxTokenLength + (maxCodes - 1)) {
    throw new AnalysisBudgetExceededError(
      "INPUT_CARDINALITY",
      "Trade Explorer",
    );
  }
  const tokens = value.split(",");
  if (tokens.length > maxCodes) {
    throw new AnalysisBudgetExceededError(
      "INPUT_CARDINALITY",
      "Trade Explorer",
    );
  }
  for (const token of tokens) {
    if (!pattern.test(token)) {
      return null;
    }
  }
  return tokens;
}

// `undefined` signals malformed input (distinct from a valid `null` sort);
// callers treat either non-object return the same way via the `sort ===
// undefined` check above.
function decodeSort(
  key: string | null,
  direction: string | null,
): TradeExplorerV1RecipeInput["sort"] | undefined {
  if (key === null && direction === null) {
    return null;
  }
  if (
    key === null ||
    direction === null ||
    (direction !== "asc" && direction !== "desc")
  ) {
    return undefined;
  }
  return { key: key as TradeExplorerSortKey, direction };
}
