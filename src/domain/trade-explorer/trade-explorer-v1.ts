import {
  formatFixedDecimal as formatFixed,
  normalizeFixedDecimal as normalizeFixed,
  parsePositiveFixedDecimal as parsePositiveDecimal,
  tenTo,
  type FixedDecimal,
} from "../fixed-decimal";
import {
  tradeExplorerResultBytesBudgetExceeded,
  tradeExplorerResultRowsBudgetExceeded,
  tradeExplorerScanBudgetExceeded,
} from "./errors";
import {
  TRADE_EXPLORER_MAX_RESULT_BYTES,
  TRADE_EXPLORER_MAX_RESULT_ROWS,
  TRADE_EXPLORER_MAX_SCAN_ROWS,
  TRADE_EXPLORER_MAX_FILTER_CODES,
  TRADE_EXPLORER_MAX_YEARS,
  type TradeExplorerCellEvidence,
  type TradeExplorerDimensionValue,
  type TradeExplorerObservationState,
  type TradeExplorerQualityWarningCode,
  type TradeExplorerResult,
  type TradeExplorerRow,
  type TradeExplorerTotalRow,
  type TradeExplorerV1Inputs,
} from "./result";

const TRADE_EXPLORER_DISCLAIMER =
  "Trade Explorer evidence is bounded public trade data for one allowlisted business shape. It does not identify companies, buyers, shipments, Party Roles, or Commercial Relationship Assertions, and never exposes SQL, storage layout, or raw records.";

const ZERO: FixedDecimal = { units: 0n, scale: 0 };

export function computeTradeExplorerV1(
  inputs: TradeExplorerV1Inputs,
): TradeExplorerResult {
  assertReleaseConsistency(inputs);
  assertIdentityConsistency(inputs);

  const groupedValues = groupedDimensionValues(inputs);
  const scanRows = inputs.cells.length;
  assertTradeExplorerScanBudget(scanRows);

  if (!inputs.cohortEnumerable) {
    if (scanRows !== 0) {
      throw new TypeError(
        "Trade Explorer evidence declared a non-enumerable cohort with nonzero cells.",
      );
    }
    return assemble(inputs, [], null, [], scanRows, 0);
  }

  if (groupedValues.length !== inputs.cells.length) {
    throw new TypeError(
      "Trade Explorer evidence cell count must match its grouped cohort length.",
    );
  }
  assertTradeExplorerResultRowBudget(groupedValues.length);

  const rows = groupedValues
    .map((dimensionValue, index) =>
      buildRow(dimensionValue, inputs.cells[index]!, inputs.query.measures),
    )
    .sort((left, right) => compareRows(left, right, inputs));

  const totalRow = totalRowFor(inputs, rows);
  const qualityWarnings = qualityWarningsFor(rows);

  return assemble(inputs, rows, totalRow, qualityWarnings, scanRows, rows.length);
}

function assemble(
  inputs: TradeExplorerV1Inputs,
  rows: readonly TradeExplorerRow[],
  totalRow: TradeExplorerTotalRow | null,
  qualityWarnings: readonly TradeExplorerQualityWarningCode[],
  scanRows: number,
  resultRows: number,
): TradeExplorerResult {
  const windowStart =
    inputs.release.finalizedCutoffYear - (TRADE_EXPLORER_MAX_YEARS - 1);
  const windowEnd = inputs.release.finalizedCutoffYear;
  const columns = [
    inputs.query.dimension,
    ...inputs.query.measures,
  ] as const;
  const resultBytes = utf8ByteLength(
    JSON.stringify({ columns, rows, totalRow }),
  );
  assertTradeExplorerResultByteBudget(resultBytes);

  return {
    schemaVersion: "trade-explorer-result-v1",
    analysisId: `trade-explorer:${inputs.analysisBuildId}:${inputs.query.shape}:${inputs.query.exportEconomy.join("-")}:${inputs.query.importEconomy.join("-")}:${inputs.query.hsProduct.join("-")}:${inputs.query.years.join("-")}`,
    analysisBuildId: inputs.analysisBuildId,
    analysisReleaseCatalogSha256: inputs.analysisReleaseCatalogSha256,
    query: inputs.query,
    provenance: {
      baciRelease: inputs.release.baciRelease,
      sourceUpdateDate: inputs.release.sourceUpdateDate,
      hsRevision: inputs.release.hsRevision,
      ingestedYears: inputs.release.ingestedYears,
      finalizedWindow: { start: windowStart, end: windowEnd },
      artifactBuildId: inputs.artifact.buildId,
      artifactSchemaVersion: inputs.artifact.schemaVersion,
      artifactSha256: inputs.artifact.sha256,
      evidenceSha256: inputs.evidenceSha256,
      valueUnit: "CURRENT_USD",
    },
    columns,
    rowCount: rows.length,
    emptyReason: inputs.cohortEnumerable ? null : "NO_ENUMERABLE_COHORT",
    rows,
    totalRow,
    qualityWarnings,
    budget: {
      requested: {
        maxYears: TRADE_EXPLORER_MAX_YEARS,
        maxFilterCodesPerDimension: TRADE_EXPLORER_MAX_FILTER_CODES,
        maxResultRows: TRADE_EXPLORER_MAX_RESULT_ROWS,
        maxResultBytes: TRADE_EXPLORER_MAX_RESULT_BYTES,
      },
      accepted: {
        maxYears: TRADE_EXPLORER_MAX_YEARS,
        maxFilterCodesPerDimension: TRADE_EXPLORER_MAX_FILTER_CODES,
        maxResultRows: TRADE_EXPLORER_MAX_RESULT_ROWS,
        maxScanRows: TRADE_EXPLORER_MAX_SCAN_ROWS,
        maxResultBytes: TRADE_EXPLORER_MAX_RESULT_BYTES,
      },
      actual: { scanRows, resultRows, resultBytes },
    },
    discoveryDisclaimer: TRADE_EXPLORER_DISCLAIMER,
  };
}

function assertReleaseConsistency(inputs: TradeExplorerV1Inputs): void {
  if (inputs.artifact.baciRelease !== inputs.release.baciRelease) {
    throw new TypeError("Trade Explorer cannot mix BACI Releases.");
  }
  if (inputs.release.hsRevision !== "HS12") {
    throw new TypeError("Trade Explorer v1 requires an HS12 product.");
  }
}

function assertIdentityConsistency(inputs: TradeExplorerV1Inputs): void {
  const bindings: readonly (readonly [
    readonly string[],
    readonly string[],
    string,
  ])[] = [
    [
      inputs.exportEconomies.map(({ code }) => code),
      inputs.query.exportEconomy,
      "export economies",
    ],
    [
      inputs.importEconomies.map(({ code }) => code),
      inputs.query.importEconomy,
      "import economies",
    ],
    [
      inputs.products.map(({ code }) => code),
      inputs.query.hsProduct,
      "HS products",
    ],
  ];
  for (const [evidenceCodes, requestedCodes, label] of bindings) {
    if (
      evidenceCodes.length !== requestedCodes.length ||
      evidenceCodes.some((code, index) => code !== requestedCodes[index])
    ) {
      throw new TypeError(
        `Trade Explorer evidence ${label} do not match the normalized request.`,
      );
    }
  }
  if (inputs.products.some(({ hsRevision }) => hsRevision !== "HS12")) {
    throw new TypeError("Trade Explorer evidence products must use HS12.");
  }
}

function groupedDimensionValues(
  inputs: TradeExplorerV1Inputs,
): readonly TradeExplorerDimensionValue[] {
  switch (inputs.query.dimension) {
    case "YEAR":
      return inputs.query.years.map((year) => ({ dimension: "YEAR", year }));
    case "EXPORT_ECONOMY":
      return inputs.exportEconomies.map((economy) => ({
        dimension: "EXPORT_ECONOMY",
        economy,
      }));
    case "IMPORT_ECONOMY":
      return inputs.importEconomies.map((economy) => ({
        dimension: "IMPORT_ECONOMY",
        economy,
      }));
    case "HS_PRODUCT":
      return inputs.products.map((product) => ({
        dimension: "HS_PRODUCT",
        product,
      }));
  }
}

function buildRow(
  dimensionValue: TradeExplorerDimensionValue,
  cell: TradeExplorerCellEvidence,
  measures: TradeExplorerV1Inputs["query"]["measures"],
): TradeExplorerRow {
  const wantsValue = measures.includes("TRADE_VALUE_USD");
  const wantsCount = measures.includes("RECORDED_FLOW_COUNT");

  if (cell.state === "RECORDED_POSITIVE") {
    const value = parsePositiveDecimal(
      cell.valueCurrentUsd,
      "Trade Explorer recorded value",
    );
    if (!Number.isSafeInteger(cell.sourceFlowCount) || cell.sourceFlowCount < 1) {
      throw new TypeError(
        "Trade Explorer RECORDED_POSITIVE cells require a positive safe-integer sourceFlowCount.",
      );
    }
    return {
      dimensionValue,
      state: cell.state,
      tradeValueUsd: wantsValue ? formatFixed(value) : null,
      recordedFlowCount: wantsCount ? cell.sourceFlowCount : null,
    };
  }
  if (cell.state === "NO_RECORDED_POSITIVE_FLOW") {
    return {
      dimensionValue,
      state: cell.state,
      tradeValueUsd: null,
      recordedFlowCount: wantsCount ? 0 : null,
    };
  }
  return { dimensionValue, state: "MISSING_OBSERVATION", tradeValueUsd: null, recordedFlowCount: null };
}

function dimensionSortCode(value: TradeExplorerDimensionValue): number {
  if (value.dimension === "YEAR") {
    return value.year;
  }
  if (value.dimension === "HS_PRODUCT") {
    return Number(value.product.code);
  }
  return Number(value.economy.code);
}

function measureValue(
  row: TradeExplorerRow,
  key: "TRADE_VALUE_USD" | "RECORDED_FLOW_COUNT",
): FixedDecimal | null {
  if (key === "RECORDED_FLOW_COUNT") {
    return row.recordedFlowCount === null
      ? null
      : { units: BigInt(row.recordedFlowCount), scale: 0 };
  }
  return row.tradeValueUsd === null ? null : parseFixedString(row.tradeValueUsd);
}

function stateRank(state: TradeExplorerObservationState): number {
  if (state === "RECORDED_POSITIVE") {
    return 0;
  }
  return state === "NO_RECORDED_POSITIVE_FLOW" ? 1 : 2;
}

function compareRows(
  left: TradeExplorerRow,
  right: TradeExplorerRow,
  inputs: TradeExplorerV1Inputs,
): number {
  const { key, direction } = inputs.query.sort;
  const sign = direction === "asc" ? 1 : -1;
  if (key === inputs.query.dimension) {
    return sign * (dimensionSortCode(left.dimensionValue) - dimensionSortCode(right.dimensionValue));
  }
  const measureKey = key as "TRADE_VALUE_USD" | "RECORDED_FLOW_COUNT";
  const leftValue = measureValue(left, measureKey);
  const rightValue = measureValue(right, measureKey);
  if (leftValue !== null && rightValue !== null) {
    const comparison = compareFixed(leftValue, rightValue);
    if (comparison !== 0) {
      return sign * comparison;
    }
    return dimensionSortCode(left.dimensionValue) - dimensionSortCode(right.dimensionValue);
  }
  if (leftValue !== null) {
    return -1;
  }
  if (rightValue !== null) {
    return 1;
  }
  const rankComparison = stateRank(left.state) - stateRank(right.state);
  if (rankComparison !== 0) {
    return rankComparison;
  }
  return dimensionSortCode(left.dimensionValue) - dimensionSortCode(right.dimensionValue);
}

function totalRowFor(
  inputs: TradeExplorerV1Inputs,
  rows: readonly TradeExplorerRow[],
): TradeExplorerTotalRow | null {
  // A cross-year total is not a meaningful business quantity (like Trade
  // Trend, which has no cross-year total either); every other grouped
  // dimension pools a genuine bounded cohort, where a total is useful.
  if (inputs.query.dimension === "YEAR") {
    return null;
  }
  const wantsValue = inputs.query.measures.includes("TRADE_VALUE_USD");
  const wantsCount = inputs.query.measures.includes("RECORDED_FLOW_COUNT");
  let valueTotal: FixedDecimal = ZERO;
  let includedRowCount = 0;
  let missingRowCount = 0;
  let countTotal = 0;
  let hasCountableRow = false;
  for (const row of rows) {
    if (row.state === "MISSING_OBSERVATION") {
      missingRowCount += 1;
      continue;
    }
    hasCountableRow = true;
    if (row.state === "RECORDED_POSITIVE") {
      includedRowCount += 1;
      if (row.tradeValueUsd !== null) {
        valueTotal = addFixed(valueTotal, parseFixedString(row.tradeValueUsd));
      }
    }
    if (row.recordedFlowCount !== null) {
      countTotal += row.recordedFlowCount;
    }
  }
  return {
    tradeValueUsd: wantsValue && includedRowCount > 0 ? formatFixed(valueTotal) : null,
    recordedFlowCount: wantsCount && hasCountableRow ? countTotal : null,
    includedRowCount,
    missingRowCount,
  };
}

function qualityWarningsFor(
  rows: readonly TradeExplorerRow[],
): readonly TradeExplorerQualityWarningCode[] {
  const warnings: TradeExplorerQualityWarningCode[] = [];
  const recordedPositiveCount = rows.filter(
    (row) => row.state === "RECORDED_POSITIVE",
  ).length;
  if (rows.length > 0 && recordedPositiveCount === 0) {
    warnings.push("SPARSE_COHORT");
  }
  if (rows.some((row) => row.state === "MISSING_OBSERVATION")) {
    warnings.push("INCOMPLETE_COHORT");
  }
  return warnings;
}

export function assertTradeExplorerScanBudget(scanRows: number): void {
  if (scanRows > TRADE_EXPLORER_MAX_SCAN_ROWS) {
    throw tradeExplorerScanBudgetExceeded(scanRows);
  }
}

export function assertTradeExplorerResultRowBudget(rowCount: number): void {
  if (rowCount > TRADE_EXPLORER_MAX_RESULT_ROWS) {
    throw tradeExplorerResultRowsBudgetExceeded(rowCount);
  }
}

export function assertTradeExplorerResultByteBudget(bytes: number): void {
  if (bytes > TRADE_EXPLORER_MAX_RESULT_BYTES) {
    throw tradeExplorerResultBytesBudgetExceeded(bytes);
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseFixedString(value: string): FixedDecimal {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (match === null) {
    throw new TypeError(`${value} is not a decimal string.`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const units = sign * BigInt(`${match[2]}${fraction}`);
  return normalizeFixed({ units, scale: fraction.length });
}

function addFixed(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalizeFixed({
    units: scaleUnitsTo(left, scale) + scaleUnitsTo(right, scale),
    scale,
  });
}

function compareFixed(left: FixedDecimal, right: FixedDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = scaleUnitsTo(left, scale);
  const rightUnits = scaleUnitsTo(right, scale);
  if (leftUnits === rightUnits) {
    return 0;
  }
  return leftUnits < rightUnits ? -1 : 1;
}

function scaleUnitsTo(value: FixedDecimal, scale: number): bigint {
  return value.units * tenTo(scale - value.scale);
}
