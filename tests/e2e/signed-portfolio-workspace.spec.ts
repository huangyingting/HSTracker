import { expect, test, type Page } from "@playwright/test";

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
    .getByRole("button");
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
  await page.getByRole("button", { name: "Show portfolio filter" }).click();
  await expect(candidates).toHaveCount(2);

  const analyticalUrl = page.url();
  await candidates.nth(1).click();
  expect(page.url()).toBe(analyticalUrl);
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();
  await page.reload();
  await expect(candidates).toHaveCount(4);
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Mexico" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show portfolio filter" }).click();
  await expect(candidates).toHaveCount(2);

  const requestsBeforeRefresh = opportunityRequests;
  await page.getByRole("button", { name: "Refresh current analysis" }).click();
  await expect(candidates).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeRefresh + 1);

  const requestsBeforeLocale = opportunityRequests;
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/locale=zh-Hans/u);
  await expect(
    page.getByRole("list", { name: "组合机会候选项" }).getByRole("button"),
  ).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeLocale + 1);
  await expect(
    page.getByRole("button", { name: "刷新当前分析" }),
  ).toBeVisible();
  const requestsBeforeEnglish = opportunityRequests;
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(candidates).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeEnglish + 1);
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
        .getByRole("region", { name: "Selected portfolio candidate detail" })
        .getByRole("heading", { name: "Mexico" }),
    ).toBeVisible();
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
  expect(opportunityRequests).toBe(1);

  const direct = await page.request.get(
    "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528",
  );
  expect(direct.ok()).toBe(true);
  const directBytes = await direct.body();
  const analyzeNetherlands = candidates
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" })
    .getByRole("link", { name: "Analyze this market" });
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
