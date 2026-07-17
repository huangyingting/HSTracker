import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

async function selectSupplierCompetitionContext(
  page: Page,
  importerQuery: string,
  importerOptionPattern: RegExp,
) {
  const importer = page.getByRole("combobox", {
    name: "Importing economy",
  });
  await importer.fill(importerQuery);
  await expect(page.getByRole("option", { name: importerOptionPattern })).toBeVisible();
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

test("an analyst can select Supplier Competition by keyboard, share it, and change locale without changing values", async ({
  page,
}) => {
  await page.goto("/");
  const tasks = page.getByRole("navigation", { name: "Choose an analysis task" });
  await tasks.getByRole("button", { name: /Supplier Competition/ }).click();

  await selectSupplierCompetitionContext(page, "124", /Canada/);
  await page.getByRole("button", { name: "Analyze Supplier Competition" }).click();

  const structure = page.getByRole("table", {
    name: "Complete supplier-economy structure",
  });
  await expect(structure).toContainText("China · BACI 156");
  await expect(structure).toContainText("70.000000%");
  await expect(structure).toContainText("USD 700000");

  const concentration = page.getByRole("heading", { name: "Concentration (HHI)" });
  await expect(concentration).toBeVisible();
  await expect(page.getByText("5200.000000", { exact: true })).toBeVisible();

  const boundary = page.getByRole("note");
  await expect(boundary).toContainText(
    "does not identify companies, buyers, shipments, Party Roles, or Commercial Relationship Assertions",
  );

  await expect(page).toHaveURL(
    /recipe=supplier-competition-v1.*importer=124.*revision=HS12.*product=010121/,
  );

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("heading", { name: "集中度（HHI）" }),
  ).toBeVisible();
  await expect(page.getByText("5200.000000", { exact: true })).toBeVisible();
  await expect(page.getByText("仅为经济体级别证据")).toBeVisible();
});

test("an analyst downloads the complete contextual Supplier Competition CSV", async ({
  page,
}) => {
  let exportUrl: URL | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/supplier-competitions.csv")) {
      exportUrl = url;
    }
  });

  await page.goto(
    "/?task=supplier-competition&importer=124&revision=HS12&product=010121",
  );
  await selectSupplierCompetitionContext(page, "124", /Canada/);
  await page.getByRole("button", { name: "Analyze Supplier Competition" }).click();
  await expect(
    page.getByRole("table", { name: "Complete supplier-economy structure" }),
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
    /^hs-tracker_supplier-competition_for-124_HS12-010121_V202601_scx1-[a-f0-9]{64}\.csv$/u,
  );
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(text.match(/\r\n/g)).toHaveLength(5);
  expect(text.match(/"SUPPLIER"/g)).toHaveLength(4);
  expect(text).toContain('"纯种繁殖用活马"');
  expect(text).toContain('"700000"');
  expect(text).toContain('"5200.000000"');
  expect(exportUrl).not.toBeNull();
  expect(exportUrl!.searchParams.get("importer")).toBe("124");
  expect(exportUrl!.searchParams.get("product")).toBe("010121");
  expect(exportUrl!.searchParams.get("schema")).toBe(
    "supplier-competitions-csv-v1",
  );

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("button", { name: "下载完整 CSV" }),
  ).toBeVisible();
});

test("Supplier Competition distinguishes sparse, incomplete supplier structure, and not-applicable provisional evidence on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?task=supplier-competition&importer=404&revision=HS12&product=010121",
  );

  const structure = page.getByRole("table", {
    name: "Complete supplier-economy structure",
  });
  await expect(structure).toContainText("Netherlands · BACI 528");
  await expect(structure).toContainText("85.714286%");
  await expect(structure).toContainText("Mexico · BACI 484");
  await expect(structure).toContainText("14.285714%");

  await expect(
    page.getByRole("heading", { name: "Quality warnings" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Some finalized years have no recorded supplier at all.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "At least one supplying economy is missing observations within the finalized window.",
    ),
  ).toBeVisible();

  const provisional = page.getByRole("table", {
    name: "Provisional Year snapshot",
  });
  await expect(provisional).toContainText("Not applicable");
  await expect(provisional).not.toContainText("Recorded positive value");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Supplier Competition marks an empty cohort without inventing a neutral share or concentration", async ({
  page,
}) => {
  await page.goto(
    "/?task=supplier-competition&importer=616&revision=HS12&product=010121",
  );

  await expect(
    page.getByText(
      "No supplying economy recorded a positive value in this window.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Concentration unavailable")).toBeVisible();
  await expect(
    page.getByText(
      "No supplying economy recorded a positive value, so concentration cannot be computed.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No Provisional Year supplier evidence is available."),
  ).toBeVisible();
});

test("Supplier Competition keeps the Provisional Year snapshot separate from finalized shares and HHI", async ({
  page,
}) => {
  await page.goto(
    "/?task=supplier-competition&importer=699&revision=HS12&product=010121",
  );

  const structure = page.getByRole("table", {
    name: "Complete supplier-economy structure",
  });
  await expect(structure).toContainText("China · BACI 156");
  await expect(structure).toContainText("Netherlands · BACI 528");
  await expect(structure.getByText("50.000000%")).toHaveCount(2);
  await expect(page.getByText("5000.000000", { exact: true })).toBeVisible();

  const provisional = page.getByRole("table", {
    name: "Provisional Year snapshot",
  });
  await expect(provisional).toContainText("United States · BACI 842");
  await expect(provisional).toContainText("USD 150000");
  await expect(provisional).toContainText("No recorded positive flow");

  // The Provisional Year snapshot never changes the finalized numbers above.
  await expect(structure).toContainText("USD 200000");
  await expect(page.getByText("5000.000000", { exact: true })).toBeVisible();
});

test("Candidate Market remains reachable alongside Supplier Competition", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121&market=528");

  const candidateMarkets = page.getByRole("list", {
    name: "Candidate Markets",
  });
  await expect(candidateMarkets.getByRole("button")).toHaveCount(13);
  await expect(page).not.toHaveURL(/recipe=supplier-competition-v1/);
});

test("switching to Supplier Competition starts with a fresh analysis context", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121");
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).toBeVisible();

  const tasks = page.getByRole("navigation", {
    name: "Choose an analysis task",
  });
  await tasks.getByRole("button", { name: /Supplier Competition/ }).click();

  await expect(page).toHaveURL(/\?recipe=supplier-competition-v1$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();

  await selectSupplierCompetitionContext(page, "124", /Canada/);
  await tasks.getByRole("button", { name: /Candidate Markets/ }).click();

  await expect(page).toHaveURL(/\?recipe=candidate-market-v1$/u);
  await expect(
    page.getByText("Selected product: HS 2012 · 010121"),
  ).not.toBeVisible();
});
