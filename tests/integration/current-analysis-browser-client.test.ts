import { describe, expect, it, vi } from "vitest";

import { loadCurrentAnalysisManifest } from "../../src/app/current-analysis-discovery";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";

const currentManifest = resolveCurrentAnalysisManifest(
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
  FIXTURE_CURRENT_AS_OF,
);

describe("browser current-analysis discovery", () => {
  it("bypasses the browser cache when explicitly revalidating a retired build", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(currentManifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const controller = new AbortController();

    await expect(
      loadCurrentAnalysisManifest({
        fetcher,
        signal: controller.signal,
        revalidate: true,
      }),
    ).resolves.toEqual(currentManifest);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/analyses/current", {
      cache: "no-store",
      signal: controller.signal,
    });
  });

  it("rejects a malformed or release-incompatible current manifest", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...currentManifest,
          freshness: {
            ...currentManifest.freshness,
            servedBaciRelease: "V202501",
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      loadCurrentAnalysisManifest({
        fetcher,
        signal: new AbortController().signal,
        revalidate: false,
      }),
    ).rejects.toMatchObject({
      name: "CurrentAnalysisDiscoveryError",
      code: "INVALID_MANIFEST",
    });
  });
});
