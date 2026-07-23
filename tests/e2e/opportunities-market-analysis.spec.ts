import { expect, test } from "@playwright/test";

import type { MarketInvestigationPage } from "../../src/domain/opportunity-discovery/result";

test("[launch-evidence:opportunity-back] a fixed-product opportunity opens Market Analysis explicitly and Back restores its action", async ({
  page,
}) => {
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121",
  );

  const candidates = page.getByRole("list", { name: "Candidate Markets" });
  await expect(candidates.getByRole("link")).toHaveCount(13);
  await expect(
    page.getByRole("heading", { name: /Market Analysis/u }),
  ).toHaveCount(0);

  const netherlandsRow = candidates
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" });
  const analyzeNetherlands = netherlandsRow.getByRole("link", {
    name: "Analyze this market: Netherlands",
  });
  await expect(netherlandsRow).toContainText("Candidate Market Score 85");
  await expect(netherlandsRow).toContainText("Rank 1 of 13");
  await expect(netherlandsRow).toContainText("Market Size USD 3.70M/year");
  await expect(netherlandsRow).toContainText("Market Growth 31.6%");
  await expect(netherlandsRow).toContainText("Recorded Foothold 30.0%");
  await expect(netherlandsRow).toContainText("Supplier Diversity 1");
  await expect(netherlandsRow).toContainText("Data Confidence: HIGH");
  await expect(netherlandsRow.getByRole("link")).toHaveCount(1);
  await analyzeNetherlands.click();

  await expect(page).toHaveURL(
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*market=528.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: /Add Netherlands to comparison/u }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Back to opportunities" }).click();

  await expect(page).toHaveURL(
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(page).not.toHaveURL(/market=/u);
  await expect(analyzeNetherlands).toBeFocused();
  await expect(
    page.getByRole("heading", { name: /Market Analysis/u }),
  ).toHaveCount(0);
});

test("a cross-product opportunity preserves its exact product, market, and release pin", async ({
  page,
}) => {
  await page.goto("/?recipe=opportunity-discovery-v1&exporter=156");

  const scope = page.getByRole("region", { name: "Workspace scope" });
  await expect(scope).toContainText("156 · China");
  await expect(scope).toContainText("All published HS Products");
  await expect(scope).toContainText("Finalized window2019–2023");
  await expect(
    page.getByText(
      "Ordered by canonical Investigation Priority for this exporter cohort. Pagination preserves that public order.",
    ),
  ).toBeVisible();

  const candidate = page
    .getByRole("list", { name: "Market Investigation Candidates" })
    .getByRole("listitem")
    .filter({ hasText: "Mexico" })
    .filter({ hasText: "010121" });
  const analyzeMarket = candidate.getByRole("link", {
    name: "Analyze this market",
  });
  await expect(candidate.getByRole("button")).toHaveCount(0);
  await expect(analyzeMarket).toHaveAccessibleName(
    "Analyze this market: Mexico, HS12 010121",
  );
  await expect(candidate).toContainText("Horses: live, pure-bred breeding animals");
  await expect(candidate).toContainText("Investigation Priority 73");
  await expect(candidate).toContainText("Unvalidated Market Gap");
  await expect(candidate).toContainText("Market Attractiveness 88");
  await expect(candidate).toContainText("Exporter Fit 55");
  await expect(candidate).toContainText("Data Confidence: HIGH");
  await expect(candidate).toContainText("Coverage: 5 observed · 0 missing");
  const actionBox = await analyzeMarket.boundingBox();
  expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  await analyzeMarket.click();

  await expect(page).toHaveURL(
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*market=484.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(
    page.getByRole("heading", { name: "Mexico · Market Analysis" }),
  ).toBeFocused();

  await page.getByRole("link", { name: "Back to opportunities" }).click();

  await expect(page).toHaveURL(
    /recipe=opportunity-discovery-v1.*exporter=156.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
  );
  await expect(analyzeMarket).toBeFocused();
});

test("the Chinese opportunity action is singular and keyboard/touch usable on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  try {
    await page.goto(
      "/?recipe=opportunity-discovery-v1&exporter=156&locale=zh-Hans",
    );

    const scope = page.getByRole("region", { name: "工作区范围" });
    const viewScope = scope.getByRole("button", { name: "查看范围" });
    await expect(viewScope).toBeVisible();
    await expect(scope.getByText("BACI 发布版本")).not.toBeVisible();
    await viewScope.tap();
    await expect(scope.getByText("BACI 发布版本")).toBeVisible();
    await expect(
      scope.getByRole("button", { name: "更改范围" }),
    ).toBeVisible();
    await expect(scope.getByRole("button", { name: "复制链接" })).toBeVisible();
    await scope.getByRole("button", { name: "来源详情" }).tap();
    await expect(
      page.getByRole("region", { name: "来源详情" }),
    ).toBeVisible();

    const candidate = page
      .getByRole("list", { name: "市场调查候选项" })
      .getByRole("listitem")
      .filter({ hasText: "Mexico" })
      .filter({ hasText: "010121" });
    const action = candidate.getByRole("link", { name: "分析此市场" });
    await expect(action).toHaveCount(1);
    await expect(candidate).toContainText("调查优先级 73");
    await expect(candidate).toContainText("市场吸引力 88");
    await expect(candidate).toContainText("出口方匹配度 55");
    const actionBox = await action.boundingBox();
    expect(actionBox?.width).toBeGreaterThanOrEqual(44);
    expect(actionBox?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await action.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: /Mexico · 市场分析/u }),
    ).toBeFocused();
    await expect(page).toHaveURL(
      /locale=zh-Hans.*product=010121.*market=484.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-/u,
    );

    await page.getByRole("link", { name: "返回机会" }).click();
    await expect(action).toBeFocused();
    await action.tap();
    await expect(
      page.getByRole("heading", { name: /Mexico · 市场分析/u }),
    ).toBeFocused();

    await page.goto(
      "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&locale=zh-Hans",
    );
    const fixedCandidate = page
      .getByRole("list", { name: "候选市场" })
      .getByRole("listitem")
      .filter({ hasText: "Netherlands" });
    await expect(fixedCandidate).toContainText("候选市场评分 85");
    await expect(fixedCandidate).toContainText("数据置信度: 高");
    const fixedAction = fixedCandidate.getByRole("link", {
      name: "分析此市场: Netherlands",
    });
    const fixedBox = await fixedAction.boundingBox();
    expect(fixedBox?.width).toBeGreaterThanOrEqual(44);
    expect(fixedBox?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await fixedAction.tap();
    await expect(
      page.getByRole("heading", { name: /Netherlands · 市场分析/u }),
    ).toBeFocused();
  } finally {
    await context.close();
  }
});

test("Back restores loaded opportunity pages, scroll, and row focus", async ({
  page,
}) => {
  let completePage: MarketInvestigationPage | null = null;
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/opportunities?*",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === "test-page-2") {
        if (completePage === null) {
          throw new Error("The first opportunity page was not requested.");
        }
        await route.fulfill({
          contentType: "application/json",
          json: {
            ...completePage,
            page: {
              ...completePage.page,
              requestedCursor: cursor,
              nextCursor: null,
              returnedCount: 3,
            },
            candidates: completePage.candidates.slice(1),
          },
        });
        return;
      }

      const response = await route.fetch();
      completePage = (await response.json()) as MarketInvestigationPage;
      await route.fulfill({
        response,
        json: {
          ...completePage,
          page: {
            ...completePage.page,
            nextCursor: "test-page-2",
            returnedCount: 1,
          },
          candidates: completePage.candidates.slice(0, 1),
        },
      });
    },
  );

  await page.goto("/?recipe=opportunity-discovery-v1&exporter=156");
  const opportunities = page.getByRole("list", {
    name: "Market Investigation Candidates",
  });
  await expect(
    opportunities.getByRole("link", { name: "Analyze this market" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Load more candidates" }).click();
  await expect(
    opportunities.getByRole("link", { name: "Analyze this market" }),
  ).toHaveCount(4);

  const netherlands = opportunities
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" })
    .filter({ hasText: "010121" })
    .getByRole("link", { name: "Analyze this market" });
  await netherlands.scrollIntoViewIfNeeded();
  const originScrollY = await page.evaluate(() => window.scrollY);
  await netherlands.click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/locale=zh-Hans/u);
  await page.getByRole("link", { name: "返回机会列表" }).click();

  const restoredOpportunities = page.getByRole("list", {
    name: "Market Investigation Candidates",
  });
  const restoredNetherlands = restoredOpportunities
    .getByRole("listitem")
    .filter({ hasText: "Netherlands" })
    .filter({ hasText: "010121" })
    .getByRole("link", {
      name: "Analyze this market: Netherlands, HS12 010121",
    });
  await expect(
    restoredOpportunities.getByRole("link", { name: /Analyze this market/u }),
  ).toHaveCount(4);
  await expect(restoredNetherlands).toBeFocused();
  await expect
    .poll(async () =>
      page.evaluate(
        (expected) => Math.abs(window.scrollY - expected),
        originScrollY,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("[launch-evidence:direct-link-fallback] a direct Market Analysis link falls back to its fixed-product opportunities", async ({
  page,
}) => {
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  const back = page.getByRole("link", { name: "Back to opportunities" });
  await expect(back).toHaveAttribute(
    "href",
    /recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&build=acceptance-fixtures-v1&pkg=dataset-package-v1-[0-9a-f]{64}$/u,
  );
  await expect(back).not.toHaveAttribute("href", /market=/u);

  await back.click();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);
});
