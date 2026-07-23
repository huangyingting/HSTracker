import { expect, test, type Page } from "@playwright/test";

import type { CurrentAnalysisManifest } from "../../src/domain/release/current-analysis";

type CompatibilityRecipe =
  | "candidate-market"
  | "opportunity-discovery"
  | "supplier-competition"
  | "trade-explorer"
  | "trade-trend";

type CanonicalLinkFixture = {
  name: string;
  href: string;
  recipe: CompatibilityRecipe;
  recipeIdentity: string;
  packageIdentity: string;
  semanticInputs: Readonly<Record<string, string>>;
};

function requiredPackageIdentity(
  identity: string | undefined,
  recipe: CompatibilityRecipe,
): string {
  if (identity === undefined) {
    throw new TypeError(`The fixture manifest does not declare ${recipe}.`);
  }
  return identity;
}

async function expectRecipeLoaded(
  page: Page,
  fixture: CanonicalLinkFixture,
) {
  if (fixture.recipe === "candidate-market") {
    await expect(
      page.getByRole("heading", {
        name:
          fixture.semanticInputs.locale === "zh-Hans"
            ? "Netherlands · 市场分析"
            : "Netherlands · Market Analysis",
      }),
    ).toBeVisible();
    return;
  }
  if (fixture.recipe === "opportunity-discovery") {
    await expect(
      page
        .getByRole("list", { name: "Market Investigation Candidates" })
        .getByRole("listitem"),
    ).toHaveCount(4);
    return;
  }
  if (fixture.recipe === "trade-trend") {
    await expect(
      page.getByRole("table", { name: "Five Finalized Years" }),
    ).toBeVisible();
    return;
  }
  if (fixture.recipe === "supplier-competition") {
    await expect(
      page.getByRole("table", {
        name: "Complete supplier-economy structure",
      }),
    ).toBeVisible();
    return;
  }
  await expect(page.getByRole("table", { name: "Result" })).toBeVisible();
}

test("[launch-evidence:canonical-link-compatibility] the canonical-link compatibility fixture set preserves recipe, inputs, locale, and Current identity", async ({
  page,
  request,
}) => {
  const manifestResponse = await request.get("/api/v1/analyses/current");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as CurrentAnalysisManifest;
  const build = manifest.analysisBuildId;
  const candidatePackage = manifest.recommendation.datasetPackageIdentity;
  const opportunityPackage = requiredPackageIdentity(
    manifest.recommendation.opportunityDiscovery?.datasetPackageIdentity,
    "opportunity-discovery",
  );
  const trendPackage = requiredPackageIdentity(
    manifest.recommendation.tradeTrend?.datasetPackageIdentity,
    "trade-trend",
  );
  const supplierPackage = requiredPackageIdentity(
    manifest.recommendation.supplierCompetition?.datasetPackageIdentity,
    "supplier-competition",
  );
  const explorerPackage = requiredPackageIdentity(
    manifest.recommendation.tradeExplorer?.datasetPackageIdentity,
    "trade-explorer",
  );
  const explorerInputs =
    "shape=finalized-trend-v1&measures=TRADE_VALUE_USD&years=2019%2C2020%2C2021%2C2022%2C2023&exportEconomy=156&importEconomy=528&hsProduct=010121";
  const fixtures: CanonicalLinkFixture[] = [
    {
      name: "legacy Candidate Market shape",
      href: `/?exporter=156&revision=HS12&product=010121&market=528&build=${build}&pkg=${candidatePackage}`,
      recipe: "candidate-market",
      recipeIdentity: "candidate-market-v1",
      packageIdentity: candidatePackage,
      semanticInputs: {
        exporter: "156",
        revision: "HS12",
        product: "010121",
        market: "528",
      },
    },
    {
      name: "versioned Candidate Market",
      href: `/?recipe=candidate-market-v1&locale=zh-Hans&exporter=156&revision=HS12&product=010121&market=528&build=${build}&pkg=${candidatePackage}`,
      recipe: "candidate-market",
      recipeIdentity: "candidate-market-v1",
      packageIdentity: candidatePackage,
      semanticInputs: {
        locale: "zh-Hans",
        exporter: "156",
        revision: "HS12",
        product: "010121",
        market: "528",
      },
    },
    {
      name: "versioned Opportunity Discovery",
      href: `/?recipe=opportunity-discovery-v1&exporter=156&build=${build}&pkg=${opportunityPackage}`,
      recipe: "opportunity-discovery",
      recipeIdentity: "opportunity-discovery-v1",
      packageIdentity: opportunityPackage,
      semanticInputs: { exporter: "156" },
    },
    {
      name: "legacy Trade Trend alias",
      href: `/?task=trade-trend&importer=528&revision=HS12&product=010121&build=${build}&pkg=${trendPackage}`,
      recipe: "trade-trend",
      recipeIdentity: "trade-trend-v1",
      packageIdentity: trendPackage,
      semanticInputs: {
        importer: "528",
        revision: "HS12",
        product: "010121",
      },
    },
    {
      name: "versioned Trade Trend",
      href: `/?recipe=trade-trend-v1&importer=528&revision=HS12&product=010121&build=${build}&pkg=${trendPackage}`,
      recipe: "trade-trend",
      recipeIdentity: "trade-trend-v1",
      packageIdentity: trendPackage,
      semanticInputs: {
        importer: "528",
        revision: "HS12",
        product: "010121",
      },
    },
    {
      name: "legacy Supplier Competition alias",
      href: `/?task=supplier-competition&importer=528&revision=HS12&product=010121&build=${build}&pkg=${supplierPackage}`,
      recipe: "supplier-competition",
      recipeIdentity: "supplier-competition-v1",
      packageIdentity: supplierPackage,
      semanticInputs: {
        importer: "528",
        revision: "HS12",
        product: "010121",
      },
    },
    {
      name: "versioned Supplier Competition",
      href: `/?recipe=supplier-competition-v1&importer=528&revision=HS12&product=010121&build=${build}&pkg=${supplierPackage}`,
      recipe: "supplier-competition",
      recipeIdentity: "supplier-competition-v1",
      packageIdentity: supplierPackage,
      semanticInputs: {
        importer: "528",
        revision: "HS12",
        product: "010121",
      },
    },
    {
      name: "versioned Trade Explorer",
      href: `/?recipe=trade-explorer-v1&${explorerInputs}&build=${build}&pkg=${explorerPackage}`,
      recipe: "trade-explorer",
      recipeIdentity: "trade-explorer-v1",
      packageIdentity: explorerPackage,
      semanticInputs: {
        shape: "finalized-trend-v1",
        measures: "TRADE_VALUE_USD",
        years: "2019,2020,2021,2022,2023",
        exportEconomy: "156",
        importEconomy: "528",
        hsProduct: "010121",
      },
    },
  ];

  for (const fixture of fixtures) {
    await test.step(fixture.name, async () => {
      await page.goto(fixture.href);
      await expectRecipeLoaded(page, fixture);

      const restored = new URL(page.url());
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        fixture.semanticInputs.locale ?? "en",
      );
      expect(restored.searchParams.get("recipe")).toBe(fixture.recipeIdentity);
      expect(restored.searchParams.get("build")).toBe(build);
      expect(restored.searchParams.get("pkg")).toBe(fixture.packageIdentity);
      for (const [name, value] of Object.entries(fixture.semanticInputs)) {
        expect(restored.searchParams.get(name)).toBe(value);
      }
    });
  }
});
