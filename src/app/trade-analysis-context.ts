// The single canonical seam for Trade Analysis Context URLs. It owns
// canonical query-parameter names, their order, locale and legacy-input
// normalization, recipe-scoped transitions, pin-vs-current resolution, and
// applying a current manifest pin, for Opportunity Discovery, Candidate
// Market, Trade Trend, Supplier Competition, and Trade Explorer. Every task workspace,
// combobox, task shell, and share link goes through this module rather
// than reading or writing `URLSearchParams` directly, or hand-constructing
// a `TradeAnalysisContext` object, so canonical URL rules and the
// context's own shape/invariants exist exactly once. It is pure: it never
// touches `window`, `document`, or `history` itself, which keeps it fully
// unit-testable and leaves the actual browser side effects to its "use
// client" callers.
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { tradeExplorerShapeDefinition } from "../domain/trade-explorer/shapes";
import {
  TRADE_EXPLORER_MAX_FILTER_CODES,
  TRADE_EXPLORER_MAX_YEARS,
  TRADE_EXPLORER_MEASURE_ORDER,
  type TradeExplorerMeasure,
  type TradeExplorerShape,
  type TradeExplorerSort,
} from "../domain/trade-explorer/result";

export type TradeAnalysisLocale = "en" | "zh-Hans";
export type TradeAnalysisRecipe =
  | "opportunity-discovery"
  | "candidate-market"
  | "trade-trend"
  | "supplier-competition"
  | "trade-explorer";

// The exact versioned Analysis Recipe identity the canonical `recipe` URL
// parameter carries — the same literal strings `CurrentAnalysisManifest`'s
// recommendation record uses (see domain/release/current-analysis.ts) — so
// a canonical link names precisely the recipe version it reproduces, not
// just an unversioned task alias.
export type TradeAnalysisRecipeIdentity =
  | "opportunity-discovery-v1"
  | "candidate-market-v1"
  | "trade-trend-v1"
  | "supplier-competition-v1"
  | "trade-explorer-v1";

const DEFAULT_LOCALE: TradeAnalysisLocale = "en";
const DEFAULT_RECIPE: TradeAnalysisRecipe = "opportunity-discovery";

// Matches the analysisBuildId format already validated by every recipe
// request (see e.g. candidate-market-v1-request.ts) so a pinned build
// carried through the URL is held to the same shape as the server accepts.
const ANALYSIS_BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/iu;
const DATASET_PACKAGE_IDENTITY_PATTERN =
  /^dataset-package-v1-[0-9a-f]{64}$/u;
const ECONOMY_CODE_PATTERN = /^\d{1,3}$/u;
const PRODUCT_CODE_PATTERN = /^\d{6}$/u;
const OPPORTUNITY_MAX_PRODUCT_CODES = 20;

const RECIPE_IDENTITY: Readonly<
  Record<TradeAnalysisRecipe, TradeAnalysisRecipeIdentity>
> = {
  "opportunity-discovery": "opportunity-discovery-v1",
  "candidate-market": "candidate-market-v1",
  "trade-trend": "trade-trend-v1",
  "supplier-competition": "supplier-competition-v1",
  "trade-explorer": "trade-explorer-v1",
};

const RECIPE_BY_IDENTITY: Readonly<
  Record<TradeAnalysisRecipeIdentity, TradeAnalysisRecipe>
> = {
  "opportunity-discovery-v1": "opportunity-discovery",
  "candidate-market-v1": "candidate-market",
  "trade-trend-v1": "trade-trend",
  "supplier-competition-v1": "supplier-competition",
  "trade-explorer-v1": "trade-explorer",
};

// Pre-recipe-identity links only ever named Trade Trend and Supplier
// Competition this way (Candidate Market, the default, never had a task
// alias). Parsing still accepts them for backward compatibility, but
// reserialization always upgrades to the exact versioned `recipe`
// identity above; see parseRecipe. Trade Explorer is new in issue #46 and
// never had a pre-recipe-identity alias, so it is deliberately absent
// here.
const LEGACY_TASK_RECIPE: Readonly<Record<string, TradeAnalysisRecipe>> = {
  "trade-trend": "trade-trend",
  "supplier-competition": "supplier-competition",
};

// The recipes that share Trade Trend/Supplier Competition's single
// importer + HS12-product shape, used by withRecipe below to decide
// whether switching recipes can carry that shape forward. Trade Explorer
// and Candidate Market are both excluded: Trade Explorer's shape has no
// single importer/product field at all, so switching into or out of it
// always starts from empty inputs.
const IMPORTER_SHAPED_RECIPES: ReadonlySet<TradeAnalysisRecipe> = new Set([
  "trade-trend",
  "supplier-competition",
]);

export type TradeAnalysisContextPin = Readonly<{
  analysisBuildId: string;
  datasetPackageIdentity: string;
}>;

type BaseContextFields = Readonly<{
  locale: TradeAnalysisLocale;
  productCode: string | null;
  pin: TradeAnalysisContextPin | null;
}>;

export type CandidateMarketContext = BaseContextFields &
  Readonly<{
    recipe: "candidate-market";
    exporterCode: string | null;
    // Adjacent-context focus only: it never participates in Candidate
    // Market Analysis Identity (see CONTEXT.md, "Candidate Market
    // Context").
    focusedMarketCode: string | null;
  }>;

export type OpportunityDiscoveryContext = Readonly<{
  recipe: "opportunity-discovery";
  locale: TradeAnalysisLocale;
  pin: TradeAnalysisContextPin | null;
  exportEconomyCode: string | null;
  productCodes: readonly string[] | null;
  focusProductCode?: string | null;
  focusedMarketCode?: string | null;
  portfolioFilter?: boolean | null;
}>;

export type TradeTrendContext = BaseContextFields &
  Readonly<{
    recipe: "trade-trend";
    importerCode: string | null;
  }>;

export type SupplierCompetitionContext = BaseContextFields &
  Readonly<{
    recipe: "supplier-competition";
    importerCode: string | null;
  }>;

// Trade Explorer has no single economy/product field pair, so it does not
// extend BaseContextFields: it carries its own bounded, ordered lists
// (never a generic key/value map) plus an optional sort, each field
// independently present or absent so the canonical URL can reflect
// in-progress selection exactly like the other tasks' incremental
// economy/product selection. `shape` alone is nullable; every list
// defaults to `[]` and `sort` to `null` when unset.
export type TradeExplorerContext = Readonly<{
  recipe: "trade-explorer";
  locale: TradeAnalysisLocale;
  pin: TradeAnalysisContextPin | null;
  shape: TradeExplorerShape | null;
  measures: readonly TradeExplorerMeasure[];
  years: readonly number[];
  exportEconomy: readonly string[];
  importEconomy: readonly string[];
  hsProduct: readonly string[];
  sort: TradeExplorerSort | null;
}>;

export type TradeAnalysisContext =
  | OpportunityDiscoveryContext
  | CandidateMarketContext
  | TradeTrendContext
  | SupplierCompetitionContext
  | TradeExplorerContext;

export type PinRetiredReason =
  | "BUILD_MISMATCH"
  | "PACKAGE_MISMATCH"
  | "RECIPE_UNSUPPORTED";

export type PinResolution =
  | Readonly<{ state: "unpinned" }>
  | Readonly<{ state: "current"; pin: TradeAnalysisContextPin }>
  // Within the retained retention window (an older but still-served
  // deployment pairing): the pin reproduces its exact Analysis Identity,
  // distinct from "current" so callers can label it explicitly rather
  // than presenting it as today's live recommendation (see CONTEXT.md
  // "Pinned"/"Current" and issue #44).
  | Readonly<{
      state: "retained";
      pin: TradeAnalysisContextPin;
      deployment: CurrentAnalysisManifest["deploymentWindow"][number];
    }>
  | Readonly<{
      state: "retired";
      pin: TradeAnalysisContextPin;
      reason: PinRetiredReason;
    }>;

/**
 * Compares a URL-carried pin against the current manifest for `recipe`
 * without ever fabricating or silently rewriting it. A missing pin is
 * "unpinned" (legacy or not-yet-executed); a pin that already matches the
 * current recommendation is "current"; a pin whose analysisBuildId names
 * one of the manifest's own retained predecessors (see
 * `CurrentAnalysisManifest.deploymentWindow`) and matches that
 * predecessor's own recipe/package identity is "retained" and still
 * executes; any other pin is "retired" and must not be executed against
 * current or retained data.
 */
export function resolvePinnedContext(
  pin: TradeAnalysisContextPin | null,
  manifest: CurrentAnalysisManifest,
  recipe: TradeAnalysisRecipe,
): PinResolution {
  if (pin === null) {
    return { state: "unpinned" };
  }
  if (pin.analysisBuildId === manifest.analysisBuildId) {
    const expectedPackageIdentity = recipeDatasetPackageIdentity(manifest, recipe);
    if (expectedPackageIdentity === null) {
      return { state: "retired", pin, reason: "RECIPE_UNSUPPORTED" };
    }
    return pin.datasetPackageIdentity === expectedPackageIdentity
      ? { state: "current", pin }
      : { state: "retired", pin, reason: "PACKAGE_MISMATCH" };
  }
  const retained = manifest.deploymentWindow.find(
    (candidate) => candidate.analysisBuildId === pin.analysisBuildId,
  );
  if (retained === undefined) {
    return { state: "retired", pin, reason: "BUILD_MISMATCH" };
  }
  const retainedPackageIdentity = recipeDatasetPackageIdentityFromRecommendation(
    retained.recommendation,
    recipe,
  );
  if (retainedPackageIdentity === null) {
    return { state: "retired", pin, reason: "RECIPE_UNSUPPORTED" };
  }
  return retainedPackageIdentity === pin.datasetPackageIdentity
    ? { state: "retained", pin, deployment: retained }
    : { state: "retired", pin, reason: "PACKAGE_MISMATCH" };
}

function recipeDatasetPackageIdentity(
  manifest: CurrentAnalysisManifest,
  recipe: TradeAnalysisRecipe,
): string | null {
  return recipeDatasetPackageIdentityFromRecommendation(
    manifest.recommendation,
    recipe,
  );
}

function recipeDatasetPackageIdentityFromRecommendation(
  recommendation: CurrentAnalysisManifest["recommendation"],
  recipe: TradeAnalysisRecipe,
): string | null {
  if (recipe === "candidate-market") {
    return recommendation.datasetPackageIdentity;
  }
  if (recipe === "trade-trend") {
    return recommendation.tradeTrend?.datasetPackageIdentity ?? null;
  }
  if (recipe === "supplier-competition") {
    return recommendation.supplierCompetition?.datasetPackageIdentity ?? null;
  }
  if (recipe === "opportunity-discovery") {
    return recommendation.opportunityDiscovery?.datasetPackageIdentity ?? null;
  }
  return recommendation.tradeExplorer?.datasetPackageIdentity ?? null;
}

/**
 * Parses a location's query string into a fully recipe-scoped, validated
 * Trade Analysis Context. Fields the target recipe does not consume are
 * structurally absent rather than silently carried forward, and malformed
 * or legacy-shaped inputs normalize to `null` instead of propagating.
 */
export function parseTradeAnalysisContext(
  location: string | URL,
): TradeAnalysisContext {
  const params = toURL(location).searchParams;
  const recipe = parseRecipe(params.get("recipe"), params.get("task"), params);
  const locale = parseLocale(params.get("locale"));
  const pin = parsePin(params.get("build"), params.get("pkg"));

  if (recipe === "trade-explorer") {
    return {
      recipe,
      locale,
      pin,
      ...parseTradeExplorerFields(params),
    };
  }

  if (recipe === "opportunity-discovery") {
    const focusProductCode = parseProductCode("HS12", params.get("focusProduct"));
    const focusedMarketCode = parseEconomyCode(params.get("market"));
    const portfolioFilter = params.get("portfolio") === "filter";
    return {
      recipe,
      locale,
      pin,
      exportEconomyCode: parseEconomyCode(params.get("exporter")),
      productCodes: parseOpportunityProductCodes(params),
      ...(focusProductCode !== null || focusedMarketCode !== null
        ? { focusProductCode, focusedMarketCode }
        : {}),
      ...(portfolioFilter ? { portfolioFilter } : {}),
    };
  }

  const productCode = parseProductCode(
    params.get("revision"),
    params.get("product"),
  );

  if (recipe === "candidate-market") {
    return {
      recipe,
      locale,
      productCode,
      pin,
      exporterCode: parseEconomyCode(params.get("exporter")),
      focusedMarketCode: parseEconomyCode(params.get("market")),
    };
  }
  return {
    recipe,
    locale,
    productCode,
    pin,
    importerCode: parseEconomyCode(params.get("importer")),
  };
}

/**
 * Builds the canonical href for a Trade Analysis Context: deterministic
 * parameter order and default-value omission for an entirely empty,
 * unpinned, default-recipe (opportunity-discovery) context with no meaningful
 * change yet — that one case alone may stay a bare pathname.
 *
 * Locale is independently canonical: it is observable as soon as it is
 * non-default, regardless of whether the recipe's own inputs are complete,
 * so a locale choice on a bare landing page or mid-selection is never lost
 * to reload, copy, or browser back/forward. Only the default locale ("en")
 * is omitted, because parsing deterministically defaults to it.
 *
 * The exact versioned Analysis Recipe identity (`recipe=`) is likewise
 * observable — deterministically first when present — whenever the recipe
 * is non-default, once its own inputs are complete, or once it is pinned,
 * so a non-default task selection persists even before its inputs are
 * complete, and every complete or pinned analytical link names precisely
 * the recipe version it reproduces rather than only an unversioned task
 * alias.
 */
export function serializeTradeAnalysisContext(
  location: string | URL,
  context: TradeAnalysisContext,
): string {
  const url = toURL(location);
  const params = new URLSearchParams();
  const isComplete = hasCompleteRecipeInputs(context);
  if (context.recipe !== DEFAULT_RECIPE || isComplete || context.pin !== null) {
    params.set("recipe", RECIPE_IDENTITY[context.recipe]);
  }

  if (context.locale !== DEFAULT_LOCALE) {
    params.set("locale", context.locale);
  }

  if (context.recipe === "trade-explorer") {
    appendTradeExplorerFields(params, context);
  } else if (context.recipe === "opportunity-discovery") {
    if (context.exportEconomyCode !== null) {
      params.set("exporter", context.exportEconomyCode);
    }
    const productCodes = canonicalProductCodes(context.productCodes ?? []);
    if (productCodes.length > 0) {
      params.set("products", productCodes.join(","));
    }
    if (context.focusProductCode != null) {
      params.set("focusProduct", context.focusProductCode);
    }
    if (context.focusedMarketCode != null) {
      params.set("market", context.focusedMarketCode);
    }
    if (context.portfolioFilter === true) {
      params.set("portfolio", "filter");
    }
  } else {
    const economyCode = economyCodeOf(context);
    if (economyCode !== null) {
      params.set(economyParamName(context.recipe), economyCode);
    }
    if (context.productCode !== null) {
      params.set("revision", "HS12");
      params.set("product", context.productCode);
    }
    if (context.recipe === "candidate-market" && context.focusedMarketCode !== null) {
      params.set("market", context.focusedMarketCode);
    }
  }

  if (context.pin !== null) {
    params.set("build", context.pin.analysisBuildId);
    params.set("pkg", context.pin.datasetPackageIdentity);
  }

  const query = params.toString();
  return `${url.pathname}${query === "" ? "" : `?${query}`}`;
}

/** A fresh context for `recipe` with no selected inputs, focus, or pin. */
export function emptyTradeAnalysisContext(
  recipe: TradeAnalysisRecipe,
  locale: TradeAnalysisLocale,
): TradeAnalysisContext {
  if (recipe === "opportunity-discovery") {
    return emptyOpportunityDiscoveryContext(locale);
  }
  if (recipe === "candidate-market") {
    return {
      recipe,
      locale,
      productCode: null,
      pin: null,
      exporterCode: null,
      focusedMarketCode: null,
    };
  }
  if (recipe === "trade-explorer") {
    return emptyTradeExplorerContext(locale);
  }
  return { recipe, locale, productCode: null, pin: null, importerCode: null };
}

function emptyOpportunityDiscoveryContext(
  locale: TradeAnalysisLocale,
): OpportunityDiscoveryContext {
  return {
    recipe: "opportunity-discovery",
    locale,
    pin: null,
    exportEconomyCode: null,
    productCodes: null,
  };
}

function emptyTradeExplorerContext(
  locale: TradeAnalysisLocale,
): TradeExplorerContext {
  return {
    recipe: "trade-explorer",
    locale,
    pin: null,
    shape: null,
    measures: [],
    years: [],
    exportEconomy: [],
    importEconomy: [],
    hsProduct: [],
    sort: null,
  };
}

/** True once the recipe's own canonical inputs are both present. */
export function hasCompleteRecipeInputs(context: TradeAnalysisContext): boolean {
  if (context.recipe === "opportunity-discovery") {
    return context.exportEconomyCode !== null;
  }
  if (context.recipe === "trade-explorer") {
    return (
      context.shape !== null &&
      context.measures.length > 0 &&
      context.exportEconomy.length > 0 &&
      context.importEconomy.length > 0 &&
      context.hsProduct.length > 0
    );
  }
  return economyCodeOf(context) !== null && context.productCode !== null;
}

/**
 * Transitions `context` to `recipe`, always discarding the pin (a recipe
 * change invalidates it). Compatible single economy and product selections
 * carry across recipes. Trade Explorer receives a candidate-market exporter
 * or an importer-shaped recipe's importer in the matching dimension; it
 * transfers a dimension back only when that dimension has exactly one value.
 */
export function withRecipe(
  context: TradeAnalysisContext,
  recipe: TradeAnalysisRecipe,
): TradeAnalysisContext {
  if (context.recipe === recipe) {
    return context;
  }
  if (recipe === "opportunity-discovery") {
    const opportunity = emptyOpportunityDiscoveryContext(context.locale);
    if (context.recipe === "candidate-market") {
      return {
        ...opportunity,
        exportEconomyCode: context.exporterCode,
        productCodes:
          context.productCode === null ? null : [context.productCode],
      };
    }
    if (context.recipe === "trade-explorer") {
      return {
        ...opportunity,
        exportEconomyCode:
          context.exportEconomy.length === 1
            ? context.exportEconomy[0]!
            : null,
        productCodes: context.hsProduct.length === 0 ? null : context.hsProduct,
      };
    }
    if (context.recipe === "trade-trend" || context.recipe === "supplier-competition") {
      return {
        ...opportunity,
        productCodes:
          context.productCode === null ? null : [context.productCode],
      };
    }
    return opportunity;
  }
  if (context.recipe === "opportunity-discovery") {
    const productCode =
      context.productCodes !== null && context.productCodes.length === 1
        ? context.productCodes[0]!
        : null;
    if (recipe === "candidate-market") {
      return {
        recipe: "candidate-market",
        locale: context.locale,
        pin: null,
        exporterCode: context.exportEconomyCode,
        productCode,
        focusedMarketCode: null,
      };
    }
    if (recipe === "trade-explorer") {
      return {
        ...emptyTradeExplorerContext(context.locale),
        exportEconomy:
          context.exportEconomyCode === null ? [] : [context.exportEconomyCode],
        hsProduct: context.productCodes ?? [],
      };
    }
    return {
      ...emptyTradeAnalysisContext(recipe, context.locale),
      productCode,
    } as TradeTrendContext | SupplierCompetitionContext;
  }
  const sharesImporterShape =
    IMPORTER_SHAPED_RECIPES.has(context.recipe) &&
    IMPORTER_SHAPED_RECIPES.has(recipe);
  if (sharesImporterShape) {
    return {
      recipe: recipe as "trade-trend" | "supplier-competition",
      locale: context.locale,
      productCode: (context as TradeTrendContext | SupplierCompetitionContext)
        .productCode,
      pin: null,
      importerCode: (context as TradeTrendContext | SupplierCompetitionContext)
        .importerCode,
    };
  }
  if (recipe === "trade-explorer") {
    const explorer = emptyTradeExplorerContext(context.locale);
    if (context.recipe === "candidate-market") {
      return {
        ...explorer,
        exportEconomy:
          context.exporterCode === null ? [] : [context.exporterCode],
        hsProduct:
          context.productCode === null ? [] : [context.productCode],
      };
    }
    if (context.recipe !== "trade-explorer") {
      return {
        ...explorer,
        importEconomy:
          context.importerCode === null ? [] : [context.importerCode],
        hsProduct:
          context.productCode === null ? [] : [context.productCode],
      };
    }
  }
  if (context.recipe === "trade-explorer") {
    const single = emptyTradeAnalysisContext(recipe, context.locale);
    const productCode =
      context.hsProduct.length === 1 ? context.hsProduct[0]! : null;
    if (recipe === "candidate-market") {
      return {
        ...single,
        productCode,
        exporterCode:
          context.exportEconomy.length === 1
            ? context.exportEconomy[0]!
            : null,
      } as CandidateMarketContext;
    }
    return {
      ...single,
      productCode,
      importerCode:
        context.importEconomy.length === 1
          ? context.importEconomy[0]!
          : null,
    } as TradeTrendContext | SupplierCompetitionContext;
  }
  return emptyTradeAnalysisContext(recipe, context.locale);
}

export type AdvancedToolRecipe =
  | "trade-trend"
  | "supplier-competition"
  | "trade-explorer";

export function withAdvancedToolRecipe(
  context: TradeAnalysisContext,
  recipe: AdvancedToolRecipe,
): TradeTrendContext | SupplierCompetitionContext | TradeExplorerContext {
  const transitioned = withRecipe(context, recipe);
  if (recipe === "trade-explorer") {
    if (transitioned.recipe !== "trade-explorer") {
      throw new TypeError("Trade Explorer transition produced the wrong context.");
    }
    const focused = focusedProductMarket(context);
    return {
      ...transitioned,
      pin: context.pin,
      importEconomy:
        focused.marketCode === null
          ? transitioned.importEconomy
          : [focused.marketCode],
      hsProduct:
        focused.productCode === null
          ? transitioned.hsProduct
          : [focused.productCode],
    };
  }
  if (
    transitioned.recipe !== "trade-trend" &&
    transitioned.recipe !== "supplier-competition"
  ) {
    throw new TypeError("Advanced evidence transition produced the wrong context.");
  }
  const focused = focusedProductMarket(context);
  return {
    ...transitioned,
    pin: context.pin,
    productCode: focused.productCode ?? transitioned.productCode,
    importerCode: focused.marketCode ?? transitioned.importerCode,
  };
}

function focusedProductMarket(context: TradeAnalysisContext): Readonly<{
  productCode: string | null;
  marketCode: string | null;
}> {
  switch (context.recipe) {
    case "candidate-market":
      return {
        productCode: context.productCode,
        marketCode: context.focusedMarketCode,
      };
    case "opportunity-discovery":
      return {
        productCode:
          context.focusProductCode ??
          (context.productCodes?.length === 1 ? context.productCodes[0]! : null),
        marketCode: context.focusedMarketCode ?? null,
      };
    case "trade-trend":
    case "supplier-competition":
      return {
        productCode: context.productCode,
        marketCode: context.importerCode,
      };
    case "trade-explorer":
      return {
        productCode:
          context.hsProduct.length === 1 ? context.hsProduct[0]! : null,
        marketCode:
          context.importEconomy.length === 1
            ? context.importEconomy[0]!
            : null,
      };
  }
}

/** Returns `context` with its pin explicitly discarded. */
export function withoutPin(context: TradeAnalysisContext): TradeAnalysisContext {
  return { ...context, pin: null };
}

/** Recipes carrying BaseContextFields' single economy/product shape --
 * every recipe except Trade Explorer, whose own shape has no such single
 * field (see TradeExplorerContext). `withEconomyCode`/`withProductCode`/
 * `economyCodeOf` are only ever called by the shared EconomyCombobox/
 * ProductCombobox components, which Trade Explorer's workspace does not
 * use for its own bounded per-dimension code-list fields; calling them
 * with a Trade Explorer context is a caller defect, not an expected
 * input, so they throw rather than silently reshaping it. */
export type SingleEconomyContext =
  | OpportunityDiscoveryContext
  | CandidateMarketContext
  | TradeTrendContext
  | SupplierCompetitionContext;

function asSingleEconomyContext(
  context: TradeAnalysisContext,
): SingleEconomyContext {
  if (context.recipe === "trade-explorer") {
    throw new TypeError(
      "Trade Explorer's Trade Analysis Context has no single economy/product field.",
    );
  }
  return context;
}

/** Returns `context` with its own economy code field (exporter or
 * importer, whichever the recipe consumes) set to `code`. */
export function withEconomyCode(
  context: TradeAnalysisContext,
  code: string | null,
): TradeAnalysisContext {
  const single = asSingleEconomyContext(context);
  if (single.recipe === "opportunity-discovery") {
    return { ...withoutOpportunityFocus(single), exportEconomyCode: code };
  }
  return single.recipe === "candidate-market"
    ? { ...single, exporterCode: code }
    : { ...single, importerCode: code };
}

/** Returns `context` with its product code field set to `code`. */
export function withProductCode(
  context: TradeAnalysisContext,
  code: string | null,
): TradeAnalysisContext {
  const single = asSingleEconomyContext(context);
  if (single.recipe === "opportunity-discovery") {
    return {
      ...withoutOpportunityFocus(single),
      productCodes: code === null ? null : [code],
    };
  }
  return { ...single, productCode: code };
}

/** Returns `context` relabeled to `locale`; the Analysis Identity it may
 * already carry through `pin` is untouched, since locale never changes
 * analytical meaning. */
export function withLocale(
  context: TradeAnalysisContext,
  locale: TradeAnalysisLocale,
): TradeAnalysisContext {
  return { ...context, locale };
}

/**
 * The pin a fresh execution of `recipe` would carry under the current
 * Recommended Dataset Mapping, or `null` when the current manifest does
 * not support `recipe` at all.
 */
export function pinFromManifest(
  manifest: CurrentAnalysisManifest,
  recipe: TradeAnalysisRecipe,
): TradeAnalysisContextPin | null {
  const datasetPackageIdentity = recipeDatasetPackageIdentity(manifest, recipe);
  if (datasetPackageIdentity === null) {
    return null;
  }
  return { analysisBuildId: manifest.analysisBuildId, datasetPackageIdentity };
}

/**
 * Returns the recipe-specific pin for one exact current or retained
 * deployment-window entry. An absent build or an undeclared recipe remains
 * unpinned rather than falling forward to a different deployment.
 */
export function pinFromDeploymentWindow(
  manifest: CurrentAnalysisManifest,
  analysisBuildId: string,
  recipe: TradeAnalysisRecipe,
): TradeAnalysisContextPin | null {
  const deployment = manifest.deploymentWindow.find(
    (entry) => entry.analysisBuildId === analysisBuildId,
  );
  if (deployment === undefined) {
    return null;
  }
  const datasetPackageIdentity =
    recipeDatasetPackageIdentityFromRecommendation(
      deployment.recommendation,
      recipe,
    );
  return datasetPackageIdentity === null
    ? null
    : { analysisBuildId, datasetPackageIdentity };
}

/**
 * Returns `context` with the pin a fresh execution would carry under
 * `manifest`'s current Recommended Dataset Mapping — `context.recipe`'s
 * own analysis build and Dataset Package identity, or no pin at all when
 * the current manifest does not support that recipe. This is the one seam
 * through which a freshly executed analysis earns its pin: callers apply
 * it to whatever recipe context they already built (own economy code,
 * product code, and locale already set) instead of re-deriving the pin
 * shape by hand, so the module alone owns what a pin is and how it is
 * attached.
 */
export function withPin<T extends TradeAnalysisContext>(
  context: T,
  manifest: CurrentAnalysisManifest,
): T {
  return { ...context, pin: pinFromManifest(manifest, context.recipe) };
}

/** The recipe's own economy code (exporter for candidate-market, importer
 * for trade-trend and supplier-competition), independent of which field
 * name backs it. */
export function economyCodeOf(context: TradeAnalysisContext): string | null {
  const single = asSingleEconomyContext(context);
  if (single.recipe === "opportunity-discovery") {
    return single.exportEconomyCode;
  }
  return single.recipe === "candidate-market"
    ? single.exporterCode
    : single.importerCode;
}

/** The recipe's own single product code field, for the three recipes that
 * have one (see SingleEconomyContext); Trade Explorer's own product
 * cohort/filter codes are read directly from its own `hsProduct` field
 * instead. */
export function productCodeOf(context: TradeAnalysisContext): string | null {
  const single = asSingleEconomyContext(context);
  if (single.recipe === "opportunity-discovery") {
    return single.productCodes !== null && single.productCodes.length === 1
      ? single.productCodes[0]!
      : null;
  }
  return single.productCode;
}

function economyParamName(
  recipe: SingleEconomyContext["recipe"],
): "exporter" | "importer" {
  return recipe === "candidate-market" ? "exporter" : "importer";
}

function withoutOpportunityFocus(
  context: OpportunityDiscoveryContext,
): OpportunityDiscoveryContext {
  const next: {
    -readonly [Key in keyof OpportunityDiscoveryContext]: OpportunityDiscoveryContext[Key];
  } = { ...context };
  delete next.focusProductCode;
  delete next.focusedMarketCode;
  return next;
}

/**
 * Resolves the recipe from the exact versioned `recipe` identity when
 * present, deliberately never consulting the legacy `task` alias in that
 * case — an exact recipe always wins over a conflicting or redundant task,
 * and the unconsumed legacy field is discarded rather than merged. Only an
 * absent `recipe` falls back to a recognized `task`; an unrecognized exact
 * recipe defaults without consulting the legacy alias.
 */
function parseRecipe(
  recipeIdentity: string | null,
  legacyTask: string | null,
  params: URLSearchParams,
): TradeAnalysisRecipe {
  if (recipeIdentity !== null) {
    return (
      RECIPE_BY_IDENTITY[recipeIdentity as TradeAnalysisRecipeIdentity] ??
      DEFAULT_RECIPE
    );
  }
  if (legacyTask !== null) {
    return LEGACY_TASK_RECIPE[legacyTask] ?? DEFAULT_RECIPE;
  }
  if (hasLegacyCandidateMarketShape(params)) {
    return "candidate-market";
  }
  return DEFAULT_RECIPE;
}

function hasLegacyCandidateMarketShape(params: URLSearchParams): boolean {
  if (parseEconomyCode(params.get("market")) !== null) {
    return true;
  }
  return (
    parseEconomyCode(params.get("exporter")) !== null &&
    parseProductCode(params.get("revision"), params.get("product")) !== null
  );
}

function parseLocale(value: string | null): TradeAnalysisLocale {
  return value === "zh-Hans" ? "zh-Hans" : DEFAULT_LOCALE;
}

function parseEconomyCode(value: string | null): string | null {
  return value !== null && ECONOMY_CODE_PATTERN.test(value) ? value : null;
}

function parseProductCode(
  revision: string | null,
  product: string | null,
): string | null {
  return revision === "HS12" &&
    product !== null &&
    PRODUCT_CODE_PATTERN.test(product)
    ? product
    : null;
}

function parseOpportunityProductCodes(
  params: URLSearchParams,
): readonly string[] | null {
  const products = parseCodeList<string>(
    params.get("products"),
    PRODUCT_CODE_PATTERN.test.bind(PRODUCT_CODE_PATTERN),
    OPPORTUNITY_MAX_PRODUCT_CODES,
    6,
  );
  if (products.length > 0) {
    return products;
  }
  const productCode = parseProductCode(
    params.get("revision"),
    params.get("product"),
  );
  return productCode === null ? null : [productCode];
}

function parsePin(
  analysisBuildId: string | null,
  datasetPackageIdentity: string | null,
): TradeAnalysisContextPin | null {
  if (analysisBuildId === null || datasetPackageIdentity === null) {
    return null;
  }
  if (
    !ANALYSIS_BUILD_ID_PATTERN.test(analysisBuildId) ||
    !DATASET_PACKAGE_IDENTITY_PATTERN.test(datasetPackageIdentity)
  ) {
    return null;
  }
  return { analysisBuildId, datasetPackageIdentity };
}

// Trade Explorer's own canonical URL vocabulary intentionally reuses the
// exact param names the API route's own GET/HEAD query-string form uses
// (see domain/trade-analytics/trade-explorer-v1-query-codec.ts) -- shape,
// measures, years, exportEconomy, importEconomy, hsProduct, sortKey,
// sortDirection -- but parses each independently and tolerates partial
// presence, unlike that strict all-or-nothing codec: a Trade Explorer
// workspace's in-progress selection (e.g. shape chosen but no codes yet)
// must still round-trip through the URL, exactly like Trade Trend and
// Supplier Competition's importer/product fields already do one at a
// time. `dimensions` and `filters.year`'s range form are deliberately
// never parsed here; the workspace always writes years as an explicit
// list.
function parseTradeExplorerFields(
  params: URLSearchParams,
): Omit<TradeExplorerContext, "recipe" | "locale" | "pin"> {
  const shapeValue = params.get("shape");
  const shape =
    shapeValue !== null && tradeExplorerShapeDefinition(shapeValue) !== null
      ? (shapeValue as TradeExplorerShape)
      : null;
  const measures = parseCodeList<TradeExplorerMeasure>(
    params.get("measures"),
    (token): token is TradeExplorerMeasure =>
      TRADE_EXPLORER_MEASURE_ORDER.includes(token as TradeExplorerMeasure),
    TRADE_EXPLORER_MEASURE_ORDER.length,
    "RECORDED_FLOW_COUNT".length,
  );
  const years = parseCodeList<string>(
    params.get("years"),
    YEAR_PATTERN.test.bind(YEAR_PATTERN),
    TRADE_EXPLORER_MAX_YEARS,
    4,
  ).map(Number);
  const exportEconomy = parseCodeList<string>(
    params.get("exportEconomy"),
    ECONOMY_CODE_PATTERN.test.bind(ECONOMY_CODE_PATTERN),
    TRADE_EXPLORER_MAX_FILTER_CODES,
    3,
  );
  const importEconomy = parseCodeList<string>(
    params.get("importEconomy"),
    ECONOMY_CODE_PATTERN.test.bind(ECONOMY_CODE_PATTERN),
    TRADE_EXPLORER_MAX_FILTER_CODES,
    3,
  );
  const hsProduct = parseCodeList<string>(
    params.get("hsProduct"),
    PRODUCT_CODE_PATTERN.test.bind(PRODUCT_CODE_PATTERN),
    TRADE_EXPLORER_MAX_FILTER_CODES,
    6,
  );
  const sort = parseTradeExplorerSort(
    params.get("sortKey"),
    params.get("sortDirection"),
    shape,
    measures,
  );

  return {
    shape,
    measures,
    years,
    exportEconomy,
    importEconomy,
    hsProduct,
    sort,
  };
}

function parseCodeList<T extends string>(
  value: string | null,
  isValid: (token: string) => boolean,
  maxTokens: number,
  maxTokenLength: number,
): readonly T[] {
  if (value === null || value.length === 0) {
    return [];
  }
  if (value.length > maxTokens * maxTokenLength + (maxTokens - 1)) {
    return [];
  }
  const tokens = value.split(",");
  return tokens.length <= maxTokens && tokens.every(isValid)
    ? (tokens as unknown as readonly T[])
    : [];
}

function parseTradeExplorerSort(
  key: string | null,
  direction: string | null,
  shape: TradeExplorerShape | null,
  measures: readonly TradeExplorerMeasure[],
): TradeExplorerSort | null {
  if (key === null || direction === null || shape === null) {
    return null;
  }
  const definition = tradeExplorerShapeDefinition(shape);
  const allowedKeys: readonly string[] =
    definition === null ? measures : [definition.groupedDimension, ...measures];
  if (
    !allowedKeys.includes(key) ||
    (direction !== "asc" && direction !== "desc")
  ) {
    return null;
  }
  return { key: key as TradeExplorerSort["key"], direction };
}

function appendTradeExplorerFields(
  params: URLSearchParams,
  context: TradeExplorerContext,
): void {
  const measures = TRADE_EXPLORER_MEASURE_ORDER.filter((measure) =>
    context.measures.includes(measure),
  );
  const years = [...new Set(context.years)]
    .filter((year) => Number.isSafeInteger(year) && YEAR_PATTERN.test(String(year)))
    .sort((left, right) => left - right);
  const exportEconomy = canonicalEconomyCodes(context.exportEconomy);
  const importEconomy = canonicalEconomyCodes(context.importEconomy);
  const hsProduct = canonicalProductCodes(context.hsProduct);

  if (context.shape !== null) {
    params.set("shape", context.shape);
  }
  if (measures.length > 0) {
    params.set("measures", measures.join(","));
  }
  if (years.length > 0) {
    params.set("years", years.join(","));
  }
  if (exportEconomy.length > 0) {
    params.set("exportEconomy", exportEconomy.join(","));
  }
  if (importEconomy.length > 0) {
    params.set("importEconomy", importEconomy.join(","));
  }
  if (hsProduct.length > 0) {
    params.set("hsProduct", hsProduct.join(","));
  }
  if (
    context.sort !== null &&
    parseTradeExplorerSort(
      context.sort.key,
      context.sort.direction,
      context.shape,
      measures,
    ) !== null
  ) {
    params.set("sortKey", context.sort.key);
    params.set("sortDirection", context.sort.direction);
  }
}

function canonicalEconomyCodes(codes: readonly string[]): readonly string[] {
  return [...new Set(
    codes
      .filter((code) => ECONOMY_CODE_PATTERN.test(code))
      .map((code) => String(Number(code))),
  )].sort(compareSemanticCodes);
}

function canonicalProductCodes(codes: readonly string[]): readonly string[] {
  return [...new Set(
    codes.filter((code) => PRODUCT_CODE_PATTERN.test(code)),
  )].sort(compareSemanticCodes);
}

function compareSemanticCodes(left: string, right: string): number {
  return Number(left) - Number(right);
}

const YEAR_PATTERN = /^\d{4}$/u;

function toURL(location: string | URL): URL {
  if (location instanceof URL) {
    return location;
  }
  try {
    return new URL(location);
  } catch {
    return new URL(location, "http://localhost/");
  }
}
