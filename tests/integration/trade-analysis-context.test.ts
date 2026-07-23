import { describe, expect, it } from "vitest";

import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";
import {
  economyCodeOf,
  emptyTradeAnalysisContext,
  hasCompleteRecipeInputs,
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  pinFromManifest,
  productCodeOf,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withAdvancedToolRecipe,
  withEconomyCode,
  withLocale,
  withoutPin,
  withPin,
  withProductCode,
  withRecipe,
  type TradeAnalysisContext,
} from "../../src/app/trade-analysis-context";

const manifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);

const CURRENT_CANDIDATE_MARKET_PIN = {
  analysisBuildId: manifest.analysisBuildId,
  datasetPackageIdentity: manifest.recommendation.datasetPackageIdentity,
};

describe("Trade Analysis Context: parsing", () => {
  it("defaults an empty location to an incomplete opportunity-discovery context", () => {
    expect(parseTradeAnalysisContext("/")).toEqual({
      recipe: "opportunity-discovery",
      locale: "en",
      pin: null,
      exportEconomyCode: null,
      productCodes: null,
    });
  });

  it("parses opportunity-discovery exporter scope and an HS12 product projection", () => {
    expect(
      parseTradeAnalysisContext(
        "/?recipe=opportunity-discovery-v1&exporter=100&products=010003,010001",
      ),
    ).toEqual({
      recipe: "opportunity-discovery",
      locale: "en",
      pin: null,
      exportEconomyCode: "100",
      productCodes: ["010003", "010001"],
    });
  });

  it("parses complete candidate-market inputs, focus, and locale", () => {
    const context = parseTradeAnalysisContext(
      "/?locale=zh-Hans&exporter=156&revision=HS12&product=010121&market=484",
    );
    expect(context).toEqual({
      recipe: "candidate-market",
      locale: "zh-Hans",
      productCode: "010121",
      pin: null,
      exporterCode: "156",
      focusedMarketCode: "484",
    });
  });

  it("parses trade-trend inputs and discards fields it does not consume", () => {
    const context = parseTradeAnalysisContext(
      "/?task=trade-trend&importer=528&revision=HS12&product=010121&market=484&exporter=156",
    );
    expect(context).toEqual({
      recipe: "trade-trend",
      locale: "en",
      productCode: "010121",
      pin: null,
      importerCode: "528",
    });
    expect(context).not.toHaveProperty("focusedMarketCode");
    expect(context).not.toHaveProperty("exporterCode");
  });

  it("parses supplier-competition inputs identically to trade-trend", () => {
    const context = parseTradeAnalysisContext(
      "/?task=supplier-competition&importer=124&revision=HS12&product=010121",
    );
    expect(context).toEqual({
      recipe: "supplier-competition",
      locale: "en",
      productCode: "010121",
      pin: null,
      importerCode: "124",
    });
  });

  it("parses the exact versioned recipe identity", () => {
    expect(
      parseTradeAnalysisContext("/?recipe=opportunity-discovery-v1&exporter=100")
        .recipe,
    ).toBe("opportunity-discovery");
    expect(
      parseTradeAnalysisContext("/?recipe=trade-trend-v1&importer=528")
        .recipe,
    ).toBe("trade-trend");
    expect(
      parseTradeAnalysisContext(
        "/?recipe=supplier-competition-v1&importer=124",
      ).recipe,
    ).toBe("supplier-competition");
    expect(
      parseTradeAnalysisContext("/?recipe=candidate-market-v1&exporter=156")
        .recipe,
    ).toBe("candidate-market");
  });

  it("prefers the exact recipe identity over a conflicting legacy task, discarding the unconsumed task", () => {
    const context = parseTradeAnalysisContext(
      "/?recipe=trade-trend-v1&task=supplier-competition&importer=528&revision=HS12&product=010121",
    );
    expect(context).toEqual({
      recipe: "trade-trend",
      locale: "en",
      productCode: "010121",
      pin: null,
      importerCode: "528",
    });
  });

  it("defaults an unrecognized recipe identity without falling back to a present legacy task", () => {
    const context = parseTradeAnalysisContext(
      "/?recipe=trade-trend-v2&task=trade-trend&importer=528",
    );
    expect(context.recipe).toBe("opportunity-discovery");
  });

  it("falls back to the legacy task alias only when no recipe identity is present", () => {
    expect(
      parseTradeAnalysisContext("/?task=trade-trend&importer=528").recipe,
    ).toBe("trade-trend");
    expect(
      parseTradeAnalysisContext(
        "/?task=supplier-competition&importer=124",
      ).recipe,
    ).toBe("supplier-competition");
  });

  it("normalizes an unknown task and an unknown locale to their defaults", () => {
    const context = parseTradeAnalysisContext(
      "/?task=trade-explorer&locale=fr",
    );
    expect(context.recipe).toBe("opportunity-discovery");
    expect(context.locale).toBe("en");
  });

  it("keeps legacy candidate-market links on their historical task when no recipe identity is present", () => {
    expect(
      parseTradeAnalysisContext(
        "/?exporter=156&revision=HS12&product=010121&market=484",
      ),
    ).toMatchObject({
      recipe: "candidate-market",
      exporterCode: "156",
      productCode: "010121",
      focusedMarketCode: "484",
    });
  });

  it("discards a malformed economy code", () => {
    const context = parseTradeAnalysisContext("/?exporter=not-a-code");
    expect(economyCodeOf(context)).toBeNull();
  });

  it("discards a product code when the revision is not HS12", () => {
    const context = parseTradeAnalysisContext(
      "/?revision=HS07&product=010121",
    );
    expect(productCodeOf(context)).toBeNull();
  });

  it("discards a malformed product code", () => {
    const context = parseTradeAnalysisContext(
      "/?revision=HS12&product=abcdef",
    );
    expect(productCodeOf(context)).toBeNull();
  });

  it("discards a pin unless both build and pkg are present and well-formed", () => {
    expect(
      parseTradeAnalysisContext("/?exporter=156&revision=HS12&product=010121&build=acceptance-fixtures-v1").pin,
    ).toBeNull();
    expect(
      parseTradeAnalysisContext(
        `/?exporter=156&revision=HS12&product=010121&pkg=${CURRENT_CANDIDATE_MARKET_PIN.datasetPackageIdentity}`,
      ).pin,
    ).toBeNull();
    expect(
      parseTradeAnalysisContext(
        "/?exporter=156&revision=HS12&product=010121&build=not valid&pkg=dataset-package-v1-zz",
      ).pin,
    ).toBeNull();
  });

  it("parses a well-formed pin", () => {
    const context = parseTradeAnalysisContext(
      `/?exporter=156&revision=HS12&product=010121&build=${CURRENT_CANDIDATE_MARKET_PIN.analysisBuildId}&pkg=${CURRENT_CANDIDATE_MARKET_PIN.datasetPackageIdentity}`,
    );
    expect(context.pin).toEqual(CURRENT_CANDIDATE_MARKET_PIN);
  });

  it("accepts a bare relative query string as well as a full href", () => {
    const bare = parseTradeAnalysisContext("?exporter=156");
    const full = parseTradeAnalysisContext(
      "https://hstracker.example/?exporter=156",
    );
    expect(bare).toMatchObject({
      recipe: "opportunity-discovery",
      exportEconomyCode: "156",
    });
    expect(full).toMatchObject({
      recipe: "opportunity-discovery",
      exportEconomyCode: "156",
    });
  });
});

describe("Trade Analysis Context: serializing", () => {
  it("produces a bare pathname when the context is entirely empty", () => {
    const context = emptyTradeAnalysisContext("opportunity-discovery", "en");
    expect(serializeTradeAnalysisContext("/", context)).toBe("/");
  });

  it("serializes an opportunity-discovery feed and product projection canonically", () => {
    const context: TradeAnalysisContext = {
      recipe: "opportunity-discovery",
      locale: "zh-Hans",
      pin: null,
      exportEconomyCode: "100",
      productCodes: ["010003", "010001", "010001"],
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      "/?recipe=opportunity-discovery-v1&locale=zh-Hans&exporter=100&products=010001%2C010003",
    );
  });

  it("includes the exact versioned recipe identity, first, once the recipe's own inputs are complete — even for the default candidate-market recipe", () => {
    const context: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "en",
      productCode: "010121",
      pin: null,
      exporterCode: "156",
      focusedMarketCode: "484",
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=484",
    );
  });

  it("includes the exact versioned recipe identity and importer for trade-trend", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-trend",
      locale: "en",
      productCode: "010121",
      pin: null,
      importerCode: "528",
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      "/?recipe=trade-trend-v1&importer=528&revision=HS12&product=010121",
    );
  });

  it("includes the exact versioned recipe identity for a non-default task even before its inputs are complete, so task persists", () => {
    const context = emptyTradeAnalysisContext("supplier-competition", "en");
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      "/?recipe=supplier-competition-v1",
    );
  });

  it("includes a non-default locale independently of completeness — it is never lost while inputs are still incomplete", () => {
    const bare: TradeAnalysisContext = emptyTradeAnalysisContext(
      "opportunity-discovery",
      "zh-Hans",
    );
    expect(serializeTradeAnalysisContext("/", bare)).toBe(
      "/?locale=zh-Hans",
    );

    const partial: TradeAnalysisContext = {
      recipe: "opportunity-discovery",
      locale: "zh-Hans",
      pin: null,
      exportEconomyCode: null,
      productCodes: ["010121"],
    };
    expect(serializeTradeAnalysisContext("/", partial)).toBe(
      "/?locale=zh-Hans&products=010121",
    );

    const complete: TradeAnalysisContext = {
      ...partial,
      exportEconomyCode: "156",
    };
    expect(serializeTradeAnalysisContext("/", complete)).toBe(
      "/?recipe=opportunity-discovery-v1&locale=zh-Hans&exporter=156&products=010121",
    );
  });

  it("omits only the default locale (\"en\"), never a non-default one, while keeping canonical order", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-trend",
      locale: "en",
      productCode: "010121",
      pin: null,
      importerCode: "528",
    };
    expect(serializeTradeAnalysisContext("/", context)).not.toContain(
      "locale=",
    );
  });

  it("places the recipe param deterministically first, even before a non-default locale and a pin", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-trend",
      locale: "zh-Hans",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      importerCode: "528",
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      `/?recipe=trade-trend-v1&locale=zh-Hans&importer=528&revision=HS12&product=010121&build=${CURRENT_CANDIDATE_MARKET_PIN.analysisBuildId}&pkg=${CURRENT_CANDIDATE_MARKET_PIN.datasetPackageIdentity}`,
    );
  });

  it("includes the pin only when present, after market focus, with the recipe identity first", () => {
    const context: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "en",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      exporterCode: "156",
      focusedMarketCode: "484",
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      `/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=484&build=${CURRENT_CANDIDATE_MARKET_PIN.analysisBuildId}&pkg=${CURRENT_CANDIDATE_MARKET_PIN.datasetPackageIdentity}`,
    );
  });

  it("upgrades a legacy task alias to the exact versioned recipe identity on reserialization, and round-trips the same context", () => {
    const legacyHref = `/?task=trade-trend&locale=zh-Hans&importer=528&revision=HS12&product=010121&build=${CURRENT_CANDIDATE_MARKET_PIN.analysisBuildId}&pkg=${CURRENT_CANDIDATE_MARKET_PIN.datasetPackageIdentity}`;
    const context = parseTradeAnalysisContext(legacyHref);
    expect(context.recipe).toBe("trade-trend");
    const reserialized = serializeTradeAnalysisContext("/", context);
    expect(reserialized).toContain("recipe=trade-trend-v1");
    expect(reserialized).not.toContain("task=");
    expect(parseTradeAnalysisContext(reserialized)).toEqual(context);
  });
});

describe("Trade Analysis Context: completeness", () => {
  it("is complete once economy and product codes are both present", () => {
    expect(
      hasCompleteRecipeInputs({
        recipe: "candidate-market",
        locale: "en",
        productCode: "010121",
        pin: null,
        exporterCode: "156",
        focusedMarketCode: null,
      }),
    ).toBe(true);
    expect(
      hasCompleteRecipeInputs(
        emptyTradeAnalysisContext("trade-trend", "en"),
      ),
    ).toBe(false);
  });

  it("is complete for opportunity discovery once an export economy is present", () => {
    expect(
      hasCompleteRecipeInputs({
        recipe: "opportunity-discovery",
        locale: "en",
        pin: null,
        exportEconomyCode: "100",
        productCodes: null,
      }),
    ).toBe(true);
    expect(hasCompleteRecipeInputs(emptyTradeAnalysisContext("opportunity-discovery", "en"))).toBe(false);
  });
});

describe("Trade Analysis Context: withRecipe", () => {
  it("returns the same context when the recipe is unchanged", () => {
    const context = withEconomyCode(
      withProductCode(
        emptyTradeAnalysisContext("trade-trend", "en"),
        "010121",
      ),
      "528",
    );
    expect(withRecipe(context, "trade-trend")).toBe(context);
  });

  it("preserves importer and product when switching directly between trade-trend and supplier-competition", () => {
    const trend = withEconomyCode(
      withProductCode(
        {
          recipe: "trade-trend",
          locale: "zh-Hans",
          productCode: null,
          pin: CURRENT_CANDIDATE_MARKET_PIN,
          importerCode: null,
        },
        "010121",
      ),
      "528",
    );
    expect(withRecipe(trend, "supplier-competition")).toEqual({
      recipe: "supplier-competition",
      locale: "zh-Hans",
      productCode: "010121",
      pin: null,
      importerCode: "528",
    });
  });

  it("starts with empty inputs when transitioning to or from candidate-market", () => {
    const candidateMarket: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "en",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      exporterCode: "156",
      focusedMarketCode: "484",
    };
    expect(withRecipe(candidateMarket, "trade-trend")).toEqual(
      emptyTradeAnalysisContext("trade-trend", "en"),
    );

    const trend = withEconomyCode(
      withProductCode(emptyTradeAnalysisContext("trade-trend", "en"), "010121"),
      "528",
    );
    expect(withRecipe(trend, "candidate-market")).toEqual(
      emptyTradeAnalysisContext("candidate-market", "en"),
    );
  });

  it("carries genuine exporter and single-product shape between opportunity discovery and candidate-market", () => {
    const candidateMarket: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "en",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      exporterCode: "156",
      focusedMarketCode: "484",
    };
    expect(withRecipe(candidateMarket, "opportunity-discovery")).toEqual({
      recipe: "opportunity-discovery",
      locale: "en",
      pin: null,
      exportEconomyCode: "156",
      productCodes: ["010121"],
    });

    const opportunity: TradeAnalysisContext = {
      recipe: "opportunity-discovery",
      locale: "zh-Hans",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      exportEconomyCode: "100",
      productCodes: ["010001"],
    };
    expect(withRecipe(opportunity, "candidate-market")).toEqual({
      recipe: "candidate-market",
      locale: "zh-Hans",
      productCode: "010001",
      pin: null,
      exporterCode: "100",
      focusedMarketCode: null,
    });
  });
});

describe("Trade Analysis Context: Advanced tools", () => {
  it("carries focused semantics with each advanced recipe's own deployment pin", () => {
    const context: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "zh-Hans",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      exporterCode: "156",
      focusedMarketCode: "528",
    };
    const tradeTrendPin = pinFromManifest(manifest, "trade-trend");
    const supplierCompetitionPin = pinFromManifest(
      manifest,
      "supplier-competition",
    );
    const tradeExplorerPin = pinFromManifest(manifest, "trade-explorer");
    expect(tradeTrendPin).not.toEqual(CURRENT_CANDIDATE_MARKET_PIN);
    expect(supplierCompetitionPin).not.toEqual(CURRENT_CANDIDATE_MARKET_PIN);
    expect(tradeExplorerPin).not.toEqual(CURRENT_CANDIDATE_MARKET_PIN);

    expect(
      withAdvancedToolRecipe(context, "trade-trend", tradeTrendPin),
    ).toEqual({
      recipe: "trade-trend",
      locale: "zh-Hans",
      productCode: "010121",
      pin: tradeTrendPin,
      importerCode: "528",
    });
    expect(
      withAdvancedToolRecipe(
        context,
        "supplier-competition",
        supplierCompetitionPin,
      ),
    ).toEqual({
      recipe: "supplier-competition",
      locale: "zh-Hans",
      productCode: "010121",
      pin: supplierCompetitionPin,
      importerCode: "528",
    });
    expect(
      withAdvancedToolRecipe(context, "trade-explorer", tradeExplorerPin),
    ).toEqual({
      recipe: "trade-explorer",
      locale: "zh-Hans",
      pin: tradeExplorerPin,
      shape: null,
      measures: [],
      years: [],
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
      sort: null,
    });
  });
});

describe("Trade Analysis Context: withoutPin", () => {
  it("discards only the pin, preserving every other field", () => {
    const context: TradeAnalysisContext = {
      recipe: "supplier-competition",
      locale: "zh-Hans",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      importerCode: "124",
    };
    expect(withoutPin(context)).toEqual({ ...context, pin: null });
  });
});

describe("Trade Analysis Context: withLocale", () => {
  it("relabels the context without touching its pin or inputs", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-trend",
      locale: "en",
      productCode: "010121",
      pin: CURRENT_CANDIDATE_MARKET_PIN,
      importerCode: "528",
    };
    expect(withLocale(context, "zh-Hans")).toEqual({
      ...context,
      locale: "zh-Hans",
    });
  });
});

describe("Trade Analysis Context: economyCodeOf / withEconomyCode / withProductCode", () => {
  it("reads and writes the exporter field for candidate-market", () => {
    const context = emptyTradeAnalysisContext("candidate-market", "en");
    expect(economyCodeOf(context)).toBeNull();
    const next = withEconomyCode(context, "156");
    expect(economyCodeOf(next)).toBe("156");
    expect(next).toMatchObject({ exporterCode: "156" });
  });

  it("reads and writes the importer field for trade-trend and supplier-competition", () => {
    for (const recipe of ["trade-trend", "supplier-competition"] as const) {
      const context = emptyTradeAnalysisContext(recipe, "en");
      const next = withEconomyCode(context, "528");
      expect(economyCodeOf(next)).toBe("528");
      expect(next).toMatchObject({ importerCode: "528" });
    }
  });

  it("reads and writes the export economy and one confirmed product projection for opportunity discovery", () => {
    const context = emptyTradeAnalysisContext("opportunity-discovery", "en");
    expect(economyCodeOf(context)).toBeNull();
    expect(productCodeOf(context)).toBeNull();
    const withExporter = withEconomyCode(context, "100");
    const withProduct = withProductCode(withExporter, "010001");
    expect(economyCodeOf(withProduct)).toBe("100");
    expect(productCodeOf(withProduct)).toBe("010001");
    expect(withProduct).toMatchObject({
      exportEconomyCode: "100",
      productCodes: ["010001"],
    });
  });

  it("writes the product code without touching the economy code", () => {
    const context = withEconomyCode(
      emptyTradeAnalysisContext("candidate-market", "en"),
      "156",
    );
    const next = withProductCode(context, "010121");
    expect(next).toMatchObject({ exporterCode: "156", productCode: "010121" });
  });
});

describe("Trade Analysis Context: pinFromManifest", () => {
  it("derives the current candidate-market pin from the manifest", () => {
    expect(pinFromManifest(manifest, "candidate-market")).toEqual(
      CURRENT_CANDIDATE_MARKET_PIN,
    );
  });

  it("derives the current trade-trend and supplier-competition pins", () => {
    expect(pinFromManifest(manifest, "trade-trend")).toEqual({
      analysisBuildId: manifest.analysisBuildId,
      datasetPackageIdentity:
        manifest.recommendation.tradeTrend!.datasetPackageIdentity,
    });
    expect(pinFromManifest(manifest, "supplier-competition")).toEqual({
      analysisBuildId: manifest.analysisBuildId,
      datasetPackageIdentity:
        manifest.recommendation.supplierCompetition!.datasetPackageIdentity,
    });
  });

  it("derives the current opportunity-discovery pin", () => {
    expect(pinFromManifest(manifest, "opportunity-discovery")).toEqual({
      analysisBuildId: manifest.analysisBuildId,
      datasetPackageIdentity:
        manifest.recommendation.opportunityDiscovery!.datasetPackageIdentity,
    });
  });

  it("returns null when the current Recommended Dataset Mapping does not declare the recipe", () => {
    const unsupported = {
      ...manifest,
      recommendation: { ...manifest.recommendation, tradeTrend: null },
    };
    expect(pinFromManifest(unsupported, "trade-trend")).toBeNull();
  });
});

describe("Trade Analysis Context: withPin", () => {
  it("applies the current manifest pin to an existing candidate-market context, preserving every other field", () => {
    const context: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "zh-Hans",
      productCode: "010121",
      pin: null,
      exporterCode: "156",
      focusedMarketCode: "484",
    };
    expect(withPin(context, manifest)).toEqual({
      ...context,
      pin: CURRENT_CANDIDATE_MARKET_PIN,
    });
  });

  it("applies the current manifest pin to trade-trend and supplier-competition contexts", () => {
    for (const recipe of ["trade-trend", "supplier-competition"] as const) {
      const context = withEconomyCode(
        withProductCode(emptyTradeAnalysisContext(recipe, "en"), "010121"),
        "528",
      );
      expect(withPin(context, manifest)).toEqual({
        ...context,
        pin: pinFromManifest(manifest, recipe),
      });
    }
  });

  it("applies the current manifest pin to opportunity-discovery contexts", () => {
    const context = withEconomyCode(
      emptyTradeAnalysisContext("opportunity-discovery", "en"),
      "100",
    );
    expect(withPin(context, manifest)).toEqual({
      ...context,
      pin: pinFromManifest(manifest, "opportunity-discovery"),
    });
  });

  it("replaces an existing (possibly retired) pin rather than merging it", () => {
    const context: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "en",
      productCode: "010121",
      pin: { analysisBuildId: "replacement-analysis-v2", datasetPackageIdentity: `dataset-package-v1-${"0".repeat(64)}` },
      exporterCode: "156",
      focusedMarketCode: null,
    };
    expect(withPin(context, manifest).pin).toEqual(
      CURRENT_CANDIDATE_MARKET_PIN,
    );
  });

  it("clears the pin when the current manifest does not support the recipe", () => {
    const unsupported = {
      ...manifest,
      recommendation: { ...manifest.recommendation, supplierCompetition: null },
    };
    const context = withEconomyCode(
      withProductCode(
        emptyTradeAnalysisContext("supplier-competition", "en"),
        "010121",
      ),
      "124",
    );
    expect(withPin(context, unsupported).pin).toBeNull();
  });

  it("composes with the module's other combinators to build a canonical pinned href without a hand-authored literal", () => {
    const context = withPin(
      withProductCode(
        withEconomyCode(
          withRecipe(parseTradeAnalysisContext("/?task=trade-trend"), "trade-trend"),
          "528",
        ),
        "010121",
      ),
      manifest,
    );
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      `/?recipe=trade-trend-v1&importer=528&revision=HS12&product=010121&build=${manifest.analysisBuildId}&pkg=${manifest.recommendation.tradeTrend!.datasetPackageIdentity}`,
    );
  });
});

describe("Trade Analysis Context: resolvePinnedContext", () => {
  it("is unpinned when the URL carries no pin", () => {
    expect(resolvePinnedContext(null, manifest, "candidate-market")).toEqual({
      state: "unpinned",
    });
  });

  it("is current when the pin matches the manifest's live recommendation", () => {
    expect(
      resolvePinnedContext(
        CURRENT_CANDIDATE_MARKET_PIN,
        manifest,
        "candidate-market",
      ),
    ).toEqual({ state: "current", pin: CURRENT_CANDIDATE_MARKET_PIN });
  });

  it("is retired with BUILD_MISMATCH when the analysis build changed", () => {
    const stalePin = {
      ...CURRENT_CANDIDATE_MARKET_PIN,
      analysisBuildId: "replacement-analysis-v2",
    };
    expect(
      resolvePinnedContext(stalePin, manifest, "candidate-market"),
    ).toEqual({ state: "retired", pin: stalePin, reason: "BUILD_MISMATCH" });
  });

  it("is retired with PACKAGE_MISMATCH when only the package identity changed", () => {
    const stalePin = {
      ...CURRENT_CANDIDATE_MARKET_PIN,
      datasetPackageIdentity: `dataset-package-v1-${"0".repeat(64)}`,
    };
    expect(
      resolvePinnedContext(stalePin, manifest, "candidate-market"),
    ).toEqual({ state: "retired", pin: stalePin, reason: "PACKAGE_MISMATCH" });
  });

  it("is retired with RECIPE_UNSUPPORTED when current no longer declares the recipe", () => {
    const unsupported = {
      ...manifest,
      recommendation: { ...manifest.recommendation, supplierCompetition: null },
    };
    const pin = pinFromManifest(manifest, "supplier-competition")!;
    expect(
      resolvePinnedContext(pin, unsupported, "supplier-competition"),
    ).toEqual({ state: "retired", pin, reason: "RECIPE_UNSUPPORTED" });
  });

  it("never fabricates a pin: unpinned stays unpinned even when current is available", () => {
    const resolution = resolvePinnedContext(null, manifest, "trade-trend");
    expect(resolution).toEqual({ state: "unpinned" });
  });

  const RETAINED_ANALYSIS_BUILD_ID = "analysis-build-v1-retained0000000";
  const RETAINED_DATASET_PACKAGE_IDENTITY = manifest.recommendation
    .tradeTrend!.datasetPackageIdentity;
  const MISMATCHED_DATASET_PACKAGE_IDENTITY = manifest.recommendation
    .supplierCompetition!.datasetPackageIdentity;
  const retainedRecommendation = {
    ...manifest.recommendation,
    datasetPackageIdentity: RETAINED_DATASET_PACKAGE_IDENTITY,
  };
  const manifestWithRetainedPredecessor = {
    ...manifest,
    deploymentWindow: [
      ...manifest.deploymentWindow,
      {
        analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
        recommendation: retainedRecommendation,
        baciRelease: "V202501",
        artifactSha256: "e".repeat(64),
      },
    ],
  };

  it("is retained when the pin names a retained predecessor with a matching package identity", () => {
    const pin = {
      analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
      datasetPackageIdentity: RETAINED_DATASET_PACKAGE_IDENTITY,
    };
    expect(
      resolvePinnedContext(
        pin,
        manifestWithRetainedPredecessor,
        "candidate-market",
      ),
    ).toEqual({
      state: "retained",
      pin,
      deployment: manifestWithRetainedPredecessor.deploymentWindow[1],
    });
  });

  it("derives recipe-specific canonical pins from current and retained deployment-window entries", () => {
      expect(
        pinFromDeploymentWindow(
          manifestWithRetainedPredecessor,
          manifest.analysisBuildId,
          "opportunity-discovery",
        ),
      ).toEqual(pinFromManifest(manifest, "opportunity-discovery"));
      expect(
        pinFromDeploymentWindow(
          manifestWithRetainedPredecessor,
          RETAINED_ANALYSIS_BUILD_ID,
          "trade-trend",
        ),
      ).toEqual({
        analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
        datasetPackageIdentity:
          retainedRecommendation.tradeTrend!.datasetPackageIdentity,
      });
      expect(
        pinFromDeploymentWindow(
          manifestWithRetainedPredecessor,
          RETAINED_ANALYSIS_BUILD_ID,
          "supplier-competition",
        ),
      ).toEqual({
        analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
        datasetPackageIdentity:
          retainedRecommendation.supplierCompetition!.datasetPackageIdentity,
      });
  });

  it("does not fabricate a deployment-window pin for an absent build or unsupported recipe", () => {
      expect(
        pinFromDeploymentWindow(
          manifestWithRetainedPredecessor,
          "absent-build",
          "trade-trend",
        ),
      ).toBeNull();
      expect(
        pinFromDeploymentWindow(
          {
            ...manifestWithRetainedPredecessor,
            deploymentWindow: [
              manifestWithRetainedPredecessor.deploymentWindow[0]!,
              {
                ...manifestWithRetainedPredecessor.deploymentWindow[1]!,
                recommendation: {
                  ...retainedRecommendation,
                  tradeExplorer: null,
                },
              },
            ],
          },
          RETAINED_ANALYSIS_BUILD_ID,
          "trade-explorer",
        ),
      ).toBeNull();
  });

  it("is retired with PACKAGE_MISMATCH when a retained predecessor's package identity has since changed", () => {
    const pin = {
      analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
      datasetPackageIdentity: MISMATCHED_DATASET_PACKAGE_IDENTITY,
    };
    expect(
      resolvePinnedContext(
        pin,
        manifestWithRetainedPredecessor,
        "candidate-market",
      ),
    ).toEqual({ state: "retired", pin, reason: "PACKAGE_MISMATCH" });
  });

  it("is retired with RECIPE_UNSUPPORTED when the retained predecessor never declared the recipe", () => {
    const pin = {
      analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
      datasetPackageIdentity: RETAINED_DATASET_PACKAGE_IDENTITY,
    };
    const manifestWithLegacyPredecessor = {
      ...manifest,
      deploymentWindow: [
        ...manifest.deploymentWindow,
        {
          analysisBuildId: RETAINED_ANALYSIS_BUILD_ID,
          recommendation: { ...retainedRecommendation, supplierCompetition: null },
          baciRelease: "V202501",
          artifactSha256: "e".repeat(64),
        },
      ],
    };
    expect(
      resolvePinnedContext(
        pin,
        manifestWithLegacyPredecessor,
        "supplier-competition",
      ),
    ).toEqual({ state: "retired", pin, reason: "RECIPE_UNSUPPORTED" });
  });

  it("is retired with BUILD_MISMATCH when the pin names neither current nor any retained predecessor", () => {
    const pin = {
      analysisBuildId: "never-retained-build",
      datasetPackageIdentity: RETAINED_DATASET_PACKAGE_IDENTITY,
    };
    expect(
      resolvePinnedContext(
        pin,
        manifestWithRetainedPredecessor,
        "candidate-market",
      ),
    ).toEqual({ state: "retired", pin, reason: "BUILD_MISMATCH" });
  });
});

describe("Trade Analysis Context: trade-explorer", () => {
  it("defaults an empty location to an incomplete trade-explorer context when explicitly requested", () => {
    expect(
      parseTradeAnalysisContext("/?recipe=trade-explorer-v1"),
    ).toEqual({
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: null,
      measures: [],
      years: [],
      exportEconomy: [],
      importEconomy: [],
      hsProduct: [],
      sort: null,
    });
  });

  it("parses the exact versioned recipe identity to the trade-explorer recipe", () => {
    expect(
      parseTradeAnalysisContext("/?recipe=trade-explorer-v1").recipe,
    ).toBe("trade-explorer");
  });

  it("round-trips a complete finalized-trend-v1 selection through parse/serialize", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      years: [],
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
      sort: { key: "YEAR", direction: "asc" },
    };
    const url = serializeTradeAnalysisContext("/", context);
    expect(parseTradeAnalysisContext(url)).toEqual(context);
  });

  it("round-trips a bounded cohort selection with an explicit year list and a measure sort", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "zh-Hans",
      pin: null,
      shape: "importing-markets-v1",
      measures: ["TRADE_VALUE_USD"],
      years: [2023],
      exportEconomy: ["156"],
      importEconomy: ["36", "484", "528"],
      hsProduct: ["010121"],
      sort: { key: "TRADE_VALUE_USD", direction: "desc" },
    };
    const url = serializeTradeAnalysisContext("/", context);
    expect(parseTradeAnalysisContext(url)).toEqual(context);
  });

  it("serializes equivalent Trade Explorer inputs to one normalized canonical URL", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: "importing-markets-v1",
      measures: ["RECORDED_FLOW_COUNT", "TRADE_VALUE_USD"],
      years: [2023, 2023],
      exportEconomy: ["156"],
      importEconomy: ["528", "036", "484", "528"],
      hsProduct: ["010129", "010121", "010129"],
      sort: { key: "TRADE_VALUE_USD", direction: "desc" },
    };
    expect(serializeTradeAnalysisContext("/", context)).toBe(
      "/?recipe=trade-explorer-v1&shape=importing-markets-v1&measures=TRADE_VALUE_USD%2CRECORDED_FLOW_COUNT&years=2023&exportEconomy=156&importEconomy=36%2C484%2C528&hsProduct=010121%2C010129&sortKey=TRADE_VALUE_USD&sortDirection=desc",
    );
  });

  it("reflects in-progress selection: a chosen shape survives with no codes selected yet", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: "importing-markets-v1",
      measures: [],
      years: [],
      exportEconomy: [],
      importEconomy: [],
      hsProduct: [],
      sort: null,
    };
    const url = serializeTradeAnalysisContext("/", context);
    expect(url).toContain("recipe=trade-explorer-v1");
    expect(url).toContain("shape=importing-markets-v1");
    expect(parseTradeAnalysisContext(url)).toEqual(context);
  });

  it("never encodes an opaque JSON or base64 blob -- only named semantic parameters", () => {
    const context: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: "product-mix-v1",
      measures: ["TRADE_VALUE_USD"],
      years: [2023],
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121", "010129"],
      sort: null,
    };
    const url = new URL(
      serializeTradeAnalysisContext("/", context),
      "http://localhost",
    );
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        "recipe",
        "shape",
        "measures",
        "years",
        "exportEconomy",
        "importEconomy",
        "hsProduct",
      ].sort(),
    );
    for (const value of url.searchParams.values()) {
      expect(value).not.toMatch(/[{}[\]]/u);
    }
  });

  it("discards an unrecognized shape and every malformed code list", () => {
    const context = parseTradeAnalysisContext(
      "/?recipe=trade-explorer-v1&shape=unknown-shape-v1&measures=DROP_TABLE&exportEconomy=not-a-code&importEconomy=528,076&hsProduct=abc",
    );
    expect(context).toMatchObject({
      shape: null,
      measures: [],
      exportEconomy: [],
      hsProduct: [],
    });
    // A well-formed sibling list still parses even when another field is
    // malformed -- each field is validated independently.
    expect(context).toMatchObject({ importEconomy: ["528", "076"] });
  });

  it("discards a sort key that is not the grouped dimension or a requested measure", () => {
    const context = parseTradeAnalysisContext(
      "/?recipe=trade-explorer-v1&shape=importing-markets-v1&measures=TRADE_VALUE_USD&sortKey=DROP_TABLE&sortDirection=asc",
    );
    expect(context).toMatchObject({ sort: null });
  });

  it("is complete only once shape, measures, and all three code lists are non-empty", () => {
    const empty = emptyTradeAnalysisContext("trade-explorer", "en");
    expect(hasCompleteRecipeInputs(empty)).toBe(false);
    const complete = {
      ...empty,
      shape: "finalized-trend-v1" as const,
      measures: ["TRADE_VALUE_USD"] as const,
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
    };
    expect(hasCompleteRecipeInputs(complete)).toBe(true);
  });

  it("transfers compatible economy and product selections to and from trade-explorer", () => {
    const tradeTrend = withEconomyCode(
      withProductCode(emptyTradeAnalysisContext("trade-trend", "en"), "010121"),
      "528",
    );
    expect(withRecipe(tradeTrend, "trade-explorer")).toEqual({
      ...emptyTradeAnalysisContext("trade-explorer", "en"),
      importEconomy: ["528"],
      hsProduct: ["010121"],
    });

    const explorer: TradeAnalysisContext = {
      recipe: "trade-explorer",
      locale: "en",
      pin: null,
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD"],
      years: [],
      exportEconomy: ["156"],
      importEconomy: ["528"],
      hsProduct: ["010121"],
      sort: null,
    };
    expect(withRecipe(explorer, "trade-trend")).toEqual({
      ...emptyTradeAnalysisContext("trade-trend", "en"),
      productCode: "010121",
      importerCode: "528",
    });
    expect(withRecipe(explorer, "candidate-market")).toEqual({
      ...emptyTradeAnalysisContext("candidate-market", "en"),
      productCode: "010121",
      exporterCode: "156",
    });
  });

  it("throws when withEconomyCode or withProductCode is misapplied to a trade-explorer context", () => {
    const explorer = emptyTradeAnalysisContext("trade-explorer", "en");
    expect(() => withEconomyCode(explorer, "528")).toThrow(TypeError);
    expect(() => withProductCode(explorer, "010121")).toThrow(TypeError);
    expect(() => economyCodeOf(explorer)).toThrow(TypeError);
    expect(() => productCodeOf(explorer)).toThrow(TypeError);
  });

  it("resolves the current pin from the manifest's own tradeExplorer recommendation", () => {
    const pin = pinFromManifest(manifest, "trade-explorer");
    expect(pin).toEqual({
      analysisBuildId: manifest.analysisBuildId,
      datasetPackageIdentity:
        manifest.recommendation.tradeExplorer!.datasetPackageIdentity,
    });
    expect(resolvePinnedContext(pin, manifest, "trade-explorer")).toEqual({
      state: "current",
      pin,
    });
  });

  it("is retired with RECIPE_UNSUPPORTED when the manifest no longer declares trade-explorer", () => {
    const unsupported = {
      ...manifest,
      recommendation: { ...manifest.recommendation, tradeExplorer: null },
    };
    const pin = pinFromManifest(manifest, "trade-explorer")!;
    expect(
      resolvePinnedContext(pin, unsupported, "trade-explorer"),
    ).toEqual({ state: "retired", pin, reason: "RECIPE_UNSUPPORTED" });
  });
});
