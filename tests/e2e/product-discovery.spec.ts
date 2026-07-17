import { expect, test } from "@playwright/test";

const CANDIDATE_MARKET_HOME = "/?recipe=candidate-market-v1";

type SearchFixture = {
  code: string;
  sourceDescriptionEn: string;
  auxiliaryDescriptionZhHans: string;
  matchedText: string;
};

test("an analyst explicitly selects a product with the keyboard", async ({
  page,
}) => {
  await page.goto(CANDIDATE_MARKET_HOME);
  const combobox = page.getByRole("combobox", {
    name: "HS 2012 product",
  });

  await combobox.fill("horse");

  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("HS 2012 · 010121");
  await expect(options.first()).toContainText(
    "Horses: live, pure-bred breeding animals",
  );
  await expect(options.first()).toContainText("纯种繁殖用活马");
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(CANDIDATE_MARKET_HOME);

  await combobox.press("ArrowUp");
  await expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    /product-option-010129/,
  );
  await combobox.press("ArrowDown");
  await expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    /product-option-010121/,
  );
  await combobox.press("Enter");

  await expect(combobox).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
  await expect(combobox).toBeFocused();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(
    "/?recipe=candidate-market-v1&revision=HS12&product=010121",
  );
  const selection = page.getByLabel("Selected product");
  await expect(selection).toContainText("HS 2012 · 010121");
  await expect(selection).toContainText(
    "Horses: live, pure-bred breeding animals",
  );
  await expect(selection).toContainText("纯种繁殖用活马");
});

test("locale changes relabel but never replace an explicit selection", async ({
  page,
}) => {
  await page.goto(CANDIDATE_MARKET_HOME);
  const combobox = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await combobox.fill("馬");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option").first().click();
  const selectedUrl = page.url();

  await page.getByRole("button", { name: "简体中文" }).click();

  const chineseCombobox = page.getByRole("combobox", {
    name: "HS 2012 产品",
  });
  await expect(chineseCombobox).toHaveValue(
    "HS 2012 · 010121 — 纯种繁殖用活马",
  );
  await expect(chineseCombobox).toHaveAttribute("aria-expanded", "false");
  // Locale is independently canonical: it is added even though the
  // recipe's own inputs (no export economy yet) are still incomplete, so
  // the explicit product selection is never lost or replaced.
  await expect(page).toHaveURL(
    selectedUrl.replace(
      "?recipe=candidate-market-v1&revision=",
      "?recipe=candidate-market-v1&locale=zh-Hans&revision=",
    ),
  );
});

test("a canonical product URL restores the same HS Product identity", async ({
  page,
}) => {
  await page.goto("/?recipe=candidate-market-v1&revision=HS12&product=010121");

  await expect(
    page.getByRole("combobox", { name: "HS 2012 product" }),
  ).toHaveValue(
    "HS 2012 · 010121 — Horses: live, pure-bred breeding animals",
  );
  await expect(page).toHaveURL(
    "/?recipe=candidate-market-v1&revision=HS12&product=010121",
  );
});

test("locale changes preserve an ambiguous result set without selecting it", async ({
  page,
}) => {
  let searchRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/product-catalogs/")) {
      searchRequests += 1;
    }
  });
  await page.goto(CANDIDATE_MARKET_HOME);
  await page
    .getByRole("combobox", { name: "HS 2012 product" })
    .fill("馬");
  await expect(page.getByRole("option")).toHaveCount(2);
  expect(searchRequests).toBe(1);

  await page.getByRole("button", { name: "简体中文" }).click();

  await page.getByRole("combobox", { name: "HS 2012 产品" }).focus();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.waitForTimeout(300);
  expect(searchRequests).toBe(1);
  await expect(
    page.getByRole("option").locator("strong"),
  ).toHaveText(["HS 2012 · 010121", "HS 2012 · 010129"]);
  await expect(page.getByRole("option").first()).toContainText("纯种繁殖用活马");
  // Locale is independently canonical: even with no product selected at
  // all (still just an ambiguous, unresolved search), the non-default
  // locale is never lost alongside the explicit Candidate Market task.
  await expect(page).toHaveURL(
    "/?recipe=candidate-market-v1&locale=zh-Hans",
  );
});

test("the combobox closes on Escape and explains an unsupported revision", async ({
  page,
}) => {
  await page.goto(CANDIDATE_MARKET_HOME);
  const combobox = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await combobox.fill("horse");
  await expect(page.getByRole("option")).toHaveCount(2);

  await combobox.press("Escape");

  await expect(combobox).toBeFocused();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await combobox.press("Tab");
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await combobox.focus();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  await combobox.press("Tab");
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await combobox.fill("HS17 010121");
  await expect(
    page.getByText(
      "That HS revision is not supported. This workspace uses HS 2012.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("debouncing and request identity prevent stale search results", async ({
  page,
}) => {
  let horseRequested = false;
  let releaseHorse: () => void = () => {};
  const horseGate = new Promise<void>((resolve) => {
    releaseHorse = resolve;
  });

  await page.route("**/api/v1/product-catalogs/**/products?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "horse") {
      horseRequested = true;
      await horseGate;
      try {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(searchResult("horse", {
            code: "010121",
            sourceDescriptionEn: "Horses: live, pure-bred breeding animals",
            auxiliaryDescriptionZhHans: "纯种繁殖用活马",
            matchedText: "Horses: live, pure-bred breeding animals",
          })),
        });
      } catch {
        // The browser is expected to abort this superseded request.
      }
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(searchResult("mobile", {
        code: "851712",
        sourceDescriptionEn:
          "Telephones for cellular networks or for other wireless networks",
        auxiliaryDescriptionZhHans: "蜂窝网络或其他无线网络用电话机",
        matchedText: "mobile",
      })),
    });
  });

  await page.goto(CANDIDATE_MARKET_HOME);
  const combobox = page.getByRole("combobox", {
    name: "HS 2012 product",
  });
  await combobox.fill("ho");
  await page.waitForTimeout(100);
  expect(horseRequested).toBe(false);
  await combobox.fill("horse");
  await page.waitForTimeout(100);
  expect(horseRequested).toBe(false);
  await expect.poll(() => horseRequested).toBe(true);

  await combobox.fill("mobile");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("851712");
  releaseHorse();
  await page.waitForTimeout(100);
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("851712");
});

test("product choices remain usable without horizontal overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(CANDIDATE_MARKET_HOME);
  await page
    .getByRole("combobox", { name: "HS 2012 product" })
    .fill("horse");

  await expect(page.getByRole("option")).toHaveCount(2);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

function searchResult(query: string, fixture: SearchFixture) {
  return {
    schemaVersion: "product-search-result-v1",
    productSearchBuildId: "acceptance-product-search-v3",
    query: { normalized: query, locale: "en", limit: 20 },
    state: "RESULTS",
    messageCode: null,
    totalMatches: 1,
    truncated: false,
    matches: [
      {
        product: {
          hsRevision: "HS12",
          code: fixture.code,
          sourceDescriptionEn: fixture.sourceDescriptionEn,
          auxiliaryDescriptionZhHans: fixture.auxiliaryDescriptionZhHans,
          translationStatus: "reviewed",
          translationVersion: "acceptance-zh-hans-v1",
        },
        match: {
          class: "EXACT_ALIAS",
          field: "ALIAS_EN",
          matchedText: fixture.matchedText,
        },
      },
    ],
  };
}
