import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

async function openTradeExplorer(page: Page) {
  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  await advancedTools.getByRole("link", { name: "Trade Explorer" }).click();
}

async function selectFinalizedTrendShape(
  page: Page,
  {
    exportEconomy,
    importEconomy,
    hsProduct,
  }: { exportEconomy: string; importEconomy: string; hsProduct: string },
) {
  await page
    .getByRole("radio", { name: /Finalized-year trend for one market/ })
    .check();
  await page.getByLabel("Export economy").fill(exportEconomy);
  await page.getByLabel("Import economy").fill(importEconomy);
  await page.getByLabel("HS12 product").fill(hsProduct);
  await page.getByRole("checkbox", { name: "Trade value (current USD)" }).check();
}

test("an analyst can run the finalized-trend-v1 shape, share it, and change locale without changing values", async ({
  page,
}) => {
  await page.goto("/");
  await openTradeExplorer(page);

  await selectFinalizedTrendShape(page, {
    exportEconomy: "156",
    importEconomy: "528",
    hsProduct: "010121",
  });
  await page.getByRole("button", { name: "Analyze Trade Explorer" }).click();

  const result = page.getByRole("table", { name: "Result" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("2019");
  await expect(result).toContainText("40000");
  await expect(result).toContainText("2021");
  await expect(result).toContainText("No recorded positive flow");
  await expect(result).toContainText("2022");
  await expect(result).toContainText("Missing observation");
  await expect(result).toContainText("2023");
  await expect(result).toContainText("80000");

  const boundary = page.getByRole("note");
  await expect(boundary).toContainText(
    "no SQL, table name, column name, expression, or raw-record input",
  );

  await expect(page).toHaveURL(
    /recipe=trade-explorer-v1.*shape=finalized-trend-v1.*exportEconomy=156.*importEconomy=528.*hsProduct=010121/,
  );

  await page.getByLabel("Import economy").fill("484");
  await expect(result).not.toBeVisible();
  await expect(page).toHaveURL(/importEconomy=484/u);
  await page.goBack();
  await expect(page.getByLabel("Import economy")).toHaveValue("528");
  await expect(result).toBeVisible();

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("heading", { name: "结果" }),
  ).toBeVisible();
  await expect(page.getByText("没有 SQL、表名、列名")).toBeVisible();
});

test("[launch-evidence:trade-explorer-csv] an analyst downloads the complete bounded Trade Explorer CSV", async ({
  page,
}) => {
  let exportUrl: URL | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/trade-explorer.csv")) {
      exportUrl = url;
    }
  });

  await page.goto("/");
  await openTradeExplorer(page);
  await selectFinalizedTrendShape(page, {
    exportEconomy: "156",
    importEconomy: "528",
    hsProduct: "010121",
  });
  await page.getByRole("button", { name: "Analyze Trade Explorer" }).click();
  await expect(page.getByRole("table", { name: "Result" })).toBeVisible();

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
    /^hs-tracker_trade-explorer_finalized-trend-v1_V202601_tex1-[a-f0-9]{64}\.csv$/u,
  );
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(text).toContain('"ROW"');
  expect(text).toContain('"40000"');
  expect(exportUrl).not.toBeNull();
  expect(exportUrl!.searchParams.get("shape")).toBe("finalized-trend-v1");
  expect(exportUrl!.searchParams.get("schema")).toBe("trade-explorers-csv-v1");
});

test("Trade Explorer reports a typed empty outcome for a non-enumerable combination without inventing rows", async ({
  page,
}) => {
  await page.goto("/");
  await openTradeExplorer(page);
  await selectFinalizedTrendShape(page, {
    exportEconomy: "842",
    importEconomy: "276",
    hsProduct: "010121",
  });
  await page.getByRole("button", { name: "Analyze Trade Explorer" }).click();

  await expect(
    page.getByText("This exact combination has no enumerable evidence."),
  ).toBeVisible();
});

test("Trade Explorer reports an internal route failure as fatal rather than malformed input", async ({
  page,
}) => {
  await page.route(
    /\/api\/v1\/analyses\/[^/]+\/trade-explorer(?:\?.*)?$/u,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "Trade Explorer analysis could not be completed.",
          },
        }),
      }),
  );
  await page.goto("/");
  await openTradeExplorer(page);
  await selectFinalizedTrendShape(page, {
    exportEconomy: "156",
    importEconomy: "528",
    hsProduct: "010121",
  });
  await page.getByRole("button", { name: "Analyze Trade Explorer" }).click();

  await expect(
    page.getByText("Trade Explorer could not be completed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This combination is not allowed. Check the shape, filters, measures, and sort.",
      { exact: true },
    ),
  ).not.toBeVisible();
});

test("a canonical grouped-year link preserves and executes its complete year list", async ({
  page,
}) => {
  await page.goto(
    "/?recipe=trade-explorer-v1&shape=finalized-trend-v1&measures=TRADE_VALUE_USD&years=2019%2C2020%2C2021%2C2022%2C2023&exportEconomy=156&importEconomy=528&hsProduct=010121",
  );

  const result = page.getByRole("table", { name: "Result" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("2019");
  await expect(result).toContainText("2023");
  await expect(page).toHaveURL(/years=2019%2C2020%2C2021%2C2022%2C2023/u);
});

test("switching from a fixed-year shape to finalized trend restores the full window", async ({
  page,
}) => {
  await page.goto("/");
  await openTradeExplorer(page);
  await page
    .getByRole("radio", { name: /Compare importing markets/ })
    .check();
  await page.getByLabel("Export economy").fill("156");
  await page.getByLabel("Import economy").fill("528");
  await page.getByLabel("HS12 product").fill("010121");
  await page.getByLabel("Finalized year").fill("2023");
  await page.getByRole("checkbox", { name: "Trade value (current USD)" }).check();

  await page
    .getByRole("radio", { name: /Finalized-year trend for one market/ })
    .check();
  await page.getByRole("button", { name: "Analyze Trade Explorer" }).click();

  const result = page.getByRole("table", { name: "Result" });
  await expect(result).toContainText("2019");
  await expect(result).toContainText("2023");
  await expect(page).not.toHaveURL(/years=/u);
});

test("switching to and from Trade Explorer transfers compatible analysis context", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121");
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);

  await openTradeExplorer(page);

  await expect(page).toHaveURL(
    /\?recipe=trade-explorer-v1&exportEconomy=156&hsProduct=010121&build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await page
    .getByRole("radio", { name: /Finalized-year trend for one market/ })
    .check();
  await expect(page.getByLabel("Export economy")).toHaveValue("156");
  await expect(page.getByLabel("HS12 product")).toHaveValue("010121");

  await page.goBack();
  await expect(page).toHaveURL(
    /\?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /Finalized-year trend/ })).not.toBeVisible();
});
