import { expect, test } from "@playwright/test";

test("an analyst loads and scans the complete fixture ranking", async ({
  page,
}) => {
  let analysisRequests = 0;
  await page.route("**/candidate-markets?*", async (route) => {
    analysisRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("/");

  const economy = page.getByRole("combobox", { name: "Export economy" });
  await economy.fill("156");
  await page.getByRole("option", { name: /China/ }).click();

  const product = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("010121");
  await page.getByRole("option", { name: /010121/ }).click();

  const analyze = page.getByRole("button", { name: "Analyze markets" });
  await expect(analyze).toBeEnabled();
  await analyze.click();

  await expect(
    page.getByText("Loading the complete Candidate Market result…"),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Candidate Markets" })).toHaveCount(
    0,
  );

  const markets = page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("button");
  await expect(markets).toHaveCount(13);
  expect(analysisRequests).toBe(1);
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=010121.*market=528/,
  );
  await expect(page.getByText("V202601")).toBeVisible();
  await expect(page.getByText("Finalized 2019–2023")).toBeVisible();
  await expect(page.getByText("Provisional 2024")).toBeVisible();

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(evidence.getByRole("heading", { name: "Netherlands" })).toBeVisible();
  await expect(evidence.getByText("Score 85")).toBeVisible();
  await expect(evidence.getByText("Rank 1 of 13")).toBeVisible();

  await markets.filter({ hasText: "Mexico" }).click();

  await expect(evidence.getByRole("heading", { name: "Mexico" })).toBeVisible();
  await expect(evidence.getByText("Score 70")).toBeVisible();
  await expect(evidence.getByText("Rank 2 of 13")).toBeVisible();
  await expect(page).toHaveURL(/market=484/);
  expect(analysisRequests).toBe(1);
});

test("a canonical analysis URL restores its complete selected context", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=484",
  );

  await expect(page.getByLabel("Export economy")).toHaveValue("156 — China");
  await expect(
    page.getByRole("combobox", { name: "HS 2012 product" }),
  ).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);
  await expect(
    page
      .getByRole("region", { name: "Selected Candidate Market evidence" })
      .getByRole("heading", { name: "Mexico" }),
  ).toBeVisible();
  expect(analysisRequests).toBe(1);
});

test("browser history restores market evidence without reloading analysis", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=528",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  const markets = page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("button");
  await expect(
    evidence.getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();

  await markets.filter({ hasText: "Mexico" }).click();
  await expect(evidence.getByRole("heading", { name: "Mexico" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/market=528/);
  await expect(
    evidence.getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/market=484/);
  await expect(evidence.getByRole("heading", { name: "Mexico" })).toBeVisible();
  expect(analysisRequests).toBe(1);
});

test("a valid empty analysis preserves context without a partial ranking", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=851712",
  );

  await expect(
    page.getByRole("status").getByRole("heading", {
      name: "No eligible Candidate Markets",
    }),
  ).toBeVisible();
  await expect(page.getByText("V202601")).toBeVisible();
  await expect(page.getByText("Finalized 2019–2023")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=851712/,
  );
  expect(analysisRequests).toBe(1);
});

test("a malformed analysis response keeps the context but exposes no ranking", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname.endsWith("/candidate-markets"),
    async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "INVALID_ANALYSIS_QUERY",
          message: "Invalid analysis query.",
        }),
      });
    },
  );

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121",
  );

  await expect(
    page
      .getByRole("region", { name: "Define one analysis context." })
      .getByRole("alert"),
  ).toHaveText(
    "This analysis context is invalid. Check the selected exporter and product.",
  );
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Export economy")).toHaveValue("156 — China");
  await expect(
    page.getByRole("combobox", { name: "HS 2012 product" }),
  ).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
});

test("a stale analysis build can retry the complete result", async ({ page }) => {
  let analysisRequests = 0;
  await page.route(
    (url) => url.pathname.endsWith("/candidate-markets"),
    async (route) => {
      analysisRequests += 1;
      if (analysisRequests === 1) {
        await route.fulfill({
          status: 410,
          contentType: "application/problem+json",
          body: JSON.stringify({
            code: "ANALYSIS_BUILD_RETIRED",
            message: "Analysis build retired.",
          }),
        });
        return;
      }
      await route.continue();
    },
  );

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121",
  );

  const workspace = page.getByRole("region", {
    name: "Define one analysis context.",
  });
  await expect(workspace.getByRole("alert")).toContainText(
    "This analysis build has retired.",
  );
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);

  await workspace
    .getByRole("button", { name: "Retry complete analysis" })
    .click();

  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);
  await expect(
    page
      .getByRole("region", { name: "Selected Candidate Market evidence" })
      .getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();
  expect(analysisRequests).toBe(2);
});

test("a capacity response exposes a retryable state without a ranking", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname.endsWith("/candidate-markets"),
    async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "ANALYSIS_CAPACITY_EXCEEDED",
          message: "Analysis capacity exceeded.",
        }),
      });
    },
  );

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121",
  );

  const workspace = page.getByRole("region", {
    name: "Define one analysis context.",
  });
  await expect(workspace.getByRole("alert")).toContainText(
    "Analysis capacity is temporarily busy.",
  );
  await expect(
    workspace.getByRole("button", { name: "Retry complete analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);
});

test("an unavailable analysis artifact exposes a retryable state", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname.endsWith("/candidate-markets"),
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "ANALYSIS_UNAVAILABLE",
          message: "Analysis unavailable.",
        }),
      });
    },
  );

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121",
  );

  const workspace = page.getByRole("region", {
    name: "Define one analysis context.",
  });
  await expect(workspace.getByRole("alert")).toContainText(
    "The compatible analysis artifact is temporarily unavailable.",
  );
  await expect(
    workspace.getByRole("button", { name: "Retry complete analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);
});

test("leaving the economy field cancels its pending directory", async ({
  page,
}) => {
  let releaseDirectory!: () => void;
  const directoryGate = new Promise<void>((resolve) => {
    releaseDirectory = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.endsWith("/economies") && url.searchParams.get("q") === "",
    async (route) => {
      await directoryGate;
      await route.continue();
    },
  );

  await page.goto("/");
  const economy = page.getByRole("combobox", { name: "Export economy" });
  const directoryRequest = page.waitForRequest(
    (request) => request.url().includes("/economies?q="),
  );

  await economy.focus();
  await directoryRequest;
  await page
    .getByRole("combobox", { name: "HS 2012 product" })
    .focus();
  releaseDirectory();
  await page.waitForTimeout(300);

  await expect(
    page.getByRole("listbox", { name: "Export economy" }),
  ).toHaveCount(0);
});
