import { expect, test } from "@playwright/test";

const CANONICAL_INVESTIGATE_URL =
  "/?exporter=156&revision=HS12&product=010121";

async function analysisTasks(page: import("@playwright/test").Page) {
  const tasks = page.getByRole("navigation", {
    name: "Choose an analysis task",
  });
  if (!(await tasks.isVisible())) {
    await page.getByRole("button", { name: "Advanced tools" }).click();
  }
  return tasks;
}

async function analyzeCandidateMarket(page: import("@playwright/test").Page) {
  await page.goto(CANONICAL_INVESTIGATE_URL);
  const ranking = page.getByRole("list", { name: "Candidate Markets" });
  await expect(ranking.getByRole("button")).toHaveCount(13);
  await ranking
    .getByRole("button", { name: "Analyze this market: Netherlands" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();
}

test("a direct task link renders the matching server snapshot before hydration", async ({
  baseURL,
  browser,
}) => {
  const serverOnlyPage = await browser.newPage({
    baseURL,
    javaScriptEnabled: false,
  });

  await serverOnlyPage.goto("/?recipe=trade-trend-v1");

  const tasks = await analysisTasks(serverOnlyPage);
  await expect(
    tasks.getByRole("button", { name: /Trade Trend/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    serverOnlyPage.getByRole("heading", { name: "Inspect annual import evidence." }),
  ).toBeVisible();
  await serverOnlyPage.close();
});

test("a direct non-default task link hydrates without a server/client mismatch", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  const recordHydrationError = (message: string) => {
    if (/hydration|hydrated|Minified React error #418/iu.test(message)) {
      hydrationErrors.push(message);
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error") {
      recordHydrationError(message.text());
    }
  });
  page.on("pageerror", (error) => recordHydrationError(error.message));

  await page.goto("/?recipe=trade-trend-v1");

  const tasks = await analysisTasks(page);
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toBeVisible();
  expect(hydrationErrors).toEqual([]);
  await expect(
    tasks.getByRole("button", { name: /Trade Trend/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Candidate Market's cross-task links live outside the locked ranking list and are keyboard-accessible", async ({
  page,
}) => {
  await analyzeCandidateMarket(page);

  const rankingList = page.getByRole("list", { name: "Candidate Markets" });
  await expect(rankingList.getByRole("link")).toHaveCount(0);
  await expect(rankingList.getByRole("button")).toHaveCount(13);

  const evidence = page.getByRole("region", {
    name: "Netherlands · Market Analysis",
  });
  await expect(
    evidence.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  const tradeTrendLink = evidence.locator("#demand").getByRole("link", {
    name: "Open Trade Trend for this market",
  });
  const supplierCompetitionLink = evidence
    .locator("#supplier-landscape")
    .getByRole("link", {
      name: "Open Supplier Competition for this market",
    });
  await expect(tradeTrendLink).toBeVisible();
  await expect(supplierCompetitionLink).toBeVisible();

  // Keyboard-only activation: focus (as Tab would land) then Enter, exactly
  // like any native <a>, never a mouse click.
  await tradeTrendLink.focus();
  await expect(tradeTrendLink).toBeFocused();
  await tradeTrendLink.press("Enter");

  await expect(page).toHaveURL(
    /recipe=trade-trend-v1.*importer=528.*revision=HS12.*product=010121/,
  );
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue("528 — Netherlands");
  const observations = page.getByRole("table", {
    name: "Five Finalized Years",
  });
  await expect(observations).toContainText(
    "2019Recorded positive value · USD 100000",
  );
  await expect(observations).toContainText(
    "2023Recorded positive value · USD 160000",
  );
  // The freshly executed Trade Trend request pins its own recipe and
  // Dataset Package identity, distinct from Candidate Market's.
  await expect(page).toHaveURL(
    /build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/,
  );
});

test("Candidate Market's Supplier Competition link preselects the same importing economy and HS Product", async ({
  page,
}) => {
  await analyzeCandidateMarket(page);

  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("button")
    .filter({ hasText: "Canada" })
    .click();

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(evidence.getByRole("heading", { name: "Canada" })).toBeVisible();

  const supplierCompetitionLink = evidence.getByRole("link", {
    name: "Open Supplier Competition for this market",
  });
  await supplierCompetitionLink.focus();
  await supplierCompetitionLink.press("Enter");

  await expect(page).toHaveURL(
    /recipe=supplier-competition-v1.*importer=124.*revision=HS12.*product=010121/,
  );
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue("124 — Canada");
  const concentration = page.getByRole("region", { name: "Concentration (HHI)" });
  await expect(concentration).toBeVisible();
  await expect(page.getByText("5200.000000", { exact: true })).toBeVisible();
});

test("Trade Trend and Supplier Competition preserve the importing economy and HS Product across a direct switch", async ({
  page,
}) => {
  await page.goto("/?task=trade-trend");
  const importer = page.getByRole("combobox", { name: "Importing economy" });
  await importer.fill("528");
  await expect(page.getByRole("option", { name: /Netherlands/ })).toBeVisible();
  await importer.press("ArrowDown");
  await importer.press("Enter");
  const product = page.getByRole("combobox", { name: "HS 2012 product" });
  await product.fill("010121");
  await expect(page.getByRole("option", { name: /010121/ })).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
  await page.getByRole("button", { name: "Analyze Trade Trend" }).click();
  await expect(
    page.getByRole("heading", { name: "Finalized trend summary" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/build=acceptance-fixtures-v1&pkg=/);

  const tasks = await analysisTasks(page);
  await tasks.getByRole("button", { name: /Supplier Competition/ }).click();

  await expect(page).toHaveURL(
    /recipe=supplier-competition-v1.*importer=528.*revision=HS12.*product=010121/,
  );
  // The pin never survives a recipe change; it must be re-earned.
  await expect(page).not.toHaveURL(/build=/);
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue("528 — Netherlands");
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).toBeVisible();

  await expect(
    page
      .getByRole("region", { name: "Inspect the complete recorded" })
      .getByRole("heading", { name: "Complete supplier-economy structure" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/build=acceptance-fixtures-v1&pkg=/);
  await expect(page.getByText("5000.000000", { exact: true })).toBeVisible();
});

test("copying, reloading, and opening a pinned Candidate Market link in another browser reproduce the same task and pin", async ({
  page,
  browser,
}) => {
  await analyzeCandidateMarket(page);
  const pinnedUrl = page.url();
  expect(pinnedUrl).toMatch(/build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/);

  await page.reload();
  await expect(page).toHaveURL(pinnedUrl);
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);
  await expect(
    page
      .getByRole("region", { name: "Netherlands · Market Analysis" })
      .getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  const anotherBrowserContext = await browser.newContext();
  const anotherPage = await anotherBrowserContext.newPage();
  await anotherPage.goto(pinnedUrl);
  await expect(anotherPage).toHaveURL(pinnedUrl);
  await expect(
    anotherPage
      .getByRole("region", { name: "Netherlands · Market Analysis" })
      .getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  await expect(
    anotherPage
      .getByRole("region", { name: "Netherlands · Market Analysis" })
      .getByText("Candidate Market Score 85", { exact: true }),
  ).toBeVisible();
  await anotherBrowserContext.close();
});

test("a pinned Candidate Market link that no longer matches the current recommendation shows a typed retired state instead of executing under the old pin, and explicit refresh resolves a distinct current pin", async ({
  page,
}) => {
  await analyzeCandidateMarket(page);
  const pinnedUrl = page.url();

  let oldBuildRequests = 0;
  let currentManifestRequests = 0;
  let replacementBuildRequests = 0;
  let replacementProductRequests = 0;

  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...manifest,
        analysisBuildId: "replacement-analysis-v2",
        productSearchBuildId: "replacement-products-v2",
        // The simulated redeploy retires the old build entirely rather
        // than retaining it: without this, the old pin would still
        // match the manifest's own deploymentWindow entry and resolve as
        // "retained" (still executable) instead of "retired" (see issue
        // #44).
        deploymentWindow: [
          {
            analysisBuildId: "replacement-analysis-v2",
            recommendation: manifest.recommendation,
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      oldBuildRequests += 1;
      await route.continue();
    },
  );
  await page.route(
    "**/api/v1/analyses/replacement-analysis-v2/**",
    async (route) => {
      replacementBuildRequests += 1;
      const originalUrl = route
        .request()
        .url()
        .replace("replacement-analysis-v2", "acceptance-fixtures-v1");
      const response = await route.fetch({ url: originalUrl });
      if (route.request().url().includes("/candidate-markets?")) {
        const result = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          response,
          json: { ...result, analysisBuildId: "replacement-analysis-v2" },
        });
        return;
      }
      if (route.request().url().includes("/market-analysis?")) {
        const result = (await response.json()) as Record<string, unknown>;
        const context = result.context as Record<string, unknown>;
        await route.fulfill({
          response,
          json: {
            ...result,
            context: {
              ...context,
              analysisBuildId: "replacement-analysis-v2",
            },
          },
        });
        return;
      }
      await route.fulfill({ response });
    },
  );
  await page.route(
    "**/api/v1/product-catalogs/replacement-products-v2/**",
    async (route) => {
      replacementProductRequests += 1;
      const originalUrl = route
        .request()
        .url()
        .replace("replacement-products-v2", "acceptance-product-search-v3");
      const response = await route.fetch({ url: originalUrl });
      await route.fulfill({ response });
    },
  );

  // Reopening the pinned link after the simulated redeploy: the client
  // detects the pin no longer matches the current recommendation from the
  // manifest alone, before any candidate-markets request is attempted.
  await page.goto(pinnedUrl);

  await expect(page.locator(".analysis-error")).toContainText(
    "This analysis build has retired.",
  );
  expect(oldBuildRequests).toBe(0);
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Refresh with current evidence" })
    .click();

  await expect(
    page.getByRole("region", { name: "Netherlands · Market Analysis" }),
  ).toContainText("Netherlands");
  await expect(page).toHaveURL(
    new RegExp(
      `\\?recipe=candidate-market-v1&${CANONICAL_INVESTIGATE_URL.slice(2)}&market=528&build=replacement-analysis-v2&pkg=dataset-package-v1-[0-9a-f]{64}$`,
    ),
  );
  expect(oldBuildRequests).toBe(0);
  expect(currentManifestRequests).toBeGreaterThanOrEqual(2);
  expect(replacementBuildRequests).toBeGreaterThan(0);
  expect(replacementProductRequests).toBeGreaterThan(0);

  await page.goBack();
  await expect(page).toHaveURL(/build=acceptance-fixtures-v1/u);
  await expect(page.locator(".analysis-error")).toContainText(
    "This analysis build has retired.",
  );
  expect(oldBuildRequests).toBe(0);

  await page.goForward();
  await expect(page).toHaveURL(/build=replacement-analysis-v2/u);
  await expect(
    page.getByRole("region", { name: "Netherlands · Market Analysis" }),
  ).toContainText("Netherlands");
});

test("a pinned Candidate Market link that still names a retained predecessor executes its exact build rather than retiring or substituting current", async ({
  page,
}) => {
  await analyzeCandidateMarket(page);
  const pinnedUrl = page.url();

  let retainedAnalysisRequests = 0;
  let currentAnalysisRequests = 0;

  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown> & {
      analysisBuildId: string;
      recommendation: unknown;
      source: { baciRelease: string; artifact: { sha256: string } };
    };
    // A redeploy that keeps the pinned build as a retained predecessor:
    // current advances to a new build/package identity, but the
    // manifest's own deploymentWindow still lists the original
    // (analysisBuildId, recommendation) pair the pin was minted against
    // (see issue #44).
    await route.fulfill({
      response,
      json: {
        ...manifest,
        analysisBuildId: "current-analysis-v3",
        productSearchBuildId: "current-products-v3",
        deploymentWindow: [
          {
            analysisBuildId: "current-analysis-v3",
            recommendation: manifest.recommendation,
            baciRelease: manifest.source.baciRelease,
            artifactSha256: manifest.source.artifact.sha256,
          },
          {
            analysisBuildId: manifest.analysisBuildId,
            recommendation: manifest.recommendation,
            baciRelease: manifest.source.baciRelease,
            artifactSha256: manifest.source.artifact.sha256,
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      retainedAnalysisRequests += 1;
      await route.continue();
    },
  );
  // The current-only economy/product selectors still restore against
  // current's (fake) build by design (see issue #44 "if selectors stay
  // current-only"), so their own restore requests are proxied back to
  // the real fixture build rather than left to 410 -- only the
  // candidate-markets analysis request itself is asserted below to have
  // used the retained build, never this proxied current one.
  await page.route(
    "**/api/v1/analyses/current-analysis-v3/**",
    async (route) => {
      const url = route.request().url();
      if (url.includes("/candidate-markets?")) {
        currentAnalysisRequests += 1;
      }
      const originalUrl = url.replace(
        "current-analysis-v3",
        "acceptance-fixtures-v1",
      );
      const response = await route.fetch({ url: originalUrl });
      await route.fulfill({ response });
    },
  );
  await page.route(
    "**/api/v1/product-catalogs/current-products-v3/**",
    async (route) => {
      const originalUrl = route
        .request()
        .url()
        .replace("current-products-v3", "acceptance-product-search-v3");
      const response = await route.fetch({ url: originalUrl });
      await route.fulfill({ response });
    },
  );

  await page.goto(pinnedUrl);

  // The retained build executes exactly -- the same ranking and market
  // as the original analysis -- without ever calling the new current
  // build for analysis, and without showing the typed retired state.
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);
  await expect(
    page.getByRole("region", { name: "Netherlands · Market Analysis" }),
  ).toContainText("Netherlands");
  await expect(page.locator(".analysis-error")).toHaveCount(0);
  expect(retainedAnalysisRequests).toBeGreaterThan(0);
  expect(currentAnalysisRequests).toBe(0);
  // The pinned URL still names the exact retained build it reproduced,
  // never silently promoted to look like current.
  await expect(page).toHaveURL(new RegExp("build=acceptance-fixtures-v1&"));
});
