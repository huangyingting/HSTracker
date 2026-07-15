import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  CANDIDATE_MARKET_V1_DATASET_DECLARATION,
  createCandidateMarketDatasetPackage,
  parseCandidateMarketDatasetCapabilityDeclaration,
  type CandidateMarketDatasetCapabilityDeclaration,
  type CandidateMarketDatasetPackage,
  type DatasetSourceReconciliationEvidence,
} from "../domain/trade-analytics/dataset-package";
import {
  createTradeTrendDatasetPackage,
  parseTradeTrendDatasetCapabilityDeclaration,
  type TradeTrendDatasetCapabilityDeclaration,
  type TradeTrendDatasetPackage,
} from "../domain/trade-analytics/trade-trend-v1-dataset-package";
import {
  count,
  hs12,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "../release/release-validation";
import { readRuntimeFile } from "../runtime-file-access";

export type AnalysisArtifactBenchmarkQuery = {
  role: "sparse" | "median" | "upper-quartile" | "maximum-row";
  productCode: string;
  exporterCode: string;
  candidateCount: number;
};

export type TradeTrendArtifactBenchmarkQuery = {
  role: "sparse" | "median" | "upper-quartile" | "maximum-row";
  productCode: string;
  importerCode: string;
  windowRowCount: number;
  pairRowCount: number;
};

export type AnalysisArtifactManifest = {
  schemaVersion: "candidate-market-artifact-manifest-v1";
  baciRelease: string;
  sourceUrl: string;
  sourceBytes: number;
  sourceSha256: string;
  sourceUpdateDate: string;
  license: {
    name: string;
    url: string;
  };
  attribution: string;
  hsRevision: "HS12";
  ingestedYears: number[];
  finalizedYears: number[];
  provisionalYears: number[];
  finalizedCutoffYear: number;
  scoreWindow: { start: number; end: number };
  stagingManifestSha256: string;
  coverageApprovalSha256: string;
  sourceReconciliationEvidence: DatasetSourceReconciliationEvidence;
  datasetPackage: CandidateMarketDatasetCapabilityDeclaration;
  tradeTrendDatasetPackage: TradeTrendDatasetCapabilityDeclaration;
  scoreVersionsSupported: string[];
  artifact: {
    schemaVersion: "candidate-market-artifact-v1";
    buildId: string;
    relativePath: "candidate-market.duckdb";
    bytes: number;
    sha256: string;
  };
  builtAt: string;
  benchmarkQueries: AnalysisArtifactBenchmarkQuery[];
  tradeTrendBenchmarkQueries: TradeTrendArtifactBenchmarkQuery[];
};

const LEGACY_ANNUAL_SOURCE_CHECK_KEYS = [
  "year",
  "rowCount",
  "exporterCount",
  "importerCount",
  "observedProductCount",
  "quantityPresentCount",
  "quantityNullCount",
  "valueTotalKusd",
  "quantityTotalTons",
];

export async function readAnalysisArtifactManifest(
  path: string,
): Promise<AnalysisArtifactManifest> {
  return parseAnalysisArtifactManifest(
    JSON.parse(
      await readRuntimeFile(
        resolve(/* turbopackIgnore: true */ path),
        "utf8",
      ),
    ),
  );
}

export function parseAnalysisArtifactManifest(
  value: unknown,
): AnalysisArtifactManifest {
  const manifest = record(value, "analysis artifact manifest");
  if (manifest.schemaVersion !== "candidate-market-artifact-manifest-v1") {
    throw new Error("Analysis artifact manifest schema is incompatible.");
  }
  const artifact = record(manifest.artifact, "analysis artifact identity");
  const license = record(manifest.license, "analysis source license");
  if (
    artifact.schemaVersion !== "candidate-market-artifact-v1" ||
    artifact.relativePath !== "candidate-market.duckdb"
  ) {
    throw new Error("Analysis artifact schema is incompatible.");
  }
  const finalizedCutoffYear = year(
    manifest.finalizedCutoffYear,
    "finalized cutoff year",
  );
  const scoreWindow = yearRange(manifest.scoreWindow, "score window");
  const ingestedYears = yearArray(manifest.ingestedYears, "ingested years");
  const finalizedYears = yearArray(manifest.finalizedYears, "finalized years");
  const provisionalYears = yearArray(
    manifest.provisionalYears,
    "provisional years",
  );
  if (scoreWindow.start > scoreWindow.end) {
    throw new Error("Analysis artifact year windows are incompatible.");
  }
  const scoreYears = Array.from(
    { length: scoreWindow.end - scoreWindow.start + 1 },
    (_, index) => scoreWindow.start + index,
  );
  if (
    scoreWindow.end !== finalizedCutoffYear ||
    finalizedYears.at(-1) !== finalizedCutoffYear ||
    !finalizedYears.every((year) => ingestedYears.includes(year)) ||
    !scoreYears.every((year) => finalizedYears.includes(year)) ||
    provisionalYears.length !== 1 ||
    provisionalYears[0] !== ingestedYears.at(-1) ||
    finalizedYears.includes(provisionalYears[0]!)
  ) {
    throw new Error("Analysis artifact year windows are incompatible.");
  }
  const scoreVersionsSupported = stringArray(
    manifest.scoreVersionsSupported,
    "score versions",
  );
  if (!scoreVersionsSupported.includes("cms-v1")) {
    throw new Error("Analysis artifact does not support cms-v1.");
  }
  const hasSourceReport =
    manifest.sourceReportSha256 !== undefined;
  const hasCapabilityDeclaration =
    manifest.datasetPackage !== undefined;
  if (hasSourceReport !== hasCapabilityDeclaration) {
    throw new Error(
      "Analysis artifact Dataset Package evidence is incomplete.",
    );
  }
  const sourceReconciliationEvidence: DatasetSourceReconciliationEvidence =
    hasSourceReport
      ? {
          kind: "SOURCE_REPORT",
          sha256: sha256String(
            manifest.sourceReportSha256,
            "source report SHA-256",
          ),
        }
      : embeddedAnnualSourceChecksEvidence(
          manifest.annualSourceChecks,
          ingestedYears,
        );
  const datasetPackage = hasCapabilityDeclaration
    ? parseCandidateMarketDatasetCapabilityDeclaration(
        manifest.datasetPackage,
      )
    : CANDIDATE_MARKET_V1_DATASET_DECLARATION;
  const tradeTrendDatasetPackage =
    manifest.tradeTrendDatasetPackage === undefined
      ? {
          schemaVersion: "trade-trend-dataset-capabilities-v1" as const,
          capabilities: [],
        }
      : parseTradeTrendDatasetCapabilityDeclaration(
          manifest.tradeTrendDatasetPackage,
        );
  const benchmarkQueries = array(
    manifest.benchmarkQueries,
    "benchmark queries",
  ).map(parseBenchmarkQuery);
  const tradeTrendBenchmarkQueries = array(
    manifest.tradeTrendBenchmarkQueries ?? [],
    "trade trend benchmark queries",
  ).map(parseTradeTrendBenchmarkQuery);
  const buildId = string(artifact.buildId, "analysis artifact build ID");
  if (!/^candidate-market-artifact-v1-[a-f0-9]{16}$/u.test(buildId)) {
    throw new Error("Analysis artifact build ID is malformed.");
  }

  return {
    schemaVersion: "candidate-market-artifact-manifest-v1",
    baciRelease: string(manifest.baciRelease, "BACI Release"),
    sourceUrl: absoluteUrl(manifest.sourceUrl, "source URL"),
    sourceBytes: count(manifest.sourceBytes, "source bytes"),
    sourceSha256: sha256String(manifest.sourceSha256, "source SHA-256"),
    sourceUpdateDate: date(
      manifest.sourceUpdateDate,
      "source update date",
    ),
    license: {
      name: string(license.name, "source license name"),
      url: absoluteUrl(license.url, "source license URL"),
    },
    attribution: string(manifest.attribution, "source attribution"),
    hsRevision: hs12(manifest.hsRevision, "HS revision"),
    ingestedYears,
    finalizedYears,
    provisionalYears,
    finalizedCutoffYear,
    scoreWindow,
    stagingManifestSha256: sha256String(
      manifest.stagingManifestSha256,
      "staging manifest SHA-256",
    ),
    coverageApprovalSha256: sha256String(
      manifest.coverageApprovalSha256,
      "coverage approval SHA-256",
    ),
    sourceReconciliationEvidence,
    datasetPackage,
    tradeTrendDatasetPackage,
    scoreVersionsSupported,
    artifact: {
      schemaVersion: "candidate-market-artifact-v1",
      buildId,
      relativePath: "candidate-market.duckdb",
      bytes: count(artifact.bytes, "analysis artifact bytes"),
      sha256: sha256String(
        artifact.sha256,
        "analysis artifact SHA-256",
      ),
    },
    builtAt: utcTimestamp(manifest.builtAt, "artifact builtAt"),
    benchmarkQueries,
    tradeTrendBenchmarkQueries,
  };
}

export function createCandidateMarketDatasetPackageFromArtifacts(input: {
  manifest: AnalysisArtifactManifest;
  analysisReleaseCatalogSha256: string;
  previousManifest: AnalysisArtifactManifest | null;
}): CandidateMarketDatasetPackage {
  const { manifest, previousManifest } = input;
  const currentEvidence =
    datasetPackageEvidenceFromArtifactManifest(manifest);
  return createCandidateMarketDatasetPackage({
    schemaVersion: "candidate-market-dataset-package-manifest-v1",
    ...currentEvidence,
    content: {
      releaseCatalogSha256: input.analysisReleaseCatalogSha256,
      ...currentEvidence.content,
    },
    physicalObjects: [
      {
        role: "ANALYSIS_ARTIFACT",
        objectId: manifest.artifact.buildId,
        relativePath: manifest.artifact.relativePath,
        schemaVersion: manifest.artifact.schemaVersion,
        bytes: manifest.artifact.bytes,
        sha256: manifest.artifact.sha256,
      },
    ],
    comparisonEvidence:
      previousManifest === null
        ? null
        : {
            ...datasetPackageEvidenceFromArtifactManifest(
              previousManifest,
            ),
            physicalObject: {
              role: "PREVIOUS_ANALYSIS_ARTIFACT",
              objectId: previousManifest.artifact.buildId,
              relativePath: `previous/${previousManifest.artifact.relativePath}`,
              schemaVersion:
                previousManifest.artifact.schemaVersion,
              bytes: previousManifest.artifact.bytes,
              sha256: previousManifest.artifact.sha256,
            },
          },
  });
}

function datasetPackageEvidenceFromArtifactManifest(
  manifest: AnalysisArtifactManifest,
) {
  return {
    source: {
      dataset: "CEPII_BACI",
      release: manifest.baciRelease,
      updateDate: manifest.sourceUpdateDate,
      archive: {
        url: manifest.sourceUrl,
        bytes: manifest.sourceBytes,
        sha256: manifest.sourceSha256,
      },
    },
    packageSchemaVersion: manifest.artifact.schemaVersion,
    hsRevision: manifest.hsRevision,
    missingObservationTreatment:
      manifest.datasetPackage.missingObservationTreatment,
    coverage: {
      ingestedYears: {
        start: manifest.ingestedYears[0]!,
        end: manifest.ingestedYears.at(-1)!,
      },
      finalized: {
        years: {
          start: manifest.finalizedYears[0]!,
          end: manifest.finalizedYears.at(-1)!,
        },
        cutoffYear: manifest.finalizedCutoffYear,
        scoreWindow: manifest.scoreWindow,
        treatment: manifest.datasetPackage.finalizedTreatment,
      },
      provisional: {
        years: manifest.provisionalYears,
        treatment: manifest.datasetPackage.provisionalTreatment,
      },
    },
    capabilities: manifest.datasetPackage.capabilities,
    content: {
      stagingManifestSha256: manifest.stagingManifestSha256,
      coverageApprovalSha256: manifest.coverageApprovalSha256,
      sourceReconciliationEvidence:
        manifest.sourceReconciliationEvidence,
    },
    quality: {
      status: "accepted",
      evidence: [
        {
          kind: manifest.sourceReconciliationEvidence.kind,
          sha256: manifest.sourceReconciliationEvidence.sha256,
        },
        {
          kind: "COVERAGE_APPROVAL",
          sha256: manifest.coverageApprovalSha256,
        },
      ],
    },
    attribution: {
      statement: manifest.attribution,
      license: manifest.license,
    },
  };
}

function embeddedAnnualSourceChecksEvidence(
  value: unknown,
  ingestedYears: readonly number[],
): DatasetSourceReconciliationEvidence {
  const values = array(value, "annual source checks");
  if (values.length !== ingestedYears.length) {
    throw new Error(
      "Legacy analysis artifact must contain one annual source check per ingested year.",
    );
  }
  const checks = values.map((value, index) =>
    parseLegacyAnnualSourceCheck(
      value,
      ingestedYears[index]!,
      index,
    ),
  );
  const bytes = `${JSON.stringify(checks, null, 2)}\n`;
  return {
    kind: "EMBEDDED_ANNUAL_SOURCE_CHECKS",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseLegacyAnnualSourceCheck(
  value: unknown,
  expectedYear: number,
  index: number,
) {
  const label = `legacy annual source check ${index}`;
  const check = record(value, label);
  const keys = Object.keys(check);
  if (
    keys.length !== LEGACY_ANNUAL_SOURCE_CHECK_KEYS.length ||
    keys.some(
      (key) => !LEGACY_ANNUAL_SOURCE_CHECK_KEYS.includes(key),
    )
  ) {
    throw new Error(`${label} has an invalid object shape.`);
  }
  const parsed = {
    year: year(check.year, `${label} year`),
    rowCount: count(check.rowCount, `${label} row count`),
    exporterCount: count(
      check.exporterCount,
      `${label} exporter count`,
    ),
    importerCount: count(
      check.importerCount,
      `${label} importer count`,
    ),
    observedProductCount: count(
      check.observedProductCount,
      `${label} observed product count`,
    ),
    quantityPresentCount: count(
      check.quantityPresentCount,
      `${label} quantity-present count`,
    ),
    quantityNullCount: count(
      check.quantityNullCount,
      `${label} quantity-null count`,
    ),
    valueTotalKusd: fixed3(
      check.valueTotalKusd,
      `${label} value total`,
    ),
    quantityTotalTons: fixed3(
      check.quantityTotalTons,
      `${label} quantity total`,
    ),
  };
  if (parsed.year !== expectedYear) {
    throw new Error(
      `${label} must align with ingested year ${expectedYear}.`,
    );
  }
  if (
    parsed.quantityPresentCount + parsed.quantityNullCount !==
      parsed.rowCount ||
    parsed.exporterCount > parsed.rowCount ||
    parsed.importerCount > parsed.rowCount ||
    parsed.observedProductCount > parsed.rowCount
  ) {
    throw new Error(`${label} counts are inconsistent.`);
  }
  return parsed;
}

function fixed3(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^\d+\.\d{3}$/u.test(candidate)) {
    throw new Error(`${label} must have exactly three decimal places.`);
  }
  return candidate;
}

function parseBenchmarkQuery(
  value: unknown,
  index: number,
): AnalysisArtifactBenchmarkQuery {
  const query = record(value, `benchmark query ${index}`);
  const role = string(query.role, `benchmark query ${index} role`);
  if (
    role !== "sparse" &&
    role !== "median" &&
    role !== "upper-quartile" &&
    role !== "maximum-row"
  ) {
    throw new Error(`Benchmark query ${index} role is invalid.`);
  }
  const productCode = string(
    query.productCode,
    `benchmark query ${index} product code`,
  );
  const exporterCode = string(
    query.exporterCode,
    `benchmark query ${index} exporter code`,
  );
  if (!/^\d{6}$/u.test(productCode) || !/^\d{1,3}$/u.test(exporterCode)) {
    throw new Error(`Benchmark query ${index} identity is malformed.`);
  }
  return {
    role,
    productCode,
    exporterCode,
    candidateCount: count(
      query.candidateCount,
      `benchmark query ${index} candidate count`,
    ),
  };
}

function parseTradeTrendBenchmarkQuery(
  value: unknown,
  index: number,
): TradeTrendArtifactBenchmarkQuery {
  const query = record(value, `trade trend benchmark query ${index}`);
  const role = string(query.role, `trade trend benchmark query ${index} role`);
  if (
    role !== "sparse" &&
    role !== "median" &&
    role !== "upper-quartile" &&
    role !== "maximum-row"
  ) {
    throw new Error(`Trade trend benchmark query ${index} role is invalid.`);
  }
  const productCode = string(
    query.productCode,
    `trade trend benchmark query ${index} product code`,
  );
  const importerCode = string(
    query.importerCode,
    `trade trend benchmark query ${index} importer code`,
  );
  if (!/^\d{6}$/u.test(productCode) || !/^\d{1,3}$/u.test(importerCode)) {
    throw new Error(
      `Trade trend benchmark query ${index} identity is malformed.`,
    );
  }
  return {
    role,
    productCode,
    importerCode,
    windowRowCount: count(
      query.windowRowCount,
      `trade trend benchmark query ${index} window row count`,
    ),
    pairRowCount: count(
      query.pairRowCount,
      `trade trend benchmark query ${index} pair row count`,
    ),
  };
}

export function createTradeTrendDatasetPackageFromArtifacts(
  manifest: AnalysisArtifactManifest,
): TradeTrendDatasetPackage {
  // The declared capabilities come from the published artifact manifest
  // (manifest.tradeTrendDatasetPackage), not from a hardcoded requirements
  // list, so evaluateTradeTrendV1DatasetPackage() below is a genuine check
  // against reviewed, artifact-embedded evidence rather than a tautology.
  return createTradeTrendDatasetPackage({
    schemaVersion: "trade-trend-dataset-package-manifest-v1",
    baciRelease: manifest.baciRelease,
    hsRevision: manifest.hsRevision,
    finalizedYearCount: 5,
    evidenceSha256: manifest.artifact.sha256,
    capabilities: manifest.tradeTrendDatasetPackage.capabilities,
  });
}

function yearRange(
  value: unknown,
  label: string,
): { start: number; end: number } {
  const range = record(value, label);
  const start = year(range.start, `${label} start`);
  const end = year(range.end, `${label} end`);
  if (start > end) {
    throw new Error(`${label} start must not exceed its end.`);
  }
  return { start, end };
}

function yearArray(value: unknown, label: string): number[] {
  const years = array(value, label).map((entry) => year(entry, `${label} entry`));
  if (
    years.length === 0 ||
    years.some((entry, index) => index > 0 && entry !== years[index - 1]! + 1)
  ) {
    throw new Error(`${label} must be a nonempty contiguous sequence.`);
  }
  return years;
}

function year(value: unknown, label: string): number {
  const parsed = count(value, label);
  if (parsed < 1900 || parsed > 9999) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return parsed;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry) => string(entry, `${label} entry`));
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  const candidate = string(value, label);
  const instant = new Date(`${candidate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(candidate) ||
    Number.isNaN(instant.getTime()) ||
    instant.toISOString().slice(0, 10) !== candidate
  ) {
    throw new Error(`${label} must be an ISO date.`);
  }

  return candidate;
}

function absoluteUrl(value: unknown, label: string): string {
  const candidate = string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return candidate;
}
