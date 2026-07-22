import { expect, test, type Page } from "@playwright/test";

// Durable browser journeys for the Market Analysis product-area view
// (issue #68; spec docs/spec/export-market-analysis-workspace.md §4.3,
// §11.4; docs/spec/export-market-analysis-workspace-ui-design.md §19).
// These exercise the rendered accessible product-area DOM seam directly:
// they never assert on React internals, only on roles, accessible names,
// visible text, focus, and `data-evidence-state` attributes a screen
// reader or CSS selector could also observe.

const CANONICAL_URL = "/?exporter=156&revision=HS12&product=010121&market=528";

async function openNetherlandsMarketAnalysis(page: Page) {
  await page.goto(CANONICAL_URL);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
}

test("the eight product areas render in the exact specified order with no AQ ID or question navigation", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);

  const view = page.getByRole("region", { name: "Netherlands · Market Analysis" });
  await expect(
    view.getByRole("heading", {
      level: 2,
      name: "Netherlands · Market Analysis",
    }),
  ).toBeVisible();
  const headings = await view.getByRole("heading", { level: 3 }).allTextContents();
  expect(headings).toEqual([
    "Market Snapshot",
    "Demand",
    "Exporter Position",
    "Supplier Landscape",
    "Evidence Quality",
    "Recent Momentum",
    "Explore Further",
    "Validation Plan",
  ]);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/AQ-\d{2}/u);
  expect(page.locator("[data-aq-id]")).toHaveCount(0);
});

test("the Market Analysis scope header exposes identity, deployment, freshness, copy, and a canonical in-product Back fallback", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);

  const header = page.locator(".market-analysis-header");
  await expect(header).toContainText(
    "HS12 010121 · Horses: live, pure-bred breeding animals",
  );
  await expect(header).toContainText("Current");
  await expect(header).toContainText("Fresh");
  await expect(
    header.getByRole("button", { name: "Copy Market Analysis link" }),
  ).toBeVisible();

  const back = header.getByRole("link", { name: "Back to opportunities" });
  await expect(back).toHaveAttribute(
    "href",
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await back.click();
  await expect(page).toHaveURL(/recipe=candidate-market-v1/u);
});

test("Market Snapshot exposes deterministic interpretation, canonical score/rank, and the existing score audit view", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);
  const snapshot = page.locator("#snapshot");
  await expect(snapshot).toContainText(
    "Netherlands ranks 1 of 13 Candidate Markets for China in HS12 010121, with HIGH Data Confidence.",
  );
  await expect(snapshot).toContainText("cohort size: 13");
  await expect(snapshot).toContainText("Score audit disclosure");

  // The deterministic interpretation and component facts above appear
  // before the reused, unchanged score audit view (formula, component
  // table, confidence ledger, stability/caveats, provisional evidence,
  // Release Revision, comparison, and investigate links) -- issue #68
  // preserves this view exactly rather than re-deriving it (spec
  // docs/spec/export-market-analysis-workspace-ui-design.md §10.1).
  await expect(
    snapshot.getByText(
      "30% Market Size + 25% Market Growth + 25% Recorded Foothold + 20% Supplier Diversity",
    ),
  ).toBeVisible();
  await expect(
    snapshot.getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();
  await expect(snapshot.getByText("Candidate Market Score 85")).toBeVisible();
});

test("Demand shows the finalized trend, summary, equivalent table, and separately labelled Provisional evidence", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);
  const demand = page.locator("#demand");

  await expect(demand).toContainText(
    "Recorded imports increased from 2019 (USD 100000) to 2023 (USD 160000); the five-year summary CAGR is 12.468265%.",
  );

  const table = demand.getByRole("table", { name: "Five Finalized Years" });
  await expect(table.getByRole("row", { name: /2019/ })).toContainText(
    "Recorded positive value · USD 100000",
  );
  await expect(table.getByRole("row", { name: /2023/ })).toContainText(
    "Recorded positive value · USD 160000",
  );

  await expect(demand).toContainText("USD 60000");
  await expect(demand).toContainText("60.000000%");
  await expect(demand).toContainText("12.468265%");

  const provisional = demand.getByRole("heading", {
    name: "2024 Provisional Year context",
  });
  await expect(provisional).toBeVisible();
  await expect(demand).toContainText(
    "never extends the Finalized trend and is excluded from Candidate Market Score, rank, and Data Confidence",
  );
});

test("Exporter Position distinguishes the score-window, pooled-supplier, and Provisional bilateral bases", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);
  const exporterPosition = page.locator("#exporter-position");

  await expect(exporterPosition).toContainText(
    "The selected export economy supplied 50.000000% of pooled recorded imports and is positioned 1 of 2",
  );
  await expect(
    exporterPosition.getByRole("heading", {
      name: "Score-window recorded foothold",
    }),
  ).toBeVisible();
  await expect(exporterPosition).toContainText("30.0%");
  await expect(
    exporterPosition.getByRole("heading", {
      name: "Pooled supplying-economy position",
    }),
  ).toBeVisible();
  await expect(exporterPosition).toContainText("USD 300000");
  await expect(
    exporterPosition.getByRole("heading", {
      name: "2024 Provisional Year bilateral evidence",
    }),
  ).toBeVisible();
  await expect(exporterPosition).toContainText(
    "Provisional bilateral evidence is not applicable.",
  );
  await expect(exporterPosition).toContainText(
    "These three bases use different periods and denominators; they are not additive or interchangeable.",
  );
});

test("Supplier Landscape shows the complete bounded cohort, exact HHI scale, and selected-exporter position", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);
  const supplierLandscape = page.locator("#supplier-landscape");

  const table = supplierLandscape.getByRole("table", {
    name: "Complete bounded supplying-economy cohort",
  });
  await expect(table.getByRole("row", { name: /China/ })).toContainText(
    "USD 300000",
  );
  await expect(table.getByRole("row", { name: /China/ })).toContainText(
    "50.000000%",
  );
  await expect(table.getByRole("row", { name: /United States/ })).toContainText(
    "50.000000%",
  );
  await expect(table.getByRole("row")).toHaveCount(3); // header + 2 economies

  await expect(supplierLandscape).toContainText(
    "positioned 1 of 2 recorded supplying economies by pooled value",
  );
  await expect(
    supplierLandscape.locator(
      '.market-supplier-bars [data-selected="true"]',
    ),
  ).toHaveCSS("outline-style", "solid");

  await expect(
    supplierLandscape.getByRole("heading", { name: "Concentration (HHI)" }),
  ).toBeVisible();
  await expect(supplierLandscape).toContainText("5000.000000");
  await expect(supplierLandscape).toContainText("on a 0-10,000 scale");
});

test("each analytical product area exposes its own complete constituent provenance", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);

  for (const { area, recipe, owner } of [
    {
      area: "#snapshot",
      recipe: "candidate-market-v1",
      owner: "Candidate Market Module",
    },
    {
      area: "#demand",
      recipe: "trade-trend-v1",
      owner: "Trade Trend Module",
    },
    {
      area: "#exporter-position",
      recipe: "candidate-market-v1",
      owner: "Candidate Market Module",
    },
    {
      area: "#supplier-landscape",
      recipe: "supplier-competition-v1",
      owner: "Supplier Competition Module",
    },
  ]) {
    const provenance = page.locator(area).locator("details.market-area-provenance");
    const summary = provenance.locator("summary");
    await expect(summary).toContainText("Evidence & provenance");
    await expect(summary).toContainText("2019–2023");
    await expect(summary).toContainText("CURRENT_USD");
    await expect(summary).toContainText(recipe);
    if (area === "#demand") {
      await expect(summary).toContainText(
        "Five Finalized Year market/world-import trend",
      );
    }

    await summary.click();
    await expect(provenance).toContainText(
      "Analysis build: acceptance-fixtures-v1",
    );
    await expect(provenance).toContainText(
      "Constituent source release (BACI): V202601",
    );
    await expect(provenance).toContainText(`Calculation owner: ${owner}`);
    await expect(provenance).toContainText(/analysis-identity-v1-[0-9a-f]{64}/u);
    await expect(provenance).toContainText(/dataset-package-v1-[0-9a-f]{64}/u);
  }
});

test("evidence gaps at a low-confidence market remain distinguishable from Validation Plan gaps", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121&market=710");
  await expect(
    page.getByRole("heading", { name: "South Africa · Market Analysis" }),
  ).toBeVisible();

  const demand = page.locator("#demand");
  await expect(
    demand.getByRole("row", { name: /2019/ }),
  ).toContainText("Missing observation");
  await expect(
    demand.getByRole("row", { name: /2020/ }),
  ).toContainText("No recorded positive flow");
  await expect(
    demand.getByRole("row", { name: /2021/ }),
  ).toContainText("Recorded positive value · USD 7000");
  await expect(demand).toContainText("Summary unavailable");
  await expect(demand).toContainText(
    "Only one Finalized Year recorded a positive value.",
  );

  const exporterPosition = page.locator("#exporter-position");
  await expect(exporterPosition).toContainText(
    "The selected export economy recorded no pooled value among South Africa's supplying economies",
  );

  const supplierLandscape = page.locator("#supplier-landscape");
  await expect(supplierLandscape).toContainText(
    "No supplying economy recorded a positive pooled value in the Finalized Years.",
  );
  await expect(supplierLandscape).toContainText(
    "Concentration is unavailable: no supplying economy recorded a positive pooled value.",
  );
  await expect(
    supplierLandscape.getByRole("heading", { name: "Quality warnings" }),
  ).toBeVisible();
  await expect(supplierLandscape).toContainText(
    "The Provisional Year market observation is missing; supplier structure was not observed.",
  );
  await expect(supplierLandscape).toContainText(
    "Some Finalized Years have no recorded supplier at all.",
  );
  await expect(supplierLandscape).toContainText(
    "Concentration is unavailable for this cohort.",
  );

  const evidenceQuality = page.locator("#evidence-quality");
  await expect(evidenceQuality).toContainText("LOW");
  await expect(evidenceQuality).toContainText("3 missing score-window years -30");
  await expect(evidenceQuality).toContainText(
    "Unknown alternative-supplier structure -10",
  );

  // Evidence gaps (missing/no-flow/summary-unavailable/bounded/empty
  // cohort) are separate from the Validation Plan's outside-evidence
  // categories; both remain visible without one masquerading as the
  // other.
  const validationPlan = page.locator("#validation-plan");
  await expect(
    validationPlan.getByRole("heading", {
      name: "Company economics, risk, and forecasting",
    }),
  ).toBeVisible();
});

test("Provisional supplier evidence distinguishes no recorded flow from a missing observation", async ({
  page,
}) => {
  await page.goto("/?exporter=156&revision=HS12&product=010121&market=616");
  await expect(
    page.getByRole("heading", { name: "Poland · Market Analysis" }),
  ).toBeVisible();
  await expect(page.locator("#supplier-landscape")).toContainText(
    "The Provisional Year recorded no positive market flow; there is no recorded supplier structure.",
  );
});

test("Explore Further links preserve market and product context, and Validation Plan shows all five categories with no placeholder", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);

  const exploreFurther = page.locator("#explore-further");
  await expect(
    exploreFurther.getByRole("link", { name: "Trade Trend" }),
  ).toHaveAttribute(
    "href",
    /recipe=trade-trend-v1.*importer=528.*product=010121/u,
  );
  await expect(
    exploreFurther.getByRole("link", { name: "Supplier Competition" }),
  ).toHaveAttribute(
    "href",
    /recipe=supplier-competition-v1.*importer=528.*product=010121/u,
  );
  const tradeExplorerHref = await exploreFurther
    .getByRole("link", { name: "Trade Explorer" })
    .getAttribute("href");
  expect(tradeExplorerHref).not.toBeNull();
  const tradeExplorerContext = new URL(
    tradeExplorerHref ?? "",
    "http://localhost",
  ).searchParams;
  expect(tradeExplorerContext.get("recipe")).toBe("trade-explorer-v1");
  expect(tradeExplorerContext.get("shape")).toBe("finalized-trend-v1");
  expect(tradeExplorerContext.get("measures")).toBe("TRADE_VALUE_USD");
  expect(tradeExplorerContext.get("exportEconomy")).toBe("156");
  expect(tradeExplorerContext.get("importEconomy")).toBe("528");
  expect(tradeExplorerContext.get("hsProduct")).toBe("010121");

  const validationPlan = page.locator("#validation-plan");
  const categoryHeadings = await validationPlan
    .getByRole("heading", { level: 4 })
    .allTextContents();
  expect(categoryHeadings).toEqual([
    "Quantity and customs unit value",
    "Market access and regulation",
    "Logistics and landed cost",
    "Companies and commercial relationships",
    "Company economics, risk, and forecasting",
  ]);
  await expect(validationPlan).toContainText("Candidate extension");
  await expect(validationPlan).toContainText("Intentional product exclusion");

  // The boundary is functional, not lexical: the copy may explain in
  // prose that no request/estimate/credential/logo exists, but the DOM
  // itself must contain none of those actual controls.
  await expect(validationPlan.locator("button")).toHaveCount(0);
  await expect(validationPlan.locator("input, select, textarea")).toHaveCount(
    0,
  );
  await expect(validationPlan.locator("img")).toHaveCount(0);
});

test("selecting a different Candidate Market moves focus to the Market Analysis heading without stealing focus on background updates", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);

  const heading = page.getByRole("heading", {
    name: "Netherlands · Market Analysis",
  });
  await expect(heading).not.toBeFocused();

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link")
    .filter({ hasText: "South Africa" })
    .click();

  const nextHeading = page.getByRole("heading", {
    name: "South Africa · Market Analysis",
  });
  await expect(nextHeading).toBeVisible();
  await expect(nextHeading).toBeFocused();
});

test("an explicit market selection moves focus to the Market Analysis status when loading fails", async ({
  page,
}) => {
  await page.route("**/market-analysis?*", async (route) => {
    const market = new URL(route.request().url()).searchParams.get("market");
    if (market !== "710") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Compatible Market Analysis evidence is unavailable.",
        },
      }),
    });
  });
  await openNetherlandsMarketAnalysis(page);

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link")
    .filter({ hasText: "South Africa" })
    .click();

  const heading = page
    .getByRole("region", { name: "Market Analysis" })
    .getByRole("heading", { name: "Market Analysis" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
});

test("a rapid re-selection cancels the outstanding request so only the last selected market's Market Analysis is ever shown", async ({
  page,
}) => {
  let marketAnalysisRequests = 0;
  await page.route("**/market-analysis?*", async (route) => {
    marketAnalysisRequests += 1;
    if (new URL(route.request().url()).searchParams.get("market") === "528") {
      // Delay Netherlands' response so it would resolve after South
      // Africa's if it were not cancelled/ignored as stale.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue();
  });

  await page.goto("/?exporter=156&revision=HS12&product=010121");
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);

  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link")
    .filter({ hasText: "Netherlands" })
    .click();
  await page.goBack();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);
  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link")
    .filter({ hasText: "South Africa" })
    .click();

  await expect(
    page.getByRole("heading", { name: "South Africa · Market Analysis" }),
  ).toBeVisible();
  // The still-in-flight, later-resolving Netherlands response must never
  // overwrite South Africa's already-rendered Market Analysis.
  await page.waitForTimeout(600);
  await expect(
    page.getByRole("heading", { name: "South Africa · Market Analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toHaveCount(0);
  expect(marketAnalysisRequests).toBeGreaterThanOrEqual(2);
});

test("a fatal annual Market Analysis failure surfaces a full-width assertive recoverable state", async ({
  page,
}) => {
  await page.route("**/market-analysis?*", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Compatible Market Analysis evidence is unavailable.",
        },
      }),
    });
  });

  await page.goto(CANONICAL_URL);
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(0);

  const error = page
    .getByRole("region", { name: "Market Analysis" })
    .getByRole("alert");
  await expect(error).toContainText(
    "Compatible Market Analysis evidence is temporarily unavailable.",
  );
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to opportunities" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Netherlands · Market Analysis" }),
  ).toHaveCount(0);
});

test("a rate-limited Market Analysis preserves Retry-After before enabling Retry", async ({
  page,
}) => {
  await page.route("**/market-analysis?*", async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "1" },
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_RATE_LIMITED",
          message: "Retry later.",
        },
      }),
    });
  });

  await page.goto(CANONICAL_URL);
  const recovery = page
    .getByRole("region", { name: "Market Analysis" })
    .getByRole("alert");
  const retry = recovery.getByRole("button", { name: "Retry" });

  await expect(recovery).toContainText("Retry available in 1 second.");
  await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled({ timeout: 2_500 });
});

test("retired Market Analysis recovery identifies the requested build", async ({
  page,
}) => {
  await page.route("**/market-analysis?*", async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build has retired.",
        },
      }),
    });
  });

  await page.goto(CANONICAL_URL);
  const recovery = page.locator(".market-analysis-error");
  await expect(recovery).toContainText(
    "Analysis build acceptance-fixtures-v1 has retired.",
  );
  await expect(
    recovery.getByRole("button", { name: "Refresh with current evidence" }),
  ).toBeVisible();
});

test("a failed retired-build refresh preserves the original canonical pin", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    if (currentManifestRequests === 1) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "ANALYSIS_UNAVAILABLE", message: "Unavailable." },
      }),
    });
  });
  await page.route("**/market-analysis?*", async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build has retired.",
        },
      }),
    });
  });

  await page.goto(CANONICAL_URL);
  await expect(page.locator(".market-analysis-error")).toContainText(
    "Analysis build acceptance-fixtures-v1 has retired.",
  );
  const originalUrl = page.url();
  expect(originalUrl).toMatch(
    /build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );

  await page
    .getByRole("button", { name: "Refresh with current evidence" })
    .click();
  await expect(page.locator(".analysis-error")).toBeVisible();
  expect(page.url()).toBe(originalUrl);
});

test("manifest revalidation retires loaded evidence without dropping its canonical pin", async ({
  page,
}) => {
  let serveNextManifest = false;
  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    if (!serveNextManifest) {
      await route.fulfill({ response, json: manifest });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...manifest,
        analysisBuildId: "next-fixtures-v1",
        deploymentWindow: [
          {
            ...manifest.deploymentWindow[0],
            analysisBuildId: "next-fixtures-v1",
          },
        ],
      },
    });
  });

  await openNetherlandsMarketAnalysis(page);
  serveNextManifest = true;
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();

  await expect(
    page
      .getByRole("region", { name: "Candidate Market Result Export" })
      .getByRole("alert"),
  ).toContainText("The current analysis changed.");

  const recovery = page.locator(".market-analysis-error");
  await expect(recovery).toContainText(
    "Analysis build acceptance-fixtures-v1 has retired.",
  );
  await expect(
    page.getByRole("link", { name: "Back to opportunities" }),
  ).toHaveAttribute(
    "href",
    /build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
});

test("a retained build never exposes unpinned links for recipes it did not declare", async ({
  page,
}) => {
  const response = await page.request.get("/api/v1/analyses/current");
  const manifest = await response.json();
  const limitedRecommendation = {
    ...manifest.recommendation,
    opportunityDiscovery: null,
    tradeExplorer: null,
  };
  const retained = {
    ...manifest.deploymentWindow[0],
    recommendation: limitedRecommendation,
  };
  const nextCurrent = {
    ...manifest.deploymentWindow[0],
    analysisBuildId: "next-fixtures-v1",
  };
  let serveNextManifest = false;
  await page.route("**/api/v1/analyses/current", async (route) => {
    await route.fulfill({
      response,
      json: serveNextManifest
        ? {
            ...manifest,
            analysisBuildId: "next-fixtures-v1",
            deploymentWindow: [nextCurrent, retained],
          }
        : {
            ...manifest,
            recommendation: limitedRecommendation,
            deploymentWindow: [retained],
          },
    });
  });

  await page.goto(CANONICAL_URL);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  serveNextManifest = true;
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Candidate Market Result Export" })
      .getByRole("alert"),
  ).toContainText("The current analysis changed.");
  await expect(page.locator(".market-analysis-header")).toContainText(
    "Retained",
  );

  await expect(
    page.getByRole("link", { name: "Back to opportunities" }),
  ).toHaveAttribute(
    "href",
    /recipe=candidate-market-v1.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(
    page.locator("#explore-further").getByRole("link", {
      name: "Trade Explorer",
    }),
  ).toHaveCount(0);
  await expect(page.locator("#explore-further")).toContainText(
    "Trade Explorer is unavailable for this evidence version.",
  );
});

test("both locales expose identical values, evidence states, and actions for Market Analysis", async ({
  page,
}) => {
  await openNetherlandsMarketAnalysis(page);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(
    page.getByRole("heading", { name: "Netherlands · 市场分析" }),
  ).toBeVisible();
  const view = page.getByRole("region", { name: "Netherlands · 市场分析" });
  await expect(
    view.getByRole("heading", {
      level: 2,
      name: "Netherlands · 市场分析",
    }),
  ).toBeVisible();
  const headings = await view.getByRole("heading", { level: 3 }).allTextContents();
  expect(headings).toEqual([
    "市场概览",
    "市场需求证据",
    "出口方位置",
    "供应方格局",
    "证据质量",
    "近期动量",
    "深入探索",
    "商业验证计划",
  ]);

  await expect(view).toContainText("100000");
  await expect(view).toContainText("160000");
  await expect(view).toContainText("12.468265%");
  await expect(view).toContainText("5000.000000");
  await expect(view).toContainText("300000");

  const validationPlan = page.locator("#validation-plan");
  const categoryHeadings = await validationPlan
    .getByRole("heading", { level: 4 })
    .allTextContents();
  expect(categoryHeadings).toEqual([
    "数量与海关单位价值",
    "市场准入与监管",
    "物流与到岸成本",
    "公司与商业关系",
    "公司经济性、风险与预测",
  ]);
});

test("the complete Market Analysis journey works at 390px and 320px without horizontal-only comprehension", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openNetherlandsMarketAnalysis(page);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    const view = page.getByRole("region", { name: "Netherlands · Market Analysis" });
    await expect(
      view.getByRole("heading", {
        level: 2,
        name: "Netherlands · Market Analysis",
      }),
    ).toBeVisible();
    const headings = await view
      .getByRole("heading", { level: 3 })
      .allTextContents();
    expect(headings).toEqual([
      "Market Snapshot",
      "Demand",
      "Exporter Position",
      "Supplier Landscape",
      "Evidence Quality",
      "Recent Momentum",
      "Explore Further",
      "Validation Plan",
    ]);

    const areaNavigation = view.getByRole("navigation", {
      name: "Product areas",
    });
    const disclosure = areaNavigation.locator("details");
    await expect(
      disclosure.getByText("Jump to section", { exact: true }),
    ).toBeVisible();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    await expect(
      areaNavigation.getByRole("link", { name: "Market Snapshot" }),
    ).toHaveAttribute("aria-current", "location");
  }
});

test("a collapsed mobile Scope Bar keeps a source warning visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    await route.fulfill({
      response,
      json: {
        ...manifest,
        freshness: {
          ...manifest.freshness,
          state: "CHECK_OVERDUE",
        },
      },
    });
  });

  await openNetherlandsMarketAnalysis(page);
  const scope = page.locator(".market-analysis-scope-mobile");
  await expect(scope).not.toHaveAttribute("open", "");
  await expect(scope.locator("summary")).toContainText(
    "Source freshness check overdue",
  );
});
