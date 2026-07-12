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
});

function identityFetch(
  requests: Array<{ url: string; init: RequestInit | undefined }>,
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
