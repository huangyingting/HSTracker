import { expect, test, type Page } from "@playwright/test";

test("a signed-in analyst confirms a portfolio product, inspects it in both locales, then deletes the account and can no longer sign in", async ({
  page,
}) => {
  const email = `lifecycle-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct horse battery staple";

  await page.goto("/");
  await createPortfolioAccount(page, email, password);

  await page.getByLabel("Confirm HS12 product code").fill("010121");
  await page.getByRole("button", { name: "Add product to portfolio" }).click();
  await expect(page.getByText("Portfolio products: 010121")).toBeVisible();
  await page.getByRole("button", { name: "Show portfolio filter" }).click();

  const candidates = page
    .getByRole("list", { name: "Portfolio Opportunity Candidates" })
    .getByRole("button");
  await expect(candidates).toHaveCount(2);

  await candidates.nth(1).click();
  await expect(page).toHaveURL(/focusProduct=010121.*market=528/u);
  await expect(
    page
      .getByRole("region", { name: "Selected portfolio candidate detail" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/locale=zh-Hans/u);
  await expect(
    page.getByRole("list", { name: "组合机会候选项" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "使用当前证据刷新" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "EN" }).click();
  await expect(candidates).toHaveCount(2);

  const deleteResponse = await page.request.post("/api/account/delete");
  expect(deleteResponse.status()).toBe(204);

  await page.goto("/");
  await expect(page.getByText("No account required")).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Open portfolio workspace" }).click();
  await expect(
    page.getByText("The account request could not be completed."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your portfolio opportunity workspace" }),
  ).toHaveCount(0);
});

async function createPortfolioAccount(
  page: Page,
  email: string,
  password: string,
) {
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Display name").fill("Lifecycle Analyst");
  await page.getByLabel("Primary export economy").fill("156");
  await page.getByRole("button", { name: "Create portfolio workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your portfolio opportunity workspace" }),
  ).toBeVisible();
}
