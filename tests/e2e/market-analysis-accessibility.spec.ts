import { expect, test, type Page } from "@playwright/test";

import {
  MARKET_ANALYSIS_ACCESSIBILITY_CASES,
  MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE,
  RECENT_MOMENTUM_LAUNCH_STATES,
} from "../support/market-analysis-launch-matrix";

const CANONICAL_URL = "/?exporter=156&revision=HS12&product=010121&market=528";
const ANNUAL_DATA_URL =
  "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528";

async function openNetherlandsMarketAnalysis(page: Page) {
  await page.goto(CANONICAL_URL);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
}

test(MARKET_ANALYSIS_ACCESSIBILITY_CASES[0].title, async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1_024 });
  await openNetherlandsMarketAnalysis(page);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const navigation = page.getByRole("navigation", { name: "Product areas" });
  const demandLink = navigation.getByRole("link", { name: "Demand" });
  await demandLink.focus();
  await expect(demandLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/#demand$/u);
  await expect(demandLink).toHaveAttribute("aria-current", "location");
  const demandHeading = page
    .locator("#demand")
    .getByRole("heading", { name: "Demand" });
  await expect(demandHeading).toBeVisible();
  await expect(demandHeading).toBeFocused();
  const target = await demandLink.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
});

test(MARKET_ANALYSIS_ACCESSIBILITY_CASES[1].title, async ({
  page,
}) => {
  // A 640 CSS-pixel viewport represents a 1280px desktop viewport at 200%
  // browser zoom and exercises the same reflow seam without browser-specific UI.
  await page.setViewportSize({ width: 640, height: 720 });
  await openNetherlandsMarketAnalysis(page);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page
      .getByRole("region", { name: "Netherlands · Market Analysis" })
      .getByRole("heading", { level: 3 }),
  ).toHaveCount(8);
  await expect(
    page.getByRole("link", { name: "Trade Explorer" }),
  ).toBeVisible();
});

test(MARKET_ANALYSIS_ACCESSIBILITY_CASES[2].title, async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNetherlandsMarketAnalysis(page);

  const motion = await page
    .getByRole("navigation", { name: "Product areas" })
    .getByRole("link", { name: "Supplier Landscape" })
    .evaluate((link) => {
      const style = getComputedStyle(link);
      return {
        preference: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    });
  expect(motion.preference).toBe(true);
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(
    0.000_001,
  );
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(
    0.000_001,
  );

  await page
    .getByRole("navigation", { name: "Product areas" })
    .getByRole("link", { name: "Supplier Landscape" })
    .click();
  await expect(page).toHaveURL(/#supplier-landscape$/u);
});

test(MARKET_ANALYSIS_ACCESSIBILITY_CASES[3].title, async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", contrast: "more" });
  await openNetherlandsMarketAnalysis(page);

  expect(
    await page.evaluate(
      () =>
        matchMedia("(forced-colors: active)").matches &&
        matchMedia("(prefers-contrast: more)").matches,
    ),
  ).toBe(true);

  const evidenceQuality = page.locator("#evidence-quality");
  await expect(
    evidenceQuality.getByRole("heading", { name: "Evidence Quality" }),
  ).toBeVisible();
  await expect(evidenceQuality).toContainText("HIGH");

  const validationLink = page
    .getByRole("navigation", { name: "Product areas" })
    .getByRole("link", { name: "Validation Plan" });
  await validationLink.focus();
  await expect(validationLink).toBeFocused();
  expect(
    await validationLink.evaluate(
      (link) => getComputedStyle(link).outlineStyle !== "none",
    ),
  ).toBe(true);
});

test(MARKET_ANALYSIS_ACCESSIBILITY_CASES[4].title, async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await openNetherlandsMarketAnalysis(page);

    const navigation = page.getByRole("navigation", { name: "Product areas" });
    const disclosure = navigation.locator("details");
    const summary = disclosure.locator("summary");
    const summaryTarget = await summary.boundingBox();
    expect(summaryTarget?.height).toBeGreaterThanOrEqual(44);
    await summary.tap();

    const momentumLink = navigation.locator(
      '.market-analysis-area-nav-mobile a[href="#recent-momentum"]',
    );
    const linkTarget = await momentumLink.boundingBox();
    expect(linkTarget?.height).toBeGreaterThanOrEqual(44);
    await momentumLink.tap();
    await expect(page).toHaveURL(/#recent-momentum$/u);
    await expect(momentumLink).toHaveAttribute("aria-current", "location");
  } finally {
    await context.close();
  }
});

test(MARKET_ANALYSIS_ANNUAL_INVARIANCE_CASE.title, async ({
  page,
}) => {
  const templateResponse = await page.request.get(
    "/api/v1/analyses/acceptance-fixtures-v1/recent-trade-momentum?reporter=NL&product=010121",
  );
  const template = (await templateResponse.json()) as Record<string, unknown>;
  let monthlyState: Record<string, unknown> = template;
  await page.route("**/recent-trade-momentum?*", async (route) => {
    await route.fulfill({ json: monthlyState });
  });

  const annualResponse = await page.request.get(ANNUAL_DATA_URL);
  const annualBytes = await annualResponse.text();
  let annualDom: string | null = null;

  for (const state of RECENT_MOMENTUM_LAUNCH_STATES) {
    monthlyState = {
      ...template,
      coverageState: state.coverageState,
      signalState: state.signalState,
      reasonCodes: state.reasonCodes,
      recentValueEur: state.signalState === null ? null : "1250000",
      baselineValueEur: state.signalState === null ? null : "1000000",
      growthRateDecimal:
        state.signalState === null ? null : state.growthRateDecimal,
      growthPercentDisplay:
        state.signalState === null ? null : state.growthPercentDisplay,
      confidence: state.signalState === null ? null : "HIGH",
      confidenceReasons: [],
    };
    await page.goto(CANONICAL_URL);
    const momentum = page.getByRole("region", { name: "Recent Momentum" });
    await expect(momentum).toContainText(state.expectedCopy);

    const observedAnnualBytes = await (await page.request.get(ANNUAL_DATA_URL)).text();
    expect(observedAnnualBytes, state.label).toBe(annualBytes);
    const observedAnnualDom = await annualPresentation(page);
    annualDom ??= observedAnnualDom;
    expect(observedAnnualDom, state.label).toBe(annualDom);
  }
});

async function annualPresentation(page: Page): Promise<string> {
  return page.locator(".market-analysis-view").evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelector("#recent-momentum")?.remove();
    clone
      .querySelectorAll("[aria-current]")
      .forEach((current) => current.removeAttribute("aria-current"));
    return clone.innerHTML;
  });
}
