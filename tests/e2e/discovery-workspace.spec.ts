import { expect, test } from "@playwright/test";

import type { CurrentAnalysisManifest } from "../../src/domain/release/current-analysis";

test("an Export Market Analyst loads and scans the complete fixture ranking", async ({
  page,
}) => {
  let analysisRequests = 0;
  await page.route("**/candidate-markets?*", async (route) => {
    analysisRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("/?recipe=candidate-market-v1");

  const analyze = page.getByRole("button", {
    name: "Discover Candidate Markets",
  });
  await expect(analyze).toBeDisabled();
  await expect(
    page.getByText(
      "Select an export economy and one exact Product Catalog result. Free text is not an analytical input.",
    ),
  ).toBeVisible();

  const economy = page.getByRole("combobox", { name: "Export economy" });
  await economy.fill("156");
  await page.getByRole("option", { name: /China/ }).click();

  const product = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("010121");
  await page.getByRole("option", { name: /010121/ }).click();

  await expect(analyze).toBeEnabled();
  await analyze.click();

  await expect(
    page.getByText("Loading the complete Candidate Market result…"),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Candidate Markets" })).toHaveCount(
    0,
  );

  const candidateList = page.getByRole("list", { name: "Candidate Markets" });
  const candidateMarkets = candidateList.getByRole("link");
  const candidateRows = candidateList.getByRole("listitem");
  await expect(candidateRows).toHaveCount(13);
  const expectedCandidates = [
    { rank: 1, market: "Netherlands", confidence: "HIGH", score: 85 },
    { rank: 2, market: "Mexico", confidence: "HIGH", score: 70 },
    { rank: 3, market: "Chile", confidence: "HIGH", score: 57 },
    { rank: 4, market: "Poland", confidence: "HIGH", score: 56 },
    { rank: 5, market: "Canada", confidence: "HIGH", score: 54 },
    { rank: 5, market: "Japan", confidence: "HIGH", score: 54 },
    { rank: 7, market: "South Africa", confidence: "LOW", score: 50 },
    { rank: 7, market: "United States", confidence: "MEDIUM", score: 50 },
    { rank: 9, market: "India", confidence: "HIGH", score: 45 },
    { rank: 10, market: "Brazil", confidence: "HIGH", score: 39 },
    {
      rank: 11,
      market: "Other Asia, n.e.s. (Taiwan proxy)",
      confidence: "HIGH",
      score: 37,
    },
    { rank: 12, market: "Australia", confidence: "HIGH", score: 36 },
    { rank: 13, market: "Kenya", confidence: "LOW", score: 17 },
  ] as const;
  for (const [index, candidate] of expectedCandidates.entries()) {
    const row = candidateRows.nth(index);
    await expect(row).toContainText(`#${candidate.rank}`);
    await expect(row).toContainText(candidate.market);
    await expect(row).toContainText(
      `Candidate Market Score ${candidate.score}`,
    );
    await expect(row).toContainText(
      `Data Confidence: ${candidate.confidence}`,
    );
    await expect(row).toContainText("Analyze this market");
    await expect(row.getByRole("link")).toHaveCount(1);
  }
  await expect(candidateMarkets.first()).toHaveAttribute(
    "href",
    /recipe=candidate-market-v1.*exporter=156.*product=010121.*market=528.*build=acceptance-fixtures-v1.*pkg=dataset-package-v1-[0-9a-f]{64}/u,
  );
  const analyzeActionHeight = await candidateMarkets
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(analyzeActionHeight).toBeGreaterThanOrEqual(44);
  expect(analysisRequests).toBe(1);
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=010121/,
  );
  await expect(page).not.toHaveURL(/market=/u);
  await expect(
    page
      .getByRole("region", { name: "Workspace scope" })
      .getByText("V202601", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Finalized Years 2019–2023")).toBeVisible();
  await expect(page.getByText("Provisional Year 2024")).toBeVisible();
  await expect(
    page.getByText(
      "Ordered by canonical Candidate Market rank. Presentation never re-sorts or recomputes this evidence.",
    ),
  ).toBeVisible();
  const scope = page.getByRole("region", { name: "Workspace scope" });
  await expect(scope).toContainText("HS12 · 010121");
  await expect(scope).toContainText("Horses: live, pure-bred breeding animals");
  await expect(scope).toContainText("纯种繁殖用活马");

  await candidateMarkets.filter({ hasText: "Netherlands" }).click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();
  const netherlandsAnalysis = page.getByRole("region", {
    name: "Netherlands · Market Analysis",
  });
  await expect(
    netherlandsAnalysis.getByText("Candidate Market Score 85"),
  ).toBeVisible();
  await expect(netherlandsAnalysis.getByText("Rank 1 of 13")).toBeVisible();

  await page
    .getByRole("link", { name: "Back to opportunities" })
    .click();
  await candidateMarkets.filter({ hasText: "Mexico" }).click();

  await expect(
    page.getByRole("heading", { name: "Mexico · Market Analysis" }),
  ).toBeFocused();
  const mexicoAnalysis = page.getByRole("region", {
    name: "Mexico · Market Analysis",
  });
  await expect(
    mexicoAnalysis.getByText("Candidate Market Score 70"),
  ).toBeVisible();
  await expect(mexicoAnalysis.getByText("Rank 2 of 13")).toBeVisible();
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

  const scope = page.getByRole("region", { name: "Workspace scope" });
  await expect(scope).toContainText("156 · China");
  await expect(scope).toContainText("HS12 · 010121");
  await expect(scope).toContainText("484 · Mexico");
  await expect(
    page.getByRole("heading", { name: "Mexico · Market Analysis" }),
  ).toBeVisible();
  expect(analysisRequests).toBe(1);
});

test("browser history restores full-width Market Analysis without reloading its Candidate Market result", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121",
  );
  const candidateMarkets = page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link");
  await candidateMarkets.filter({ hasText: "Netherlands" }).click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/market=/u);
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);

  await page.goForward();
  await expect(page).toHaveURL(/market=528/u);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  expect(analysisRequests).toBe(1);
});

test("browser history restores prior HS Product scope after an explicit scope change", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=528",
  );
  await page.getByRole("button", { name: "Change scope" }).click();
  const candidateList = page.getByRole("list", {
    name: "Candidate Markets",
  });
  await expect(candidateList.getByRole("link")).toHaveCount(13);

  const product = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await product.fill("851712");
  await page.getByRole("option", { name: /851712/ }).click();
  await page
    .getByRole("button", { name: "Discover Candidate Markets" })
    .click();
  await expect(
    page.getByRole("status").getByRole("heading", {
      name: "No eligible Candidate Markets",
    }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=010121/,
  );
  await expect(product).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
  await expect(candidateList.getByRole("link")).toHaveCount(13);
  await expect(page).not.toHaveURL(/market=/u);

  await page.goForward();
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=851712/,
  );
  await expect(
    page.getByRole("status").getByRole("heading", {
      name: "No eligible Candidate Markets",
    }),
  ).toBeVisible();
  expect(analysisRequests).toBe(4);
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
  await expect(
    page
      .getByRole("region", { name: "Workspace scope" })
      .getByText("V202601", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Finalized Years 2019–2023")).toBeVisible();
  await expect(
    page.getByText("This is a valid empty evidence result, not a temporary failure."),
  ).toBeVisible();
  await expect(page.getByText("Applicable Finalized window: 2019–2023")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=851712/,
  );
  expect(analysisRequests).toBe(1);
  await page.getByRole("button", { name: "Change scope" }).click();
  await expect(page.getByRole("combobox", { name: "Export economy" })).toBeFocused();
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
      .getByRole("region", { name: "Define the analysis inputs." })
      .getByRole("alert"),
  ).toHaveText(
    "These analysis inputs are invalid. Check the selected export economy and HS Product.",
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

test("a stale analysis build can refresh the complete result", async ({
  page,
}) => {
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
    name: "Define the analysis inputs.",
  });
  await expect(workspace.getByRole("alert")).toContainText(
    "This analysis build has retired.",
  );
  const retiredScope = page.getByRole("region", {
    name: "Workspace scope",
  });
  await expect(
    retiredScope.locator("dd").filter({ hasText: /^Retired$/u }),
  ).toBeVisible();
  await expect(retiredScope).toContainText("Unavailable for retired context");
  await expect(
    page.getByRole("list", { name: "Candidate Markets" }),
  ).toHaveCount(0);

  const refreshCurrentEvidence = workspace.getByRole("button", {
    name: "Refresh with current evidence",
  });
  const recoveryActionBox = await refreshCurrentEvidence.boundingBox();
  expect(recoveryActionBox?.width).toBeGreaterThanOrEqual(44);
  expect(recoveryActionBox?.height).toBeGreaterThanOrEqual(44);
  await refreshCurrentEvidence.click();

  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("link"),
  ).toHaveCount(13);
  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link", { name: "Analyze this market: Netherlands" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeFocused();
  expect(analysisRequests).toBe(2);
});

test("Scope keeps deployment activation separate from Source Freshness Status", async ({
  page,
}) => {
  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as CurrentAnalysisManifest;
    await route.fulfill({
      response,
      json: {
        ...manifest,
        freshness: {
          ...manifest.freshness,
          deploymentActivation: {
            mode: "LAST_VERIFIED_RESIDENT_FALLBACK",
            fallbackReason: "OBJECT_STORE_UNAVAILABLE",
          },
        },
      },
    });
  });

  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121",
  );
  const scope = page.getByRole("region", { name: "Workspace scope" });
  await expect(scope).toContainText(
    "Last Verified Resident Fallback · OBJECT_STORE_UNAVAILABLE",
  );
  await expect(scope).toContainText(
    "Source Freshness StatusLatest known BACI release",
  );
});

const analysisRejectionCases = [
  {
    locale: "en",
    status: 429,
    code: "ANALYSIS_RATE_LIMITED",
    message: "Candidate Market requests are temporarily limited. Wait a moment before retrying.",
    retry: true,
  },
  {
    locale: "zh-Hans",
    status: 429,
    code: "ANALYSIS_RATE_LIMITED",
    message: "候选市场请求暂时受限。请稍候再试。",
    retry: true,
  },
  {
    locale: "en",
    status: 413,
    code: "ANALYSIS_BUDGET_EXCEEDED",
    message: "This Candidate Market request exceeds the complete-result size limit. Choose a different export economy or HS Product.",
    retry: false,
  },
  {
    locale: "zh-Hans",
    status: 413,
    code: "ANALYSIS_BUDGET_EXCEEDED",
    message: "该候选市场请求超出完整结果大小限制。请选择其他出口经济体或 HS 产品。",
    retry: false,
  },
  {
    locale: "en",
    status: 503,
    code: "ANALYSIS_CAPACITY_EXCEEDED",
    message: "Analysis capacity is temporarily busy.",
    retry: true,
  },
  {
    locale: "zh-Hans",
    status: 503,
    code: "ANALYSIS_CAPACITY_EXCEEDED",
    message: "分析容量暂时繁忙。",
    retry: true,
  },
];

for (const { locale, status, code, message, retry } of analysisRejectionCases) {
  test(`a ${locale} ${code} response exposes a localized actionable state without a ranking`, async ({
    page,
  }) => {
  await page.route(
    (url) => url.pathname.endsWith("/candidate-markets"),
    async (route) => {
      await route.fulfill({
        status,
        contentType: "application/problem+json",
        body: JSON.stringify({
          error: { code, message },
        }),
      });
    },
  );

  await page.goto(
    `/?locale=${locale}&exporter=156&revision=HS12&product=010121`,
  );
  if (locale === "zh-Hans") {
    await page.getByRole("button", { name: "简体中文" }).click();
  }

  const workspace = page.getByRole("region", {
    name: locale === "en" ? "Define the analysis inputs." : "定义分析输入。",
  });
  await expect(workspace.getByRole("alert")).toContainText(message);
  await expect(
    workspace.getByRole("button", {
      name:
        locale === "en" ? "Retry complete analysis" : "重试完整分析",
    }),
  ).toHaveCount(retry ? 1 : 0);
  await expect(
    page.getByRole("list", {
      name: locale === "en" ? "Candidate Markets" : "候选市场",
    }),
  ).toHaveCount(0);
  });
}

test("an unavailable analysis artifact exposes a fatal state", async ({
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
    name: "Define the analysis inputs.",
  });
  await expect(workspace.getByRole("alert")).toContainText(
    "The compatible analysis artifact is temporarily unavailable.",
  );
  await expect(
    workspace.getByRole("button", { name: "Retry complete analysis" }),
  ).toHaveCount(0);
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

test("an invalid economy query is not reported as unavailable", async ({
  page,
}) => {
  await page.goto("/");
  const economy = page.getByRole("combobox", { name: "Export economy" });

  await economy.fill("a".repeat(101));

  await expect(
    page.getByText("Economy queries are limited to 100 characters."),
  ).toBeVisible();
  await expect(
    page.getByText("Economy search is temporarily unavailable."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listbox", { name: "Export economy" }),
  ).toHaveCount(0);
});

test("a retired economy directory offers a current-analysis refresh", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname.endsWith("/economies"),
    async (route) => {
      await route.fulfill({
        status: 410,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "ANALYSIS_BUILD_RETIRED",
          message: "Analysis build retired.",
        }),
      });
    },
  );
  await page.goto("/");

  await page.getByRole("combobox", { name: "Export economy" }).focus();

  await expect(
    page.getByText(
      "This economy directory has retired. Refresh the current analysis.",
    ),
  ).toBeVisible();
  const refreshCurrentAnalysis = page.getByRole("button", {
    name: "Refresh current analysis",
  });
  await expect(refreshCurrentAnalysis).toBeVisible();
  const catalogRefreshBox = await refreshCurrentAnalysis.boundingBox();
  expect(catalogRefreshBox?.width).toBeGreaterThanOrEqual(44);
  expect(catalogRefreshBox?.height).toBeGreaterThanOrEqual(44);
});

test("an Export Market Analyst can inspect localized Chinese evidence", async ({
  page,
}) => {
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
    }
  });
  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=528",
  );
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(
    page.getByRole("heading", { name: "Netherlands · 市场分析" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "工作区范围" }).getByText("BACI 发布版本"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "当前来源范围" }).getByText("来源日期"),
  ).toBeVisible();
  await expect(page.getByText("计分定稿年份 2019–2023")).toBeVisible();
  await expect(page.getByText("暂定年份 2024")).toBeVisible();

  const evidence = page.getByRole("region", {
    name: "所选候选市场证据",
  });
  await expect(
    evidence.getByRole("heading", { name: "Netherlands" }),
  ).toBeVisible();
  await expect(evidence.getByText("候选市场评分 85")).toBeVisible();
  await expect(evidence.getByText("排名 1 / 13")).toBeVisible();
  await expect(evidence.getByText("百分位 65")).toBeVisible();
  await expect(page).toHaveURL(
    /exporter=156.*revision=HS12.*product=010121.*market=528/,
  );
  expect(analysisRequests).toBe(1);
});
