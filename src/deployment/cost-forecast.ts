export type RecurringCostForecastLineItem = {
  id: string;
  monthlyUsd: number;
  sourceUrl: string;
  assumption: string;
};

export type RecurringCostForecast = {
  schemaVersion: "recurring-cost-forecast-v1";
  checkedAt: string;
  currency: "USD";
  region: string;
  machineClass: string;
  memoryGiB: number;
  volumeGiB: number;
  lineItems: readonly RecurringCostForecastLineItem[];
  forecastMonthlyUsd: number;
  targetMonthlyUsd: 40;
  reviewThresholdMonthlyUsd: 50;
};

export class CostForecastValidationError extends Error {
  readonly code = "COST_FORECAST_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CostForecastValidationError";
  }
}

export function parseRecurringCostForecast(
  value: unknown,
): RecurringCostForecast {
  const forecast = record(value, "cost forecast");
  if (forecast.schemaVersion !== "recurring-cost-forecast-v1") {
    throw new CostForecastValidationError(
      "Cost forecast schema is incompatible.",
    );
  }
  if (forecast.currency !== "USD") {
    throw new CostForecastValidationError(
      "Cost forecast currency must be USD.",
    );
  }
  const targetMonthlyUsd = money(
    forecast.targetMonthlyUsd,
    "target monthly cost",
  );
  const reviewThresholdMonthlyUsd = money(
    forecast.reviewThresholdMonthlyUsd,
    "review-threshold monthly cost",
  );
  if (targetMonthlyUsd !== 40 || reviewThresholdMonthlyUsd !== 50) {
    throw new CostForecastValidationError(
      "Cost forecast thresholds are incompatible.",
    );
  }
  if (!Array.isArray(forecast.lineItems) || forecast.lineItems.length === 0) {
    throw new CostForecastValidationError(
      "Cost forecast line items must be a nonempty array.",
    );
  }
  const lineItems = forecast.lineItems.map((item, index) =>
    lineItem(item, index),
  );
  const ids = new Set(lineItems.map((item) => item.id));
  if (ids.size !== lineItems.length) {
    throw new CostForecastValidationError(
      "Cost forecast line-item IDs must be unique.",
    );
  }
  const forecastMonthlyUsd = money(
    forecast.forecastMonthlyUsd,
    "forecast monthly cost",
  );
  const lineItemCents = lineItems.reduce(
    (total, item) => total + Math.round(item.monthlyUsd * 100),
    0,
  );
  if (Math.round(forecastMonthlyUsd * 100) !== lineItemCents) {
    throw new CostForecastValidationError(
      "Cost forecast total does not match its line items.",
    );
  }

  return {
    schemaVersion: "recurring-cost-forecast-v1",
    checkedAt: utcTimestamp(forecast.checkedAt, "cost forecast checkedAt"),
    currency: "USD",
    region: region(forecast.region),
    machineClass: nonemptyString(
      forecast.machineClass,
      "cost forecast Machine class",
    ),
    memoryGiB: positiveInteger(
      forecast.memoryGiB,
      "cost forecast memory GiB",
    ),
    volumeGiB: positiveInteger(
      forecast.volumeGiB,
      "cost forecast volume GiB",
    ),
    lineItems,
    forecastMonthlyUsd,
    targetMonthlyUsd: 40,
    reviewThresholdMonthlyUsd: 50,
  };
}

function lineItem(
  value: unknown,
  index: number,
): RecurringCostForecastLineItem {
  const item = record(value, `cost forecast line item ${index}`);
  const sourceUrl = nonemptyString(
    item.sourceUrl,
    `cost forecast line item ${index} source URL`,
  );
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new CostForecastValidationError(
      `Cost forecast line item ${index} source URL is invalid.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new CostForecastValidationError(
      `Cost forecast line item ${index} source URL must use HTTPS.`,
    );
  }
  return {
    id: nonemptyString(
      item.id,
      `cost forecast line item ${index} ID`,
    ),
    monthlyUsd: money(
      item.monthlyUsd,
      `cost forecast line item ${index} monthly cost`,
    ),
    sourceUrl,
    assumption: nonemptyString(
      item.assumption,
      `cost forecast line item ${index} assumption`,
    ),
  };
}

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CostForecastValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CostForecastValidationError(
      `${label} must be a nonempty string.`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CostForecastValidationError(
      `${label} must be a positive safe integer.`,
    );
  }
  return value as number;
}

function money(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-8
  ) {
    throw new CostForecastValidationError(
      `${label} must be a nonnegative USD amount with at most two decimals.`,
    );
  }
  return value;
}

function utcTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new CostForecastValidationError(
      `${label} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function region(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{3}$/u.test(value)) {
    throw new CostForecastValidationError(
      "Cost forecast region must be a three-letter Fly region.",
    );
  }
  return value;
}
