import { expect, test } from "@playwright/test";

test("an analyst can open the public discovery shell without signing in", async ({
  page,
}) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/HS Tracker/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Analyze export markets with public trade evidence.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Discovery aid, not a recommendation."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Public trade indicators can guide further investigation. They do not predict profit, demand, or sales success.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No account required")).toBeVisible();
});

test("an analyst can switch the public shell to Simplified Chinese", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "简体中文" }).click();

  // Locale is independently canonical: it appears in the URL as soon as
  // it is non-default, even on the bare landing page with no recipe
  // inputs at all, so it survives reload, copy, and browser back/forward.
  await expect(page).toHaveURL("/?locale=zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "使用公共贸易证据分析出口市场。",
    }),
  ).toBeVisible();
  await expect(page.getByText("发现线索，而非提供建议。")).toBeVisible();
  await expect(
    page.getByText(
      "公共贸易指标可为进一步调查提供方向，但不能预测利润、需求或销售成功。",
    ),
  ).toBeVisible();
  await expect(page.getByText("无需注册")).toBeVisible();
});

test("an unknown public route provides a clear way home", async ({ page }) => {
  const response = await page.goto("/not-a-public-route");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to HS Tracker" }),
  ).toHaveAttribute("href", "/");
});

test("the public evidence boundary remains readable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Analyze export markets with public trade evidence.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Discovery aid, not a recommendation.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "简体中文" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
