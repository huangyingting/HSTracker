import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

async function expectCandidateExportReady(page: Page, market: string) {
  await expect(
    page.getByRole("heading", { name: `${market} · Market Analysis` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    }),
  ).toBeVisible();
}

test("Candidate Markets downloads the complete bilingual 13-row CSV", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  let analysisRequests = 0;
  let exportUrl: URL | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/analyses/current") {
      currentManifestRequests += 1;
    }
    if (url.pathname.endsWith("/candidate-markets")) {
      analysisRequests += 1;
    }
    if (url.pathname.endsWith("/candidate-markets.csv")) {
      exportUrl = url;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=484",
  );
  await expectCandidateExportReady(page, "Mexico");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) {
    throw new Error("The CSV download did not produce a local file.");
  }
  const bytes = await readFile(path);
  const text = bytes.toString("utf8");

  expect(download.suggestedFilename()).toMatch(
    /^hs-tracker_candidate-markets_from-156_HS12-010121_V202601_cmx1-[a-f0-9]{64}\.csv$/u,
  );
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(text.match(/\r\n/g)).toHaveLength(14);
  expect(text.match(/"CANDIDATE"/g)).toHaveLength(13);
  expect(text).toContain('"纯种繁殖用活马"');
  expect(exportUrl).not.toBeNull();
  expect(exportUrl!.searchParams.get("exporter")).toBe("156");
  expect(exportUrl!.searchParams.get("product")).toBe("010121");
  expect(exportUrl!.searchParams.get("productSearchBuildId")).toBe(
    "acceptance-product-search-v3",
  );
  expect(exportUrl!.searchParams.get("freshnessStatusId")).toMatch(
    /^freshness:/u,
  );
  expect(exportUrl!.searchParams.get("schema")).toBe(
    "candidate-markets-csv-v1",
  );
  expect(currentManifestRequests).toBe(2);
  expect(analysisRequests).toBe(1);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("button", {
      name: "下载全部 13 个候选市场的完整 CSV",
    }),
  ).toBeVisible();
});

test("export preflight stops when the current analysis context changed", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  let csvRequests = 0;
  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    if (currentManifestRequests === 1) {
      await route.fulfill({ response });
      return;
    }
    const manifest = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...manifest,
        analysisBuildId: "replacement-analysis-v2",
      },
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/candidate-markets.csv")) {
      csvRequests += 1;
    }
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expectCandidateExportReady(page, "Netherlands");
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();

  await expect(
    page
      .getByRole("region", { name: "Candidate Market Result Export" })
      .getByRole("alert"),
  ).toContainText(
    "The current analysis changed. Run the analysis again before exporting.",
  );
  expect(currentManifestRequests).toBe(2);
  expect(csvRequests).toBe(0);
});

test("export preflight renders refreshed source status before requesting CSV", async ({
  page,
}) => {
  const refreshedFreshnessId = "freshness:browser:export-update";
  let currentManifestRequests = 0;
  let originalFreshnessId = "";
  let warningVisibleBeforeExport = false;
  let requestedFreshnessId = "";
  await page.route("**/api/v1/analyses/current", async (route) => {
    currentManifestRequests += 1;
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown> & {
      freshness: Record<string, unknown>;
    };
    originalFreshnessId = String(manifest.freshness.freshnessStatusId);
    await route.fulfill({
      response,
      json:
        currentManifestRequests === 1
          ? manifest
          : {
              ...manifest,
              freshness: {
                ...manifest.freshness,
                freshnessStatusId: refreshedFreshnessId,
                state: "UPDATE_IN_PROGRESS",
                latestKnownBaciRelease: "V202701",
                newerReleaseDetectedAt: "2027-03-02T12:00:00Z",
                refreshDueAt: "2027-03-09T12:00:00Z",
                effectiveAt: "2027-03-02T12:00:00Z",
              },
            },
    });
  });
  await page.route("**/candidate-markets.csv?*", async (route) => {
    const requested = new URL(route.request().url());
    requestedFreshnessId =
      requested.searchParams.get("freshnessStatusId") ?? "";
    await expect(
      page
        .getByRole("region", { name: "Current source scope" })
        .getByRole("alert"),
    ).toContainText("New BACI release is being validated");
    warningVisibleBeforeExport = true;
    requested.searchParams.set("freshnessStatusId", originalFreshnessId);
    const response = await route.fetch({ url: requested.toString() });
    await route.fulfill({ response });
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expectCandidateExportReady(page, "Netherlands");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();
  await downloadPromise;

  expect(currentManifestRequests).toBe(2);
  expect(requestedFreshnessId).toBe(refreshedFreshnessId);
  expect(warningVisibleBeforeExport).toBe(true);
});

test("a valid empty analysis downloads one attributable row", async ({
  page,
}) => {
  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=851712",
  );
  await expect(
    page.getByRole("heading", { name: "No eligible Candidate Markets" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download complete CSV for the empty analysis",
    })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) {
    throw new Error("The empty CSV download did not produce a local file.");
  }
  const text = (await readFile(path)).toString("utf8");

  expect(text.match(/\r\n/g)).toHaveLength(2);
  expect(text).toContain('"EMPTY_ANALYSIS"');
  expect(text).toContain('"NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW"');
  expect(text).toContain('"851712"');
  expect(text).toContain('"蜂窝网络或其他无线网络用电话机"');
});

test("the public CSV route rejects unsupported methods", async ({
  request,
}) => {
  const current = await request.get("/api/v1/analyses/current");
  const manifest = (await current.json()) as {
    analysisBuildId: string;
    productSearchBuildId: string;
    freshness: { freshnessStatusId: string };
  };
  const parameters = new URLSearchParams({
    exporter: "156",
    product: "010121",
    productSearchBuildId: manifest.productSearchBuildId,
    freshnessStatusId: manifest.freshness.freshnessStatusId,
    schema: "candidate-markets-csv-v1",
  });

  const response = await request.post(
    `/api/v1/analyses/${manifest.analysisBuildId}/candidate-markets.csv?${parameters}`,
  );

  expect(response.status()).toBe(405);
});

test("a stale CSV response revalidates current context without substituting a download", async ({
  page,
}) => {
  let currentManifestRequests = 0;
  let csvRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/analyses/current") {
      currentManifestRequests += 1;
    }
  });
  await page.route("**/candidate-markets.csv?*", async (route) => {
    csvRequests += 1;
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ANALYSIS_BUILD_RETIRED",
          message: "The requested analysis build is no longer served.",
        },
      }),
    });
  });

  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=528",
  );
  await expectCandidateExportReady(page, "Netherlands");
  const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("button", {
      name: "Download complete CSV for all 13 Candidate Markets",
    })
    .click();

  await expect(
    page
      .getByRole("region", { name: "Candidate Market Result Export" })
      .getByRole("alert"),
  ).toContainText(
    "The current analysis changed. Run the analysis again before exporting.",
  );
  expect(currentManifestRequests).toBe(3);
  expect(csvRequests).toBe(1);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentStartedAt,
  );
});
