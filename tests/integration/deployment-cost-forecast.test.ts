import forecastDocument from "../../deployment/cost-forecast.json";
import { describe, expect, it } from "vitest";

import { parseRecurringCostForecast } from "../../src/deployment/cost-forecast";

describe("production deployment cost forecast", () => {
  it("retains a current forecast below the recurring-cost target", () => {
    expect(parseRecurringCostForecast(forecastDocument)).toMatchObject({
      schemaVersion: "recurring-cost-forecast-v1",
      checkedAt: "2026-07-12T00:00:00Z",
      currency: "USD",
      region: "sin",
      machineClass: "shared-cpu-2x",
      memoryGiB: 2,
      volumeGiB: 50,
      forecastMonthlyUsd: 25.14,
      targetMonthlyUsd: 40,
      reviewThresholdMonthlyUsd: 50,
    });
  });
});
