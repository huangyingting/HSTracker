import { describe, expect, it } from "vitest";

import {
  CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS,
  createCandidateMarketDatasetPackage,
  evaluateCandidateMarketV1DatasetPackage,
} from "../../src/domain/trade-analytics/dataset-package";
import { CandidateMarketTradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";
import {
  createCandidateMarketDatasetPackageFromArtifacts,
  parseAnalysisArtifactManifest,
} from "../../src/evidence/analysis-artifact-manifest";
import { createFixtureCandidateMarketDatasetPackages } from "../../src/evidence/fixture-trade-evidence-source";
import productionReport from "../../reports/releases/V202601.artifact-build-report.json";

describe("Candidate Market Dataset Package", () => {
  it("has deterministic canonical serialization and content-addressed identity", () => {
    const manifest = datasetPackageManifest();
    const reordered = {
      ...manifest,
      capabilities: [...manifest.capabilities].reverse(),
    };

    const first = createCandidateMarketDatasetPackage(manifest);
    const second = createCandidateMarketDatasetPackage(reordered);

    expect(first.serializedManifest).toBe(second.serializedManifest);
    expect(first.identity).toBe(second.identity);
    expect(first.identity).toMatch(
      /^dataset-package-v1-[a-f0-9]{64}$/u,
    );
  });

  it("includes every package-defining semantic and physical category in identity", () => {
    const manifest = datasetPackageManifest();
    const changedSourceEvidenceSha256 = "9".repeat(64);
    const variants = [
      { ...manifest, source: { ...manifest.source, release: "V202602" } },
      {
        ...manifest,
        packageSchemaVersion: "candidate-market-artifact-v2",
      },
      { ...manifest, hsRevision: "HS17" },
      {
        ...manifest,
        coverage: {
          ...manifest.coverage,
          ingestedYears: { start: 2011, end: 2024 },
        },
      },
      {
        ...manifest,
        missingObservationTreatment: "MISSING_TO_ZERO",
      },
      {
        ...manifest,
        capabilities: manifest.capabilities.map((capability, index) =>
          index === 0 ? { ...capability, version: "2" } : capability,
        ),
      },
      {
        ...manifest,
        content: {
          ...manifest.content,
          stagingManifestSha256: "8".repeat(64),
        },
      },
      {
        ...manifest,
        content: {
          ...manifest.content,
          sourceReconciliationEvidence: {
            ...manifest.content.sourceReconciliationEvidence,
            sha256: changedSourceEvidenceSha256,
          },
        },
        quality: {
          ...manifest.quality,
          evidence: manifest.quality.evidence.map((item) =>
            item.kind === "SOURCE_REPORT"
              ? { ...item, sha256: changedSourceEvidenceSha256 }
              : item,
          ),
        },
      },
      {
        ...manifest,
        attribution: {
          ...manifest.attribution,
          statement: "Source: updated attribution.",
        },
      },
      {
        ...manifest,
        physicalObjects: manifest.physicalObjects.map((object, index) =>
          index === 0
            ? { ...object, objectId: `${object.objectId}-revision` }
            : object,
        ),
      },
    ];
    const identities = [
      createCandidateMarketDatasetPackage(manifest).identity,
      ...variants.map(
        (variant) =>
          createCandidateMarketDatasetPackage(variant).identity,
      ),
    ];

    expect(new Set(identities)).toHaveLength(identities.length);
  });

  it("rejects a missing capability before Candidate Market execution", async () => {
    const manifest = datasetPackageManifest();
    const datasetPackage = createCandidateMarketDatasetPackage({
      ...manifest,
      capabilities: manifest.capabilities.slice(1),
    });
    const platform = new CandidateMarketTradeAnalyticsPlatform(
      async () => {
        throw new Error("Candidate Market executor must not be called.");
      },
      new Map([["acceptance-fixtures-v1", datasetPackage]]),
    );

    const outcome = await platform.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });

    expect(outcome).toMatchObject({
      state: "incompatible-package",
      error: {
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "MISSING_REQUIRED_CAPABILITY",
      },
    });
  });

  it("rejects a mismatched capability version before Candidate Market execution", async () => {
    const manifest = datasetPackageManifest();
    const datasetPackage = createCandidateMarketDatasetPackage({
      ...manifest,
      capabilities: manifest.capabilities.map((capability, index) =>
        index === 0 ? { ...capability, version: "2" } : capability,
      ),
    });
    const platform = new CandidateMarketTradeAnalyticsPlatform(
      async () => {
        throw new Error("Candidate Market executor must not be called.");
      },
      new Map([["acceptance-fixtures-v1", datasetPackage]]),
    );

    const outcome = await platform.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });

    expect(outcome).toMatchObject({
      state: "incompatible-package",
      error: {
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "CAPABILITY_VERSION_MISMATCH",
      },
    });
  });

  it("rejects a score window that is not fully finalized", () => {
    const manifest = datasetPackageManifest();

    expect(() =>
      createCandidateMarketDatasetPackage({
        ...manifest,
        coverage: {
          ...manifest.coverage,
          finalized: {
            ...manifest.coverage.finalized,
            years: { start: 2020, end: 2023 },
          },
        },
      }),
    ).toThrow(
      "Dataset Package year treatment is inconsistent.",
    );
  });

  it("rejects finalized coverage shorter than the ten-year stability window before execution", async () => {
    const manifest = datasetPackageManifest();
    const datasetPackage = createCandidateMarketDatasetPackage({
      ...manifest,
      coverage: {
        ...manifest.coverage,
        ingestedYears: { start: 2015, end: 2024 },
        finalized: {
          ...manifest.coverage.finalized,
          years: { start: 2015, end: 2023 },
        },
      },
    });
    const platform = new CandidateMarketTradeAnalyticsPlatform(
      async () => {
        throw new Error("Candidate Market executor must not be called.");
      },
      new Map([["acceptance-fixtures-v1", datasetPackage]]),
    );

    const outcome = await platform.execute({
      recipe: "candidate-market-v1",
      analysisBuildId: "acceptance-fixtures-v1",
      exporterCode: "156",
      productCode: "010121",
    });

    expect(outcome).toMatchObject({
      state: "incompatible-package",
      error: {
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "PACKAGE_IDENTITY_MISMATCH",
      },
    });
  });

  it("accepts ten-year fixture and legacy production coverage with equivalent capability semantics", () => {
    const fixture = createFixtureCandidateMarketDatasetPackages().get(
      "acceptance-fixtures-v1",
    )!;
    expect(productionReport.artifactManifest).not.toHaveProperty(
      "sourceReportSha256",
    );
    expect(productionReport.artifactManifest).not.toHaveProperty(
      "datasetPackage",
    );
    const productionManifest = parseAnalysisArtifactManifest(
      productionReport.artifactManifest,
    );
    expect(productionManifest.sourceReconciliationEvidence).toEqual({
      kind: "EMBEDDED_ANNUAL_SOURCE_CHECKS",
      sha256:
        "dc46a4b28b931513def75d514ad750e52643c5cc35986ffdd6aed7d2dd81cb48",
    });
    const production =
      createCandidateMarketDatasetPackageFromArtifacts({
        manifest: productionManifest,
        analysisReleaseCatalogSha256: "f".repeat(64),
        previousManifest: null,
      });

    expect(evaluateCandidateMarketV1DatasetPackage(fixture)).toEqual({
      compatible: true,
    });
    expect(
      evaluateCandidateMarketV1DatasetPackage(production),
    ).toEqual({ compatible: true });
    expect([
      fixture.manifest.coverage.finalized.years,
      production.manifest.coverage.finalized.years,
    ]).toEqual([
      { start: 2012, end: 2023 },
      { start: 2012, end: 2023 },
    ]);
    expect({
      capabilities: production.manifest.capabilities,
      finalized: production.manifest.coverage.finalized.treatment,
      provisional:
        production.manifest.coverage.provisional.treatment,
      missing: production.manifest.missingObservationTreatment,
    }).toEqual({
      capabilities: fixture.manifest.capabilities,
      finalized: fixture.manifest.coverage.finalized.treatment,
      provisional: fixture.manifest.coverage.provisional.treatment,
      missing: fixture.manifest.missingObservationTreatment,
    });
  });

  it("does not infer Candidate Market capabilities for a legacy manifest without cms-v1", () => {
    expect(() =>
      parseAnalysisArtifactManifest({
        ...productionReport.artifactManifest,
        scoreVersionsSupported: ["cms-v2"],
      }),
    ).toThrow("Analysis artifact does not support cms-v1.");
  });

  it.each([
    {
      name: "null check",
      checks: [null],
    },
    {
      name: "incomplete years",
      checks:
        productionReport.artifactManifest.annualSourceChecks.slice(
          0,
          -1,
        ),
    },
    {
      name: "misaligned year",
      checks:
        productionReport.artifactManifest.annualSourceChecks.map(
          (check, index) =>
            index === 0 ? { ...check, year: check.year + 1 } : check,
        ),
    },
    {
      name: "invalid numeric field",
      checks:
        productionReport.artifactManifest.annualSourceChecks.map(
          (check, index) =>
            index === 0 ? { ...check, rowCount: "many" } : check,
        ),
    },
    {
      name: "arbitrary extra field",
      checks:
        productionReport.artifactManifest.annualSourceChecks.map(
          (check, index) =>
            index === 0
              ? { ...check, arbitrary: { nested: true } }
              : check,
        ),
    },
    {
      name: "invalid decimal field",
      checks:
        productionReport.artifactManifest.annualSourceChecks.map(
          (check, index) =>
            index === 0
              ? { ...check, valueTotalKusd: "1.00" }
              : check,
        ),
    },
    {
      name: "inconsistent quantity counts",
      checks:
        productionReport.artifactManifest.annualSourceChecks.map(
          (check, index) =>
            index === 0
              ? {
                  ...check,
                  quantityPresentCount: check.rowCount,
                  quantityNullCount: 1,
                }
              : check,
        ),
    },
  ])(
    "does not infer legacy capabilities from $name",
    ({ checks }) => {
      expect(() =>
        parseAnalysisArtifactManifest({
          ...productionReport.artifactManifest,
          annualSourceChecks: checks,
        }),
      ).toThrow();
    },
  );

  it("includes previous-release semantic metadata in identity", () => {
    const current = historicalProductionManifest();
    const previous = previousProductionManifest();
    const changedPrevious = {
      ...previous,
      ingestedYears: [2011, ...previous.ingestedYears],
    };

    const first = createCandidateMarketDatasetPackageFromArtifacts({
      manifest: current,
      analysisReleaseCatalogSha256: "f".repeat(64),
      previousManifest: previous,
    });
    const changed = createCandidateMarketDatasetPackageFromArtifacts({
      manifest: current,
      analysisReleaseCatalogSha256: "f".repeat(64),
      previousManifest: changedPrevious,
    });

    expect(changed.identity).not.toBe(first.identity);
  });

  it.each([
    {
      name: "missing",
      capabilities: CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS.slice(1),
      reason: "MISSING_REQUIRED_CAPABILITY",
    },
    {
      name: "mismatched",
      capabilities: CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS.map(
        (capability, index) =>
          index === 0
            ? { ...capability, version: "2" }
            : capability,
      ),
      reason: "CAPABILITY_VERSION_MISMATCH",
    },
  ])(
    "rejects $name previous-release capabilities before execution",
    async ({ capabilities, reason }) => {
      const previous = previousProductionManifest();
      const datasetPackage =
        createCandidateMarketDatasetPackageFromArtifacts({
          manifest: historicalProductionManifest(),
          analysisReleaseCatalogSha256: "f".repeat(64),
          previousManifest: {
            ...previous,
            datasetPackage: {
              ...previous.datasetPackage,
              capabilities,
            },
          },
        });
      const platform = new CandidateMarketTradeAnalyticsPlatform(
        async () => {
          throw new Error(
            "Candidate Market executor must not be called.",
          );
        },
        new Map([["acceptance-fixtures-v1", datasetPackage]]),
      );

      const outcome = await platform.execute({
        recipe: "candidate-market-v1",
        analysisBuildId: "acceptance-fixtures-v1",
        exporterCode: "156",
        productCode: "010121",
      });

      expect(outcome).toMatchObject({
        state: "incompatible-package",
        error: {
          code: "NO_COMPATIBLE_DATASET_PACKAGE",
          reason,
        },
      });
    },
  );
});

function historicalProductionManifest() {
  return parseAnalysisArtifactManifest(
    productionReport.artifactManifest,
  );
}

function previousProductionManifest() {
  const current = historicalProductionManifest();
  return {
    ...current,
    baciRelease: "V202501",
    sourceUpdateDate: "2025-01-22",
    artifact: {
      ...current.artifact,
      buildId: "candidate-market-artifact-v1-7777777777777777",
      sha256: "7".repeat(64),
    },
  };
}

function datasetPackageManifest() {
  return {
    schemaVersion: "candidate-market-dataset-package-manifest-v1",
    source: {
      dataset: "CEPII_BACI",
      release: "V202601",
      updateDate: "2026-01-22",
      archive: {
        url: "https://example.test/BACI_HS12_V202601.zip",
        bytes: 123,
        sha256: "a".repeat(64),
      },
    },
    packageSchemaVersion: "candidate-market-artifact-v1",
    hsRevision: "HS12",
    missingObservationTreatment: "PRESERVE_MISSINGNESS",
    coverage: {
      ingestedYears: { start: 2012, end: 2024 },
      finalized: {
        years: { start: 2012, end: 2023 },
        cutoffYear: 2023,
        scoreWindow: { start: 2019, end: 2023 },
        treatment: "SCORE_INPUT",
      },
      provisional: {
        years: [2024],
        treatment: "SUPPORTING_EVIDENCE_ONLY",
      },
    },
    capabilities: CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS.map(
      (requirement) => ({ ...requirement }),
    ),
    content: {
      releaseCatalogSha256: "b".repeat(64),
      stagingManifestSha256: "c".repeat(64),
      coverageApprovalSha256: "d".repeat(64),
      sourceReconciliationEvidence: {
        kind: "SOURCE_REPORT",
        sha256: "e".repeat(64),
      },
    },
    quality: {
      status: "accepted",
      evidence: [
        { kind: "SOURCE_REPORT", sha256: "e".repeat(64) },
        { kind: "COVERAGE_APPROVAL", sha256: "d".repeat(64) },
      ],
    },
    attribution: {
      statement: "Source: CEPII BACI fixture.",
      license: {
        name: "Etalab Open Licence 2.0",
        url: "https://example.test/license",
      },
    },
    physicalObjects: [
      {
        role: "ANALYSIS_ARTIFACT",
        objectId: "candidate-market-artifact-v1-1111111111111111",
        relativePath: "candidate-market.duckdb",
        schemaVersion: "candidate-market-artifact-v1",
        bytes: 121,
        sha256: "1".repeat(64),
      },
    ],
    comparisonEvidence: null,
  } as const;
}
