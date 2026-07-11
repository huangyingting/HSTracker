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
      name: "Find candidate markets worth a closer look.",
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
  const workspaceUrl = page.url();

  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page).toHaveURL(workspaceUrl);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "寻找值得深入研究的候选市场。",
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
      name: "Find candidate markets worth a closer look.",
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
