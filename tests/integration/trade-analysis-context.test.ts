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
  pinFromManifest,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
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
  it("defaults an empty location to an incomplete candidate-market context", () => {
    expect(parseTradeAnalysisContext("/")).toEqual({
      recipe: "candidate-market",
      locale: "en",
      productCode: null,
      pin: null,
      exporterCode: null,
      focusedMarketCode: null,
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
    expect(context.recipe).toBe("candidate-market");
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
    expect(context.recipe).toBe("candidate-market");
    expect(context.locale).toBe("en");
  });

  it("discards a malformed economy code", () => {
    const context = parseTradeAnalysisContext("/?exporter=not-a-code");
    expect(context).toMatchObject({ exporterCode: null });
  });

  it("discards a product code when the revision is not HS12", () => {
    const context = parseTradeAnalysisContext(
      "/?revision=HS07&product=010121",
    );
    expect(context.productCode).toBeNull();
  });

  it("discards a malformed product code", () => {
    const context = parseTradeAnalysisContext(
      "/?revision=HS12&product=abcdef",
    );
    expect(context.productCode).toBeNull();
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
    expect(bare).toMatchObject({ recipe: "candidate-market", exporterCode: "156" });
    expect(full).toMatchObject({ recipe: "candidate-market", exporterCode: "156" });
  });
});

describe("Trade Analysis Context: serializing", () => {
  it("produces a bare pathname when the context is entirely empty", () => {
    const context = emptyTradeAnalysisContext("candidate-market", "en");
    expect(serializeTradeAnalysisContext("/", context)).toBe("/");
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
      "candidate-market",
      "zh-Hans",
    );
    expect(serializeTradeAnalysisContext("/", bare)).toBe(
      "/?locale=zh-Hans",
    );

    const partial: TradeAnalysisContext = {
      recipe: "candidate-market",
      locale: "zh-Hans",
      productCode: "010121",
      pin: null,
      exporterCode: null,
      focusedMarketCode: null,
    };
    expect(serializeTradeAnalysisContext("/", partial)).toBe(
      "/?locale=zh-Hans&revision=HS12&product=010121",
    );

    const complete: TradeAnalysisContext = { ...partial, exporterCode: "156" };
    expect(serializeTradeAnalysisContext("/", complete)).toBe(
      "/?recipe=candidate-market-v1&locale=zh-Hans&exporter=156&revision=HS12&product=010121",
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

  it("returns null when the current recommendation does not declare the recipe", () => {
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
});
