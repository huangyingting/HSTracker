import { expect, test } from "@playwright/test";

test("an Export Market Analyst can inspect the exact current source scope", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/analyses/current")) {
      currentManifestRequests += 1;
    }
    if (request.url().includes("/candidate-markets?")) {
      analysisRequests += 1;
      expect(request.url()).toContain(
        "/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?",
      );
    }
  });

  await page.goto("/?exporter=156&revision=HS12&product=010121&market=484");

  const scope = page.getByRole("region", { name: "Current source scope" });
  await expect(scope).toContainText(
    "BACI HS 2012 - V202601 - source updated 22 Jan 2026",
  );
  await expect(scope).toContainText(
    "Score window 2019-2023 - provisional context 2024",
  );
  await expect(
    scope.locator(".source-scope-facts").getByText("V202601", { exact: true }),
  ).toBeVisible();
  await expect(scope.getByText("Latest known BACI release")).toBeVisible();
  await scope.getByRole("button", { name: "Source details" }).click();

  const details = page.getByRole("region", { name: "Source details" });
  await expect(details).toContainText(
    "Source: CEPII BACI, HS 2012, V202601 (updated 2026-01-22), Etalab Open Licence 2.0.",
  );
  await expect(
    details.getByRole("link", { name: "CEPII BACI documentation" }),
  ).toHaveAttribute(
    "href",
    "https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html",
  );
  await expect(details).toContainText("Ingested years 2012–2024");
  await expect(details).toContainText("Finalized cutoff 2023");
  await expect(details).toContainText("3-year window 2021–2023");
  await expect(details).toContainText("5-year score window 2019–2023");
  await expect(details).toContainText("10-year window 2014–2023");
  await expect(details).toContainText(
    "Provisional Year 2024 · supporting evidence only - excluded from score and rank",
  );
  await expect(details).toContainText("Analysis build acceptance-fixtures-v1");
  await expect(details).toContainText(
    "Artifact 038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
  );
  await expect(details).toContainText(
    "Latest successful source check 2026-03-01T00:00:00Z",
  );
  await expect(details).toContainText("No compatible prior release comparison");
  await expect(details).toContainText(
    "BACI Releases are never mixed in one Candidate Market Score.",
  );

  const revision = page
    .getByRole("region", { name: "Selected Candidate Market evidence" })
    .getByRole("region", { name: "Release Revision" });
  await expect(revision).toContainText(
    "No compatible prior release comparison",
  );
  await expect(revision).toContainText(
    "Release Revision means evidence changed between BACI releases, not historical growth.",
  );

  expect(currentManifestRequests).toBe(1);
  expect(analysisRequests).toBe(1);
});

test("a retired analysis build is replaced through current-manifest revalidation without a reload", async ({
  page,
}) => {
  const canonicalUrl = "/?exporter=156&revision=HS12&product=010121&market=484";
  let currentManifestRequests = 0;
  let retiredBuildRequests = 0;
  let replacementBuildRequests = 0;
  let replacementProductRequests = 0;

  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json:
        currentManifestRequests === 1
          ? manifest
          : {
              ...manifest,
              analysisBuildId: "replacement-analysis-v2",
              productSearchBuildId: "replacement-products-v2",
            },
    });
  });
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      retiredBuildRequests += 1;
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: "public-error-v1",
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build has retired.",
        }),
      });
    },
  );
  await page.route(
    "**/api/v1/analyses/replacement-analysis-v2/**",
    async (route) => {
      replacementBuildRequests += 1;
      const originalUrl = route
        .request()
        .url()
        .replace("replacement-analysis-v2", "acceptance-fixtures-v1");
      const response = await route.fetch({ url: originalUrl });
      if (route.request().url().includes("/candidate-markets?")) {
        const result = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          response,
          json: { ...result, analysisBuildId: "replacement-analysis-v2" },
        });
        return;
      }
      await route.fulfill({ response });
    },
  );
  await page.route(
    "**/api/v1/product-catalogs/replacement-products-v2/**",
    async (route) => {
      replacementProductRequests += 1;
      const originalUrl = route
        .request()
        .url()
        .replace("replacement-products-v2", "acceptance-product-search-v3");
      const response = await route.fetch({ url: originalUrl });
      await route.fulfill({ response });
    },
  );

  await page.goto(canonicalUrl);
  await expect(page.locator(".analysis-error")).toContainText(
    "This analysis build has retired.",
  );
  const documentStartedAt = await page.evaluate(() => performance.timeOrigin);

  await page.getByRole("button", { name: "Refresh current analysis" }).click();

  await expect(
    page.getByRole("region", { name: "Selected Candidate Market evidence" }),
  ).toContainText("Mexico");
  await expect(page).toHaveURL(
    new RegExp(`${canonicalUrl.replace("?", "\\?")}$`),
  );
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentStartedAt,
  );
  expect(currentManifestRequests).toBe(2);
  expect(retiredBuildRequests).toBe(1);
  expect(replacementBuildRequests).toBe(2);
  expect(replacementProductRequests).toBe(1);
});

test("a retired build is not retried with a release-incompatible current manifest", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  let retiredBuildRequests = 0;
  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    if (currentManifestRequests === 1) {
      await route.fulfill({ response });
      return;
    }
    const manifest = (await response.json()) as Record<string, unknown> & {
      freshness: Record<string, unknown>;
    };
    await route.fulfill({
      response,
      json: {
        ...manifest,
        freshness: {
          ...manifest.freshness,
          servedBaciRelease: "V202501",
        },
      },
    });
  });
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      retiredBuildRequests += 1;
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: "public-error-v1",
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build has retired.",
        }),
      });
    },
  );

  await page.goto("/?exporter=156&revision=HS12&product=010121");
  await expect(page.locator(".analysis-error")).toBeVisible();
  await page.getByRole("button", { name: "Refresh current analysis" }).click();

  await expect(page.locator(".analysis-error")).toContainText(
    "This analysis build has retired.",
  );
  expect(currentManifestRequests).toBe(2);
  expect(retiredBuildRequests).toBe(1);
});

const warningStates = [
  {
    state: "UPDATE_IN_PROGRESS",
    latestKnownBaciRelease: "V202701",
    newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
    refreshDueAt: "2027-03-09T12:00:00Z",
    effectiveAt: "2027-03-02T12:00:00Z",
    wording: "New BACI release is being validated",
    evidence:
      "Detected 2027-03-02T12:00:00Z · Refresh due 2027-03-09T12:00:00Z",
  },
  {
    state: "REFRESH_DELAYED",
    latestKnownBaciRelease: "V202701",
    newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
    refreshDueAt: "2027-03-09T12:00:00Z",
    effectiveAt: "2027-03-09T12:00:00Z",
    wording: "Data refresh delayed - showing the last validated release",
    evidence:
      "Currently serving V202601 · Latest successful source check 2026-03-01T00:00:00Z",
  },
  {
    state: "CHECK_OVERDUE",
    latestKnownBaciRelease: "V202601",
    newerReleaseDetectedAt: null,
    refreshDueAt: null,
    effectiveAt: "2026-03-15T00:00:00Z",
    wording:
      "Source freshness check overdue - showing the last validated release",
    evidence:
      "Currently serving V202601 · Latest successful source check 2026-03-01T00:00:00Z",
  },
] as const;

for (const warningState of warningStates) {
  test(`the ${warningState.state} source status remains visible with absolute evidence`, async ({
    page,
  }) => {
    await page.route("**/api/v1/analyses/current", async (route) => {
      const response = await route.fetch();
      const manifest = (await response.json()) as Record<string, unknown> & {
        freshness: Record<string, unknown>;
      };
      await route.fulfill({
        response,
        json: {
          ...manifest,
          freshness: {
            ...manifest.freshness,
            freshnessStatusId: `freshness:browser:${warningState.state}`,
            state: warningState.state,
            latestKnownBaciRelease: warningState.latestKnownBaciRelease,
            newerReleaseDetectedAt: warningState.newerReleaseDetectedAt,
            refreshDueAt: warningState.refreshDueAt,
            effectiveAt: warningState.effectiveAt,
          },
        },
      });
    });

    await page.goto("/");

    const scope = page.getByRole("region", { name: "Current source scope" });
    const warning = scope.getByRole("alert");
    await expect(warning).toContainText(warningState.wording);
    await expect(warning).toContainText(warningState.evidence);
    await expect(
      scope.getByRole("button", { name: "Source details" }),
    ).toBeVisible();
  });
}

test("freshness explanation is localized without rewriting source identities", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown> & {
      freshness: Record<string, unknown>;
    };
    await route.fulfill({
      response,
      json: {
        ...manifest,
        freshness: {
          ...manifest.freshness,
          freshnessStatusId: "freshness:browser:update-in-progress",
          state: "UPDATE_IN_PROGRESS",
          latestKnownBaciRelease: "V202701",
          newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
          refreshDueAt: "2027-03-09T12:00:00Z",
          effectiveAt: "2027-03-02T12:00:00Z",
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "简体中文" }).click();

  const scope = page.getByRole("region", { name: "当前来源范围" });
  await expect(scope.getByRole("alert")).toContainText(
    "正在验证新的 BACI 数据版",
  );
  await expect(scope.getByRole("alert")).toContainText("2027-03-02T12:00:00Z");
  await expect(scope).toContainText("V202601");
  expect(currentManifestRequests).toBe(1);
});

test("material Release Revision evidence stays separate from historical growth", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      const response = await route.fetch();
      const result = (await response.json()) as {
        releaseRevisionSummary: Record<string, unknown>;
        candidates: Array<{
          economy: { code: string };
          releaseRevision: Record<string, unknown>;
        }>;
      } & Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...result,
          releaseRevisionSummary: {
            comparisonRelease: "V202501",
            previousArtifactSha256:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            notComparedReason: null,
            noLongerEligibleCount: 2,
          },
          candidates: result.candidates.map((candidate) => {
            const releaseRevision = {
              "484": {
                state: "MATERIAL_CHANGE",
                previousReleaseRecomputedScore: 45,
                scoreChange: 12,
                previousReleaseRecomputedRankPercentile: "50.000",
                rankPercentileChange: "15.000",
                materialChange: true,
              },
              "528": {
                state: "BELOW_THRESHOLD",
                previousReleaseRecomputedScore: 82,
                scoreChange: 3,
                previousReleaseRecomputedRankPercentile: "95.000",
                rankPercentileChange: "5.000",
                materialChange: false,
              },
              "710": {
                state: "NEWLY_ELIGIBLE",
                previousReleaseRecomputedScore: null,
                scoreChange: null,
                previousReleaseRecomputedRankPercentile: null,
                rankPercentileChange: null,
                materialChange: null,
              },
            }[candidate.economy.code];
            return releaseRevision === undefined
              ? candidate
              : { ...candidate, releaseRevision };
          }),
        },
      });
    },
  );

  await page.goto("/?exporter=156&revision=HS12&product=010121&market=484");

  const revision = page
    .getByRole("region", { name: "Selected Candidate Market evidence" })
    .getByRole("region", { name: "Release Revision" });
  await expect(revision).toContainText("Changed materially since V202501");
  await expect(revision).toContainText("Previous-release recomputed score 45");
  await expect(revision).toContainText("Score change +12");
  await expect(revision).toContainText(
    "Previous-release recomputed rank percentile 50.000",
  );
  await expect(revision).toContainText("Rank-percentile change +15.000");
  await expect(revision).toContainText("No longer eligible in this release: 2");
  await expect(revision).toContainText(
    "Release Revision means evidence changed between BACI releases, not historical growth.",
  );

  await page.getByRole("button", { name: "Source details" }).click();
  await expect(
    page.getByRole("region", { name: "Source details" }),
  ).toContainText("Release Revision comparison V202501");
  await expect(
    page.getByRole("region", { name: "Source details" }),
  ).toContainText("No longer eligible in this release 2");

  const candidates = page.getByRole("list", { name: "Candidate Markets" });
  await candidates.getByRole("button", { name: /Netherlands/ }).click();
  await expect(revision).toContainText("No material revision flag");
  await expect(revision).toContainText("Previous-release recomputed score 82");

  await candidates.getByRole("button", { name: /South Africa/ }).click();
  await expect(revision).toContainText("Newly eligible in this release");
  await expect(revision).not.toContainText("Previous-release recomputed score");
});

test("a skipped prior release keeps the canonical not-compared wording", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?*",
    async (route) => {
      const response = await route.fetch();
      const result = (await response.json()) as {
        candidates: Array<Record<string, unknown>>;
      } & Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...result,
          releaseRevisionSummary: {
            comparisonRelease: "V202401",
            previousArtifactSha256:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            notComparedReason: "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
            noLongerEligibleCount: null,
          },
          candidates: result.candidates.map((candidate) => ({
            ...candidate,
            releaseRevision: {
              state: "NOT_COMPARED",
              previousReleaseRecomputedScore: null,
              scoreChange: null,
              previousReleaseRecomputedRankPercentile: null,
              rankPercentileChange: null,
              materialChange: null,
            },
          })),
        },
      });
    },
  );

  await page.goto("/?exporter=156&revision=HS12&product=010121&market=484");

  const revision = page
    .getByRole("region", { name: "Selected Candidate Market evidence" })
    .getByRole("region", { name: "Release Revision" });
  await expect(revision).toContainText(
    "No compatible prior release comparison",
  );
  await expect(revision).toContainText("Comparison release: V202401");
  await expect(revision).not.toContainText(
    "The prior release artifact cannot cover this exact score window.",
  );
});
