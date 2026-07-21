import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_PRODUCT_AREAS } from "../../src/domain/market-analysis/product-areas";

describe("Market Analysis product-area ordering", () => {
  it("locks the exact stable product-area order for product and presentation", () => {
    expect(MARKET_ANALYSIS_PRODUCT_AREAS).toEqual([
      "snapshot",
      "demand",
      "exporterPosition",
      "supplierLandscape",
      "evidenceQuality",
      "recentMomentum",
      "exploreFurther",
      "validationPlan",
    ]);
  });

  it("is a frozen, deterministically ordered tuple rather than a mutable registry", () => {
    expect(Object.isFrozen(MARKET_ANALYSIS_PRODUCT_AREAS)).toBe(true);
    expect(new Set(MARKET_ANALYSIS_PRODUCT_AREAS).size).toBe(
      MARKET_ANALYSIS_PRODUCT_AREAS.length,
    );
  });
});
