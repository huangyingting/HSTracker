import {
  divideHalfUp,
  formatFixedDecimal as formatFixed,
  formatFixedDecimalScale as formatFixedScale,
  normalizeFixedDecimal as normalizeFixed,
  parsePositiveFixedDecimal as parsePositiveDecimal,
  tenTo,
  type FixedDecimal,
} from "../fixed-decimal";
import { supplierCohortBudgetExceeded } from "./errors";
import type {
  ProvisionalSupplierEconomyEvidence,
  ProvisionalSupplierShare,
  SupplierAnnualObservation,
  SupplierCompetitionConcentration,
  SupplierCompetitionQualityWarningCode,
  SupplierCompetitionResult,
  SupplierCompetitionShare,
  SupplierCompetitionV1Inputs,
  SupplierEconomyEvidence,
} from "./result";
import {
  SUPPLIER_COMPETITION_FINALIZED_YEAR_COUNT,
  SUPPLIER_COMPETITION_MAX_COHORT_SIZE,
} from "./result";

const SHARE_PERCENTAGE_DIGITS = 6;
const HHI_DIGITS = 6;
const QUANTITY_COVERAGE_DIGITS = 6;
const HHI_SCALE = 10000;
const SUPPLIER_COMPETITION_DISCLAIMER =
  "Supplier Competition evidence is economy-level public trade data. It does not identify companies, buyers, shipments, Party Roles, or Commercial Relationship Assertions.";

const ZERO: FixedDecimal = { units: 0n, scale: 0 };

export function computeSupplierCompetitionV1(
  inputs: SupplierCompetitionV1Inputs,
): SupplierCompetitionResult {
  assertReleaseConsistency(inputs);
  if (inputs.suppliers.length > SUPPLIER_COMPETITION_MAX_COHORT_SIZE) {
    throw supplierCohortBudgetExceeded(inputs.suppliers.length);
  }
  assertUniqueEconomies(
    inputs.suppliers.map((supplier) => supplier.economy.code),
    "Supplier Competition finalized suppliers",
  );
  assertUniqueEconomies(
    inputs.provisionalSuppliers.map((supplier) => supplier.economy.code),
    "Supplier Competition provisional suppliers",
  );
  if (
    inputs.provisionalMarketState !== "RECORDED" &&
    inputs.provisionalSuppliers.length > 0
  ) {
    throw new TypeError(
      "Supplier Competition provisional suppliers require a RECORDED provisional market state.",
    );
  }

  const windowStart =
    inputs.release.finalizedCutoffYear -
    (SUPPLIER_COMPETITION_FINALIZED_YEAR_COUNT - 1);
  const windowEnd = inputs.release.finalizedCutoffYear;

  const pooled = inputs.suppliers.map((supplier) =>
    poolSupplier(supplier, windowStart, windowEnd),
  );
  const eligible = pooled.filter((entry) => entry.pooledValue.units > 0n);

  const totalScale = Math.max(0, ...eligible.map((entry) => entry.pooledValue.scale));
  const totalUnits = eligible.reduce(
    (sum, entry) => sum + scaleUnitsTo(entry.pooledValue, totalScale),
    0n,
  );

  const supplierShares =
    totalUnits === 0n
      ? []
      : eligible
          .map((entry) => shareFor(entry, totalUnits, totalScale))
          .sort(compareShares);

  const concentration = concentrationFor(eligible, totalUnits, totalScale);
  const qualityWarnings = qualityWarningsFor(eligible, concentration, windowStart, windowEnd);

  const provisionalSupplierShares = provisionalSharesFor(inputs, eligible);

  return {
    schemaVersion: "supplier-competition-result-v1",
    analysisId: `supplier-competition:${inputs.analysisBuildId}:${inputs.importer.code}:${inputs.product.code}`,
    analysisBuildId: inputs.analysisBuildId,
    analysisReleaseCatalogSha256: inputs.analysisReleaseCatalogSha256,
    query: {
      importer: inputs.importer,
      product: inputs.product,
    },
    provenance: {
      baciRelease: inputs.release.baciRelease,
      sourceUpdateDate: inputs.release.sourceUpdateDate,
      hsRevision: inputs.release.hsRevision,
      ingestedYears: inputs.release.ingestedYears,
      finalizedWindow: { start: windowStart, end: windowEnd },
      provisionalYear: inputs.release.provisionalYear,
      artifactBuildId: inputs.artifact.buildId,
      artifactSchemaVersion: inputs.artifact.schemaVersion,
      artifactSha256: inputs.artifact.sha256,
      valueUnit: "CURRENT_USD",
    },
    cohortBudget: SUPPLIER_COMPETITION_MAX_COHORT_SIZE,
    cohortSize: supplierShares.length,
    emptyReason:
      supplierShares.length === 0
        ? "NO_ELIGIBLE_SUPPLIERS_IN_FINALIZED_WINDOW"
        : null,
    finalizedPooledValueCurrentUsd: formatFixed({
      units: totalUnits,
      scale: totalScale,
    }),
    supplierShares,
    concentration,
    qualityWarnings,
    provisionalMarketState: inputs.provisionalMarketState,
    provisionalSupplierShares,
    discoveryDisclaimer: SUPPLIER_COMPETITION_DISCLAIMER,
  };
}

function assertReleaseConsistency(inputs: SupplierCompetitionV1Inputs): void {
  if (inputs.artifact.baciRelease !== inputs.release.baciRelease) {
    throw new TypeError("Supplier Competition cannot mix BACI Releases.");
  }
  if (
    inputs.product.hsRevision !== "HS12" ||
    inputs.release.hsRevision !== "HS12"
  ) {
    throw new TypeError("Supplier Competition v1 requires an HS12 product.");
  }
}

function assertUniqueEconomies(codes: readonly string[], field: string): void {
  if (new Set(codes).size !== codes.length) {
    throw new TypeError(`${field} must be unique supplier economies.`);
  }
}

type PooledSupplier = Readonly<{
  economy: SupplierEconomyEvidence["economy"];
  pooledValue: FixedDecimal;
  recordedYears: readonly number[];
  noRecordedFlowYears: readonly number[];
  missingYears: readonly number[];
  quantityCoverageRate: FixedDecimal | null;
}>;

function poolSupplier(
  supplier: SupplierEconomyEvidence,
  windowStart: number,
  windowEnd: number,
): PooledSupplier {
  const byYear = new Map<number, SupplierAnnualObservation>();
  for (const observation of supplier.annualObservations) {
    if (
      !Number.isSafeInteger(observation.year) ||
      observation.year < windowStart ||
      observation.year > windowEnd ||
      byYear.has(observation.year)
    ) {
      throw new TypeError(
        `Supplier Competition finalized observations for economy ${supplier.economy.code} must be unique members of the five-year finalized window.`,
      );
    }
    byYear.set(observation.year, observation);
  }
  const years = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, index) => windowStart + index,
  );
  const observations = years.map((year) => byYear.get(year));
  if (observations.some((observation) => observation === undefined)) {
    throw new TypeError(
      `Supplier Competition requires every member of the five-year finalized window for economy ${supplier.economy.code}.`,
    );
  }
  const complete = observations as readonly SupplierAnnualObservation[];

  const recordedYears: number[] = [];
  const noRecordedFlowYears: number[] = [];
  const missingYears: number[] = [];
  let pooledValue: FixedDecimal = ZERO;
  for (const observation of complete) {
    if (observation.state === "RECORDED_POSITIVE") {
      recordedYears.push(observation.year);
      pooledValue = addFixed(
        pooledValue,
        parsePositiveDecimal(
          observation.valueCurrentUsd,
          `Supplier Competition recorded value for economy ${supplier.economy.code}`,
        ),
      );
    } else if (observation.state === "NO_RECORDED_POSITIVE_FLOW") {
      noRecordedFlowYears.push(observation.year);
    } else {
      missingYears.push(observation.year);
    }
  }

  if (
    !Number.isSafeInteger(supplier.sourceFlowCount) ||
    supplier.sourceFlowCount < 0
  ) {
    throw new TypeError(
      `sourceFlowCount for economy ${supplier.economy.code} must be a nonnegative safe integer.`,
    );
  }
  if (
    !Number.isSafeInteger(supplier.quantityPresentCount) ||
    supplier.quantityPresentCount < 0 ||
    supplier.quantityPresentCount > supplier.sourceFlowCount
  ) {
    throw new TypeError(
      `quantityPresentCount for economy ${supplier.economy.code} must be a nonnegative safe integer no greater than sourceFlowCount.`,
    );
  }
  const quantityCoverageRate =
    supplier.sourceFlowCount === 0
      ? null
      : divideExact(
          BigInt(supplier.quantityPresentCount),
          BigInt(supplier.sourceFlowCount),
          QUANTITY_COVERAGE_DIGITS,
        );

  return {
    economy: supplier.economy,
    pooledValue,
    recordedYears,
    noRecordedFlowYears,
    missingYears,
    quantityCoverageRate,
  };
}

function shareFor(
  entry: PooledSupplier,
  totalUnits: bigint,
  totalScale: number,
): SupplierCompetitionShare {
  const scaledUnits = scaleUnitsTo(entry.pooledValue, totalScale);
  const sharePercent = divideExact(
    scaledUnits * 100n,
    totalUnits,
    SHARE_PERCENTAGE_DIGITS,
  );
  return {
    economy: entry.economy,
    pooledValueCurrentUsd: formatFixed(entry.pooledValue),
    sharePercent: formatFixedScale(sharePercent, SHARE_PERCENTAGE_DIGITS),
    recordedYears: entry.recordedYears,
    noRecordedFlowYears: entry.noRecordedFlowYears,
    missingYears: entry.missingYears,
    quantityCoverageRate:
      entry.quantityCoverageRate === null
        ? null
        : formatFixedScale(entry.quantityCoverageRate, QUANTITY_COVERAGE_DIGITS),
  };
}

function compareShares(
  left: SupplierCompetitionShare,
  right: SupplierCompetitionShare,
): number {
  const shareComparison = compareDecimalStrings(
    right.sharePercent,
    left.sharePercent,
  );
  if (shareComparison !== 0) {
    return shareComparison;
  }
  const valueComparison = compareDecimalStrings(
    right.pooledValueCurrentUsd,
    left.pooledValueCurrentUsd,
  );
  if (valueComparison !== 0) {
    return valueComparison;
  }
  return Number(left.economy.code) - Number(right.economy.code);
}

function compareDecimalStrings(left: string, right: string): number {
  const leftValue = parseFixedString(left);
  const rightValue = parseFixedString(right);
  const scale = Math.max(leftValue.scale, rightValue.scale);
  const leftUnits = scaleUnitsTo(leftValue, scale);
  const rightUnits = scaleUnitsTo(rightValue, scale);
  if (leftUnits === rightUnits) {
    return 0;
  }
  return leftUnits < rightUnits ? -1 : 1;
}

function concentrationFor(
  eligible: readonly PooledSupplier[],
  totalUnits: bigint,
  totalScale: number,
): SupplierCompetitionConcentration {
  if (totalUnits === 0n) {
    return { state: "UNAVAILABLE", reason: "NO_POOLED_SUPPLIER_VALUE" };
  }
  const squareSum = eligible.reduce((sum, entry) => {
    const scaledUnits = scaleUnitsTo(entry.pooledValue, totalScale);
    return sum + scaledUnits * scaledUnits;
  }, 0n);
  const numerator = squareSum * BigInt(HHI_SCALE) * tenTo(HHI_DIGITS);
  const denominator = totalUnits * totalUnits;
  const hhi: FixedDecimal = {
    units: divideHalfUp(numerator, denominator),
    scale: HHI_DIGITS,
  };
  return {
    state: "COMPUTED",
    herfindahlHirschmanIndex: formatFixedScale(hhi, HHI_DIGITS),
    scale: HHI_SCALE,
  };
}

function qualityWarningsFor(
  eligible: readonly PooledSupplier[],
  concentration: SupplierCompetitionConcentration,
  windowStart: number,
  windowEnd: number,
): readonly SupplierCompetitionQualityWarningCode[] {
  const warnings: SupplierCompetitionQualityWarningCode[] = [];
  const yearsWithAnyRecordedSupplier = new Set<number>();
  let incompleteSupplierStructure = false;
  for (const entry of eligible) {
    for (const year of entry.recordedYears) {
      yearsWithAnyRecordedSupplier.add(year);
    }
    if (entry.missingYears.length > 0) {
      incompleteSupplierStructure = true;
    }
  }
  const windowYearCount = windowEnd - windowStart + 1;
  if (yearsWithAnyRecordedSupplier.size < windowYearCount) {
    warnings.push("SPARSE_FINALIZED_PERIODS");
  }
  if (incompleteSupplierStructure) {
    warnings.push("INCOMPLETE_SUPPLIER_STRUCTURE");
  }
  if (concentration.state === "UNAVAILABLE") {
    warnings.push("CONCENTRATION_UNAVAILABLE");
  }
  return warnings;
}

// Every finalized-cohort economy always receives a provisional row so a
// caller can see its Provisional Year status even when it did not export
// that year, or when the Provisional Year itself has no usable evidence
// (NOT_APPLICABLE). Evidence for supplier economies outside the finalized
// cohort (new entrants) is appended afterward: this is how the
// "provisional-changing" fixture models a supplier structure that differs
// between the finalized shares and the Provisional Year snapshot, without
// ever feeding back into the finalized shares or HHI computed above.
function provisionalSharesFor(
  inputs: SupplierCompetitionV1Inputs,
  eligible: readonly PooledSupplier[],
): readonly ProvisionalSupplierShare[] {
  const provisionalByCode = new Map(
    inputs.provisionalSuppliers.map((supplier) => [
      supplier.economy.code,
      supplier,
    ]),
  );
  const finalizedCodes = new Set(eligible.map((entry) => entry.economy.code));

  const finalizedRows = eligible.map((entry) =>
    provisionalRowFor(
      entry.economy,
      inputs.provisionalMarketState,
      provisionalByCode.get(entry.economy.code) ?? null,
    ),
  );
  const newEntrantRows =
    inputs.provisionalMarketState !== "RECORDED"
      ? []
      : inputs.provisionalSuppliers
          .filter((supplier) => !finalizedCodes.has(supplier.economy.code))
          .map((supplier) =>
            provisionalRowFor(supplier.economy, "RECORDED", supplier),
          );

  return [...finalizedRows, ...newEntrantRows].sort(compareProvisionalShares);
}

function provisionalRowFor(
  economy: SupplierEconomyEvidence["economy"],
  provisionalMarketState: SupplierCompetitionV1Inputs["provisionalMarketState"],
  evidence: ProvisionalSupplierEconomyEvidence | null,
): ProvisionalSupplierShare {
  if (provisionalMarketState !== "RECORDED") {
    return { economy, bilateralState: "NOT_APPLICABLE", valueCurrentUsd: null };
  }
  if (evidence === null || evidence.bilateral.state === "NO_RECORDED_POSITIVE_FLOW") {
    return { economy, bilateralState: "NO_RECORDED_POSITIVE_FLOW", valueCurrentUsd: null };
  }
  const value = parsePositiveDecimal(
    evidence.bilateral.valueCurrentUsd,
    `Supplier Competition provisional value for economy ${economy.code}`,
  );
  return {
    economy,
    bilateralState: "RECORDED_POSITIVE",
    valueCurrentUsd: formatFixed(value),
  };
}

function provisionalStateRank(
  state: ProvisionalSupplierShare["bilateralState"],
): number {
  if (state === "RECORDED_POSITIVE") {
    return 0;
  }
  return state === "NO_RECORDED_POSITIVE_FLOW" ? 1 : 2;
}

function compareProvisionalShares(
  left: ProvisionalSupplierShare,
  right: ProvisionalSupplierShare,
): number {
  const rankComparison =
    provisionalStateRank(left.bilateralState) -
    provisionalStateRank(right.bilateralState);
  if (rankComparison !== 0) {
    return rankComparison;
  }
  if (left.valueCurrentUsd !== null && right.valueCurrentUsd !== null) {
    const valueComparison = compareDecimalStrings(
      right.valueCurrentUsd,
      left.valueCurrentUsd,
    );
    if (valueComparison !== 0) {
      return valueComparison;
    }
  }
  return Number(left.economy.code) - Number(right.economy.code);
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

function scaleUnitsTo(value: FixedDecimal, scale: number): bigint {
  return value.units * tenTo(scale - value.scale);
}

function divideExact(
  numerator: bigint,
  denominator: bigint,
  digits: number,
): FixedDecimal {
  return {
    units: divideHalfUp(numerator * tenTo(digits), denominator),
    scale: digits,
  };
}
