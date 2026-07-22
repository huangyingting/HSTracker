import { expect, test } from "@playwright/test";

import type { CurrentAnalysisManifest } from "../../src/domain/release/current-analysis";

test("the bare product shell leads with Scope instead of recipe selection", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Analyze export markets with public trade evidence.",
    }),
  ).toBeVisible();
  const journey = page.getByRole("navigation", {
    name: "Export Market Workspace journey",
  });
  await expect(journey.getByRole("listitem")).toHaveText([
    /Scope/,
    /Opportunities/,
    /Market Analysis/,
  ]);
  await expect(journey.getByText("Scope", { exact: true })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByRole("navigation", { name: "Choose an analysis task" }),
  ).toHaveCount(0);
  const productScope = page.getByRole("group", { name: "Product scope" });
  await expect(productScope.getByRole("button")).toHaveText([
    "Across published products",
    "One confirmed HS Product",
  ]);
  await expect(
    productScope.getByRole("button", { name: "My confirmed portfolio" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Sign in to use a confirmed portfolio",
    }),
  ).toBeVisible();

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  await expect(advancedTools.getByRole("link")).toHaveText([
    "Trade Trend",
    "Supplier Competition",
    "Trade Explorer",
  ]);
  await productScope
    .getByRole("button", { name: "One confirmed HS Product" })
    .click();
  await expect(advancedTools.getByRole("link")).toHaveCount(0);
});

test("migration telemetry reports anonymous route families only", async ({
  page,
}) => {
  const payloads: unknown[] = [];
  const telemetryHeaders: Record<string, string>[] = [];
  await page.context().addCookies([
    {
      name: "hs_tracker_session",
      value: "must-not-leave-the-browser",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.route("**/api/telemetry/workspace-route", async (route) => {
    payloads.push(route.request().postDataJSON());
    telemetryHeaders.push(route.request().headers());
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect
    .poll(() => payloads)
    .toContainEqual({ routeFamily: "primary-scope" });

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  await advancedTools.getByRole("link", { name: "Trade Explorer" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Combine approved dimensions, measures, and filters under strict budgets.",
    }),
  ).toBeVisible();
  await expect
    .poll(() => payloads)
    .toContainEqual({ routeFamily: "advanced-trade-explorer" });
  expect(
    payloads.every(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        Object.keys(payload).length === 1,
    ),
  ).toBe(true);
  expect(
    telemetryHeaders.every(
        (headers) => headers.cookie === undefined && headers.referer === undefined,
    ),
  ).toBe(true);
});

test("an anonymous portfolio URL normalizes to the public workspace with a sign-in affordance", async ({
  page,
}) => {
  await page.goto("/?recipe=opportunity-discovery-v1&portfolio=filter");

  await expect(
    page.getByRole("heading", {
      name: "Start with the exporter, then browse the public candidate feed.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Sign in to use a confirmed portfolio",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Restore your exporter and product portfolio.",
    }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/portfolio=filter/u);
});

test("changing from a loaded all-product scope to exact product clears incompatible results", async ({
  page,
}) => {
  await page.goto("/?recipe=opportunity-discovery-v1&exporter=156");
  const candidates = page
    .getByRole("list", { name: "Market Investigation Candidates" })
    .getByRole("listitem");
  await expect(candidates).toHaveCount(4);

  await page
    .getByRole("group", { name: "Product scope" })
    .getByRole("button", { name: "One confirmed HS Product" })
    .click();
  await expect(candidates).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "HS 2012 product" }),
  ).toBeFocused();
});

test("the compact journey and Advanced tools remain touch-ready on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const journey = page.getByRole("navigation", {
    name: "Export Market Workspace journey",
  });
  await expect(journey.getByRole("listitem")).toHaveCount(3);
  const journeyBox = await journey.boundingBox();
  const boundaryBox = await page
    .getByRole("complementary", {
      name: "Discovery aid, not a recommendation.",
    })
    .boundingBox();
  expect(boundaryBox?.y).toBeLessThan(journeyBox?.y ?? 0);

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  const trigger = advancedTools.getByRole("button", {
    name: "Advanced tools",
  });
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  for (const link of await advancedTools.getByRole("link").all()) {
    const linkBox = await link.boundingBox();
    expect(linkBox?.height).toBeGreaterThanOrEqual(44);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("header Advanced tools preserve the selected Market Analysis context and Back", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fetchResponse = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetchResponse(...args);
      if (!response.url.includes("/trade-trends?")) {
        return response;
      }
      const parse = response.json.bind(response);
      Object.defineProperty(response, "json", {
        value: async () => {
          const payload = await parse();
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          return payload;
        },
      });
      return response;
    };
  });
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Analyze export markets with public trade evidence.",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Evidence first. Decisions remain yours.",
    }),
  ).toHaveCount(0);

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  const tradeTrend = advancedTools.getByRole("link", { name: "Trade Trend" });
  const manifestResponse = await page.request.get("/api/v1/analyses/current");
  const manifest = (await manifestResponse.json()) as CurrentAnalysisManifest;
  const tradeTrendHref = await tradeTrend.getAttribute("href");
  expect(
    new URL(tradeTrendHref ?? "", page.url()).searchParams.get("pkg"),
  ).toBe(manifest.recommendation.tradeTrend?.datasetPackageIdentity);
  await expect(tradeTrend).toHaveAttribute(
    "href",
    /recipe=trade-trend-v1.*importer=528.*product=010121.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  const trendResponse = page.waitForResponse((response) =>
    response.url().includes("/trade-trends?"),
  );
  await tradeTrend.click();

  await expect(
    page.getByRole("heading", { name: "Inspect annual import evidence." }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue(/Netherlands/u);
  await expect(
    page
      .getByRole("navigation", { name: "Export Market Workspace journey" })
      .locator("[aria-current=\"step\"]"),
  ).toHaveCount(0);
  await trendResponse;
  await page.goBack();
  await expect(page).toHaveURL(
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*market=528/u,
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
});

test("header Advanced tools preserve a mismatched source package so every destination fails closed", async ({
  page,
}) => {
  const mismatchedPackage = `dataset-package-v1-${"0".repeat(64)}`;
  await page.goto(
    `/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528&build=acceptance-fixtures-v1&pkg=${mismatchedPackage}`,
  );

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  const tradeTrend = advancedTools.getByRole("link", { name: "Trade Trend" });
  await expect(tradeTrend).toHaveAttribute(
    "href",
    new RegExp(`build=acceptance-fixtures-v1.*pkg=${mismatchedPackage}`, "u"),
  );
  await tradeTrend.click();
  await expect(page.locator(".analysis-error")).toContainText(
    "This analysis build has retired.",
  );
});

test("the primary journey advances from Scope through Opportunities to Market Analysis", async ({
  page,
}) => {
  await page.goto("/");
  const journey = page.getByRole("navigation", {
    name: "Export Market Workspace journey",
  });
  const economy = page.getByRole("combobox", { name: "Export economy" });
  await economy.fill("156");
  await expect(page.getByRole("option", { name: /China/u })).toBeVisible();
  await economy.press("ArrowDown");
  await economy.press("Enter");
  await page
    .getByRole("button", { name: "Discover product-market opportunities" })
    .click();

  const candidates = page.getByRole("list", {
    name: "Market Investigation Candidates",
  });
  await expect(candidates.getByRole("listitem")).toHaveCount(4);
  await expect(
    journey.getByText("Opportunities", { exact: true }),
  ).toHaveAttribute("aria-current", "step");

  await candidates
    .getByRole("listitem")
    .filter({ hasText: "Mexico" })
    .filter({ hasText: "010121" })
    .getByRole("link", { name: "Analyze this market" })
    .click();
  await expect(
    journey.getByText("Market Analysis", { exact: true }),
  ).toHaveAttribute("aria-current", "step");

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await expect(
    journey.getByText("Opportunities", { exact: true }),
  ).toHaveAttribute("aria-current", "step");
});

test("a fixed-product selection updates the shared shell to Market Analysis", async ({
  page,
}) => {
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121",
  );
  const journey = page.getByRole("navigation", {
    name: "Export Market Workspace journey",
  });
  await expect(
    journey.getByText("Opportunities", { exact: true }),
  ).toHaveAttribute("aria-current", "step");

  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link", { name: "Analyze this market: Netherlands" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  await expect(
    journey.getByText("Market Analysis", { exact: true }),
  ).toHaveAttribute("aria-current", "step");
});
