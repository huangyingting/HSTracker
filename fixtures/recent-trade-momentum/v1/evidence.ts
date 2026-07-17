import type {
  RecentTradeMomentumMonthObservation,
  RecentTradeMomentumV1Input,
} from "../../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";

export const RECENT_TRADE_MOMENTUM_FIXTURE_SOURCE_VINTAGE_ID =
  "recent-trade-momentum-serving-fixture-v1";
export const RECENT_TRADE_MOMENTUM_FIXTURE_ARTIFACT_SHA256 = "e".repeat(64);

export const RECENT_TRADE_MOMENTUM_FIXTURE_MONTHS = [
  "2024-03",
  "2024-04",
  "2024-05",
  "2024-06",
  "2024-07",
  "2024-08",
  "2024-09",
  "2024-10",
  "2024-11",
  "2024-12",
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
] as const;

export const RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF = "2026-02";

export type RecentTradeMomentumFixtureStateCase = Readonly<{
  label: string;
  reporterCode: string;
  productCode: string;
  expected: Readonly<{
    coverageState:
      | "SUPPORTED"
      | "SUPPORTED_NO_SIGNAL"
      | "UNSUPPORTED_MARKET"
      | "UNSUPPORTED_PRODUCT_MAPPING"
      | "SOURCE_UNAVAILABLE";
    signalState: "RISING_FAST" | null;
    reasonCodes: readonly string[];
    recentValueEur: string | null;
    baselineValueEur: string | null;
  }>;
}>;

export const RECENT_TRADE_MOMENTUM_FIXTURE_STATE_CASES = [
  {
    label: "unsupported",
    reporterCode: "FR",
    productCode: "010121",
    expected: {
      coverageState: "UNSUPPORTED_MARKET",
      signalState: null,
      reasonCodes: ["UNSUPPORTED_MARKET"],
      recentValueEur: null,
      baselineValueEur: null,
    },
  },
  {
    label: "supported-no-signal",
    reporterCode: "MX",
    productCode: "010121",
    expected: {
      coverageState: "SUPPORTED_NO_SIGNAL",
      signalState: null,
      reasonCodes: ["SMALL_BASE"],
      recentValueEur: "300000",
      baselineValueEur: "249999",
    },
  },
  {
    label: "not-observed",
    reporterCode: "CL",
    productCode: "010121",
    expected: {
      coverageState: "SUPPORTED_NO_SIGNAL",
      signalState: null,
      reasonCodes: ["MISSING_COMPARISON_MONTH"],
      recentValueEur: null,
      baselineValueEur: null,
    },
  },
  {
    label: "suppressed-reallocated",
    reporterCode: "PL",
    productCode: "010121",
    expected: {
      coverageState: "SUPPORTED_NO_SIGNAL",
      signalState: null,
      reasonCodes: ["SUPPRESSED_OR_REALLOCATED"],
      recentValueEur: null,
      baselineValueEur: null,
    },
  },
  {
    label: "mapping",
    reporterCode: "DE",
    productCode: "851712",
    expected: {
      coverageState: "UNSUPPORTED_PRODUCT_MAPPING",
      signalState: null,
      reasonCodes: ["UNSUPPORTED_PRODUCT_MAPPING"],
      recentValueEur: null,
      baselineValueEur: null,
    },
  },
  {
    label: "unavailable",
    reporterCode: "BE",
    productCode: "010121",
    expected: {
      coverageState: "SOURCE_UNAVAILABLE",
      signalState: null,
      reasonCodes: ["SOURCE_UNAVAILABLE"],
      recentValueEur: null,
      baselineValueEur: null,
    },
  },
] as const satisfies readonly RecentTradeMomentumFixtureStateCase[];

export function createRecentTradeMomentumFixtureInputs(
  monthlyPackageId: string,
): ReadonlyMap<string, RecentTradeMomentumV1Input> {
  return new Map([
    [
      key("NL", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "NL",
        productCode: "010121",
        baselineValues: [330_000, 330_000, 340_000],
        recentValues: [416_666, 416_667, 416_667],
      }),
    ],
    [
      key("MX", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "MX",
        productCode: "010121",
        baselineValues: [80_000, 80_000, 89_999],
        recentValues: [100_000, 100_000, 100_000],
      }),
    ],
    [
      key("CL", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "CL",
        productCode: "010121",
        observationOverrides: [
          { month: "2025-01", state: "NOT_OBSERVED", valueEur: null },
        ],
      }),
    ],
    [
      key("PL", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "PL",
        productCode: "010121",
        observationOverrides: [
          {
            month: "2026-01",
            state: "SUPPRESSED_OR_REALLOCATED",
            valueEur: null,
          },
        ],
      }),
    ],
    [
      key("DE", "851712"),
      input(monthlyPackageId, {
        reporterIso2: "DE",
        productCode: "851712",
        productMappingStatus: "UNSUPPORTED_PRODUCT_MAPPING",
        observationState: "NOT_OBSERVED",
      }),
    ],
    [
      key("FR", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "FR",
        productCode: "010121",
        marketStatus: "UNSUPPORTED_MARKET",
      }),
    ],
    [
      key("BE", "010121"),
      input(monthlyPackageId, {
        reporterIso2: "BE",
        productCode: "010121",
        marketStatus: "SOURCE_UNAVAILABLE",
      }),
    ],
  ]);
}

export function recentTradeMomentumFixtureKey(
  reporterCode: string,
  productCode: string,
): string {
  return key(reporterCode, productCode);
}

type InputOptions = Readonly<{
  reporterIso2: string;
  productCode: string;
  baselineValues?: readonly [number, number, number];
  recentValues?: readonly [number, number, number];
  observationOverrides?: readonly Readonly<{
    month: string;
    state: RecentTradeMomentumMonthObservation["observationState"];
    valueEur: number | null;
  }>[];
  marketStatus?: RecentTradeMomentumV1Input["marketStatus"];
  productMappingStatus?: RecentTradeMomentumV1Input["productMappingStatus"];
  observationState?: RecentTradeMomentumMonthObservation["observationState"];
}>;

function input(
  monthlyPackageId: string,
  options: InputOptions,
): RecentTradeMomentumV1Input {
  const baselineValues = options.baselineValues ?? [330_000, 330_000, 340_000];
  const recentValues = options.recentValues ?? [416_666, 416_667, 416_667];
  const values = new Map<string, number>([
    ["2024-12", baselineValues[0]],
    ["2025-01", baselineValues[1]],
    ["2025-02", baselineValues[2]],
    ["2025-12", recentValues[0]],
    ["2026-01", recentValues[1]],
    ["2026-02", recentValues[2]],
  ]);
  const overrides = new Map(
    (options.observationOverrides ?? []).map((override) => [
      override.month,
      override,
    ]),
  );
  const defaultObservationState = options.observationState ?? "RECORDED_POSITIVE";
  return {
    recipe: "recent-trade-momentum-v1",
    resultSchemaVersion: "recent-trade-momentum-result-v1",
    monthlyPackageId,
    sourceVintageId: RECENT_TRADE_MOMENTUM_FIXTURE_SOURCE_VINTAGE_ID,
    reporterIso2: options.reporterIso2,
    hs12Code: options.productCode,
    cutoffMonth: RECENT_TRADE_MOMENTUM_FIXTURE_CUTOFF,
    eligibleCompleteMonths: RECENT_TRADE_MOMENTUM_FIXTURE_MONTHS,
    marketStatus: options.marketStatus ?? "SUPPORTED",
    productMappingStatus: options.productMappingStatus ?? "EXACT_REVIEWED",
    observations: RECENT_TRADE_MOMENTUM_FIXTURE_MONTHS.map((month) => {
      const override = overrides.get(month);
      const observationState = override?.state ?? defaultObservationState;
      return {
        referenceMonth: month,
        observationState,
        valueEur:
          override?.valueEur ??
          (observationState === "RECORDED_POSITIVE"
            ? (values.get(month) ?? 100_000)
            : null),
        updateState: "FINAL_BY_SOURCE_SCHEDULE",
        mappingChain: "DIRECT_EXACT",
      };
    }),
    revisionComparisonWindowChangeRate: 0,
  };
}

function key(reporterCode: string, productCode: string): string {
  return `${reporterCode}:${productCode}`;
}
