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
    const csvBody = await csv.text();
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
      analysis: await analysis.json(),
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
  }, 20_000);
});

function routeContext<Key extends string>(
  key: Key,
  value: string,
): { params: Promise<Record<Key, string>> } {
  return { params: Promise.resolve({ [key]: value } as Record<Key, string>) };
}
