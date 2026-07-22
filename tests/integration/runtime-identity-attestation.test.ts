import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  RuntimeIdentityAttestationError,
  attestRuntimeIdentity,
} from "../../src/promotion/runtime-identity-attestation";
import type { PerformanceMeasurementIdentity } from "../../src/promotion/performance-gates";

const identity: PerformanceMeasurementIdentity = {
  fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
  buildId: "build-1",
  baciRelease: "V202601",
  analysisBuildId: "analysis-1",
  productSearchBuildId: "search-1",
  artifactSha256: "a".repeat(64),
  machineId: "machine-1",
  machineClass: "shared-cpu-2x",
  region: "sin",
};
const benchmarkQueries = [
  "sparse",
  "median",
  "upper-quartile",
  "maximum-row",
].map((role) => ({
  role,
  productCode: "090100",
  exporterCode: "156",
  candidateCount: 1,
}));
const tradeExplorerBenchmarkQueries = [
  "sparse",
  "median",
  "upper-quartile",
  "maximum-row",
].map((role) => ({
  role,
  shape: "finalized-trend-v1",
  measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
  exportEconomyCode: "156",
  importEconomyCode: "276",
  hsProductCode: "090100",
  groupedRowCount: 5,
}));

describe("runtime identity attestation", () => {
  it("binds measurements to deployment-served build, release, artifact, and Machine identity", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const attestation = await attestRuntimeIdentity(
      "https://candidate.example",
      identity,
      identityFetch(requests),
    );

    expect(attestation).toMatchObject({
      schemaVersion: "runtime-identity-attestation-v1",
      origin: "https://candidate.example",
      identity,
      capabilities: {
        recentTradeMomentum: true,
        opportunityDiscovery: false,
      },
      health: { path: "/healthz" },
      currentManifest: {
        path: "/api/v1/analyses/current",
        etag: 'W/"manifest-1"',
        schemaVersion: "current-analysis-manifest-v1",
      },
    });
    expect(attestation.health.bodySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(attestation.currentManifest.bodySha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.init).toMatchObject({
        cache: "no-store",
        redirect: "error",
        headers: {
          "X-HS-Tracker-Probe": "external-v1",
        },
      });
    }
  });

  it("fails before measurement when the deployment serves a different identity", async () => {
    await expect(
      attestRuntimeIdentity(
        "https://candidate.example",
        { ...identity, analysisBuildId: "different-analysis" },
        identityFetch([]),
      ),
    ).rejects.toThrowError(
      new RuntimeIdentityAttestationError(
        "Candidate analysisBuildId does not match the measurement plan.",
      ),
    );
  });

  it("rejects a noncanonical fixture digest without contacting the candidate", async () => {
    let called = false;
    const fetchImplementation: typeof fetch = async () => {
      called = true;
      throw new Error("must not be called");
    };

    await expect(
      attestRuntimeIdentity(
        "https://candidate.example",
        { ...identity, fixtureManifestSha256: "f".repeat(64) },
        fetchImplementation,
      ),
    ).rejects.toThrow(
      "fixture digest does not match the canonical acceptance fixture",
    );
    expect(called).toBe(false);
  });

  it.each([
    {
      name: "missing role",
      queries: benchmarkQueries.slice(0, 3),
      message: "must contain the four representative roles",
    },
    {
      name: "duplicate role",
      queries: benchmarkQueries.map((query, index) =>
        index === 1 ? { ...query, role: "sparse" } : query,
      ),
      message: "malformed or duplicated",
    },
    {
      name: "malformed product code",
      queries: benchmarkQueries.map((query, index) =>
        index === 0 ? { ...query, productCode: "901" } : query,
      ),
      message: "malformed or duplicated",
    },
  ])("rejects $name benchmark attestation", async ({ queries, message }) => {
    await expect(
      attestRuntimeIdentity(
        "https://candidate.example",
        identity,
        identityFetch([], queries),
      ),
    ).rejects.toThrow(message);
  });
});

function identityFetch(
  requests: Array<{ url: string; init: RequestInit | undefined }>,
  queries: unknown = benchmarkQueries,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/healthz")) {
      return Response.json(
        { status: "ok", buildId: identity.buildId },
        {
          headers: {
            "X-HS-Tracker-Build-Id": identity.buildId,
            "X-HS-Tracker-Machine-Id": identity.machineId,
            "X-HS-Tracker-Machine-Class": identity.machineClass,
            "X-HS-Tracker-Region": identity.region,
          },
        },
      );
    }
    if (url.endsWith("/api/v1/analyses/current")) {
      return Response.json(
        {
          schemaVersion: "current-analysis-manifest-v1",
          analysisBuildId: identity.analysisBuildId,
          productSearchBuildId: identity.productSearchBuildId,
          benchmarkQueries: queries,
          tradeExplorerBenchmarkQueries,
          recommendation: {
            recentTradeMomentum: { recipe: "recent-trade-momentum-v1" },
            opportunityDiscovery: null,
          },
          source: {
            baciRelease: identity.baciRelease,
            artifact: { sha256: identity.artifactSha256 },
          },
        },
        { headers: { ETag: 'W/"manifest-1"' } },
      );
    }
    return new Response(null, { status: 404 });
  };
}
