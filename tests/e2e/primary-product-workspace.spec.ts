import { expect, test } from "@playwright/test";

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

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  await expect(advancedTools.getByRole("link")).toHaveText([
    "Trade Trend",
    "Supplier Competition",
    "Trade Explorer",
  ]);
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
  expect(journeyBox?.y).toBeLessThan(boundaryBox?.y ?? 0);

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
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  const advancedTools = page.getByRole("group", { name: "Advanced tools" });
  await advancedTools.getByRole("button", { name: "Advanced tools" }).click();
  const tradeTrend = advancedTools.getByRole("link", { name: "Trade Trend" });
  await expect(tradeTrend).toHaveAttribute(
    "href",
    /recipe=trade-trend-v1.*importer=528.*product=010121.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await tradeTrend.click();

  await expect(
    page.getByRole("heading", { name: "Inspect annual import evidence." }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Importing economy" }),
  ).toHaveValue(/Netherlands/u);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
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
