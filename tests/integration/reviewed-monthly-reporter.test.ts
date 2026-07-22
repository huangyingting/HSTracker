import { describe, expect, it } from "vitest";

import { resolveReviewedMonthlyReporter } from "../../src/economy/reviewed-monthly-reporter";

describe("reviewed monthly reporter catalog", () => {
  it.each([
    ["AUS", "AU"],
    ["BEL", "BE"],
    ["BRA", "BR"],
    ["CAN", "CA"],
    ["CHL", "CL"],
    ["DEU", "DE"],
    ["FRA", "FR"],
    ["IND", "IN"],
    ["JPN", "JP"],
    ["KEN", "KE"],
    ["MEX", "MX"],
    ["NLD", "NL"],
    ["POL", "PL"],
    ["USA", "US"],
    ["ZAF", "ZA"],
  ] as const)("resolves the reviewed %s mapping to %s", (iso3, iso2) => {
    expect(resolveReviewedMonthlyReporter(iso3)).toEqual({
      state: "REVIEWED",
      iso3,
      iso2,
    });
  });

  it.each([null, "GBR", "ZZZ", "nld"] as const)(
    "returns an explicit unsupported state for unmapped identity %s",
    (iso3) => {
      expect(resolveReviewedMonthlyReporter(iso3)).toEqual({
        state: "UNSUPPORTED_MARKET",
        iso3,
      });
    },
  );
});
