import { readFile } from "node:fs/promises";

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
    /recipe=trade-trend-v1.*importer=528.*revision=HS12.*product=010121/,
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

test("an analyst downloads the complete contextual Trade Trend CSV", async ({
  page,
}) => {
  let exportUrl: URL | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/trade-trends.csv")) {
      exportUrl = url;
    }
  });

  await page.goto("/?task=trade-trend&importer=528&revision=HS12&product=010121");
  await selectTrendContext(page);
  await page.getByRole("button", { name: "Analyze Trade Trend" }).click();
  await expect(
    page.getByRole("table", { name: "Five Finalized Years" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete CSV" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) {
    throw new Error("The CSV download did not produce a local file.");
  }
  const bytes = await readFile(path);
  const text = bytes.toString("utf8");

  expect(download.suggestedFilename()).toMatch(
    /^hs-tracker_trade-trend_for-528_HS12-010121_V202601_ttx1-[a-f0-9]{64}\.csv$/u,
  );
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(text.match(/\r\n/g)).toHaveLength(7);
  expect(text.match(/"FINALIZED"/g)).toHaveLength(5);
  expect(text.match(/"PROVISIONAL"/g)).toHaveLength(1);
  expect(text).toContain('"纯种繁殖用活马"');
  expect(text).toContain('"200000"');
  expect(text).toContain('"60000"');
  expect(exportUrl).not.toBeNull();
  expect(exportUrl!.searchParams.get("importer")).toBe("528");
  expect(exportUrl!.searchParams.get("product")).toBe("010121");
  expect(exportUrl!.searchParams.get("schema")).toBe("trade-trends-csv-v1");

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("button", { name: "下载完整 CSV" }),
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

test("Candidate Market remains reachable with its original ranking controls and list", async ({
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
  await expect(page).not.toHaveURL(/recipe=trade-trend-v1/);
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

  await expect(page).toHaveURL(/\?recipe=trade-trend-v1$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();

  await selectTrendContext(page);
  await tasks.getByRole("button", { name: /Candidate Markets/ }).click();

  await expect(page).toHaveURL(/\?recipe=candidate-market-v1$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();
});
