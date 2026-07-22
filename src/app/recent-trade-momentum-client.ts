import type { RecentTradeMomentumV1Payload } from "../domain/trade-analytics/recent-trade-momentum-v1-adapter";

export class RecentTradeMomentumClientError extends Error {
  constructor(
    readonly code: "HTTP_ERROR" | "INVALID_PAYLOAD",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "RecentTradeMomentumClientError";
  }
}

export async function loadRecentTradeMomentum({
  analysisBuildId,
  reporterIso2,
  productCode,
  expectedDatasetPackageIdentity,
  fetcher,
  signal,
}: {
  analysisBuildId: string;
  reporterIso2: string;
  productCode: string;
  expectedDatasetPackageIdentity: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
}): Promise<RecentTradeMomentumV1Payload> {
  const parameters = new URLSearchParams({
    reporter: reporterIso2,
    product: productCode,
  });
  const response = await fetcher(
    `/api/v1/analyses/${encodeURIComponent(analysisBuildId)}/recent-trade-momentum?${parameters}`,
    { signal },
  );
  if (!response.ok) {
    throw new RecentTradeMomentumClientError(
      "HTTP_ERROR",
      `Recent Trade Momentum returned ${response.status}.`,
      response.status,
    );
  }
  const payload: unknown = await response.json();
  if (
    !isRecentTradeMomentumPayload(payload) ||
    payload.reporterIso2 !== reporterIso2 ||
    payload.hs12Code !== productCode ||
    payload.datasetPackageIdentity !== expectedDatasetPackageIdentity
  ) {
    throw new RecentTradeMomentumClientError(
      "INVALID_PAYLOAD",
      "Recent Trade Momentum payload does not match the requested context.",
    );
  }
  return payload;
}

function isRecentTradeMomentumPayload(
  value: unknown,
): value is RecentTradeMomentumV1Payload {
  return (
    isRecord(value) &&
    value.schemaVersion === "recent-trade-momentum-result-v1" &&
    value.recipe === "recent-trade-momentum-v1" &&
    isNonemptyString(value.monthlyPackageId) &&
    isNonemptyString(value.sourceVintageId) &&
    /^[A-Z]{2}$/u.test(String(value.reporterIso2)) &&
    /^[0-9]{6}$/u.test(String(value.hs12Code)) &&
    /^\d{4}-\d{2}$/u.test(String(value.cutoffMonth)) &&
    isMonthList(value.recentMonths) &&
    isMonthList(value.baselineMonths) &&
    isOneOf(value.coverageState, [
      "SUPPORTED",
      "SUPPORTED_NO_SIGNAL",
      "NOT_OBSERVED",
      "SUPPRESSED_OR_REALLOCATED",
      "UNSUPPORTED_MARKET",
      "UNSUPPORTED_PRODUCT_MAPPING",
      "SOURCE_UNAVAILABLE",
    ] as const) &&
    (value.signalState === null ||
      isOneOf(value.signalState, [
        "RISING_FAST",
        "RISING",
        "BROADLY_STABLE",
        "FALLING",
        "FALLING_FAST",
      ] as const)) &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.every(isNonemptyString) &&
    isNullableNumericString(value.recentValueEur) &&
    isNullableNumericString(value.baselineValueEur) &&
    (value.growthRateDecimal === null ||
      /^[-+]?\d+\.\d+$/u.test(String(value.growthRateDecimal))) &&
    (value.growthPercentDisplay === null ||
      /^[-+]\d+\.\d$/u.test(String(value.growthPercentDisplay))) &&
    (value.confidence === null ||
      isOneOf(value.confidence, ["HIGH", "MEDIUM", "LOW"] as const)) &&
    Array.isArray(value.confidenceReasons) &&
    value.confidenceReasons.every(isNonemptyString) &&
    Number.isInteger(value.recordedHistoryMonths) &&
    value.expectedHistoryMonths === 24 &&
    isNonemptyString(value.analysisIdentity) &&
    isNonemptyString(value.datasetPackageIdentity)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMonthList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (month) => typeof month === "string" && /^\d{4}-\d{2}$/u.test(month),
    )
  );
}

function isNullableNumericString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d+$/u.test(value));
}

function isOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return typeof value === "string" && allowed.includes(value as Value);
}
