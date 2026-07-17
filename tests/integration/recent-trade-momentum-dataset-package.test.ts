import { describe, expect, it } from "vitest";

import {
  createRecentTradeMomentumDatasetPackage,
  evaluateRecentTradeMomentumV1DatasetPackage,
  RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-dataset-package";

describe("Recent Trade Momentum Dataset Package", () => {
  it("has deterministic canonical serialization and content-addressed identity", () => {
    const manifest = monthlyManifest();
    const reordered = {
      ...manifest,
      capabilities: [...manifest.capabilities].reverse(),
    };

    const first = createRecentTradeMomentumDatasetPackage(manifest);
    const second = createRecentTradeMomentumDatasetPackage(reordered);

    expect(first.serializedManifest).toBe(second.serializedManifest);
    expect(first.identity).toBe(second.identity);
    expect(first.identity).toMatch(/^dataset-package-v1-[a-f0-9]{64}$/u);
  });

  it("includes source, mapping, artifact, coverage, quality, and attribution in identity", () => {
    const manifest = monthlyManifest();
    const variants = [
      { ...manifest, sourceVintageId: "source-vintage-v1-changed" },
      { ...manifest, extractionTimestamp: "2026-07-17T01:00:00.000Z" },
      {
        ...manifest,
        artifact: { ...manifest.artifact, sha256: "1".repeat(64) },
        artifactSha256: "1".repeat(64),
      },
      { ...manifest, sourceObjectsSha256: "2".repeat(64) },
      { ...manifest, mappingEvidenceSha256: "3".repeat(64) },
      { ...manifest, referenceMonthRange: { start: "2024-04", end: "2026-02" } },
      { ...manifest, newestEligibleMonthByReporter: { BE: "2026-01", DE: "2026-02" } },
      { ...manifest, quality: { status: "blocked" as const, reason: "fixture" } },
      { ...manifest, attribution: { ...manifest.attribution, statement: "Source: changed." } },
    ];

    const identities = [
      createRecentTradeMomentumDatasetPackage(manifest).identity,
      ...variants.map((variant) =>
        createRecentTradeMomentumDatasetPackage(variant).identity,
      ),
    ];

    expect(new Set(identities)).toHaveLength(identities.length);
  });

  it("accepts the exact v1 capability and schema contract", () => {
    const datasetPackage = createRecentTradeMomentumDatasetPackage(
      monthlyManifest(),
    );

    expect(evaluateRecentTradeMomentumV1DatasetPackage(datasetPackage)).toEqual({
      compatible: true,
    });
  });

  it.each([
    {
      capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS.slice(1),
      reason: "MISSING_REQUIRED_CAPABILITY",
    },
    {
      capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS.map(
        (capability, index) =>
          index === 0 ? { ...capability, version: "2" } : capability,
      ),
      reason: "CAPABILITY_VERSION_MISMATCH",
    },
  ] as const)("rejects incompatible capabilities", ({ capabilities, reason }) => {
    const datasetPackage = createRecentTradeMomentumDatasetPackage({
      ...monthlyManifest(),
      capabilities,
    });

    expect(evaluateRecentTradeMomentumV1DatasetPackage(datasetPackage)).toEqual({
      compatible: false,
      reason,
    });
  });

  it("rejects tampered package identity before activation", () => {
    const datasetPackage = createRecentTradeMomentumDatasetPackage(
      monthlyManifest(),
    );

    expect(
      evaluateRecentTradeMomentumV1DatasetPackage({
        ...datasetPackage,
        identity: "dataset-package-v1-".concat("0".repeat(64)) as typeof datasetPackage.identity,
      }),
    ).toEqual({
      compatible: false,
      reason: "PACKAGE_IDENTITY_MISMATCH",
    });
  });
});

function monthlyManifest() {
  return {
    schemaVersion: "monthly-trade-dataset-package-manifest-v1",
    artifactSchemaVersion: "monthly-trade-artifact-v1",
    resultSchemaVersion: "recent-trade-momentum-result-v1",
    recipeId: "recent-trade-momentum-v1",
    capability: "recent-trade-momentum/reporting-market-import-value@1",
    mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
    sourceOwner: "Eurostat",
    sourceDataset: "EUROSTAT_COMEXT_DETAIL",
    sourceVintageId: "source-vintage-v1-synthetic-a",
    extractionTimestamp: "2026-07-17T00:00:00.000Z",
    sourceObjectsSha256: "a".repeat(64),
    sourceMetadataSha256: "b".repeat(64),
    mappingEvidenceSha256: "c".repeat(64),
    partnerMappingVersion: "synthetic-eurostat-partners-v1",
    reporterAllowlist: ["BE", "DE"],
    referenceMonthRange: { start: "2024-03", end: "2026-03" },
    newestEligibleMonthByReporter: { BE: "2026-02", DE: "2026-02" },
    artifact: {
      relativePath: "recent-trade-momentum.duckdb",
      bytes: 4096,
      sha256: "d".repeat(64),
    },
    artifactSha256: "d".repeat(64),
    rowCounts: {
      reporters: 2,
      partners: 4,
      productMappings: 6,
      marketMonths: 150,
      momentum: 6,
    },
    coverage: {
      expectedHistoryMonths: 24,
      shadowVintagesPassed: 3,
      publicCapabilityActivated: false,
    },
    revisionReportSha256: "e".repeat(64),
    conformanceReportSha256: "f".repeat(64),
    capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
    quality: { status: "accepted" as const, reason: null },
    attribution: {
      statement: "Source: Eurostat Comext synthetic fixture; changes indicated.",
      license: {
        name: "CC BY 4.0",
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
    supersedesPackageIdentity: null,
  } as const;
}
