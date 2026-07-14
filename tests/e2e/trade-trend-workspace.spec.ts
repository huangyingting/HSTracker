import { expect, test, type Page } from "@playwright/test";

async function selectTrendContext(page: Page) {
  const importer = page.getByRole("combobox", {
    name: "Importing economy",
  });
  await importer.fill("528");
  await expect(page.getByRole("option", { name: /Netherlands/ })).toBeVisible();
  await importer.press("ArrowDown");
  await importer.press("Enter");

  const product = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("010121");
  await expect(page.getByRole("option", { name: /010121/ })).toBeVisible();
  await product.press("ArrowDown");
  await product.press("Enter");
}

test("an analyst can select Trade Trend by keyboard, share it, and change locale without changing values", async ({
  page,
}) => {
  await page.goto("/");
  const tasks = page.getByRole("navigation", { name: "Choose an analysis task" });
  await tasks.getByRole("button", { name: /Trade Trend/ }).click();

  await selectTrendContext(page);
  await page.getByRole("button", { name: "Analyze Trade Trend" }).click();

  const observations = page.getByRole("table", {
    name: "Five Finalized Years",
  });
  await expect(observations).toContainText(
    "2019Recorded positive value · USD 100000",
  );
  await expect(observations).toContainText(
    "2023Recorded positive value · USD 160000",
  );
  const summary = page.getByRole("heading", {
    name: "Finalized trend summary",
  });
  await expect(summary).toBeVisible();
  await expect(page.getByText("USD 60000", { exact: true })).toBeVisible();
  const provisional = page.getByRole("heading", {
    name: "Provisional Year snapshot",
  });
  await expect(provisional).toBeVisible();
  await expect(
    page.getByText("Recorded positive value · USD 200000"),
  ).toBeVisible();
  await expect(page).toHaveURL(
    /task=trade-trend.*importer=528.*revision=HS12.*product=010121/,
  );

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("heading", { name: "定稿趋势摘要" }),
  ).toBeVisible();
  await expect(page.getByText("USD 60000", { exact: true })).toBeVisible();
  await expect(
    page.getByText("已记录的正值 · USD 200000"),
  ).toBeVisible();
});

test("Trade Trend distinguishes sparse, unavailable, and absent provisional evidence on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?task=trade-trend&importer=484&revision=HS12&product=010121",
  );

  await expect(
    page.getByRole("table", { name: "Five Finalized Years" }),
  ).toContainText("Missing observation");
  await expect(
    page.getByRole("table", { name: "Five Finalized Years" }),
  ).toContainText("No recorded positive flow");
  await expect(page.getByText("USD -50000", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Provisional Year snapshot" }),
  ).toBeVisible();
  await expect(
    page.getByText("No provisional observation is available."),
  ).toBeVisible();

  await page.goto(
    "/?task=trade-trend&importer=710&revision=HS12&product=010121",
  );
  await expect(page.getByText("Trend unavailable")).toBeVisible();
  await expect(
    page.getByText(
      "Only one recorded-positive observation exists in the five Finalized Years; change and CAGR are unavailable.",
    ),
  ).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Candidate Market remains the default task with its original ranking controls and list", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121&market=528");

  const candidateMarkets = page.getByRole("list", {
    name: "Candidate Markets",
  });
  await expect(candidateMarkets.getByRole("button")).toHaveCount(13);
  await expect(candidateMarkets.getByRole("button").first()).toHaveAccessibleName(
    "#1 Netherlands BACI 528 · Data Confidence: HIGH 85 /100",
  );
  await expect(page.getByRole("button", { name: "Analyze Candidate Markets" })).toBeVisible();
  await expect(page).not.toHaveURL(/task=trade-trend/);
});

test("switching tasks starts with a fresh analysis context", async ({ page }) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121");
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).toBeVisible();

  const tasks = page.getByRole("navigation", {
    name: "Choose an analysis task",
  });
  await tasks.getByRole("button", { name: /Trade Trend/ }).click();

  await expect(page).toHaveURL(/\?task=trade-trend$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();

  await selectTrendContext(page);
  await tasks.getByRole("button", { name: /Candidate Markets/ }).click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();
});
