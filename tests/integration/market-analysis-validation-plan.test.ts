import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES } from "../../src/domain/market-analysis/validation-plan";

describe("Market Analysis Validation Plan categories", () => {
  it("renders exactly five categories in the exact fixed spec order with a disposition", () => {
    expect(
      MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES.map((category) => category.id),
    ).toEqual([
      "QUANTITY_AND_CUSTOMS_UNIT_VALUE",
      "MARKET_ACCESS_AND_REGULATION",
      "LOGISTICS_AND_LANDED_COST",
      "COMPANIES_AND_COMMERCIAL_RELATIONSHIPS",
      "COMPANY_ECONOMICS_RISK_AND_FORECASTING",
    ]);
  });

  it("marks the forecasting category an intentional exclusion and the rest candidate extensions", () => {
    const dispositionById = new Map(
      MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES.map((category) => [
        category.id,
        category.disposition,
      ]),
    );

    expect(dispositionById.get("QUANTITY_AND_CUSTOMS_UNIT_VALUE")).toBe(
      "CANDIDATE_EXTENSION",
    );
    expect(dispositionById.get("MARKET_ACCESS_AND_REGULATION")).toBe(
      "CANDIDATE_EXTENSION",
    );
    expect(dispositionById.get("LOGISTICS_AND_LANDED_COST")).toBe(
      "CANDIDATE_EXTENSION",
    );
    expect(
      dispositionById.get("COMPANIES_AND_COMMERCIAL_RELATIONSHIPS"),
    ).toBe("CANDIDATE_EXTENSION");
    expect(
      dispositionById.get("COMPANY_ECONOMICS_RISK_AND_FORECASTING"),
    ).toBe("INTENTIONAL_EXCLUSION");
  });

  it("is closed structural data with no source seam, Module, route, Adapter, or credential field", () => {
    for (const category of MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES) {
      expect(Object.keys(category).sort()).toEqual(["disposition", "id"]);
    }
  });
});
