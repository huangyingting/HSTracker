import {
  invalidTradeExplorerQuery,
  tradeExplorerDimensionMismatch,
  tradeExplorerFixedDimensionCardinalityInvalid,
  tradeExplorerGroupedDimensionEmpty,
  tradeExplorerInputCardinalityBudgetExceeded,
  tradeExplorerYearFilterInvalid,
  tradeExplorerYearOutOfFinalizedWindow,
  unsupportedTradeExplorerMeasure,
  unsupportedTradeExplorerShape,
  unsupportedTradeExplorerSortKey,
} from "./errors";
import { tradeExplorerShapeDefinition } from "./shapes";
import {
  TRADE_EXPLORER_MAX_FILTER_CODES,
  TRADE_EXPLORER_MAX_YEARS,
  TRADE_EXPLORER_MEASURE_ORDER,
  type TradeExplorerDimension,
  type TradeExplorerMeasure,
  type TradeExplorerV1NormalizedInputs,
  type TradeExplorerV1RecipeInput,
} from "./result";

const ANALYSIS_BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/iu;
const ECONOMY_CODE_PATTERN = /^[0-9]{1,3}$/u;
const PRODUCT_CODE_PATTERN = /^[0-9]{6}$/u;

export type FinalizedYearWindow = Readonly<{ start: number; end: number }>;

/**
 * Turns one untrusted, closed-shape `TradeExplorerV1RecipeInput` into its
 * deterministic normalized form, or throws a `TradeExplorerAnalysisError`
 * naming exactly which allowlisted rule the request violated. Every
 * violation this function can raise is either a structural/vocabulary
 * mismatch (state "invalid-input" once mapped by the platform) or an
 * input-cardinality budget excess (state "budget") -- never a generic
 * exception -- so callers receive an actionable, narrowly-scoped outcome.
 */
export function normalizeTradeExplorerV1Request(
  request: TradeExplorerV1RecipeInput,
  finalizedWindow: FinalizedYearWindow,
): TradeExplorerV1NormalizedInputs {
  if (!ANALYSIS_BUILD_ID_PATTERN.test(request.analysisBuildId)) {
    throw invalidTradeExplorerQuery("analysisBuildId is malformed.");
  }
  if (
    !Number.isSafeInteger(finalizedWindow.start) ||
    !Number.isSafeInteger(finalizedWindow.end) ||
    finalizedWindow.end < finalizedWindow.start
  ) {
    throw invalidTradeExplorerQuery("The finalized window is malformed.");
  }

  const definition = tradeExplorerShapeDefinition(request.shape);
  if (definition === null) {
    throw unsupportedTradeExplorerShape(String(request.shape));
  }
  const { groupedDimension } = definition;

  if (
    !Array.isArray(request.dimensions) ||
    request.dimensions.length !== 1 ||
    request.dimensions[0] !== groupedDimension
  ) {
    throw tradeExplorerDimensionMismatch(
      `Shape ${request.shape} groups exactly [${groupedDimension}].`,
    );
  }

  const measures = normalizeMeasures(request.measures);

  const filters = request.filters;
  if (
    typeof filters !== "object" ||
    filters === null ||
    !Array.isArray(filters.exportEconomy) ||
    !Array.isArray(filters.importEconomy) ||
    !Array.isArray(filters.hsProduct)
  ) {
    throw invalidTradeExplorerQuery("filters is malformed.");
  }

  const exportEconomy = normalizeCodeDimension(
    "EXPORT_ECONOMY",
    filters.exportEconomy,
    ECONOMY_CODE_PATTERN,
    normalizeEconomyCode,
    groupedDimension === "EXPORT_ECONOMY",
  );
  const importEconomy = normalizeCodeDimension(
    "IMPORT_ECONOMY",
    filters.importEconomy,
    ECONOMY_CODE_PATTERN,
    normalizeEconomyCode,
    groupedDimension === "IMPORT_ECONOMY",
  );
  const hsProduct = normalizeCodeDimension(
    "HS_PRODUCT",
    filters.hsProduct,
    PRODUCT_CODE_PATTERN,
    (code) => code,
    groupedDimension === "HS_PRODUCT",
  );
  const years = normalizeYearFilter(
    filters.year,
    finalizedWindow,
    groupedDimension === "YEAR",
  );

  const sort = normalizeSort(request.sort, groupedDimension, measures);

  return {
    shape: request.shape,
    dimension: groupedDimension,
    measures,
    years,
    exportEconomy,
    importEconomy,
    hsProduct,
    sort,
  };
}

function normalizeMeasures(
  measures: unknown,
): readonly TradeExplorerMeasure[] {
  if (!Array.isArray(measures) || measures.length === 0) {
    throw unsupportedTradeExplorerMeasure(
      "Choose between one and two approved measures.",
    );
  }
  if (measures.length > TRADE_EXPLORER_MEASURE_ORDER.length) {
    throw unsupportedTradeExplorerMeasure(
      "Choose between one and two approved measures without duplicates.",
    );
  }
  const requested = new Set(measures);
  for (const measure of requested) {
    if (!TRADE_EXPLORER_MEASURE_ORDER.includes(measure as TradeExplorerMeasure)) {
      throw unsupportedTradeExplorerMeasure(
        `Measure ${String(measure)} is not an approved Trade Explorer measure.`,
      );
    }
  }
  return TRADE_EXPLORER_MEASURE_ORDER.filter((measure) =>
    requested.has(measure),
  );
}

function normalizeCodeDimension(
  dimension: TradeExplorerDimension,
  codes: readonly unknown[],
  pattern: RegExp,
  canonicalize: (code: string) => string,
  isGrouped: boolean,
): readonly string[] {
  if (codes.length > TRADE_EXPLORER_MAX_FILTER_CODES) {
    throw tradeExplorerInputCardinalityBudgetExceeded(
      `${dimension} declared more than the ${TRADE_EXPLORER_MAX_FILTER_CODES}-code input budget.`,
    );
  }
  for (const code of codes) {
    if (typeof code !== "string" || !pattern.test(code)) {
      throw invalidTradeExplorerQuery(
        `${dimension} filter codes must match its semantic code grammar.`,
      );
    }
  }
  const canonicalCodes = (codes as readonly string[]).map(canonicalize);
  const distinctAscending = dedupeAscending(canonicalCodes, compareCodes);

  if (isGrouped) {
    if (distinctAscending.length === 0) {
      throw tradeExplorerGroupedDimensionEmpty(dimension);
    }
    if (distinctAscending.length > TRADE_EXPLORER_MAX_FILTER_CODES) {
      throw tradeExplorerInputCardinalityBudgetExceeded(
        `${dimension} cohort declared ${distinctAscending.length} codes, exceeding the ${TRADE_EXPLORER_MAX_FILTER_CODES}-code budget.`,
      );
    }
    return distinctAscending;
  }
  if (distinctAscending.length !== 1) {
    throw tradeExplorerFixedDimensionCardinalityInvalid(dimension);
  }
  return distinctAscending;
}

function normalizeEconomyCode(code: string): string {
  return String(Number(code));
}

function compareCodes(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
    return left.localeCompare(right);
  }
  return leftNumber - rightNumber;
}

function dedupeAscending<T>(values: readonly T[], compare: (left: T, right: T) => number): readonly T[] {
  return [...new Set(values)].sort(compare);
}

function normalizeYearFilter(
  year: unknown,
  finalizedWindow: FinalizedYearWindow,
  isGrouped: boolean,
): readonly number[] {
  const years = expandYearFilter(year);
  const distinctAscending = dedupeAscending(years, (left, right) => left - right);

  if (isGrouped) {
    const effective =
      distinctAscending.length === 0
        ? fullWindow(finalizedWindow)
        : distinctAscending;
    for (const value of effective) {
      if (value < finalizedWindow.start || value > finalizedWindow.end) {
        throw tradeExplorerYearOutOfFinalizedWindow(
          `Year ${value} is outside the finalized window ${finalizedWindow.start}-${finalizedWindow.end}.`,
        );
      }
    }
    if (effective.length > TRADE_EXPLORER_MAX_YEARS) {
      throw tradeExplorerInputCardinalityBudgetExceeded(
        `The year filter resolved to ${effective.length} years, exceeding the ${TRADE_EXPLORER_MAX_YEARS}-year budget.`,
      );
    }
    return effective;
  }

  if (distinctAscending.length !== 1) {
    throw tradeExplorerYearFilterInvalid(
      "A fixed YEAR dimension must resolve to exactly one finalized year.",
    );
  }
  const [value] = distinctAscending;
  if (value! < finalizedWindow.start || value! > finalizedWindow.end) {
    throw tradeExplorerYearOutOfFinalizedWindow(
      `Year ${value} is outside the finalized window ${finalizedWindow.start}-${finalizedWindow.end}.`,
    );
  }
  return distinctAscending;
}

function expandYearFilter(year: unknown): readonly number[] {
  if (typeof year !== "object" || year === null) {
    throw invalidTradeExplorerQuery("The year filter is malformed.");
  }
  const filter = year as Record<string, unknown>;
  if (filter.mode === "list") {
    if (
      !Array.isArray(filter.years) ||
      filter.years.some((value) => !Number.isSafeInteger(value))
    ) {
      throw tradeExplorerYearFilterInvalid(
        "A year list filter must contain integer years.",
      );
    }
    if (filter.years.length > TRADE_EXPLORER_MAX_YEARS) {
      throw tradeExplorerInputCardinalityBudgetExceeded(
        `The year filter declared more than the ${TRADE_EXPLORER_MAX_YEARS}-year input budget.`,
      );
    }
    return filter.years as readonly number[];
  }
  if (filter.mode === "range") {
    if (
      !Number.isSafeInteger(filter.start) ||
      !Number.isSafeInteger(filter.end)
    ) {
      throw tradeExplorerYearFilterInvalid(
        "A year range filter must contain integer bounds.",
      );
    }
    const start = filter.start as number;
    const end = filter.end as number;
    if (end < start) {
      throw tradeExplorerYearFilterInvalid(
        "A year range filter's end must not precede its start.",
      );
    }
    const yearCount = end - start + 1;
    if (
      !Number.isSafeInteger(yearCount) ||
      yearCount > TRADE_EXPLORER_MAX_YEARS
    ) {
      throw tradeExplorerInputCardinalityBudgetExceeded(
        `The year range exceeds the ${TRADE_EXPLORER_MAX_YEARS}-year input budget.`,
      );
    }
    return Array.from({ length: yearCount }, (_, index) => start + index);
  }
  throw tradeExplorerYearFilterInvalid(
    "The year filter mode must be 'list' or 'range'.",
  );
}

function fullWindow(finalizedWindow: FinalizedYearWindow): readonly number[] {
  const yearCount = finalizedWindow.end - finalizedWindow.start + 1;
  if (
    !Number.isSafeInteger(yearCount) ||
    yearCount > TRADE_EXPLORER_MAX_YEARS
  ) {
    throw tradeExplorerInputCardinalityBudgetExceeded(
      `The finalized window exceeds the ${TRADE_EXPLORER_MAX_YEARS}-year input budget.`,
    );
  }
  return Array.from(
    { length: yearCount },
    (_, index) => finalizedWindow.start + index,
  );
}

function normalizeSort(
  sort: TradeExplorerV1RecipeInput["sort"],
  groupedDimension: TradeExplorerDimension,
  measures: readonly TradeExplorerMeasure[],
): TradeExplorerV1NormalizedInputs["sort"] {
  if (sort === null) {
    return { key: groupedDimension, direction: "asc" };
  }
  if (
    typeof sort !== "object" ||
    (sort.direction !== "asc" && sort.direction !== "desc")
  ) {
    throw invalidTradeExplorerQuery("sort is malformed.");
  }
  const allowedKeys = new Set<string>([groupedDimension, ...measures]);
  if (!allowedKeys.has(sort.key)) {
    throw unsupportedTradeExplorerSortKey(
      `Sort key ${String(sort.key)} is neither the grouped dimension ${groupedDimension} nor a requested measure.`,
    );
  }
  return { key: sort.key, direction: sort.direction };
}
