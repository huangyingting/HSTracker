import { describe, expect, it } from "vitest";

import { CORE_CURRENT_INPUT } from "../../test/fixtures/acceptance/v1/evidence/core-current";
import {
  generateDemoAnalysisInput,
  isDemoAnalysisProduct,
} from "../../test/fixtures/acceptance/v1/evidence/demo-analysis";

const baseEconomyCodes = new Set(
  CORE_CURRENT_INPUT.marketYears.map((row) => row.candidateMarket.code),
);

describe("demo analysis generator", () => {
  it("recognizes only curated demo product codes", () => {
    expect(isDemoAnalysisProduct("847130")).toBe(true);
    expect(isDemoAnalysisProduct("870323")).toBe(true);
    expect(isDemoAnalysisProduct("999999")).toBe(false);
    expect(isDemoAnalysisProduct("010121")).toBe(false);
  });

  it("sets the requested product identity while reusing the release scope", () => {
    const generated = generateDemoAnalysisInput("847130");
    expect(generated.product.code).toBe("847130");
    expect(generated.product.hsRevision).toBe("HS12");
    expect(generated.product.descriptionEn).toContain(
      "Automatic data processing machines",
    );
    expect(generated.exporter).toEqual(CORE_CURRENT_INPUT.exporter);
    expect(generated.release).toEqual(CORE_CURRENT_INPUT.release);
  });

  it("relabels economies as a bijection that preserves the cohort", () => {
    const generated = generateDemoAnalysisInput("852872");
    expect(generated.marketYears).toHaveLength(
      CORE_CURRENT_INPUT.marketYears.length,
    );
    expect(generated.provisionalMarketYears).toHaveLength(
      CORE_CURRENT_INPUT.provisionalMarketYears.length,
    );
    const codes = new Set(
      generated.marketYears.map((row) => row.candidateMarket.code),
    );
    expect(codes).toEqual(baseEconomyCodes);
  });

  it("is deterministic for a given product code", () => {
    expect(generateDemoAnalysisInput("870323")).toEqual(
      generateDemoAnalysisInput("870323"),
    );
  });

  it("ranks different products differently", () => {
    const computer = generateDemoAnalysisInput("847130");
    const television = generateDemoAnalysisInput("852872");
    const firstYear = (input: typeof computer) =>
      input.marketYears
        .filter((row) => row.year === 2023)
        .map((row) => `${row.candidateMarket.code}:${row.worldValueKusd}`)
        .sort();
    expect(firstYear(computer)).not.toEqual(firstYear(television));
  });
});
