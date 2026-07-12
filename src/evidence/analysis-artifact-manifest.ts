import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  count,
  hs12,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "../release/release-validation";

export type AnalysisArtifactBenchmarkQuery = {
  role: "sparse" | "median" | "upper-quartile" | "maximum-row";
  productCode: string;
  exporterCode: string;
  candidateCount: number;
};

export type AnalysisArtifactManifest = {
  schemaVersion: "candidate-market-artifact-manifest-v1";
  baciRelease: string;
  sourceSha256: string;
  sourceUpdateDate: string;
  hsRevision: "HS12";
  ingestedYears: number[];
  finalizedYears: number[];
  provisionalYears: number[];
  finalizedCutoffYear: number;
  scoreWindow: { start: number; end: number };
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
};

export async function readAnalysisArtifactManifest(
  path: string,
): Promise<AnalysisArtifactManifest> {
  return parseAnalysisArtifactManifest(
    JSON.parse(await readFile(resolve(path), "utf8")),
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
  const benchmarkQueries = array(
    manifest.benchmarkQueries,
    "benchmark queries",
  ).map(parseBenchmarkQuery);
  const buildId = string(artifact.buildId, "analysis artifact build ID");
  if (!/^candidate-market-artifact-v1-[a-f0-9]{16}$/u.test(buildId)) {
    throw new Error("Analysis artifact build ID is malformed.");
  }

  return {
    schemaVersion: "candidate-market-artifact-manifest-v1",
    baciRelease: string(manifest.baciRelease, "BACI Release"),
    sourceSha256: sha256String(manifest.sourceSha256, "source SHA-256"),
    sourceUpdateDate: date(
      manifest.sourceUpdateDate,
      "source update date",
    ),
    hsRevision: hs12(manifest.hsRevision, "HS revision"),
    ingestedYears,
    finalizedYears,
    provisionalYears,
    finalizedCutoffYear,
    scoreWindow,
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
  };
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
