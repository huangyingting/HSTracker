import { expect, test, type Page } from "@playwright/test";

test("a signed-in analyst restores a portfolio workspace, filters the live public ranking, and signs out to the anonymous workspace", async ({
  page,
  browser,
}) => {
  const email = `portfolio-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct horse battery staple";
  let opportunityRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/analyses/acceptance-fixtures-v1/opportunities?")) {
      opportunityRequests += 1;
    }
  });

  await page.goto("/");
  await createPortfolioAccount(page, email, password);

  const candidates = page
    .getByRole("list", { name: "Portfolio Opportunity Candidates" })
    .getByRole("button");
  await expect(candidates).toHaveCount(4);
  await expect(candidates.nth(0)).toContainText("Canonical public rank #1");
  await expect(candidates.nth(0)).toContainText("Mexico");
  await expect(candidates.nth(0)).toContainText("HS12 010121");
  await expect(candidates.nth(0)).toContainText("Investigation Priority 73/100");

  await page.getByLabel("Confirm HS12 product code").fill("010121");
  await page.getByRole("button", { name: "Add product to portfolio" }).click();
  await expect(page.getByText("Portfolio products: 010121")).toBeVisible();
  await page.getByRole("button", { name: "Show portfolio filter" }).click();

  await expect(candidates).toHaveCount(2);
  await expect(candidates.nth(0)).toContainText("Canonical public rank #1");
  await expect(candidates.nth(0)).toContainText("Investigation Priority 73/100");
  await expect(candidates.nth(1)).toContainText("Canonical public rank #2");
  await expect(candidates.nth(1)).toContainText("Investigation Priority 66/100");
  expect(opportunityRequests).toBe(1);

  await candidates.nth(1).click();
  await expect(page).toHaveURL(/focusProduct=010121.*market=528/u);
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Mexico" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();

  await page.reload();
  await expect(candidates).toHaveCount(2);
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();

  const requestsBeforeRefresh = opportunityRequests;
  await page.getByRole("button", { name: "Refresh current analysis" }).click();
  await expect(candidates).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeRefresh + 1);

  const requestsBeforeLocale = opportunityRequests;
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/locale=zh-Hans/u);
  await expect(
    page
      .getByRole("list", { name: "组合机会候选项" })
      .getByRole("button"),
  ).toHaveCount(2);
  await expect.poll(() => opportunityRequests).toBe(requestsBeforeLocale + 1);
  await expect(page.getByRole("button", { name: "刷新当前分析" })).toBeVisible();
  const requestsBeforeEnglish = opportunityRequests;
  await page.getByRole("button", { name: "EN" }).click();
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
    await expect(secondPage.getByText("Portfolio products: 010121")).toBeVisible();
    await expect(
      secondPage
        .getByRole("region", { name: "Selected portfolio candidate detail" })
        .getByRole("heading", { name: "Netherlands" }),
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
  await page.getByRole("button", { name: "Create portfolio workspace" }).click();
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
