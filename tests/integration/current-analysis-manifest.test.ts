import { describe, expect, it } from "vitest";

import {
  currentManifestCacheControl,
  resolveCurrentAnalysisManifest,
} from "../../src/domain/release/current-analysis";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";

describe("Current Analysis Manifest", () => {
  it("clips browser and shared cache lifetimes at the next status boundary", () => {
    const asOf = "2026-03-14T23:59:59Z";
    const manifest = resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      asOf,
    );

    expect(currentManifestCacheControl(manifest.freshness, asOf)).toBe(
      "public, max-age=1, s-maxage=1, must-revalidate",
    );
  });

  it("rejects a freshness snapshot for a different served release", () => {
    expect(() =>
      resolveCurrentAnalysisManifest(
        FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
        {
          ...FIXTURE_SOURCE_STATUS_SNAPSHOT,
          servedBaciRelease: "V202501",
        },
        "2026-03-01T00:00:00Z",
      ),
    ).toThrow(
      "The freshness snapshot does not describe the deployed BACI Release.",
    );
  });
});
