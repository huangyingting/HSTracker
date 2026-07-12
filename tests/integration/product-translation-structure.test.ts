import { describe, expect, it } from "vitest";

import {
  preserveSourceScopeQualifiers,
  missingSourceTechnicalTerms,
  preserveSourceTechnicalTerms,
} from "../../scripts/catalog/product-translation-structure";

describe("product translation structural preservation", () => {
  it("retains exact formulas and scientific names in source order", () => {
    const source =
      "Wood: oak (Quercus spp.) and juice (Vaccinium vitis-idaea), evaluated as MgO, CaO and Fe2o3";

    expect(preserveSourceTechnicalTerms(source, "橡木及果汁")).toBe(
      "橡木及果汁 (Quercus spp.; Vaccinium vitis-idaea; MgO; CaO; Fe2o3)",
    );
    expect(
      missingSourceTechnicalTerms(
        source,
        "橡木(Quercus spp.)、果汁(Vaccinium vitis-idaea)、MgO、CaO及Fe2o3",
      ),
    ).toEqual({ chemicalFormulas: [], latinNames: [] });
  });

  it("does not misclassify English proper-name phrases as Latin names", () => {
    const source =
      "Tapestries (Gobelins, Flanders, Aubusson, Beauvais and the like), abaca (Manila hemp or Musa textilis Nee)";

    expect(missingSourceTechnicalTerms(source, "")).toEqual({
      chemicalFormulas: [],
      latinNames: ["Musa textilis Nee"],
    });
  });

  it("makes an omitted non-knitted scope qualifier explicit", () => {
    const source =
      "Shirts: men's or boys', of cotton (not knitted or crocheted)";

    expect(preserveSourceScopeQualifiers(source, "男用及男童用衬衫：棉制")).toBe(
      "男用及男童用衬衫：棉制（非针织或钩编）",
    );
    expect(
      preserveSourceScopeQualifiers(source, "男用及男童用衬衫：非针织或钩编，棉制"),
    ).toBe("男用及男童用衬衫：非针织或钩编，棉制");
  });
});
