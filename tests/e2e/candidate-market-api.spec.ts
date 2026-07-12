import { expect, test } from "@playwright/test";

const analysisPath =
  "/api/v1/analyses/acceptance-fixtures-v1/candidate-markets?exporter=156&product=010121";

test("the running application serves the versioned fixture analysis", async ({
  request,
}) => {
  const response = await request.get(analysisPath);

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("immutable");
  expect(response.headers()["etag"]).toMatch(/^W\/"[0-9a-f]{64}"$/);
  const body = await response.json();
  expect(body).toMatchObject({
    schemaVersion: "candidate-market-result-v1",
    analysisBuildId: "acceptance-fixtures-v1",
    cohortSize: 13,
    provenance: { scoreVersion: "cms-v1" },
  });
  expect(body.candidates).toHaveLength(13);
  expect(body.candidates[0]).toMatchObject({
    economy: {
      code: "528",
      name: "Netherlands",
    },
    score: 85,
    rank: 1,
  });
});

test("the running application honors validators and HEAD semantics", async ({
  request,
}) => {
  const initial = await request.get(analysisPath);
  const etag = initial.headers()["etag"];

  const notModified = await request.get(analysisPath, {
    headers: { "if-none-match": etag },
  });
  expect(notModified.status()).toBe(304);
  expect(await notModified.body()).toHaveLength(0);

  const head = await request.head(analysisPath);
  expect(head.status()).toBe(200);
  expect(head.headers()["etag"]).toBe(etag);
  expect(await head.body()).toHaveLength(0);
});

test("standalone routes preserve typed retired-build responses", async ({
  request,
}) => {
  const [analysis, products, economies] = await Promise.all([
    request.get(
      "/api/v1/analyses/retired-analysis/candidate-markets?exporter=156&product=010121",
    ),
    request.get(
      "/api/v1/product-catalogs/retired-products/products?q=horse&locale=en&limit=5",
    ),
    request.get("/api/v1/analyses/retired-analysis/economies?q=China"),
  ]);

  expect(analysis.status()).toBe(410);
  expect(await analysis.json()).toMatchObject({
    error: { code: "ANALYSIS_BUILD_RETIRED" },
  });
  expect(products.status()).toBe(410);
  expect(await products.json()).toMatchObject({
    error: { code: "PRODUCT_SEARCH_BUILD_RETIRED" },
  });
  expect(economies.status()).toBe(410);
  expect(await economies.json()).toMatchObject({
    error: { code: "ANALYSIS_BUILD_RETIRED" },
  });
});
