import { expect, test, type Page } from "@playwright/test";

const OPPORTUNITY_PRODUCT_URL =
  "/?recipe=opportunity-discovery-v1&exporter=156&products=010121";

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
    .getByRole("button")
    .filter({ hasText: "Mexico" })
    .filter({ hasText: "010121" });
  await expect(mexico).toContainText("Horses: live, pure-bred breeding animals");
  await expect(mexico).toContainText("Confidence: HIGH");
  await expect(mexico).toContainText("73");

  const detail = page.getByRole("region", {
    name: "Selected Market Investigation Candidate detail",
  });
  await expect(detail.getByRole("heading", { name: "Mexico" })).toBeVisible();
  await expect(detail).toContainText("HS 2012 · 010121 · BACI 484");
  await expect(detail).toContainText("Unvalidated Market Gap");
  await expect(detail).toContainText(
    "Large, attractive market with little or no recorded flow from this exporter — investigate why.",
  );
  await expect(detail).toContainText(
    "No recorded bilateral flow from this exporter in the five-year score window",
  );
  await expect(detail).toContainText("Investigation Priority");
  await expect(detail).toContainText("73/100");
  await expect(detail).toContainText("Market Attractiveness");
  await expect(detail).toContainText("88/100");
  await expect(detail).toContainText("Exporter Fit");
  await expect(detail).toContainText("55/100");
}

test("all-product browse, product discovery, and known-product links reach the same canonical row values", async ({
  page,
}) => {
  await page.goto("/");
  await selectChinaExporter(page);
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("button"),
  ).toHaveCount(4);
  await expectMexicoHorseCandidate(page);

  await page.goto("/");
  await selectChinaExporter(page);
  await selectHorseProduct(page);
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1.*exporter=156.*products=010121.*build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("button"),
  ).toHaveCount(2);
  await expectMexicoHorseCandidate(page);

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
  await page.goto(OPPORTUNITY_PRODUCT_URL);
  await expectMexicoHorseCandidate(page);

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
  await page.getByRole("button", { name: "Copy analysis link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();

  const anotherContext = await browser.newContext();
  const anotherPage = await anotherContext.newPage();
  await anotherPage.goto(copiedUrl);
  await expectMexicoHorseCandidate(anotherPage);
  await anotherContext.close();

  await page.getByRole("button", { name: "Show all products" }).click();
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("button"),
  ).toHaveCount(4);
  const allProductUrl = page.url();
  expect(allProductUrl).not.toContain("products=");

  await page.goBack();
  await expect(page).toHaveURL(copiedUrl);
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("button"),
  ).toHaveCount(2);

  await page.goForward();
  await expect(page).toHaveURL(allProductUrl);
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("button"),
  ).toHaveCount(4);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1&locale=zh-Hans&exporter=156.*build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(
    page
      .getByRole("list", { name: "市场调查候选项" })
      .getByRole("button"),
  ).toHaveCount(4);

  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("opportunity refresh and adjacent links preserve canonical analytical identity", async ({
  page,
}) => {
  let opportunityRequests = 0;
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/opportunities?*",
    async (route) => {
      opportunityRequests += 1;
      if (opportunityRequests === 1) {
        await route.fulfill({
          status: 410,
          contentType: "application/problem+json",
          body: JSON.stringify({
            error: {
              code: "ANALYSIS_BUILD_RETIRED",
              message: "Analysis build retired.",
            },
          }),
        });
        return;
      }
      await route.continue();
    },
  );

  await page.goto(OPPORTUNITY_PRODUCT_URL);
  await expect(
    page.locator(".opportunity-workspace").getByRole("alert"),
  ).toContainText("This analysis build has retired.");
  await page.getByRole("button", { name: "Refresh current analysis" }).click();
  await expectMexicoHorseCandidate(page);
  expect(opportunityRequests).toBe(2);

  const adjacent = page.getByRole("navigation", { name: "Adjacent evidence" });
  await expect(
    adjacent.getByRole("link", { name: "Open Candidate Market drill-down" }),
  ).toHaveAttribute(
    "href",
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=484",
  );
  await expect(
    adjacent.getByRole("link", { name: "Open Trade Trend evidence" }),
  ).toHaveAttribute(
    "href",
    "/?recipe=trade-trend-v1&importer=484&revision=HS12&product=010121",
  );
  await expect(
    adjacent.getByRole("link", { name: "Open Supplier Competition evidence" }),
  ).toHaveAttribute(
    "href",
    "/?recipe=supplier-competition-v1&importer=484&revision=HS12&product=010121",
  );
  await expect(
    adjacent.getByRole("link", { name: "Open Trade Explorer setup" }),
  ).toHaveAttribute(
    "href",
    "/?recipe=trade-explorer-v1&exportEconomy=156&hsProduct=010121",
  );

  await adjacent
    .getByRole("link", { name: "Open Candidate Market drill-down" })
    .click();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);
  await expect(
    page
      .getByRole("region", { name: "Selected Candidate Market evidence" })
      .getByRole("heading", { name: "Mexico" }),
  ).toBeVisible();

  await page.goto(
    "/?recipe=trade-trend-v1&importer=484&revision=HS12&product=010121",
  );
  await expect(
    page.getByRole("table", { name: "Five Finalized Years" }),
  ).toBeVisible();

  await page.goto(
    "/?recipe=supplier-competition-v1&importer=484&revision=HS12&product=010121",
  );
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue("484 — Mexico");
  await expect(
    page
      .getByRole("region", { name: "Inspect the complete recorded" })
      .getByRole("alert"),
  ).toContainText("These Supplier Competition inputs are invalid.");

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
