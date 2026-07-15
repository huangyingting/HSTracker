// The single canonical seam for Trade Analysis Context URLs. It owns
// canonical query-parameter names, their order, locale and legacy-input
// normalization, recipe-scoped transitions, pin-vs-current resolution, and
// applying a current manifest pin, for Candidate Market, Trade Trend, and
// Supplier Competition. Every task workspace, combobox, task shell, and
// share link goes through this module rather than reading or writing
// `URLSearchParams` directly, or hand-constructing a `TradeAnalysisContext`
// object, so canonical URL rules and the context's own shape/invariants
// exist exactly once. It is pure: it never touches `window`, `document`, or
// `history` itself, which keeps it fully unit-testable and leaves the
// actual browser side effects to its "use client" callers.
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";

export type TradeAnalysisLocale = "en" | "zh-Hans";
export type TradeAnalysisRecipe =
  | "candidate-market"
  | "trade-trend"
  | "supplier-competition";

// The exact versioned Analysis Recipe identity the canonical `recipe` URL
// parameter carries — the same literal strings `CurrentAnalysisManifest`'s
// recommendation record uses (see domain/release/current-analysis.ts) — so
// a canonical link names precisely the recipe version it reproduces, not
// just an unversioned task alias.
export type TradeAnalysisRecipeIdentity =
  | "candidate-market-v1"
  | "trade-trend-v1"
  | "supplier-competition-v1";

const DEFAULT_LOCALE: TradeAnalysisLocale = "en";
const DEFAULT_RECIPE: TradeAnalysisRecipe = "candidate-market";

// Matches the analysisBuildId format already validated by every recipe
// request (see e.g. candidate-market-v1-request.ts) so a pinned build
// carried through the URL is held to the same shape as the server accepts.
const ANALYSIS_BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/iu;
const DATASET_PACKAGE_IDENTITY_PATTERN =
  /^dataset-package-v1-[0-9a-f]{64}$/u;
const ECONOMY_CODE_PATTERN = /^\d{1,3}$/u;
const PRODUCT_CODE_PATTERN = /^\d{6}$/u;

const RECIPE_IDENTITY: Readonly<
  Record<TradeAnalysisRecipe, TradeAnalysisRecipeIdentity>
> = {
  "candidate-market": "candidate-market-v1",
  "trade-trend": "trade-trend-v1",
  "supplier-competition": "supplier-competition-v1",
};

const RECIPE_BY_IDENTITY: Readonly<
  Record<TradeAnalysisRecipeIdentity, TradeAnalysisRecipe>
> = {
  "candidate-market-v1": "candidate-market",
  "trade-trend-v1": "trade-trend",
  "supplier-competition-v1": "supplier-competition",
};

// Pre-recipe-identity links only ever named Trade Trend and Supplier
// Competition this way (Candidate Market, the default, never had a task
// alias). Parsing still accepts them for backward compatibility, but
// reserialization always upgrades to the exact versioned `recipe`
// identity above; see parseRecipe.
const LEGACY_TASK_RECIPE: Readonly<Record<string, TradeAnalysisRecipe>> = {
  "trade-trend": "trade-trend",
  "supplier-competition": "supplier-competition",
};

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

export type TradeAnalysisContext =
  | CandidateMarketContext
  | TradeTrendContext
  | SupplierCompetitionContext;

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
  return recommendation.supplierCompetition?.datasetPackageIdentity ?? null;
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
  const recipe = parseRecipe(params.get("recipe"), params.get("task"));
  const locale = parseLocale(params.get("locale"));
  const productCode = parseProductCode(
    params.get("revision"),
    params.get("product"),
  );
  const pin = parsePin(params.get("build"), params.get("pkg"));

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
 * unpinned, default-recipe (candidate-market) context with no meaningful
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
  return { recipe, locale, productCode: null, pin: null, importerCode: null };
}

/** True once the recipe's own canonical inputs are both present. */
export function hasCompleteRecipeInputs(context: TradeAnalysisContext): boolean {
  return economyCodeOf(context) !== null && context.productCode !== null;
}

/**
 * Transitions `context` to `recipe`, always discarding the pin (a recipe
 * change invalidates it). Trade Trend and Supplier Competition share an
 * importer+HS12-product shape, so switching directly between them carries
 * that importing economy and product forward; any other transition (to or
 * from Candidate Market, whose canonical input is an exporter, not an
 * importer) starts that recipe with empty inputs rather than guessing an
 * exporter from an importer or vice versa.
 */
export function withRecipe(
  context: TradeAnalysisContext,
  recipe: TradeAnalysisRecipe,
): TradeAnalysisContext {
  if (context.recipe === recipe) {
    return context;
  }
  const sharesImporterShape =
    context.recipe !== "candidate-market" && recipe !== "candidate-market";
  if (sharesImporterShape) {
    return {
      recipe,
      locale: context.locale,
      productCode: context.productCode,
      pin: null,
      importerCode: context.importerCode,
    };
  }
  return emptyTradeAnalysisContext(recipe, context.locale);
}

/** Returns `context` with its pin explicitly discarded. */
export function withoutPin(context: TradeAnalysisContext): TradeAnalysisContext {
  return { ...context, pin: null };
}

/** Returns `context` with its own economy code field (exporter or
 * importer, whichever the recipe consumes) set to `code`. */
export function withEconomyCode(
  context: TradeAnalysisContext,
  code: string | null,
): TradeAnalysisContext {
  return context.recipe === "candidate-market"
    ? { ...context, exporterCode: code }
    : { ...context, importerCode: code };
}

/** Returns `context` with its product code field set to `code`. */
export function withProductCode(
  context: TradeAnalysisContext,
  code: string | null,
): TradeAnalysisContext {
  return { ...context, productCode: code };
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
  return context.recipe === "candidate-market"
    ? context.exporterCode
    : context.importerCode;
}

function economyParamName(recipe: TradeAnalysisRecipe): "exporter" | "importer" {
  return recipe === "candidate-market" ? "exporter" : "importer";
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
  return DEFAULT_RECIPE;
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
