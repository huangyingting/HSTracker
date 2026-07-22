import type {
  RecentTradeMomentumConfidenceReason,
  RecentTradeMomentumReasonCode,
} from "../domain/recent-trade-momentum/recent-trade-momentum-v1";
import type { DatasetPackageIdentity } from "../domain/trade-analytics/dataset-package";
import type { RecentTradeMomentumV1Payload } from "../domain/trade-analytics/recent-trade-momentum-v1-adapter";

type RecentTradeMomentumClientErrorCode =
  | "HTTP_ERROR"
  | "INVALID_PAYLOAD"
  | "UNKNOWN_REPORTER"
  | "UNKNOWN_PRODUCT";

export class RecentTradeMomentumClientError extends Error {
  constructor(
    readonly code: RecentTradeMomentumClientErrorCode,
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
  expectedDatasetPackageIdentity: DatasetPackageIdentity;
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
    const boundedCode = await boundedRouteErrorCode(response);
    throw new RecentTradeMomentumClientError(
      boundedCode ?? "HTTP_ERROR",
      `Recent Trade Momentum returned ${response.status}.`,
      response.status,
    );
  }
  const payload: unknown = await response.json();
  if (
    !isRecentTradeMomentumPayload(payload) ||
    payload.reporterIso2 !== reporterIso2 ||
    payload.hs12Code !== productCode ||
    payload.monthlyPackageId !== expectedDatasetPackageIdentity ||
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
    isMonthList(value.recentMonths, 3) &&
    isMonthList(value.baselineMonths, 3) &&
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
    isReasonCodeList(value.reasonCodes) &&
    isNullableNumericString(value.recentValueEur) &&
    isNullableNumericString(value.baselineValueEur) &&
    (value.growthRateDecimal === null ||
      /^[-+]?\d+\.\d+$/u.test(String(value.growthRateDecimal))) &&
    (value.growthPercentDisplay === null ||
      /^[-+]\d+\.\d$/u.test(String(value.growthPercentDisplay))) &&
    (value.confidence === null ||
      isOneOf(value.confidence, ["HIGH", "MEDIUM", "LOW"] as const)) &&
    isConfidenceReasonList(value.confidenceReasons) &&
    Number.isInteger(value.recordedHistoryMonths) &&
    Number(value.recordedHistoryMonths) >= 0 &&
    Number(value.recordedHistoryMonths) <= 24 &&
    value.expectedHistoryMonths === 24 &&
    isAnalysisIdentity(value.analysisIdentity) &&
    isDatasetPackageIdentity(value.datasetPackageIdentity)
  );
}

async function boundedRouteErrorCode(
  response: Response,
): Promise<"UNKNOWN_REPORTER" | "UNKNOWN_PRODUCT" | null> {
  if (
    response.status !== 404 ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return null;
  }
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return null;
  }
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }
  return isOneOf(payload.error.code, [
    "UNKNOWN_REPORTER",
    "UNKNOWN_PRODUCT",
  ] as const)
    ? payload.error.code
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMonthList(
  value: unknown,
  expectedLength: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    new Set(value).size === value.length &&
    value.every(
      (month) => typeof month === "string" && /^\d{4}-\d{2}$/u.test(month),
    )
  );
}

function isReasonCodeList(
  value: unknown,
): value is readonly RecentTradeMomentumReasonCode[] {
  return (
    Array.isArray(value) &&
    value.every((reason) =>
      isOneOf(reason, [
        "INSUFFICIENT_COMPLETE_HISTORY",
        "INSUFFICIENT_RECORDED_MONTHS",
        "MISSING_COMPARISON_MONTH",
        "SMALL_BASE",
        "WINDOW_CONCENTRATION",
        "SUPPRESSED_OR_REALLOCATED",
        "CLASSIFICATION_BREAK",
        "UNSUPPORTED_PRODUCT_MAPPING",
        "UNSUPPORTED_MARKET",
        "SOURCE_UNAVAILABLE",
      ] as const),
    )
  );
}

function isConfidenceReasonList(
  value: unknown,
): value is readonly RecentTradeMomentumConfidenceReason[] {
  return (
    Array.isArray(value) &&
    value.every((reason) =>
      isOneOf(reason, [
        "RECORDED_HISTORY_20_TO_23",
        "RECORDED_HISTORY_18_TO_19",
        "PRELIMINARY_COMPARISON_MONTH",
        "MULTI_STEP_EXACT_CORRESPONDENCE",
        "MATERIAL_SOURCE_REVISION",
      ] as const),
    )
  );
}

function isAnalysisIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^analysis-identity-v1-[0-9a-f]{64}$/u.test(value)
  );
}

function isDatasetPackageIdentity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^dataset-package-v1-[0-9a-f]{64}$/u.test(value)
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
