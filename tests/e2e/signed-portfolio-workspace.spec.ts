import { expect, test, type Page } from "@playwright/test";

import type { MarketInvestigationPage } from "../../src/domain/opportunity-discovery/result";

test("a signed-in analyst restores a portfolio workspace, filters the live public ranking, and signs out to the anonymous workspace", async ({
  page,
  browser,
}) => {
  const email = `portfolio-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct horse battery staple";
  let opportunityRequests = 0;
  page.on("request", (request) => {
    if (
      request
        .url()
        .includes("/api/v1/analyses/acceptance-fixtures-v1/opportunities?")
    ) {
      opportunityRequests += 1;
    }
  });

  await page.goto("/");
  await createPortfolioAccount(page, email, password);

  const candidates = page
    .getByRole("list", { name: "Portfolio Opportunity Candidates" })
    .getByRole("listitem");
  await expect(candidates).toHaveCount(0);
  expect(opportunityRequests).toBe(0);

  const portfolio = page.getByRole("region", {
    name: "Your portfolio opportunity workspace",
  });
  const product = portfolio.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("horse");
  await expect(
    portfolio.getByRole("option", { name: /010121/u }),
  ).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
  await expect(portfolio.getByLabel("Selected product")).toContainText(
    "Horses: live, pure-bred breeding animals",
  );
  await expect(portfolio.getByLabel("Selected product")).toContainText(
    "纯种繁殖用活马",
  );
  await portfolio
    .getByRole("button", { name: "Add product to portfolio" })
    .click();

  await expect(candidates).toHaveCount(2);
  await expect(candidates.nth(0)).toContainText("Canonical public rank #1");
  await expect(candidates.nth(0)).toContainText("Mexico");
  await expect(candidates.nth(0)).toContainText("HS12 010121");
  await expect(candidates.nth(0)).toContainText(
    "Investigation Priority 73/100",
  );

  await expect(page.getByText("Portfolio products: 010121")).toBeVisible();
  await expect(candidates.nth(1)).toContainText("Canonical public rank #2");
  await expect(candidates.nth(1)).toContainText(
    "Investigation Priority 66/100",
  );
  expect(opportunityRequests).toBe(1);
  await page
    .getByRole("button", { name: "Show complete public ranking" })
    .click();
  await expect(candidates).toHaveCount(4);
  const scope = page.getByRole("region", {
    name: "Portfolio analysis scope",
  });
  await expect(scope).toContainText("Current deployment");
  await expect(scope).toContainText("Finalized score period");
  await expect(scope).toContainText("2019–2023");
  await expect(scope).toContainText("Provisional context");
  await expect(scope).toContainText("2024 · supporting evidence only");
  await expect(scope).toContainText("Latest known BACI release");
  await page.getByRole("button", { name: "Show portfolio filter" }).click();
  await expect(candidates).toHaveCount(2);
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1.*exporter=156.*portfolio=filter.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await portfolio
    .getByRole("button", { name: "Copy analysis link" })
    .click();
  await expect(
    portfolio.getByRole("button", { name: "Link copied" }),
  ).toBeVisible();

  await page.reload();
  await expect(candidates).toHaveCount(2);

  const requestsBeforeRefresh = opportunityRequests;
  await page
    .getByRole("button", { name: "Refresh with current evidence" })
    .click();
  await expect(candidates).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeRefresh + 1);

  const requestsBeforeLocale = opportunityRequests;
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/locale=zh-Hans/u);
  await expect(
    page.getByRole("list", { name: "组合机会候选项" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "组合分析范围" }),
  ).toContainText("当前部署");
  expect(opportunityRequests).toBe(requestsBeforeLocale);
  await expect(
    page.getByRole("button", { name: "使用当前证据刷新" }),
  ).toBeVisible();
  const requestsBeforeEnglish = opportunityRequests;
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(candidates).toHaveCount(2);
  expect(opportunityRequests).toBe(requestsBeforeEnglish);
  const requestsBeforeRemove = opportunityRequests;

  const retainedUrl = page.url();
  expect(retainedUrl).not.toContain(email);
  expect(retainedUrl).not.toContain("hs_tracker_session");

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.goto(retainedUrl);
    await signIn(secondPage, email, password);
    await expect(secondPage.getByText("Primary exporter: 156")).toBeVisible();
    await expect(
      secondPage.getByText("Portfolio products: 010121"),
    ).toBeVisible();
    await expect(
      secondPage
        .getByRole("list", { name: "Portfolio Opportunity Candidates" })
        .getByRole("listitem"),
    ).toHaveCount(2);
  } finally {
    await secondContext.close();
  }

  await page.getByRole("button", { name: "Remove 010121" }).click();
  await expect(page.getByText("No portfolio products confirmed")).toBeVisible();
  await expect(candidates).toHaveCount(0);
  expect(opportunityRequests).toBe(requestsBeforeRemove);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("No account required")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Choose an analysis task" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Market Investigation Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);
});

test("portfolio controls coexist with public analysis and open byte-identical Market Analysis", async ({
  page,
}) => {
  const email = `portfolio-analysis-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct horse battery staple";
  let opportunityRequests = 0;
  page.on("request", (request) => {
    if (
      request
        .url()
        .includes("/api/v1/analyses/acceptance-fixtures-v1/opportunities?")
    ) {
      opportunityRequests += 1;
    }
  });
  let completePage: MarketInvestigationPage | null = null;
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/opportunities?*",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === "portfolio-page-2") {
        if (completePage === null) {
          throw new Error("The first portfolio opportunity page was not loaded.");
        }
        await route.fulfill({
          contentType: "application/json",
          json: {
            ...completePage,
            page: {
              ...completePage.page,
              requestedCursor: cursor,
              nextCursor: null,
              returnedCount: completePage.candidates.length - 1,
            },
            candidates: completePage.candidates.slice(1),
          },
        });
        return;
      }
      const response = await route.fetch();
      completePage = (await response.json()) as MarketInvestigationPage;
      await route.fulfill({
        response,
        json: {
          ...completePage,
          page: {
            ...completePage.page,
            nextCursor: "portfolio-page-2",
            returnedCount: 1,
          },
          candidates: completePage.candidates.slice(0, 1),
        },
      });
    },
  );

  await page.goto("/");
  await createPortfolioAccount(page, email, password);
  await expect(
    page.getByRole("navigation", { name: "Choose an analysis task" }),
  ).toBeVisible();
  expect(opportunityRequests).toBe(0);

  const portfolio = page.getByRole("region", {
    name: "Your portfolio opportunity workspace",
  });
  const product = portfolio.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("horse");
  await expect(
    portfolio.getByRole("option", { name: /010121/u }),
  ).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
  await expect(portfolio.getByLabel("Selected product")).toContainText(
    "Horses: live, pure-bred breeding animals",
  );
  await expect(portfolio.getByLabel("Selected product")).toContainText(
    "纯种繁殖用活马",
  );
  await portfolio
    .getByRole("button", { name: "Add product to portfolio" })
    .click();

  const candidates = portfolio.getByRole("list", {
    name: "Portfolio Opportunity Candidates",
  });
  await expect(candidates.getByRole("listitem")).toHaveCount(2);
  expect(opportunityRequests).toBe(2);

  const direct = await page.request.get(
    "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528",
  );
  expect(direct.ok()).toBe(true);
  const directBytes = await direct.body();
  const analyzeNetherlands = candidates
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" })
    .getByRole("link", { name: "Analyze this market" });
  const netherlandsRow = candidates
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" });
  await expect(netherlandsRow.getByRole("button")).toHaveCount(0);
  await expect(analyzeNetherlands).toHaveAccessibleName(
    "Analyze this market: Netherlands, HS12 010121",
  );
  const analysisResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/market-analysis?") &&
      response.url().includes("market=528"),
  );
  await analyzeNetherlands.click();
  const portfolioBytes = await (await analysisResponse).body();

  expect(Buffer.compare(portfolioBytes, directBytes)).toBe(0);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Choose an analysis task" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await expect(analyzeNetherlands).toBeFocused();
});

test("a retired portfolio context refreshes explicitly and preserves the original history entry", async ({
  page,
}) => {
  const email = `portfolio-retired-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct horse battery staple";
  await page.goto("/");
  await createPortfolioAccount(page, email, password);
  const portfolio = page.getByRole("region", {
    name: "Your portfolio opportunity workspace",
  });
  const product = portfolio.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("horse");
  await expect(
    portfolio.getByRole("option", { name: /010121/u }),
  ).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
  await portfolio
    .getByRole("button", { name: "Add product to portfolio" })
    .click();

  await page.goto("/?recipe=opportunity-discovery-v1&exporter=156");
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  const retiredUrl = new URL(page.url());
  retiredUrl.searchParams.set("build", "retired-analysis-v1");
  await page.goto(retiredUrl.toString());

  const retiredAlert = portfolio.getByRole("alert");
  await expect(retiredAlert).toContainText(
    "This retained link points at a retired analysis build.",
  );
  await retiredAlert
    .getByRole("button", { name: "Refresh with current evidence" })
    .click();
  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(page).not.toHaveURL(/retired-analysis-v1/u);
  await expect(
    portfolio
      .getByRole("list", { name: "Portfolio Opportunity Candidates" })
      .getByRole("listitem"),
  ).toHaveCount(4);

  await page.goBack();
  await expect(page).toHaveURL(/build=retired-analysis-v1/u);
  await expect(retiredAlert).toContainText(
    "This retained link points at a retired analysis build.",
  );
});

async function createPortfolioAccount(
  page: Page,
  email: string,
  password: string,
) {
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Display name").fill("Signed Portfolio Analyst");
  await page.getByLabel("Primary export economy").fill("156");
  await page
    .getByRole("button", { name: "Create portfolio workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your portfolio opportunity workspace" }),
  ).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Open portfolio workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your portfolio opportunity workspace" }),
  ).toBeVisible();
}
