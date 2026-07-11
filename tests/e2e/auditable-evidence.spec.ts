import { expect, test, type Page } from "@playwright/test";

function countAnalysisRequests(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes("/candidate-markets?")) {
      count += 1;
    }
  });
  return () => count;
}

test("an Export Market Analyst can audit Mexico without external calculation", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=484",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(evidence.getByRole("heading", { name: "Mexico" })).toBeVisible();
  await expect(evidence.getByText("Candidate Market Score 70")).toBeVisible();
  await expect(evidence.getByText("Rank 2 of 13")).toBeVisible();
  await expect(
    evidence.getByText(
      "30% Market Size + 25% Market Growth + 25% Recorded Foothold + 20% Supplier Diversity",
    ),
  ).toBeVisible();
  await expect(
    evidence.getByText("Rounded half-up to the displayed integer score"),
  ).toBeVisible();

  const scoreInputs = evidence.getByRole("table", {
    name: "Candidate Market Score inputs",
  });
  await expect(scoreInputs.getByRole("row")).toHaveCount(5);
  const size = scoreInputs.getByRole("row", { name: /Market Size/ });
  await expect(size).toContainText("USD 9.00M / year");
  await expect(size).toContainText(
    "Mean recorded world imports · 2019–2023 (5 years)",
  );
  await expect(size).toContainText("Computed");
  await expect(size).toContainText("96");
  await expect(size).toContainText("30%");
  await expect(size).toContainText(
    "Larger than most observed Candidate Markets.",
  );

  const growth = scoreInputs.getByRole("row", { name: /Market Growth/ });
  await expect(growth).toContainText("5.73% / year");
  await expect(growth).toContainText(
    "Log-linear nominal growth · 2019–2023 (5 years)",
  );
  await expect(growth).toContainText("Computed");
  await expect(growth).toContainText("41");
  await expect(growth).toContainText("25%");
  await expect(growth).toContainText(
    "Near the cohort midpoint for observed nominal growth.",
  );

  const foothold = scoreInputs.getByRole("row", {
    name: /Recorded Foothold/,
  });
  await expect(foothold).toContainText("20.0% share");
  await expect(foothold).toContainText(
    "Selected export economy's recorded share · 2019–2023",
  );
  await expect(foothold).toContainText("Computed");
  await expect(foothold).toContainText("65");
  await expect(foothold).toContainText("25%");
  await expect(foothold).toContainText(
    "Above the cohort midpoint for recorded exporter foothold.",
  );

  const diversity = scoreInputs.getByRole("row", {
    name: /Supplier Diversity/,
  });
  await expect(diversity).toContainText("0.933 index");
  await expect(diversity).toContainText(
    "Mean alternative-supplier diversity · 2019–2023 (5 years)",
  );
  await expect(diversity).toContainText("Computed");
  await expect(diversity).toContainText("71");
  await expect(diversity).toContainText("20%");
  await expect(diversity).toContainText(
    "Above the cohort midpoint for alternative-supplier diversity.",
  );

  const confidence = evidence.getByRole("region", {
    name: "Data Confidence",
  });
  await expect(confidence.getByText("Separate from rank")).toBeVisible();
  await expect(confidence.getByText("HIGH · 100")).toBeVisible();
  await expect(confidence.getByText("No deductions")).toBeVisible();
  await expect(confidence.getByText("5 of 5 Finalized Years observed")).toBeVisible();
  await expect(confidence.getByText("Quantity coverage")).toHaveCount(0);

  const quantity = evidence.getByRole("region", {
    name: "Quantity completeness",
  });
  await expect(quantity.getByText("Separate from Data Confidence")).toBeVisible();
  await expect(quantity.getByText("Quantity coverage 88.0%")).toBeVisible();

  const provisional = evidence.getByRole("region", {
    name: "2024 Provisional Year snapshot",
  });
  await expect(provisional.getByText("Supporting evidence only")).toBeVisible();
  await expect(
    provisional.getByText(
      "Excluded from Candidate Market Score, rank, and Data Confidence.",
    ),
  ).toBeVisible();
  await expect(provisional.getByText("USD 11.0M")).toBeVisible();
  await expect(provisional.getByText("USD 2.20M")).toBeVisible();
  await expect(provisional.getByText("20.0% share")).toBeVisible();
  await expect(provisional.getByText("80.0%")).toBeVisible();

  const caveats = evidence.getByRole("region", {
    name: "Stability and caveats",
  });
  await expect(caveats.getByText("2021–2023 stability")).toBeVisible();
  await expect(caveats.getByText("Not flagged · 0.954842")).toBeVisible();
  await expect(caveats.getByText("12 common Candidate Markets")).toBeVisible();
  await expect(caveats.getByText("2014–2023 stability")).toBeVisible();
  await expect(caveats.getByText("Not flagged · 0.994681")).toBeVisible();
  await expect(caveats.getByText("No candidate-specific caveats")).toBeVisible();
  await expect(
    caveats.getByText("No HS Product series discontinuity flagged"),
  ).toBeVisible();
  expect(analysisRequestCount()).toBe(1);
});

test("South Africa exposes neutral reasons and the sparse-evidence cap", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=710",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(
    evidence.getByRole("heading", { name: "South Africa" }),
  ).toBeVisible();
  await expect(evidence.getByText("Candidate Market Score 50")).toBeVisible();
  await expect(evidence.getByText("Rank 7 of 13")).toBeVisible();

  const scoreInputs = evidence.getByRole("table", {
    name: "Candidate Market Score inputs",
  });
  const growth = scoreInputs.getByRole("row", { name: /Market Growth/ });
  await expect(growth).toContainText("Not computed");
  await expect(growth).toContainText("Neutral midpoint");
  await expect(growth).toContainText("Assigned midpoint 50 · not ranked");
  await expect(growth).not.toContainText("of observed cohort");
  await expect(growth).toContainText(
    "Fewer than 3 observed Finalized Years · 2022–2023 (2 years)",
  );
  await expect(growth).toContainText(
    "Neutral midpoint 50 assigned; growth direction is unsupported.",
  );

  const diversity = scoreInputs.getByRole("row", {
    name: /Supplier Diversity/,
  });
  await expect(diversity).toContainText("Not computed");
  await expect(diversity).toContainText("Neutral midpoint");
  await expect(diversity).toContainText("Assigned midpoint 50 · not ranked");
  await expect(diversity).not.toContainText("of observed cohort");
  await expect(diversity).toContainText(
    "No observed year has a computable alternative-supplier structure",
  );
  await expect(diversity).toContainText(
    "Neutral midpoint 50 assigned; supplier structure is unknown.",
  );

  const confidence = evidence.getByRole("region", {
    name: "Data Confidence",
  });
  await expect(confidence.getByText("LOW · 40")).toBeVisible();
  await expect(confidence.getByText("3 missing score-window years")).toBeVisible();
  await expect(
    confidence.getByText("Unknown alternative-supplier structure"),
  ).toBeVisible();
  await expect(confidence.getByText("Sparse-evidence cap applied")).toBeVisible();
  await expect(confidence.getByText("2 of 5 Finalized Years observed")).toBeVisible();

  const provisional = evidence.getByRole("region", {
    name: "2024 Provisional Year snapshot",
  });
  await expect(
    provisional.getByRole("heading", {
      name: "No recorded positive flow in the Provisional Year data",
    }),
  ).toBeVisible();
  await expect(
    provisional.getByText(
      "Excluded from Candidate Market Score, rank, and Data Confidence.",
    ),
  ).toBeVisible();
  expect(analysisRequestCount()).toBe(1);
});

test("India distinguishes no recorded bilateral flow from no trade", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=699",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(evidence.getByRole("heading", { name: "India" })).toBeVisible();

  const foothold = evidence
    .getByRole("table", { name: "Candidate Market Score inputs" })
    .getByRole("row", { name: /Recorded Foothold/ });
  await expect(foothold).toContainText(
    "No recorded bilateral flow in the score window",
  );
  await expect(foothold).toContainText("Computed");
  await expect(foothold).toContainText("Percentile 12");
  await expect(foothold).toContainText("25%");
  await expect(evidence.getByText(/no trade/i)).toHaveCount(0);

  const confidence = evidence.getByRole("region", {
    name: "Data Confidence",
  });
  await expect(confidence.getByText("HIGH · 100")).toBeVisible();
  await expect(confidence.getByText("No deductions")).toBeVisible();

  const provisional = evidence.getByRole("region", {
    name: "2024 Provisional Year snapshot",
  });
  await expect(provisional.getByText("USD 6.00M")).toBeVisible();
  await expect(
    provisional.getByText("No recorded positive flow in the Provisional Year"),
  ).toBeVisible();
  await expect(provisional.getByText("Not available")).toBeVisible();
  await expect(provisional.getByText("66.7%")).toBeVisible();
  expect(analysisRequestCount()).toBe(1);
});

test("BACI code 490 keeps its source identity and proxy caveat", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=490",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  await expect(
    evidence.getByRole("heading", {
      name: "Other Asia, n.e.s. (Taiwan proxy)",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Candidate Markets" })
      .getByRole("button", {
        name: /Other Asia, n\.e\.s\. \(Taiwan proxy\)/,
      }),
  ).toBeVisible();
  await expect(evidence.getByText("BACI 490")).toBeVisible();
  await expect(evidence.getByText("No public ISO3")).toBeVisible();
  await expect(
    evidence.getByText(
      "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
    ),
  ).toBeVisible();
  await expect(evidence.getByText("Candidate Market Score 37")).toBeVisible();
  await expect(evidence.getByText("Rank 11 of 13")).toBeVisible();

  const confidence = evidence.getByRole("region", {
    name: "Data Confidence",
  });
  await expect(confidence.getByText("HIGH · 90")).toBeVisible();
  await expect(confidence.getByText("Source identity proxy")).toBeVisible();
  await expect(confidence.getByText("-10")).toBeVisible();
  await expect(
    evidence
      .getByRole("region", { name: "Quantity completeness" })
      .getByText("Quantity coverage 100%"),
  ).toBeVisible();
  await expect(evidence.getByText(/^Taiwan$/)).toHaveCount(0);
  expect(analysisRequestCount()).toBe(1);
});

test("comparison stays client-local with consistent evidence units", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=484",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  const candidateMarkets = page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("button");

  const addMexico = evidence.getByRole("button", {
    name: "Add Mexico to comparison",
  });
  await addMexico.focus();
  await page.keyboard.press("Enter");

  const comparison = page.getByRole("region", {
    name: "Candidate Market comparison",
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(comparison).toBeInViewport();

  await candidateMarkets.filter({ hasText: "South Africa" }).focus();
  await page.keyboard.press("Enter");
  await evidence
    .getByRole("button", { name: "Add South Africa to comparison" })
    .focus();
  await page.keyboard.press("Space");

  await candidateMarkets
    .filter({ hasText: "Other Asia, n.e.s. (Taiwan proxy)" })
    .focus();
  await page.keyboard.press("Enter");
  await evidence
    .getByRole("button", {
      name: "Add Other Asia, n.e.s. (Taiwan proxy) to comparison",
    })
    .focus();
  await page.keyboard.press("Enter");

  await expect(comparison.getByText("Comparison tray · 3/3")).toBeVisible();
  const table = comparison.getByRole("table", {
    name: "Compared Candidate Markets",
  });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("columnheader")).toHaveText([
    "Candidate Market",
    "Score / rank",
    "Market Size (USD / year)",
    "Market Growth (% / year)",
    "Recorded Foothold (% share)",
    "Supplier Diversity (index)",
    "Data Confidence",
    "Actions",
  ]);

  const mexico = table.getByRole("row", { name: /Mexico/ });
  await expect(mexico).toContainText("70 / #2");
  await expect(mexico).toContainText("USD 9.00M / year");
  await expect(mexico).toContainText("5.73% / year");
  await expect(mexico).toContainText("20.0% share");
  await expect(mexico).toContainText("0.933 index");
  await expect(mexico).toContainText("HIGH · 100");

  const southAfrica = table.getByRole("row", { name: /South Africa/ });
  await expect(southAfrica).toContainText("Neutral midpoint");
  await expect(southAfrica).toContainText("LOW · 40");

  const code490 = table.getByRole("row", { name: /Other Asia/ });
  await expect(code490).toContainText("BACI 490");
  await expect(code490).toContainText("No public ISO3");
  await expect(code490).toContainText("HIGH · 90");

  await table
    .getByRole("button", { name: "Remove Mexico from comparison" })
    .focus();
  await page.keyboard.press("Enter");

  await expect(comparison.getByText("Comparison tray · 2/3")).toBeVisible();
  await expect(table.getByRole("row", { name: /Mexico/ })).toHaveCount(0);
  expect(analysisRequestCount()).toBe(1);
});

test("both integer-score tie groups preserve competition ranks", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=124",
  );

  const evidence = page.getByRole("region", {
    name: "Selected Candidate Market evidence",
  });
  const candidateMarkets = page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("button");
  await expect(
    evidence.getByText(
      "Equal displayed integer scores share a competition rank.",
    ),
  ).toBeVisible();

  await evidence
    .getByRole("button", { name: "Add Canada to comparison" })
    .click();
  await candidateMarkets.filter({ hasText: "Japan" }).click();
  await evidence
    .getByRole("button", { name: "Add Japan to comparison" })
    .click();
  await candidateMarkets.filter({ hasText: "South Africa" }).click();
  await evidence
    .getByRole("button", { name: "Add South Africa to comparison" })
    .click();

  const table = page.getByRole("table", {
    name: "Compared Candidate Markets",
  });
  await expect(table.getByRole("row", { name: /Canada/ })).toContainText(
    "54 / #5",
  );
  await expect(table.getByRole("row", { name: /Japan/ })).toContainText(
    "54 / #5",
  );
  await expect(table.getByRole("row", { name: /South Africa/ })).toContainText(
    "50 / #7",
  );

  await table
    .getByRole("button", { name: "Remove Canada from comparison" })
    .click();
  await candidateMarkets.filter({ hasText: "United States" }).click();
  await evidence
    .getByRole("button", { name: "Add United States to comparison" })
    .click();

  await expect(table.getByRole("row", { name: /United States/ })).toContainText(
    "50 / #7",
  );
  expect(analysisRequestCount()).toBe(1);
});

test("audit evidence stacks without horizontal overflow on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=484",
  );

  const scoreInputs = page.getByRole("table", {
    name: "Candidate Market Score inputs",
  });
  const size = scoreInputs.getByRole("row", { name: /Market Size/ });
  const componentBox = await size.getByRole("rowheader").boundingBox();
  const rawEvidenceBox = await size.getByRole("cell").first().boundingBox();

  expect(componentBox).not.toBeNull();
  expect(rawEvidenceBox).not.toBeNull();
  expect(rawEvidenceBox!.y).toBeGreaterThanOrEqual(
    componentBox!.y + componentBox!.height,
  );
  await expect(size.getByText("Computed")).toBeVisible();
  await expect(
    size.getByRole("cell", { name: "Percentile 96" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("locale switching preserves the auditable comparison context", async ({
  page,
}) => {
  const analysisRequestCount = countAnalysisRequests(page);

  await page.goto(
    "/?exporter=156&revision=HS12&product=010121&market=484",
  );
  await page
    .getByRole("button", { name: "Add Mexico to comparison" })
    .click();
  const canonicalUrl = page.url();

  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  const evidence = page.getByRole("region", { name: "所选候选市场证据" });
  await expect(evidence.getByText("候选市场评分 70")).toBeVisible();
  await expect(evidence.getByText("排名 2 / 13")).toBeVisible();
  await expect(
    evidence.getByText(
      "30% 市场规模 + 25% 市场增长 + 25% 已记录市场基础 + 20% 供应方多样性",
    ),
  ).toBeVisible();

  const scoreInputs = evidence.getByRole("table", {
    name: "候选市场评分输入",
  });
  const size = scoreInputs.getByRole("row", { name: /市场规模/ });
  await expect(size).toContainText("USD 9.00M / 年");
  await expect(size).toContainText("已计算");
  await expect(size).toContainText("百分位 96");

  const confidence = evidence.getByRole("region", { name: "数据置信度" });
  await expect(confidence.getByText("高 · 100")).toBeVisible();
  await expect(confidence.getByText("无扣减")).toBeVisible();

  const comparison = page.getByRole("region", { name: "候选市场比较" });
  await expect(comparison.getByText("比较栏 · 1/3")).toBeVisible();
  const mexico = comparison
    .getByRole("table", { name: "已比较候选市场" })
    .getByRole("row", { name: /Mexico/ });
  await expect(mexico).toContainText("70 / #2");
  await expect(mexico).toContainText("USD 9.00M / 年");
  await expect(
    comparison.getByRole("button", { name: "从比较栏移除 Mexico" }),
  ).toBeVisible();

  expect(page.url()).toBe(canonicalUrl);
  expect(analysisRequestCount()).toBe(1);
});
