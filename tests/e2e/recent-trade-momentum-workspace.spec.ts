import { expect, test, type Page } from "@playwright/test";

const CANONICAL_MARKET_ANALYSIS_URL =
  "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528";

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

test("a supported market loads separately identified Recent Momentum after annual Market Analysis", async ({
  page,
}) => {
  const momentumRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/recent-trade-momentum?")) {
      momentumRequests.push(request.url());
    }
  });

  await page.goto(
    "/?recipe=opportunity-discovery&exporter=156&revision=HS12&product=010121&market=528",
  );

  const candidates = page
    .getByRole("list", { name: "Market Investigation Candidates" });
  await expect(candidates.getByRole("listitem")).toHaveCount(2);
  await expect(candidates.getByRole("link")).toHaveCount(2);
  await expect(candidates.getByRole("button")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Market Analysis/ }),
  ).toHaveCount(0);
  expect(momentumRequests).toEqual([]);

  await candidates
    .getByRole("link", {
      name: "Analyze this market: Netherlands, HS12 010121",
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();

  await expect.poll(() => momentumRequests.length).toBeGreaterThan(0);
  const momentumUrl = new URL(momentumRequests[0]!);
  expect(momentumUrl.searchParams.get("reporter")).toBe("NL");
  expect(momentumUrl.searchParams.get("product")).toBe("010121");
  expect(momentumUrl.searchParams.has("exporter")).toBe(false);
  expect(
    momentumRequests.every((requestUrl) => requestUrl === momentumRequests[0]),
  ).toBe(true);

  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum).toContainText("Rising fast");
  await expect(momentum).toContainText("+25.0%");
  await expect(momentum).toContainText("NL");
  await expect(momentum).toContainText("EUR");
  await expect(momentum).toContainText("2026-02");
  await expect(momentum).toContainText(
    "recent-trade-momentum-serving-fixture-v1",
  );
  await expect(momentum).toContainText("analysis-identity-v1-");
  await expect(momentum).toContainText("dataset-package-v1-");
  await expect(momentum).toContainText(
    "Monthly evidence never changes annual evidence, Candidate Market Score, Investigation Priority, rank, or Data Confidence.",
  );
});

test("bounded monthly outcomes remain distinct and an unmapped market is never guessed", async ({
  page,
}) => {
  const momentumRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/recent-trade-momentum?")) {
      momentumRequests.push(request.url());
    }
  });
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121",
  );
  const candidates = page.getByRole("list", { name: "Candidate Markets" });
  const momentum = page.getByRole("region", { name: "Recent Momentum" });

  await candidates
    .getByRole("link", { name: "Analyze this market: Mexico" })
    .click();
  await expect(momentum).toContainText("Supported coverage — no signal");
  await expect(momentum).toContainText(
    "The comparison base is below the published EUR threshold.",
  );
  await expect(momentum).not.toContainText("Broadly stable");

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await candidates
    .getByRole("link", { name: "Analyze this market: Chile" })
    .click();
  await expect(momentum).toContainText("Not observed");
  await expect(momentum).toContainText(
    "At least one comparison month was not observed.",
  );

  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await candidates
    .getByRole("link", { name: "Analyze this market: Poland" })
    .click();
  await expect(momentum).toContainText("Suppressed or reallocated");
  await expect(momentum).toContainText(
    "At least one monthly observation was suppressed or reallocated by the source.",
  );

  const requestCountBeforeUnmappedMarket = momentumRequests.length;
  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await candidates
    .getByRole("link", {
      name: "Analyze this market: Other Asia, n.e.s. (Taiwan proxy)",
    })
    .click();
  await expect(momentum).toContainText("Unsupported market");
  await expect(momentum).toContainText(
    "HS Tracker does not guess one.",
  );
  expect(momentumRequests).toHaveLength(requestCountBeforeUnmappedMarket);
});

test("an unsupported product mapping never claims an exact reviewed correspondence", async ({
  page,
}) => {
  await page.route("**/recent-trade-momentum?*", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...payload,
        coverageState: "UNSUPPORTED_PRODUCT_MAPPING",
        signalState: null,
        reasonCodes: ["UNSUPPORTED_PRODUCT_MAPPING"],
        recentValueEur: null,
        baselineValueEur: null,
        growthRateDecimal: null,
        growthPercentDisplay: null,
        confidence: null,
        confidenceReasons: [],
      },
    });
  });
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
  );

  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum).toContainText("Unsupported product mapping");
  await expect(momentum).toContainText(
    "The HS12 product has no exact complete reviewed monthly correspondence.",
  );
  await expect(momentum).toContainText(
    "No exact complete reviewed correspondence",
  );
  await expect(momentum).not.toContainText(
    "Direct exact reviewed correspondence",
  );
});

test("preliminary monthly evidence localizes without changing values or identities", async ({
  page,
}) => {
  await page.route("**/recent-trade-momentum?*", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...payload,
        confidence: "MEDIUM",
        confidenceReasons: ["PRELIMINARY_COMPARISON_MONTH"],
      },
    });
  });
  await page.goto(
    "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
  );
  const englishMomentum = page.getByRole("region", {
    name: "Recent Momentum",
  });
  await expect(englishMomentum).toContainText("Medium");
  await expect(englishMomentum).toContainText(
    "At least one comparison month is preliminary under the source schedule.",
  );
  const englishIdentities = await englishMomentum
    .locator(".market-analysis-identity")
    .allTextContents();

  await page.getByRole("button", { name: "简体中文" }).click();

  const chineseMomentum = page.getByRole("region", { name: "近期动量" });
  await expect(chineseMomentum).toContainText("快速上升");
  await expect(chineseMomentum).toContainText("+25.0%");
  await expect(chineseMomentum).toContainText("中");
  await expect(chineseMomentum).toContainText(
    "至少一个比较月份按来源时间表仍属初步数据。",
  );
  await expect(chineseMomentum).toContainText("NL");
  await expect(chineseMomentum).toContainText("EUR 1,250,000");
  expect(
    await chineseMomentum.locator(".market-analysis-identity").allTextContents(),
  ).toEqual(englishIdentities);
});

test("[launch-evidence:annual-invariance-source-unavailable] source unavailability is a bounded monthly state and leaves annual presentation and focus unchanged", async ({
  page,
}) => {
  let releaseMonthlyResponse = () => {};
  const monthlyResponseGate = new Promise<void>((resolve) => {
    releaseMonthlyResponse = resolve;
  });
  await page.route("**/recent-trade-momentum?*", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await monthlyResponseGate;
    await route.fulfill({
      response,
      json: {
        ...payload,
        coverageState: "SOURCE_UNAVAILABLE",
        signalState: null,
        reasonCodes: ["SOURCE_UNAVAILABLE"],
        recentValueEur: null,
        baselineValueEur: null,
        growthRateDecimal: null,
        growthPercentDisplay: null,
        confidence: null,
        confidenceReasons: [],
      },
    });
  });

  await page.goto(CANONICAL_MARKET_ANALYSIS_URL);
  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum.getByRole("status")).toContainText(
    "Loading Recent Momentum",
  );
  const annualBefore = await annualPresentation(page);
  const demandLink = page
    .locator(".market-analysis-area-nav-desktop")
    .getByRole("link", { name: "Demand" });
  await demandLink.focus();
  await expect(demandLink).toBeFocused();

  releaseMonthlyResponse();

  await expect(momentum).toContainText("Source unavailable");
  await expect(momentum).toContainText(
    "The monthly source is unavailable for this reporting context.",
  );
  await expect(momentum).toContainText("SOURCE_UNAVAILABLE");
  await expect(momentum).not.toContainText("+25.0%");
  await expect(demandLink).toBeFocused();
  expect(await annualPresentation(page)).toBe(annualBefore);
});

test("a deployment without a monthly package keeps a truthful visible product area and makes no monthly request", async ({
  page,
}) => {
  const momentumRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/recent-trade-momentum?")) {
      momentumRequests.push(request.url());
    }
  });
  await page.route("**/api/v1/analyses/current", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown> & {
      recommendation: Record<string, unknown>;
      deploymentWindow: Array<
        Record<string, unknown> & {
          recommendation: Record<string, unknown>;
        }
      >;
    };
    await route.fulfill({
      response,
      json: {
        ...manifest,
        recommendation: {
          ...manifest.recommendation,
          recentTradeMomentum: null,
        },
        deploymentWindow: manifest.deploymentWindow.map((deployment) => ({
          ...deployment,
          recommendation: {
            ...deployment.recommendation,
            recentTradeMomentum: null,
          },
        })),
      },
    });
  });

  await page.goto(CANONICAL_MARKET_ANALYSIS_URL);

  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum).toContainText("Monthly capability unavailable");
  await expect(momentum).toContainText(
    "This deployment does not publish a Recent Momentum Dataset Package.",
  );
  await expect(momentum).toContainText("CAPABILITY_UNAVAILABLE");
  await expect(momentum).toContainText("Not available");
  expect(momentumRequests).toEqual([]);
});

for (const boundedRouteCase of [
  {
    label: "unknown reporter",
    reporter: "AU",
    product: "010121",
    expectedCopy: "Unsupported market",
  },
  {
    label: "unknown product",
    reporter: "NL",
    product: "999999",
    expectedCopy: "Unsupported product mapping",
  },
] as const) {
  test(`the real monthly route's ${boundedRouteCase.label} response is bounded without Retry`, async ({
    page,
  }) => {
    let routeStatus: number | null = null;
    await page.route("**/recent-trade-momentum?*", async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("reporter", boundedRouteCase.reporter);
      url.searchParams.set("product", boundedRouteCase.product);
      const response = await route.fetch({ url: url.toString() });
      routeStatus = response.status();
      await route.fulfill({ response });
    });

    await page.goto(CANONICAL_MARKET_ANALYSIS_URL);

    await expect.poll(() => routeStatus).toBe(404);
    const momentum = page.getByRole("region", { name: "Recent Momentum" });
    await expect(momentum).toContainText(boundedRouteCase.expectedCopy);
    await expect(
      momentum.getByRole("button", { name: /Retry/i }),
    ).toHaveCount(0);
  });
}

test("[launch-evidence:annual-invariance-temporary-failure] temporary monthly failure retries locally while annual data and DOM stay byte-for-byte invariant", async ({
  page,
}) => {
  let annualRequests = 0;
  let monthlyRequests = 0;
  let serveSuccessfulRetry = false;
  let releaseFailure = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/market-analysis?*", async (route) => {
    annualRequests += 1;
    await route.continue();
  });
  await page.route("**/recent-trade-momentum?*", async (route) => {
    monthlyRequests += 1;
    if (!serveSuccessfulRetry) {
      await failureGate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ANALYSIS_UNAVAILABLE",
            message: "Monthly evidence is temporarily unavailable.",
          },
        }),
      });
      return;
    }
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...payload,
        sourceVintageId: "monthly-source-vintage-after-local-retry",
      },
    });
  });

  await page.goto(CANONICAL_MARKET_ANALYSIS_URL);
  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum.getByRole("status")).toContainText(
    "Loading Recent Momentum",
  );
  const annualWhileLoading = await annualPresentation(page);
  const annualDataResponse = await page.request.get(
    "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528",
  );
  const annualData = await annualDataResponse.text();

  releaseFailure();

  const retry = momentum.getByRole("button", {
    name: "Retry monthly evidence",
  });
  await expect(retry).toBeVisible();
  expect(await annualPresentation(page)).toBe(annualWhileLoading);
  expect(
    await (
      await page.request.get(
        "/api/v1/analyses/acceptance-fixtures-v1/market-analysis?exporter=156&product=010121&market=528",
      )
    ).text(),
  ).toBe(annualData);
  const retryBox = await retry.boundingBox();
  expect(retryBox?.width).toBeGreaterThanOrEqual(44);
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);

  const annualRequestsBeforeRetry = annualRequests;
  const monthlyRequestsBeforeRetry = monthlyRequests;
  serveSuccessfulRetry = true;
  await retry.click();

  await expect(momentum).toContainText(
    "monthly-source-vintage-after-local-retry",
  );
  await expect(momentum).toContainText("Rising fast");
  expect(await annualPresentation(page)).toBe(annualWhileLoading);
  expect(annualRequests).toBe(annualRequestsBeforeRetry);
  expect(monthlyRequests).toBe(monthlyRequestsBeforeRetry + 1);
});

test("[launch-evidence:annual-invariance-cancellation] rapid market changes cannot paint a stale monthly response under the new annual heading", async ({
  page,
}) => {
  const templateResponse = await page.request.get(
    "/api/v1/analyses/acceptance-fixtures-v1/recent-trade-momentum?reporter=NL&product=010121",
  );
  const template = (await templateResponse.json()) as Record<string, unknown>;
  const requestedReporters: string[] = [];
  await page.route("**/recent-trade-momentum?*", async (route) => {
    const reporter = new URL(route.request().url()).searchParams.get("reporter");
    requestedReporters.push(reporter ?? "");
    if (reporter === "NL") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: template });
      return;
    }
    await route.fulfill({
      json: {
        ...template,
        reporterIso2: "ZA",
        signalState: "RISING",
        growthRateDecimal: "0.090000000000",
        growthPercentDisplay: "+9.0",
        sourceVintageId: "south-africa-monthly-vintage",
        analysisIdentity: `analysis-identity-v1-${"7".repeat(64)}`,
      },
    });
  });

  await page.goto(CANONICAL_MARKET_ANALYSIS_URL);
  await expect.poll(() => requestedReporters).toContain("NL");
  await page.getByRole("link", { name: "Back to opportunities" }).click();
  await page
    .getByRole("list", { name: "Candidate Markets" })
    .getByRole("link")
    .filter({ hasText: "South Africa" })
    .click();

  await expect(
    page.getByRole("heading", { name: "South Africa · Market Analysis" }),
  ).toBeVisible();
  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  await expect(momentum).toContainText("ZA");
  await expect(momentum).toContainText("Rising · +9.0%");
  await expect(momentum).toContainText("south-africa-monthly-vintage");

  await page.waitForTimeout(650);

  await expect(momentum).toContainText("ZA");
  await expect(momentum).not.toContainText("NL");
  await expect(momentum).not.toContainText("+25.0%");
  expect(new Set(requestedReporters)).toEqual(new Set(["NL", "ZA"]));
  expect(requestedReporters.at(-1)).toBe("ZA");
});

test("mobile keeps the adjacent area in reading order with a polite text state and touch-sized retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/recent-trade-momentum?*", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_UNAVAILABLE",
          message: "Monthly evidence is temporarily unavailable.",
        },
      }),
    });
  });
  await page.goto(CANONICAL_MARKET_ANALYSIS_URL);
  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
  const momentum = page.getByRole("region", { name: "Recent Momentum" });
  const retry = momentum.getByRole("button", {
    name: "Retry monthly evidence",
  });
  await expect(retry).toBeVisible();

  const areaPositions = await page
    .locator("#evidence-quality, #recent-momentum, #explore-further")
    .evaluateAll((areas) =>
      areas.map((area) => ({
        id: area.id,
        top: area.getBoundingClientRect().top + window.scrollY,
      })),
    );
  expect(areaPositions.map(({ id }) => id)).toEqual([
    "evidence-quality",
    "recent-momentum",
    "explore-further",
  ]);
  expect(areaPositions[0]!.top).toBeLessThan(areaPositions[1]!.top);
  expect(areaPositions[1]!.top).toBeLessThan(areaPositions[2]!.top);

  await expect(momentum.locator(".recent-momentum-content")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(momentum).toContainText(
    "Recent Momentum could not be loaded. Annual Market Analysis remains available.",
  );
  const retryBox = await retry.boundingBox();
  expect(retryBox?.width).toBeGreaterThanOrEqual(44);
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);
});
