import { expect, test } from "@playwright/test";

// Locale is independently canonical: it must be observable in the
// canonical URL as soon as it is non-default, even while the recipe's own
// inputs are still incomplete, and it must survive reload, browser
// back/forward, and a task switch exactly like the recipe and its inputs
// do. See CONTEXT.md, "Canonical Task Link".

test("selecting a non-default locale on the bare landing page persists it through reload, and a task switch made before any inputs still carries it forward", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: "简体中文" }).click();

  // Locale alone, with no recipe inputs at all, still canonicalizes the
  // bare landing page rather than staying an unqualified "/".
  await expect(page).toHaveURL("/?locale=zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "寻找值得深入研究的候选市场。",
    }),
  ).toBeVisible();

  const tasks = page.getByRole("navigation", { name: "选择分析任务" });
  await tasks.getByRole("button", { name: /贸易趋势/ }).click();

  // The exact versioned recipe identity now leads (deterministic first
  // position), and the locale chosen before any input was selected is
  // still exactly where it was.
  await expect(page).toHaveURL("/?recipe=trade-trend-v1&locale=zh-Hans");
  await expect(
    page.getByRole("heading", { level: 2, name: "查看年度进口证据。" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");

  // Reload: an explicit transition to a fresh load, but the exact
  // canonical URL alone must reproduce the same task and locale.
  await page.reload();
  await expect(page).toHaveURL("/?recipe=trade-trend-v1&locale=zh-Hans");
  await expect(
    page.getByRole("heading", { level: 2, name: "查看年度进口证据。" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
});

test("browser back/forward reproduce the exact task and locale carried by each canonical URL, not client memory", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL("/?locale=zh-Hans");

  const tasks = page.getByRole("navigation", { name: "选择分析任务" });
  await tasks.getByRole("button", { name: /供应商竞争/ }).click();
  await expect(page).toHaveURL("/?recipe=supplier-competition-v1&locale=zh-Hans");
  await expect(
    page.getByRole("heading", { level: 2, name: "查看完整的已记录供应经济体结构。" }),
  ).toBeVisible();

  // The locale switch itself only ever replaces the current history
  // entry (it never changes analytical meaning), but the task switch
  // pushed a new one; back returns to the locale-only entry, and the
  // task reverts to the default Opportunity Discovery while the locale
  // chosen earlier is untouched.
  await page.goBack();
  await expect(page).toHaveURL("/?locale=zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "寻找值得深入研究的候选市场。",
    }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL("/?recipe=supplier-competition-v1&locale=zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", { level: 2, name: "查看完整的已记录供应经济体结构。" }),
  ).toBeVisible();
});

test("switching locale mid-selection, before completing recipe inputs, is never lost", async ({
  page,
}) => {
  await page.goto("/");
  const product = page.getByRole("combobox", { name: "HS 2012 product" });
  await product.fill("010121");
  await expect(page.getByRole("option", { name: /010121/ })).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
  await expect(page).toHaveURL("/?products=010121");

  await page.getByRole("button", { name: "简体中文" }).click();

  // The recipe context is still incomplete (no exporter yet), so it
  // stays unpinned and un-recipe-tagged, but the locale is independently
  // canonical and appears regardless.
  await expect(page).toHaveURL("/?locale=zh-Hans&products=010121");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByLabel("已选择产品"),
  ).toContainText("HS 2012 · 010121");
});
