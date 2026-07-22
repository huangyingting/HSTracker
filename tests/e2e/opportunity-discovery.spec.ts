import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const OPPORTUNITY_PRODUCT_URL =
  "/?recipe=opportunity-discovery-v1&exporter=156&products=010121";

test("cross-product Opportunities downloads the complete pinned CSV", async ({
  page,
}) => {
  await page.goto("/?recipe=opportunity-discovery-v1&exporter=156");
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  await expect(
    page.getByText(
      "All 4 rows in this Scope, independent of the visible viewport",
    ),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete CSV" })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) {
    throw new Error("The Opportunity CSV did not produce a local file.");
  }
  const bytes = await readFile(path);
  const text = bytes.toString("utf8");

  expect(download.suggestedFilename()).toBe(
    "hs-tracker_opportunities_cross-product_from-156_acceptance-fixtures-v1.csv",
  );
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(text.match(/\r\n/g)).toHaveLength(5);
  expect(text).toContain('"opportunity-discovery-csv-v1"');
  expect(text).toContain('"dataset-package-v1-');
});

async function selectChinaExporter(page: Page) {
  const economy = page.getByRole("combobox", { name: "Export economy" });
  await economy.fill("156");
  await expect(page.getByRole("option", { name: /China/ })).toBeVisible();
  await economy.press("ArrowDown");
  await economy.press("Enter");
}

async function selectHorseProduct(page: Page) {
  const product = page.getByRole("combobox", { name: "HS 2012 product" });
  await product.fill("horse");
  await expect(page.getByRole("option", { name: /010121/ })).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
}

async function expectMexicoHorseCandidate(page: Page) {
  const list = page.getByRole("list", {
    name: "Market Investigation Candidates",
  });
  const mexico = list
    .getByRole("listitem")
    .filter({ hasText: "Mexico" })
    .filter({ hasText: "010121" });
  await expect(mexico).toContainText("Horses: live, pure-bred breeding animals");
  await expect(mexico).toContainText("Data Confidence: HIGH");
  await expect(mexico).toContainText("Investigation Priority 73");
  await expect(mexico.getByRole("link")).toHaveCount(1);
  expect((await mexico.innerText()).match(/010121/gu) ?? []).toHaveLength(1);
}

test("all-product browse, product discovery, and known-product links reach the same canonical row values", async ({
  page,
}) => {
  await page.goto("/");
  await selectChinaExporter(page);
  const discoverAll = page.getByRole("button", {
    name: "Discover product-market opportunities",
  });
  await expect(discoverAll).toBeEnabled();
  await expect(
    page.getByText(
      "Public trade evidence supports market investigation; it does not predict sales, profit, market access, or commercial success.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Market Investigation Candidates" }),
  ).toHaveCount(0);
  await discoverAll.click();
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  await expectMexicoHorseCandidate(page);

  await page.goto("/");
  await selectChinaExporter(page);
  await selectHorseProduct(page);
  await page
    .getByRole("button", { name: "Discover Candidate Markets" })
    .click();
  await expect(page).toHaveURL(
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(
    page
      .getByRole("list", { name: "Candidate Markets" })
      .getByRole("link"),
  ).toHaveCount(13);
  await expect(
    page.getByText(
      "Confirmation covers HS12 categories; it does not classify SKUs or convert HS17/HS22.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change product" }),
  ).toBeVisible();

  await page.goto(OPPORTUNITY_PRODUCT_URL);
  await expect(
    page.getByRole("combobox", { name: "HS 2012 product" }),
  ).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
  await expectMexicoHorseCandidate(page);
});

test("opportunity copy is honest and context survives filter, history, copied links, locale, and mobile", async ({
  page,
  browser,
}) => {
  let opportunityRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/opportunities?")) {
      opportunityRequests += 1;
    }
  });
  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown> & {
      freshness: Record<string, unknown>;
    };
    await route.fulfill({
      response,
      json: {
        ...manifest,
        freshness: {
          ...manifest.freshness,
          state: "REFRESH_DELAYED",
        },
      },
    });
  });
  await page.goto(OPPORTUNITY_PRODUCT_URL);
  await expectMexicoHorseCandidate(page);
  const stableShareButton = await page
    .getByRole("button", { name: "Copy link" })
    .elementHandle();
  if (stableShareButton === null) {
    throw new Error("Expected the analysis share control to be mounted.");
  }
  const requestsAfterInitialLoad = opportunityRequests;
  await page.waitForTimeout(500);
  expect(await stableShareButton.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect(opportunityRequests).toBe(requestsAfterInitialLoad);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/sales potential|company fit/iu);
  expect(bodyText).not.toMatch(
    /Investigation Priority[^.!?]*(?:sales|company capability|product-market fit|is a recommendation)/iu,
  );
  await expect(
    page.getByRole("heading", { name: "Discovery disclaimer" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A high Investigation Priority is a starting point for research, not a recommendation to enter a market.",
    ),
  ).toBeVisible();

  const copiedUrl = page.url();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();

  const anotherContext = await browser.newContext();
  const anotherPage = await anotherContext.newPage();
  await anotherPage.goto(copiedUrl);
  await expectMexicoHorseCandidate(anotherPage);
  await anotherContext.close();

  await page.getByRole("button", { name: "Show all products" }).click();
  await page
    .getByRole("button", { name: "Discover product-market opportunities" })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  const allProductUrl = page.url();
  expect(allProductUrl).not.toContain("products=");

  await page.goBack();
  await expect(page).toHaveURL(copiedUrl);
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(2);

  await page.goForward();
  await expect(page).toHaveURL(allProductUrl);
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  const requestsBeforeLocale = opportunityRequests;
  const localeSwitch = page.getByRole("button", { name: "简体中文" });
  const localeSwitchBox = await localeSwitch.boundingBox();
  expect(localeSwitchBox?.width).toBeGreaterThanOrEqual(44);
  expect(localeSwitchBox?.height).toBeGreaterThanOrEqual(44);
  await localeSwitch.click();
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1&locale=zh-Hans&exporter=156.*build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(
    page
      .getByRole("list", { name: "市场调查候选项" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  expect(opportunityRequests).toBe(requestsBeforeLocale);

  const scopeActionSize = await page
    .getByRole("button", { name: "更改范围" })
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    });
  expect(scopeActionSize.height).toBeGreaterThanOrEqual(44);
  expect(scopeActionSize.width).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await expect(
    page
      .locator(".workspace-scope-summary")
      .getByText("数据刷新延迟 - 当前显示最近验证通过的数据版"),
  ).toBeVisible();
  const scopeDisclosure = page.getByRole("button", { name: "查看范围" });
  await expect(scopeDisclosure).toHaveAttribute("aria-expanded", "false");
  const controlledScopeId = await scopeDisclosure.getAttribute("aria-controls");
  if (controlledScopeId === null) {
    throw new Error("The Scope disclosure does not identify its controlled content.");
  }
  const controlledScope = page.locator(`[id="${controlledScopeId}"]`);
  await expect(controlledScope).toHaveAttribute("data-expanded", "false");
  await scopeDisclosure.click();
  await expect(
    page.getByRole("button", { name: "收起范围" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(controlledScope).toHaveAttribute("data-expanded", "true");
});

test("opportunity refresh and explicit Market Analysis links preserve canonical analytical identity", async ({
  page,
}) => {
  let opportunityRequests = 0;
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/opportunities?*",
    async (route) => {
      opportunityRequests += 1;
      await route.continue();
    },
  );

  await page.goto(OPPORTUNITY_PRODUCT_URL);
  await expectMexicoHorseCandidate(page);
  const retiredUrl = page
    .url()
    .replace("acceptance-fixtures-v1", "retired-analysis-v1");
  opportunityRequests = 0;
  await page.goto(retiredUrl);
  await expect(
    page.locator(".opportunity-workspace").getByRole("alert"),
  ).toContainText("This analysis build has retired.");
  await expect(
    page
      .getByRole("region", { name: "Workspace scope" })
      .locator("dd")
      .filter({ hasText: /^Retired$/u }),
  ).toBeVisible();
  const requestsBeforeRefresh = opportunityRequests;
  await page
    .getByRole("button", { name: "Refresh with current evidence" })
    .click();
  await expectMexicoHorseCandidate(page);
  expect(opportunityRequests).toBe(requestsBeforeRefresh + 1);
  await expect(page).toHaveURL(/build=acceptance-fixtures-v1/u);

  await page.goBack();
  await expect(page).toHaveURL(/build=retired-analysis-v1/u);
  await expect(
    page.locator(".opportunity-workspace").getByRole("alert"),
  ).toContainText("This analysis build has retired.");

  await page.goForward();
  await expectMexicoHorseCandidate(page);
  await expect(page).toHaveURL(/build=acceptance-fixtures-v1/u);

  await page
    .getByRole("list", { name: "Market Investigation Candidates" })
    .getByRole("listitem")
    .filter({ hasText: "Mexico" })
    .filter({ hasText: "010121" })
    .getByRole("link", { name: "Analyze this market" })
    .click();
  const analysis = page.getByRole("region", {
    name: "Mexico · Market Analysis",
  });
  const tradeTrend = analysis.locator("#demand").getByRole("link", {
    name: "Open Trade Trend for this market",
  });
  await expect(tradeTrend).toHaveAttribute(
    "href",
    /recipe=trade-trend-v1.*importer=484.*product=010121.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await tradeTrend.click();
  await expect(
    page.getByRole("table", { name: "Five Finalized Years" }),
  ).toBeVisible();

  await page.goto(
    "/?recipe=supplier-competition-v1&importer=484&revision=HS12&product=010121",
  );
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue("484 — Mexico");
  // Mexico now has fixture Supplier Competition evidence too (issue #68
  // extended fixtures/supplier-competition/v1/evidence.ts so every
  // core-current.ts Candidate Market completes the atomic Market Analysis
  // Module), so this adjacent link now reaches real supplier evidence
  // instead of the invalid-input state it previously exercised.
  const structure = page.getByRole("table", {
    name: "Complete supplier-economy structure",
  });
  await expect(structure).toContainText("China · BACI 156");
  await expect(structure).toContainText("United States · BACI 842");

  await page.goto(
    "/?recipe=trade-explorer-v1&exportEconomy=156&hsProduct=010121",
  );
  await expect(page).toHaveURL(
    /recipe=trade-explorer-v1&exportEconomy=156&hsProduct=010121/u,
  );
  await page
    .getByRole("radio", { name: /Finalized-year trend for one market/ })
    .check();
  await expect(page.getByLabel("Export economy")).toHaveValue("156");
  await expect(page.getByLabel("HS12 product")).toHaveValue("010121");
});

test("exact product confirmation translates a retained Opportunity pin without falling forward", async ({
  page,
}) => {
  const retainedBuild = "retained-opportunity-v0";
  const retainedCandidatePackage = `dataset-package-v1-${"b".repeat(64)}`;
  const retainedOpportunityPackage = `dataset-package-v1-${"c".repeat(64)}`;
  let retainedArtifactSha256 = "";

  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as {
      source: { artifact: { sha256: string } };
      recommendation: Record<string, unknown> & {
        opportunityDiscovery: Record<string, unknown>;
      };
      deploymentWindow: readonly unknown[];
    };
    retainedArtifactSha256 = manifest.source.artifact.sha256;
    const retainedRecommendation = {
      ...manifest.recommendation,
      datasetPackageIdentity: retainedCandidatePackage,
      opportunityDiscovery: {
        ...manifest.recommendation.opportunityDiscovery,
        datasetPackageIdentity: retainedOpportunityPackage,
      },
    };
    await route.fulfill({
      response,
      json: {
        ...manifest,
        deploymentWindow: [
          ...manifest.deploymentWindow,
          {
            analysisBuildId: retainedBuild,
            recommendation: retainedRecommendation,
            baciRelease: "V202601",
            artifactSha256: retainedArtifactSha256,
          },
        ],
      },
    });
  });
  await page.route(
    `**/api/v1/analyses/${retainedBuild}/opportunities?*`,
    async (route) => {
      const response = await route.fetch({
        url: route
          .request()
          .url()
          .replace(retainedBuild, "acceptance-fixtures-v1"),
      });
      const pageResult = (await response.json()) as {
        provenance: Record<string, unknown>;
      };
      await route.fulfill({
        response,
        json: {
          ...pageResult,
          analysisBuildId: retainedBuild,
          datasetPackageIdentity: retainedOpportunityPackage,
          provenance: {
            ...pageResult.provenance,
            artifactSha256: retainedArtifactSha256,
          },
        },
      });
    },
  );

  await page.goto(
    `/?recipe=opportunity-discovery-v1&exporter=156&build=${retainedBuild}&pkg=${retainedOpportunityPackage}`,
  );
  await expectMexicoHorseCandidate(page);
  await expect(
    page
      .getByRole("region", { name: "Workspace scope" })
      .locator("dd")
      .filter({ hasText: /^Retained$/u }),
  ).toBeVisible();
  await expect(
    page.getByText("Not reported for retained evidence"),
  ).toBeVisible();
  await expect(page.locator(".source-scope")).toHaveCount(0);
  await selectHorseProduct(page);
  await page
    .getByRole("button", { name: "Discover Candidate Markets" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `recipe=candidate-market-v1.*product=010121.*build=${retainedBuild}&pkg=${retainedCandidatePackage}$`,
      "u",
    ),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(
      `recipe=opportunity-discovery-v1.*build=${retainedBuild}&pkg=${retainedOpportunityPackage}$`,
      "u",
    ),
  );
  await expectMexicoHorseCandidate(page);
});
