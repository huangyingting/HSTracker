import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as getCurrent } from "../../src/app/api/v1/analyses/current/route";
import { GET as getCandidateMarkets } from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets/route";
import { GET as getCandidateMarketsCsv } from "../../src/app/api/v1/analyses/[analysisBuildId]/candidate-markets.csv/route";
import { GET as getEconomies } from "../../src/app/api/v1/analyses/[analysisBuildId]/economies/route";
import { GET as getProducts } from "../../src/app/api/v1/product-catalogs/[productSearchBuildId]/products/route";
import { GET as getHealth } from "../../src/app/healthz/route";
import { GET as getOpportunities } from "../../src/app/api/v1/analyses/[analysisBuildId]/opportunities/route";
import { GET as getOpportunityDetail } from "../../src/app/api/v1/analyses/[analysisBuildId]/opportunities/[productCode]/[importerCode]/route";
import { serializeCandidateMarketCsv } from "../../src/export/candidate-market-csv";
import { InMemoryReleaseObjectStore } from "../../src/release/in-memory-release-object-store";
import { ReleasePublisher } from "../../src/release/release-publication";
import { installApplicationRuntime } from "../../src/runtime/application-runtime";
import { VerifiedReleaseRuntime } from "../../src/runtime/verified-release-runtime";
import { CountingReleaseReader } from "../support/counting-release-reader";
import {
  RUNTIME_RELEASE_FIXTURE,
  writeRuntimeReleaseCandidate,
} from "../support/runtime-release";

const temporaryDirectories: string[] = [];
const cleanups: (() => void)[] = [];
const runtimes: VerifiedReleaseRuntime[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
  for (const runtime of runtimes.splice(0)) {
    runtime.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("verified release route integration", () => {
  it("serves one paired real release through all versioned read interfaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-routes-"));
    temporaryDirectories.push(root);
    const candidate = await writeRuntimeReleaseCandidate(
      join(root, "candidate"),
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const published = await new ReleasePublisher(objectStore).promote({
      ...candidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const reader = new CountingReleaseReader(objectStore);
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore: reader,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    cleanups.push(installApplicationRuntime(runtime));
    const startupReads = reader.readCount;
    const platformOutcome = await runtime.tradeAnalytics.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: published.analysisBuildId,
      exporterCode: RUNTIME_RELEASE_FIXTURE.exporterCode,
      productCode: RUNTIME_RELEASE_FIXTURE.productCode,
    });
    if (platformOutcome.state !== "success") {
      throw new TypeError("Expected the verified-release platform to succeed.");
    }

    const current = await getCurrent(
      new Request("http://localhost/api/v1/analyses/current"),
    );
    const currentBody = await current.json();
    const health = getHealth();
    const analysis = await getCandidateMarkets(
      new Request(
        `http://localhost/api/v1/analyses/${published.analysisBuildId}/candidate-markets` +
          `?exporter=${RUNTIME_RELEASE_FIXTURE.exporterCode}` +
          `&product=${RUNTIME_RELEASE_FIXTURE.productCode}`,
      ),
      routeContext("analysisBuildId", published.analysisBuildId),
    );
    const analysisBody = await analysis.text();
    const products = await getProducts(
      new Request(
        `http://localhost/api/v1/product-catalogs/${published.productSearchBuildId}/products` +
          "?q=horse&locale=en&limit=20",
      ),
      routeContext(
        "productSearchBuildId",
        published.productSearchBuildId,
      ),
    );
    const economies = await getEconomies(
      new Request(
        `http://localhost/api/v1/analyses/${published.analysisBuildId}/economies?q=Germany`,
      ),
      routeContext("analysisBuildId", published.analysisBuildId),
    );
    const csvUrl = new URL(
      `http://localhost/api/v1/analyses/${published.analysisBuildId}/candidate-markets.csv`,
    );
    csvUrl.searchParams.set(
      "exporter",
      RUNTIME_RELEASE_FIXTURE.exporterCode,
    );
    csvUrl.searchParams.set(
      "product",
      RUNTIME_RELEASE_FIXTURE.productCode,
    );
    csvUrl.searchParams.set(
      "productSearchBuildId",
      published.productSearchBuildId,
    );
    csvUrl.searchParams.set(
      "freshnessStatusId",
      currentBody.freshness.freshnessStatusId,
    );
    csvUrl.searchParams.set("schema", "candidate-markets-csv-v1");
    const csv = await getCandidateMarketsCsv(
      new Request(csvUrl),
      routeContext("analysisBuildId", published.analysisBuildId),
    );
    const csvBytes = new Uint8Array(await csv.arrayBuffer());
    const csvBody = new TextDecoder().decode(csvBytes);
    const freshness = runtime.resolveFreshnessStatus(
      currentBody.freshness.freshnessStatusId,
    );
    const productSearch = await runtime.searchProducts({
      productSearchBuildId: published.productSearchBuildId,
      query: RUNTIME_RELEASE_FIXTURE.productCode,
      locale: "en",
      limit: 1,
    });
    const product = productSearch.matches.find(
      (match) =>
        match.product.code === RUNTIME_RELEASE_FIXTURE.productCode,
    )?.product;
    if (freshness === null || product === undefined) {
      throw new TypeError("Expected verified export dependencies.");
    }
    const platformCsv = serializeCandidateMarketCsv({
      result: platformOutcome.payload,
      product,
      manifest: {
        ...runtime.currentAnalysis(),
        freshness,
      },
    });
    const retiredAnalysisBuildId =
      "analysis-build-v1-ffffffffffffffff";
    const retiredProductSearchBuildId =
      "product-search-v1-ffffffffffffffff";
    const retiredAnalysis = await getCandidateMarkets(
      new Request(
        `http://localhost/api/v1/analyses/${retiredAnalysisBuildId}/candidate-markets` +
          `?exporter=${RUNTIME_RELEASE_FIXTURE.exporterCode}` +
          `&product=${RUNTIME_RELEASE_FIXTURE.productCode}`,
      ),
      routeContext("analysisBuildId", retiredAnalysisBuildId),
    );
    const retiredProducts = await getProducts(
      new Request(
        `http://localhost/api/v1/product-catalogs/${retiredProductSearchBuildId}/products` +
          "?q=horse&locale=en&limit=20",
      ),
      routeContext(
        "productSearchBuildId",
        retiredProductSearchBuildId,
      ),
    );

    expect({
      current: currentBody,
      health: await health.json(),
      analysis: JSON.parse(analysisBody),
      products: await products.json(),
      economies: await economies.json(),
      csv: {
        status: csv.status,
        contentType: csv.headers.get("content-type"),
        hasAnalysisBuild: csvBody.includes(published.analysisBuildId),
        hasProductSearchBuild: csvBody.includes(
          published.productSearchBuildId,
        ),
        hasCandidate: csvBody.includes("Germany"),
      },
      retired: {
        analysisStatus: retiredAnalysis.status,
        analysisError: await retiredAnalysis.json(),
        productStatus: retiredProducts.status,
        productError: await retiredProducts.json(),
      },
      requestTimeObjectReads: reader.readCount - startupReads,
    }).toMatchObject({
      current: {
        analysisBuildId: published.analysisBuildId,
        productSearchBuildId: published.productSearchBuildId,
        analysisReleaseCatalogSha256:
          published.analysisReleaseCatalogSha256,
      },
      health: {
        status: "ok",
        readiness: "ready",
        deployment: {
          deploymentPairingId: published.deploymentPairingId,
          analysisBuildId: published.analysisBuildId,
          productSearchBuildId: published.productSearchBuildId,
        },
      },
      analysis: {
        analysisBuildId: published.analysisBuildId,
        analysisReleaseCatalogSha256:
          published.analysisReleaseCatalogSha256,
        provenance: { baciRelease: published.baciRelease },
      },
      products: {
        productSearchBuildId: published.productSearchBuildId,
        matches: [
          { product: { code: RUNTIME_RELEASE_FIXTURE.productCode } },
        ],
      },
      economies: {
        analysisBuildId: published.analysisBuildId,
        matches: [{ economy: { code: "276" } }],
      },
      csv: {
        status: 200,
        contentType: "text/csv; charset=utf-8; header=present",
        hasAnalysisBuild: true,
        hasProductSearchBuild: true,
        hasCandidate: true,
      },
      retired: {
        analysisStatus: 410,
        analysisError: {
          error: { code: "ANALYSIS_BUILD_RETIRED" },
        },
        productStatus: 410,
        productError: {
          error: { code: "PRODUCT_SEARCH_BUILD_RETIRED" },
        },
      },
      requestTimeObjectReads: 0,
    });
    expect(analysisBody).toBe(JSON.stringify(platformOutcome.payload));
    expect(csvBytes).toEqual(platformCsv.bytes);
  }, 20_000);

  it("binds a retained build's own manifests, catalog, and freshness -- never current's -- for JSON and CSV routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-routes-"));
    temporaryDirectories.push(root);
    const firstCandidate = await writeRuntimeReleaseCandidate(
      join(root, "gen1"),
      {
        valueOffset: 0,
        productSearchBuildId: "product-search-v1-1111111111111111",
      },
    );
    const secondCandidate = await writeRuntimeReleaseCandidate(
      join(root, "gen2"),
      {
        valueOffset: 10,
        productSearchBuildId: "product-search-v1-2222222222222222",
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const first = await publisher.promote({
      ...firstCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const second = await publisher.promote({
      ...secondCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    cleanups.push(installApplicationRuntime(runtime));

    expect(first.analysisBuildId).not.toBe(second.analysisBuildId);
    expect(first.productSearchBuildId).not.toBe(second.productSearchBuildId);

    const currentResponse = await getCurrent(
      new Request("http://localhost/api/v1/analyses/current"),
    );
    const currentBody = await currentResponse.json();
    expect(currentBody.deploymentWindow.map((b: { analysisBuildId: string }) => b.analysisBuildId)).toEqual(
      [second.analysisBuildId, first.analysisBuildId],
    );

    const retainedFreshness = runtime.resolveAnalysisManifest(
      first.analysisBuildId,
    )!.freshness;

    const retainedAnalysis = await getCandidateMarkets(
      new Request(
        `http://localhost/api/v1/analyses/${first.analysisBuildId}/candidate-markets` +
          `?exporter=${RUNTIME_RELEASE_FIXTURE.exporterCode}` +
          `&product=${RUNTIME_RELEASE_FIXTURE.productCode}`,
      ),
      routeContext("analysisBuildId", first.analysisBuildId),
    );
    const retainedAnalysisBody = await retainedAnalysis.json();

    const retainedCsvUrl = new URL(
      `http://localhost/api/v1/analyses/${first.analysisBuildId}/candidate-markets.csv`,
    );
    retainedCsvUrl.searchParams.set(
      "exporter",
      RUNTIME_RELEASE_FIXTURE.exporterCode,
    );
    retainedCsvUrl.searchParams.set(
      "product",
      RUNTIME_RELEASE_FIXTURE.productCode,
    );
    retainedCsvUrl.searchParams.set(
      "productSearchBuildId",
      first.productSearchBuildId,
    );
    retainedCsvUrl.searchParams.set(
      "freshnessStatusId",
      retainedFreshness.freshnessStatusId,
    );
    retainedCsvUrl.searchParams.set("schema", "candidate-markets-csv-v1");
    const retainedCsv = await getCandidateMarketsCsv(
      new Request(retainedCsvUrl),
      routeContext("analysisBuildId", first.analysisBuildId),
    );
    const retainedCsvBody = new TextDecoder().decode(
      new Uint8Array(await retainedCsv.arrayBuffer()),
    );

    // A retained build's own productSearchBuildId gates its export (not
    // current's): pairing the retained analysisBuildId with current's
    // productSearchBuildId is a genuinely incompatible combination and
    // still 410s, proving the earlier 200 above used the retained
    // build's own identity rather than accidentally matching current's
    // (see issue #44).
    const currentOnlyCsvUrl = new URL(retainedCsvUrl);
    currentOnlyCsvUrl.searchParams.set(
      "productSearchBuildId",
      second.productSearchBuildId,
    );
    const wrongBuildCsv = await getCandidateMarketsCsv(
      new Request(currentOnlyCsvUrl),
      routeContext("analysisBuildId", first.analysisBuildId),
    );

    expect({
      retainedAnalysisStatus: retainedAnalysis.status,
      retainedAnalysisBuildId: retainedAnalysisBody.analysisBuildId,
      retainedAnalysisReleaseCatalogSha256:
        retainedAnalysisBody.analysisReleaseCatalogSha256,
      retainedCsvStatus: retainedCsv.status,
      retainedCsvHasOwnProductSearchBuild: retainedCsvBody.includes(
        first.productSearchBuildId,
      ),
      retainedCsvHasCurrentProductSearchBuild: retainedCsvBody.includes(
        second.productSearchBuildId,
      ),
      wrongBuildCsvStatus: wrongBuildCsv.status,
    }).toEqual({
      retainedAnalysisStatus: 200,
      retainedAnalysisBuildId: first.analysisBuildId,
      retainedAnalysisReleaseCatalogSha256:
        first.analysisReleaseCatalogSha256,
      retainedCsvStatus: 200,
      retainedCsvHasOwnProductSearchBuild: true,
      retainedCsvHasCurrentProductSearchBuild: false,
      wrongBuildCsvStatus: 410,
    });
  }, 20_000);

  it("serves Opportunity Discovery feed and detail from each retained build's own verified index", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-tracker-routes-"));
    temporaryDirectories.push(root);
    const retainedCandidate = await writeRuntimeReleaseCandidate(
      join(root, "gen1"),
      {
        valueOffset: 0,
        productSearchBuildId: "product-search-v1-1111111111111111",
        withOpportunityIndex: true,
      },
    );
    const currentCandidate = await writeRuntimeReleaseCandidate(
      join(root, "gen2"),
      {
        valueOffset: 25,
        productSearchBuildId: "product-search-v1-2222222222222222",
        withOpportunityIndex: true,
      },
    );
    const objectStore = new InMemoryReleaseObjectStore();
    const publisher = new ReleasePublisher(objectStore);
    const retained = await publisher.promote({
      ...retainedCandidate,
      activatedAt: "2026-07-12T01:00:00Z",
    });
    const current = await publisher.promote({
      ...currentCandidate,
      activatedAt: "2026-07-12T02:00:00Z",
    });
    const runtime = await VerifiedReleaseRuntime.load({
      objectStore,
      volumePath: join(root, "volume"),
      now: () => "2026-07-12T02:00:00Z",
    });
    runtimes.push(runtime);
    cleanups.push(installApplicationRuntime(runtime));

    const currentFeed = await getOpportunityFeed(current.analysisBuildId);
    const retainedFeed = await getOpportunityFeed(retained.analysisBuildId);
    const retainedCandidateRow = retainedFeed.candidates[0];
    const retainedDetail = await getOpportunityDetail(
      new Request(
        `http://localhost/api/v1/analyses/${retained.analysisBuildId}/opportunities/` +
          `${retainedCandidateRow.product.code}/${retainedCandidateRow.market.code}` +
          `?exporter=${RUNTIME_RELEASE_FIXTURE.exporterCode}`,
      ),
      routeContextMany({
        analysisBuildId: retained.analysisBuildId,
        productCode: retainedCandidateRow.product.code,
        importerCode: retainedCandidateRow.market.code,
      }),
    );
    const retainedDetailBody = await retainedDetail.json();

    expect({
      currentArtifact: currentFeed.provenance.artifactSha256,
      retainedArtifact: retainedFeed.provenance.artifactSha256,
      retainedDeploymentArtifact: runtime.resolveAnalysisManifest(
        retained.analysisBuildId,
      )!.source.artifact.sha256,
      currentDeploymentArtifact: runtime.currentAnalysis().source.artifact.sha256,
      retainedDetailStatus: retainedDetail.status,
      retainedDetailProduct: retainedDetailBody.product.code,
      retainedDetailMarket: retainedDetailBody.market.code,
      retainedDetailFirstValue:
        retainedDetailBody.marketYears[0].worldValueKusd,
    }).toEqual({
      currentArtifact: runtime.currentAnalysis().source.artifact.sha256,
      retainedArtifact: runtime.resolveAnalysisManifest(retained.analysisBuildId)!
        .source.artifact.sha256,
      retainedDeploymentArtifact: retainedFeed.provenance.artifactSha256,
      currentDeploymentArtifact: currentFeed.provenance.artifactSha256,
      retainedDetailStatus: 200,
      retainedDetailProduct: retainedCandidateRow.product.code,
      retainedDetailMarket: retainedCandidateRow.market.code,
      retainedDetailFirstValue: "150.000",
    });
  }, 20_000);
});

function routeContext<Key extends string>(
  key: Key,
  value: string,
): { params: Promise<Record<Key, string>> } {
  return { params: Promise.resolve({ [key]: value } as Record<Key, string>) };
}

function routeContextMany<const Params extends Record<string, string>>(
  params: Params,
): { params: Promise<Params> } {
  return { params: Promise.resolve(params) };
}

async function getOpportunityFeed(analysisBuildId: string) {
  const response = await getOpportunities(
    new Request(
      `http://localhost/api/v1/analyses/${analysisBuildId}/opportunities` +
        `?exporter=${RUNTIME_RELEASE_FIXTURE.exporterCode}&limit=1`,
    ),
    routeContext("analysisBuildId", analysisBuildId),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    provenance: { artifactSha256: string };
    candidates: [
      { product: { code: string }; market: { code: string } },
      ...unknown[],
    ];
  };
}
