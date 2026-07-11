import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURES_V1_MANIFEST } from "../../test/fixtures/acceptance/v1/manifest";

describe("acceptance-fixtures-v1 manifest", () => {
  it("content-addresses every implemented fixture input", async () => {
    const digestEntries: string[] = [];

    for (const file of ACCEPTANCE_FIXTURES_V1_MANIFEST.contentFiles) {
      const bytes = await readFile(
        resolve("test/fixtures/acceptance/v1", file.path),
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");

      expect(sha256).toBe(file.sha256);
      digestEntries.push(`${file.path}:${sha256}\n`);
    }

    const fixtureContentSha256 = createHash("sha256")
      .update(digestEntries.join(""))
      .digest("hex");
    expect(fixtureContentSha256).toBe(
      ACCEPTANCE_FIXTURES_V1_MANIFEST.fixtureContentSha256,
    );
    expect(ACCEPTANCE_FIXTURES_V1_MANIFEST).toMatchObject({
      fixtureSchemaVersion: "acceptance-fixtures-v1",
      fixtureOnly: true,
      scoreVersion: "cms-v1",
      artifactSchemaVersion: "candidate-market-artifact-v1",
      analysisResultSchemaVersion: "candidate-market-result-v1",
      release: {
        baciRelease: "V202601",
        sourceUpdateDate: "2026-01-22",
        hsRevision: "HS12",
        finalizedCutoffYear: 2023,
        provisionalYear: 2024,
      },
    });
    expect(ACCEPTANCE_FIXTURES_V1_MANIFEST.fixtureIds).toEqual(
      expect.arrayContaining([
        "core-current",
        "empty",
        "discontinuity",
        "component-pool-one",
        "component-all-equal",
        "component-half-display",
        "growth-both-neutral-reasons",
        "diversity-zero",
        "diversity-neutral",
        "extreme-growth",
        "dominant-size",
        "stability-low",
        "stability-threshold",
        "stability-small",
        "one-candidate",
        "no-exporter-history",
        "confidence-floor",
        "invalid-world-zero",
        "invalid-recorded-bilateral-zero",
        "quantity-zero-mutation",
        "provisional-mutation",
      ]),
    );
    expect(ACCEPTANCE_FIXTURES_V1_MANIFEST.expectedFiles).toEqual(
      ACCEPTANCE_FIXTURES_V1_MANIFEST.contentFiles.filter(({ path }) =>
        path.startsWith("expected/"),
      ),
    );
  });
});
