import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  DuckDBInstance,
  type DuckDBConnection,
} from "@duckdb/node-api";

import { OPPORTUNITY_DISCOVERY_V1_DATASET_DECLARATION } from "../../src/domain/trade-analytics/opportunity-discovery-v1-dataset-package";
import { computeOpportunityCohort } from "../../src/domain/opportunity-discovery/opportunity-discovery-v1";
import type {
  EconomyIdentity,
  MarketInvestigationCandidate,
  OpportunityConfidenceDeductionCode,
  OpportunityEvidenceFlag,
  OpportunityType,
  ProductIdentity,
} from "../../src/domain/opportunity-discovery/result";
import type {
  OpportunityMarketEvidence,
  OpportunityMarketYearEvidence,
  OpportunityProductEvidence,
} from "../../src/evidence/opportunity-evidence-source";
import { readAnalysisArtifactManifest } from "../../src/evidence/analysis-artifact-manifest";

const INDEX_SCHEMA_VERSION = "opportunity-index-v1";
const INDEX_MANIFEST_SCHEMA_VERSION = "opportunity-index-manifest-v1";
const INDEX_REPORT_SCHEMA_VERSION = "opportunity-index-build-report-v1";
const RECIPE_VERSION = "opportunity-discovery-v1";
const RESULT_SCHEMA_VERSION = "market-investigation-result-v1";
const INDEX_RELATIVE_PATH = "opportunity-index.duckdb";
const INDEX_SCHEMA_PATH = "data/schemas/opportunity-index-v1.sql";

const GIB = 1024 * 1024 * 1024;
// The Opportunity Index product size target (spec 7.5). Exceeding it is a
// review-required signal, never a silent cohort-row drop.
const INDEX_SIZE_TARGET_BYTES = 4 * GIB;
// Existing analysis artifact plus this index.
const COMBINED_SIZE_TARGET_BYTES = 8 * GIB;
// Hard architecture gate: a combined package above this blocks promotion.
const COMBINED_SIZE_HARD_LIMIT_BYTES = 10 * GIB;

const IDENTITY_PROXY_ECONOMY_CODE = "490";
const APPENDER_FLUSH_ROWS = 250_000;

// Stable enum/bit orderings. These are part of the index identity: the code in
// opportunity_type and the bit positions in the flag bitsets are the array
// index below and are also published in the index dictionary tables. The order
// mirrors the public result contract (result.ts) and must never be reordered.
const OPPORTUNITY_TYPE_ORDER: readonly OpportunityType[] = [
  "UNVALIDATED_MARKET_GAP",
  "EXPANSION_EVIDENCE",
  "GENERAL_INVESTIGATION_EVIDENCE",
];
const CONFIDENCE_FLAG_ORDER: readonly OpportunityConfidenceDeductionCode[] = [
  "MISSING_FINALIZED_MARKET_YEARS",
  "MISSING_CUTOFF_YEAR_MARKET_EVIDENCE",
  "NEUTRAL_MARKET_GROWTH",
  "NO_EXPORTER_PRODUCT_HISTORY",
  "POSSIBLE_PRODUCT_SERIES_DISCONTINUITY",
  "LOW_ALTERNATE_WINDOW_STABILITY",
  "MATERIAL_RELEASE_REVISION",
  "IDENTITY_PROXY",
];
const EVIDENCE_FLAG_ORDER: readonly OpportunityEvidenceFlag[] = [
  "NO_RECORDED_BILATERAL_FLOW",
  "NO_RECORDED_PRODUCT_EXPORT",
  "EXTREME_NOMINAL_GROWTH",
  "IDENTITY_PROXY",
];

const OPPORTUNITY_TYPE_CODE = new Map<OpportunityType, number>(
  OPPORTUNITY_TYPE_ORDER.map((type, index) => [type, index]),
);
const CONFIDENCE_FLAG_BIT = new Map<OpportunityConfidenceDeductionCode, number>(
  CONFIDENCE_FLAG_ORDER.map((code, index) => [code, index]),
);
const EVIDENCE_FLAG_BIT = new Map<OpportunityEvidenceFlag, number>(
  EVIDENCE_FLAG_ORDER.map((flag, index) => [flag, index]),
);

export type OpportunityIndexBuildErrorCode =
  | "CLI_ARGUMENT_INVALID"
  | "ANALYSIS_ARTIFACT_MISSING"
  | "COVERAGE_INCOMPLETE"
  | "INDEX_BUILD_FAILED"
  | "ROW_UNIQUENESS_VIOLATED"
  | "COHORT_INCOMPLETE"
  | "SOURCE_ARTIFACT_MUTATED"
  | "COMBINED_SIZE_LIMIT_EXCEEDED"
  | "INDEX_PUBLICATION_FAILED";

export class OpportunityIndexBuildError extends Error {
  constructor(
    readonly code: OpportunityIndexBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpportunityIndexBuildError";
  }
}

export type OpportunityIndexBuildOptions = {
  // Directory holding the published analysis artifact (candidate-market.duckdb
  // plus artifact-manifest.json). The DuckDB file is opened READ_ONLY.
  analysisArtifactPath: string;
  // Workspace root; the index is published to <workspace>/opportunity-index/<sha256>/.
  workspacePath: string;
  reportPath: string;
  buildGitSha: string;
  builtAt: string;
  // Test-only knob: restrict the build to these exporter codes (still emits the
  // full per-exporter cohort for each). Undefined builds every eligible exporter.
  onlyExporterCodes?: readonly number[];
  // Optional progress sink; called once per completed exporter.
  onProgress?: (progress: OpportunityIndexBuildProgress) => void;
};

export type OpportunityIndexBuildProgress = {
  completedExporters: number;
  totalExporters: number;
  exporterCode: number;
  cohortRows: number;
  cumulativeRows: number;
  elapsedMs: number;
  rssBytes: number;
};

export type OpportunityIndexBuildOutcome = {
  status: "accepted";
  indexSha256: string;
  indexBytes: number;
  totalRowCount: number;
  exporterCount: number;
  publicationPath: string;
  reportPath: string;
  indexSizeReviewRequired: boolean;
};

// The compact persisted grain, one per eligible (exporter, product, importer).
type CompactCandidateRow = {
  exporterCode: number;
  productId: number;
  importerCode: number;
  priorityDisplay: number;
  attractivenessDisplay: number;
  exporterFitDisplay: number;
  marketSizePercentileBp: number;
  marketGrowthPercentileBp: number;
  productPresencePercentileBp: number;
  footholdPercentileBp: number;
  competitionRank: number;
  opportunityType: number;
  confidenceScore: number;
  confidenceFlags: number;
  evidenceFlags: number;
};

// Pure projection of one public candidate into the compact persisted row. This
// is the parity seam: given an identical candidate from computeOpportunityCohort
// it always yields the same compact row, so tests can assert byte-equality
// without touching DuckDB.
export function candidateToCompactRow(
  candidate: MarketInvestigationCandidate,
  exporterCode: number,
  productId: number,
): CompactCandidateRow {
  let confidenceFlags = 0;
  for (const deduction of candidate.confidence.deductions) {
    confidenceFlags |= 1 << requireBit(CONFIDENCE_FLAG_BIT, deduction.code);
  }
  let evidenceFlags = 0;
  for (const flag of candidate.evidenceFlags) {
    evidenceFlags |= 1 << requireBit(EVIDENCE_FLAG_BIT, flag);
  }
  return {
    exporterCode,
    productId,
    importerCode: Number(candidate.market.code),
    priorityDisplay: candidate.investigationPriority.display,
    attractivenessDisplay: candidate.marketAttractiveness.display,
    exporterFitDisplay: candidate.exporterFit.display,
    marketSizePercentileBp: candidate.components.marketSize.percentileBasisPoints,
    marketGrowthPercentileBp:
      candidate.components.marketGrowth.percentileBasisPoints,
    productPresencePercentileBp:
      candidate.components.exporterProductPresence.percentileBasisPoints,
    footholdPercentileBp:
      candidate.components.recordedFoothold.percentileBasisPoints,
    competitionRank: candidate.competitionRank,
    opportunityType: requireCode(OPPORTUNITY_TYPE_CODE, candidate.opportunityType),
    confidenceScore: candidate.confidence.score,
    confidenceFlags,
    evidenceFlags,
  };
}

function requireBit<K>(map: Map<K, number>, key: K): number {
  const bit = map.get(key);
  if (bit === undefined) {
    throw new OpportunityIndexBuildError(
      "INDEX_BUILD_FAILED",
      `Unknown flag ${String(key)} has no stable bit assignment.`,
    );
  }
  return bit;
}

function requireCode<K>(map: Map<K, number>, key: K): number {
  const code = map.get(key);
  if (code === undefined) {
    throw new OpportunityIndexBuildError(
      "INDEX_BUILD_FAILED",
      `Unknown opportunity type ${String(key)} has no stable code.`,
    );
  }
  return code;
}

// Shared, immutable-across-exporters analysis inputs loaded once from the
// artifact. The market universe (every W10 (product, importer) pair) is the
// dominant allocation; it is built once and its bilateral overlay is mutated in
// place per exporter to avoid re-allocating ~1M objects for each of ~227 runs.
type SharedAnalysisInputs = {
  productById: Map<number, ProductIdentity>;
  productIdByCode: Map<string, number>;
  economyByCode: Map<number, EconomyIdentity>;
  eligibleExporterCodes: number[];
  products: OpportunityProductEvidence[];
  productEvidenceById: Map<number, OpportunityProductEvidence>;
  markets: OpportunityMarketEvidence[];
  // product_id -> importer_code -> the shared market object for bilateral overlay.
  marketByPair: Map<number, Map<number, OpportunityMarketEvidence>>;
  universeW10Pairs: number;
  w5EligiblePairs: number;
};

type WindowBounds = { start: number; end: number };

export async function buildOpportunityIndex(
  options: OpportunityIndexBuildOptions,
): Promise<OpportunityIndexBuildOutcome> {
  const buildStarted = performance.now();
  const timings: Record<string, number> = {};

  const artifactManifestPath = join(
    options.analysisArtifactPath,
    "artifact-manifest.json",
  );
  const artifactDuckDbPath = join(
    options.analysisArtifactPath,
    "candidate-market.duckdb",
  );
  const manifest = await readAnalysisArtifactManifest(artifactManifestPath);
  const sourceIdentityBefore = await fileIdentity(artifactDuckDbPath);
  if (sourceIdentityBefore.sha256 !== manifest.artifact.sha256) {
    throw new OpportunityIndexBuildError(
      "ANALYSIS_ARTIFACT_MISSING",
      `Analysis artifact SHA-256 ${sourceIdentityBefore.sha256} does not match manifest ${manifest.artifact.sha256}.`,
    );
  }

  const cutoffYear = manifest.finalizedCutoffYear;
  const scoreWindow: WindowBounds = { start: cutoffYear - 4, end: cutoffYear };
  const threeYearWindow: WindowBounds = { start: cutoffYear - 2, end: cutoffYear };
  const tenYearWindow: WindowBounds = { start: cutoffYear - 9, end: cutoffYear };

  const workspacePath = resolve(options.workspacePath);
  const temporaryPath = join(workspacePath, "opportunity-index-tmp");
  const spillPath = join(temporaryPath, "spill");
  await mkdir(spillPath, { recursive: true });
  const partialIndexPath = join(
    temporaryPath,
    `${manifest.artifact.sha256}-${process.pid}.duckdb.partial`,
  );
  await rm(partialIndexPath, { force: true });

  const readInstance = await DuckDBInstance.create(artifactDuckDbPath, {
    access_mode: "READ_ONLY",
    threads: "4",
    memory_limit: "2GB",
    temp_directory: spillPath,
  });

  let outcome: OpportunityIndexBuildOutcome;
  try {
    const readConnection = await readInstance.connect();
    const loadStarted = performance.now();
    const shared = await loadSharedInputs(
      readConnection,
      tenYearWindow,
      scoreWindow,
      options.onlyExporterCodes,
    );
    timings.loadSharedMs = elapsedMilliseconds(loadStarted);

    await assertCoverage(readConnection, tenYearWindow);

    const buildResult = await populateIndex({
      readConnection,
      partialIndexPath,
      spillPath,
      shared,
      manifest,
      windows: { scoreWindow, threeYearWindow, tenYearWindow },
      onProgress: options.onProgress,
    });
    timings.populateMs = buildResult.populateMs;
    timings.computeMs = buildResult.computeMs;

    const reconcileStarted = performance.now();
    await reconcileIndex(
      readConnection,
      partialIndexPath,
      spillPath,
      shared,
      scoreWindow,
      buildResult.perExporterRowCount,
    );
    timings.reconcileMs = elapsedMilliseconds(reconcileStarted);

    const sourceIdentityAfter = await fileIdentity(artifactDuckDbPath);
    if (sourceIdentityAfter.sha256 !== sourceIdentityBefore.sha256) {
      throw new OpportunityIndexBuildError(
        "SOURCE_ARTIFACT_MUTATED",
        "Source analysis artifact changed during the index build.",
      );
    }

    const indexIdentity = await fileIdentity(partialIndexPath);
    const combinedBytes = indexIdentity.bytes + sourceIdentityBefore.bytes;
    if (combinedBytes > COMBINED_SIZE_HARD_LIMIT_BYTES) {
      throw new OpportunityIndexBuildError(
        "COMBINED_SIZE_LIMIT_EXCEEDED",
        `Combined analytical package is ${combinedBytes} bytes; the hard limit is ${COMBINED_SIZE_HARD_LIMIT_BYTES}.`,
      );
    }

    outcome = await publishIndex({
      workspacePath,
      temporaryPath,
      partialIndexPath,
      indexIdentity,
      combinedBytes,
      sourceBytes: sourceIdentityBefore.bytes,
      manifest,
      shared,
      windows: { scoreWindow, threeYearWindow, tenYearWindow },
      buildResult,
      reportPath: options.reportPath,
      buildGitSha: options.buildGitSha,
      builtAt: options.builtAt,
      duckdbVersion: buildResult.duckdbVersion,
      timings: { ...timings, totalMs: elapsedMilliseconds(buildStarted) },
    });
  } catch (error) {
    await rm(partialIndexPath, { force: true });
    if (error instanceof OpportunityIndexBuildError) {
      throw error;
    }
    throw new OpportunityIndexBuildError(
      "INDEX_BUILD_FAILED",
      `Opportunity Index build failed: ${errorMessage(error)}`,
    );
  } finally {
    readInstance.closeSync();
  }
  return outcome;
}

async function loadSharedInputs(
  connection: DuckDBConnection,
  tenYearWindow: WindowBounds,
  scoreWindow: WindowBounds,
  onlyExporterCodes: readonly number[] | undefined,
): Promise<SharedAnalysisInputs> {
  const productById = new Map<number, ProductIdentity>();
  const productIdByCode = new Map<string, number>();
  await streamRows(
    connection,
    "SELECT product_id, hs12_code, source_description FROM product",
    (columns, index) => {
      const productId = Number(columns[0]![index]);
      const code = String(columns[1]![index]);
      productById.set(productId, {
        hsRevision: "HS12",
        code,
        descriptionEn: String(columns[2]![index]),
      });
      productIdByCode.set(code, productId);
    },
  );

  const economyByCode = new Map<number, EconomyIdentity>();
  const eligibleExporterCodes: number[] = [];
  await streamRows(
    connection,
    "SELECT code, display_name, iso3, identity_note, kind, has_trade_evidence FROM economy ORDER BY code",
    (columns, index) => {
      const code = Number(columns[0]![index]);
      const iso3 = columns[2]![index];
      const identityNote = columns[3]![index];
      economyByCode.set(code, {
        code: String(code),
        name: String(columns[1]![index]),
        iso3: iso3 === null ? null : String(iso3),
        identityNote: identityNote === null ? null : String(identityNote),
      });
      // Eligibility 2.3(1): individual economies accepted by the package. The
      // analysis build marks defunct/aggregate identities with no trade
      // evidence; those are outside the known universe and never exporters.
      if (columns[4]![index] === "ECONOMY" && columns[5]![index] === true) {
        eligibleExporterCodes.push(code);
      }
    },
  );
  eligibleExporterCodes.sort((left, right) => left - right);
  const selectedExporterCodes =
    onlyExporterCodes === undefined
      ? eligibleExporterCodes
      : eligibleExporterCodes.filter((code) => onlyExporterCodes.includes(code));

  // G[k,t]: world product totals over W10. Shared across every exporter.
  const products: OpportunityProductEvidence[] = [];
  const productEvidenceById = new Map<number, OpportunityProductEvidence>();
  const worldTotals = new Map<number, { year: number; worldValueKusd: string }[]>();
  await streamRows(
    connection,
    `SELECT product_id, year, CAST(world_value_kusd AS VARCHAR) v FROM product_year WHERE year BETWEEN ${tenYearWindow.start} AND ${tenYearWindow.end}`,
    (columns, index) => {
      const productId = Number(columns[0]![index]);
      let totals = worldTotals.get(productId);
      if (totals === undefined) {
        totals = [];
        worldTotals.set(productId, totals);
      }
      totals.push({
        year: Number(columns[1]![index]),
        worldValueKusd: String(columns[2]![index]),
      });
    },
  );
  for (const [productId, worldYearTotals] of worldTotals) {
    const identity = productById.get(productId);
    if (identity === undefined) {
      continue;
    }
    const evidence: OpportunityProductEvidence = {
      product: identity,
      worldYearTotals,
      exporterExportTotals: [],
    };
    products.push(evidence);
    productEvidenceById.set(productId, evidence);
  }

  // M[k,j,t]: the W10 market universe. Building bilateral overlay in place later.
  const markets: OpportunityMarketEvidence[] = [];
  const marketByPair = new Map<number, Map<number, OpportunityMarketEvidence>>();
  let w5EligiblePairs = 0;
  await streamRows(
    connection,
    `SELECT product_id, importer_code, year, CAST(world_value_kusd AS VARCHAR) v FROM market_year WHERE year BETWEEN ${tenYearWindow.start} AND ${tenYearWindow.end}`,
    (columns, index) => {
      const productId = Number(columns[0]![index]);
      const importerCode = Number(columns[1]![index]);
      let byImporter = marketByPair.get(productId);
      if (byImporter === undefined) {
        byImporter = new Map();
        marketByPair.set(productId, byImporter);
      }
      let market = byImporter.get(importerCode);
      if (market === undefined) {
        const productIdentity = productById.get(productId);
        const economyIdentity = economyByCode.get(importerCode);
        if (productIdentity === undefined || economyIdentity === undefined) {
          return;
        }
        market = {
          product: productIdentity,
          market: economyIdentity,
          marketYears: [],
        };
        byImporter.set(importerCode, market);
        markets.push(market);
      }
      (market.marketYears as OpportunityMarketYearEvidence[]).push({
        year: Number(columns[2]![index]),
        worldValueKusd: String(columns[3]![index]),
        bilateralValueKusd: null,
      });
    },
  );

  const w5Pairs = await queryScalarNumber(
    connection,
    `SELECT COUNT(*) FROM (SELECT DISTINCT product_id, importer_code FROM market_year WHERE year BETWEEN ${scoreWindow.start} AND ${scoreWindow.end})`,
  );
  w5EligiblePairs = w5Pairs;

  return {
    productById,
    productIdByCode,
    economyByCode,
    eligibleExporterCodes: selectedExporterCodes,
    products,
    productEvidenceById,
    markets,
    marketByPair,
    universeW10Pairs: markets.length,
    w5EligiblePairs,
  };
}

async function assertCoverage(
  connection: DuckDBConnection,
  tenYearWindow: WindowBounds,
): Promise<void> {
  for (let year = tenYearWindow.start; year <= tenYearWindow.end; year += 1) {
    const marketRows = await queryScalarNumber(
      connection,
      `SELECT COUNT(*) FROM market_year WHERE year = ${year}`,
    );
    const productRows = await queryScalarNumber(
      connection,
      `SELECT COUNT(*) FROM product_year WHERE year = ${year}`,
    );
    if (marketRows === 0 || productRows === 0) {
      throw new OpportunityIndexBuildError(
        "COVERAGE_INCOMPLETE",
        `Analysis artifact is missing market/product coverage for year ${year}.`,
      );
    }
  }
}

type PopulateResult = {
  totalRowCount: number;
  perExporterRowCount: Map<number, number>;
  perExporterStats: ExporterStats[];
  populateMs: number;
  computeMs: number;
  duckdbVersion: string;
};

type ExporterStats = {
  exporterCode: number;
  cohortRows: number;
  priorityTieGroups: number;
  maxPriorityDisplay: number;
  minPriorityDisplay: number;
  gapRows: number;
  expansionRows: number;
  generalRows: number;
  computeMs: number;
};

async function populateIndex(args: {
  readConnection: DuckDBConnection;
  partialIndexPath: string;
  spillPath: string;
  shared: SharedAnalysisInputs;
  manifest: Awaited<ReturnType<typeof readAnalysisArtifactManifest>>;
  windows: {
    scoreWindow: WindowBounds;
    threeYearWindow: WindowBounds;
    tenYearWindow: WindowBounds;
  };
  onProgress?: (progress: OpportunityIndexBuildProgress) => void;
}): Promise<PopulateResult> {
  const {
    readConnection,
    partialIndexPath,
    spillPath,
    shared,
    manifest,
    windows,
    onProgress,
  } = args;
  const populateStarted = performance.now();

  const writeInstance = await DuckDBInstance.create(partialIndexPath, {
    threads: "2",
    memory_limit: "2GB",
    temp_directory: spillPath,
  });
  const perExporterRowCount = new Map<number, number>();
  const perExporterStats: ExporterStats[] = [];
  let totalRowCount = 0;
  let computeMs = 0;
  let duckdbVersion: string;
  try {
    const writeConnection = await writeInstance.connect();
    // Canonical physical order requires insertion order be preserved verbatim.
    await writeConnection.run("SET preserve_insertion_order = true");
    await writeConnection.run(await readIndexSchema());
    await writeDictionaries(writeConnection);
    const version = await queryScalarString(
      writeConnection,
      "SELECT version()",
    );
    duckdbVersion = version;

    const appender = await writeConnection.createAppender(
      "opportunity_candidate",
    );
    let rowsSinceFlush = 0;

    const release = {
      baciRelease: manifest.baciRelease,
      sourceUpdateDate: manifest.sourceUpdateDate,
      hsRevision: "HS12" as const,
      ingestedYears: {
        start: manifest.ingestedYears[0]!,
        end: manifest.ingestedYears.at(-1)!,
      },
      finalizedCutoffYear: manifest.finalizedCutoffYear,
      provisionalYear: manifest.provisionalYears[0]!,
    };
    const artifact = {
      baciRelease: manifest.baciRelease,
      buildId: manifest.artifact.buildId,
      schemaVersion: manifest.artifact.schemaVersion,
      sha256: manifest.artifact.sha256,
    };

    let previousTouchedMarketYears: OpportunityMarketYearEvidence[] = [];
    let previousTouchedProductIds: number[] = [];
    const totalExporters = shared.eligibleExporterCodes.length;
    let completedExporters = 0;

    for (const exporterCode of shared.eligibleExporterCodes) {
      // Reset the previous exporter's in-place overlay before applying this one.
      for (const marketYear of previousTouchedMarketYears) {
        marketYear.bilateralValueKusd = null;
      }
      for (const productId of previousTouchedProductIds) {
        const evidence = shared.productEvidenceById.get(productId);
        if (evidence !== undefined) {
          evidence.exporterExportTotals = [];
        }
      }

      const overlay = await applyExporterOverlay(
        readConnection,
        shared,
        exporterCode,
        windows.tenYearWindow,
      );
      previousTouchedMarketYears = overlay.touchedMarketYears;
      previousTouchedProductIds = overlay.touchedProductIds;

      const exporter = shared.economyByCode.get(exporterCode)!;
      const computeStarted = performance.now();
      const cohort = computeOpportunityCohort({
        analysisBuildId: manifest.artifact.buildId,
        artifact,
        release,
        exporter,
        products: shared.products,
        markets: shared.markets,
        previousRelease: null,
      });
      const exporterComputeMs = elapsedMilliseconds(computeStarted);
      computeMs += exporterComputeMs;

      let gapRows = 0;
      let expansionRows = 0;
      let generalRows = 0;
      let priorityTieGroups = 0;
      let maxPriorityDisplay = 0;
      let minPriorityDisplay = 100;
      let previousPriority = -1;
      for (const candidate of cohort.candidates) {
        const productId = shared.productIdByCode.get(candidate.product.code)!;
        const row = candidateToCompactRow(candidate, exporterCode, productId);
        appendCompactRow(appender, row);
        rowsSinceFlush += 1;
        if (rowsSinceFlush >= APPENDER_FLUSH_ROWS) {
          appender.flushSync();
          rowsSinceFlush = 0;
        }
        switch (candidate.opportunityType) {
          case "UNVALIDATED_MARKET_GAP":
            gapRows += 1;
            break;
          case "EXPANSION_EVIDENCE":
            expansionRows += 1;
            break;
          default:
            generalRows += 1;
        }
        const priority = row.priorityDisplay;
        if (priority !== previousPriority) {
          priorityTieGroups += 1;
          previousPriority = priority;
        }
        if (priority > maxPriorityDisplay) {
          maxPriorityDisplay = priority;
        }
        if (priority < minPriorityDisplay) {
          minPriorityDisplay = priority;
        }
      }

      const cohortRows = cohort.candidates.length;
      perExporterRowCount.set(exporterCode, cohortRows);
      perExporterStats.push({
        exporterCode,
        cohortRows,
        priorityTieGroups,
        maxPriorityDisplay: cohortRows === 0 ? 0 : maxPriorityDisplay,
        minPriorityDisplay: cohortRows === 0 ? 0 : minPriorityDisplay,
        gapRows,
        expansionRows,
        generalRows,
        computeMs: exporterComputeMs,
      });
      totalRowCount += cohortRows;
      completedExporters += 1;
      onProgress?.({
        completedExporters,
        totalExporters,
        exporterCode,
        cohortRows,
        cumulativeRows: totalRowCount,
        elapsedMs: elapsedMilliseconds(populateStarted),
        rssBytes: process.memoryUsage().rss,
      });
      if (globalThis.gc !== undefined) {
        globalThis.gc();
      }
    }

    appender.flushSync();
    appender.closeSync();
    await writeConnection.run("ANALYZE");
    await writeConnection.run("CHECKPOINT");
  } finally {
    writeInstance.closeSync();
  }

  return {
    totalRowCount,
    perExporterRowCount,
    perExporterStats,
    populateMs: elapsedMilliseconds(populateStarted),
    computeMs,
    duckdbVersion,
  };
}

async function applyExporterOverlay(
  connection: DuckDBConnection,
  shared: SharedAnalysisInputs,
  exporterCode: number,
  tenYearWindow: WindowBounds,
): Promise<{
  touchedMarketYears: OpportunityMarketYearEvidence[];
  touchedProductIds: number[];
}> {
  // B[e,k,j,t]: raw bilateral flow attaches to the shared market year objects.
  const touchedMarketYears: OpportunityMarketYearEvidence[] = [];
  await streamRows(
    connection,
    `SELECT product_id, importer_code, year, CAST(value_kusd AS VARCHAR) v FROM bilateral_year WHERE exporter_code = ${exporterCode} AND year BETWEEN ${tenYearWindow.start} AND ${tenYearWindow.end}`,
    (columns, index) => {
      const productId = Number(columns[0]![index]);
      const importerCode = Number(columns[1]![index]);
      const market = shared.marketByPair.get(productId)?.get(importerCode);
      if (market === undefined) {
        return;
      }
      const year = Number(columns[2]![index]);
      for (const marketYear of market.marketYears) {
        if (marketYear.year === year) {
          marketYear.bilateralValueKusd = String(columns[3]![index]);
          touchedMarketYears.push(marketYear);
          break;
        }
      }
    },
  );

  // X[e,k,t]: exporter product totals, summed exactly in DuckDB (never in JS
  // floating point) so presence numerators keep decimal parity with the source.
  const touchedProductIds: number[] = [];
  const totalsByProduct = new Map<
    number,
    { year: number; valueKusd: string }[]
  >();
  await streamRows(
    connection,
    `SELECT product_id, year, CAST(SUM(value_kusd) AS VARCHAR) v FROM bilateral_year WHERE exporter_code = ${exporterCode} AND year BETWEEN ${tenYearWindow.start} AND ${tenYearWindow.end} GROUP BY product_id, year`,
    (columns, index) => {
      const productId = Number(columns[0]![index]);
      let totals = totalsByProduct.get(productId);
      if (totals === undefined) {
        totals = [];
        totalsByProduct.set(productId, totals);
      }
      totals.push({
        year: Number(columns[1]![index]),
        valueKusd: String(columns[2]![index]),
      });
    },
  );
  for (const [productId, totals] of totalsByProduct) {
    const evidence = shared.productEvidenceById.get(productId);
    if (evidence !== undefined) {
      evidence.exporterExportTotals = totals;
      touchedProductIds.push(productId);
    }
  }

  return { touchedMarketYears, touchedProductIds };
}

function appendCompactRow(
  appender: Awaited<ReturnType<DuckDBConnection["createAppender"]>>,
  row: CompactCandidateRow,
): void {
  appender.appendUSmallInt(row.exporterCode);
  appender.appendUSmallInt(row.productId);
  appender.appendUSmallInt(row.importerCode);
  appender.appendUTinyInt(row.priorityDisplay);
  appender.appendUTinyInt(row.attractivenessDisplay);
  appender.appendUTinyInt(row.exporterFitDisplay);
  appender.appendUSmallInt(row.marketSizePercentileBp);
  appender.appendUSmallInt(row.marketGrowthPercentileBp);
  appender.appendUSmallInt(row.productPresencePercentileBp);
  appender.appendUSmallInt(row.footholdPercentileBp);
  appender.appendUInteger(row.competitionRank);
  appender.appendUTinyInt(row.opportunityType);
  appender.appendUTinyInt(row.confidenceScore);
  appender.appendUInteger(row.confidenceFlags);
  appender.appendUInteger(row.evidenceFlags);
  appender.endRow();
}

async function writeDictionaries(connection: DuckDBConnection): Promise<void> {
  const typeAppender = await connection.createAppender(
    "opportunity_type_dictionary",
  );
  OPPORTUNITY_TYPE_ORDER.forEach((label, code) => {
    typeAppender.appendUTinyInt(code);
    typeAppender.appendVarchar(label);
    typeAppender.endRow();
  });
  typeAppender.closeSync();

  const confidenceAppender = await connection.createAppender(
    "opportunity_confidence_flag_dictionary",
  );
  CONFIDENCE_FLAG_ORDER.forEach((code, bit) => {
    confidenceAppender.appendUTinyInt(bit);
    confidenceAppender.appendVarchar(code);
    confidenceAppender.endRow();
  });
  confidenceAppender.closeSync();

  const evidenceAppender = await connection.createAppender(
    "opportunity_evidence_flag_dictionary",
  );
  EVIDENCE_FLAG_ORDER.forEach((code, bit) => {
    evidenceAppender.appendUTinyInt(bit);
    evidenceAppender.appendVarchar(code);
    evidenceAppender.endRow();
  });
  evidenceAppender.closeSync();
}

async function reconcileIndex(
  readConnection: DuckDBConnection,
  partialIndexPath: string,
  spillPath: string,
  shared: SharedAnalysisInputs,
  scoreWindow: WindowBounds,
  perExporterRowCount: Map<number, number>,
): Promise<void> {
  // Row uniqueness and persisted counts are read from the finished index.
  const verifyInstance = await DuckDBInstance.create(partialIndexPath, {
    access_mode: "READ_ONLY",
    threads: "4",
    memory_limit: "2GB",
    temp_directory: spillPath,
  });
  const persistedByExporter = new Map<number, number>();
  try {
    const connection = await verifyInstance.connect();
    const duplicateKeys = await queryScalarNumber(
      connection,
      "SELECT COUNT(*) FROM (SELECT exporter_code, product_id, importer_code FROM opportunity_candidate GROUP BY 1,2,3 HAVING COUNT(*) > 1)",
    );
    if (duplicateKeys > 0) {
      throw new OpportunityIndexBuildError(
        "ROW_UNIQUENESS_VIOLATED",
        `Index has ${duplicateKeys} duplicate (exporter, product, importer) keys.`,
      );
    }
    await streamRows(
      connection,
      "SELECT exporter_code, COUNT(*) FROM opportunity_candidate GROUP BY exporter_code",
      (columns, index) => {
        persistedByExporter.set(
          Number(columns[0]![index]),
          Number(columns[1]![index]),
        );
      },
    );
  } finally {
    verifyInstance.closeSync();
  }

  // Independent SQL eligibility count per exporter: distinct (product, importer)
  // pairs with at least one W5 market observation, excluding self-imports.
  for (const exporterCode of shared.eligibleExporterCodes) {
    const eligibleCount = await queryScalarNumber(
      readConnection,
      `SELECT COUNT(*) FROM (SELECT DISTINCT product_id, importer_code FROM market_year WHERE year BETWEEN ${scoreWindow.start} AND ${scoreWindow.end} AND importer_code <> ${exporterCode})`,
    );
    const persisted = persistedByExporter.get(exporterCode) ?? 0;
    const reported = perExporterRowCount.get(exporterCode) ?? 0;
    if (eligibleCount !== persisted || persisted !== reported) {
      throw new OpportunityIndexBuildError(
        "COHORT_INCOMPLETE",
        `Exporter ${exporterCode} cohort mismatch: eligible=${eligibleCount}, persisted=${persisted}, reported=${reported}.`,
      );
    }
  }
}

async function publishIndex(args: {
  workspacePath: string;
  temporaryPath: string;
  partialIndexPath: string;
  indexIdentity: { bytes: number; sha256: string };
  combinedBytes: number;
  sourceBytes: number;
  manifest: Awaited<ReturnType<typeof readAnalysisArtifactManifest>>;
  shared: SharedAnalysisInputs;
  windows: {
    scoreWindow: WindowBounds;
    threeYearWindow: WindowBounds;
    tenYearWindow: WindowBounds;
  };
  buildResult: PopulateResult;
  reportPath: string;
  buildGitSha: string;
  builtAt: string;
  duckdbVersion: string;
  timings: Record<string, number>;
}): Promise<OpportunityIndexBuildOutcome> {
  const {
    workspacePath,
    partialIndexPath,
    indexIdentity,
    combinedBytes,
    sourceBytes,
    manifest,
    shared,
    windows,
    buildResult,
    reportPath,
    buildGitSha,
    builtAt,
    duckdbVersion,
    timings,
  } = args;

  const indexBuildId = `${INDEX_SCHEMA_VERSION}-${indexIdentity.sha256.slice(0, 16)}`;
  const indexSizeReviewRequired =
    indexIdentity.bytes > INDEX_SIZE_TARGET_BYTES;
  const benchmarkExporters = selectBenchmarkExporters(
    buildResult.perExporterStats,
  );
  const indexManifest = {
    schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
    indexSchemaVersion: INDEX_SCHEMA_VERSION,
    recipeVersion: RECIPE_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    baciRelease: manifest.baciRelease,
    sourceUpdateDate: manifest.sourceUpdateDate,
    hsRevision: manifest.hsRevision,
    finalizedCutoffYear: manifest.finalizedCutoffYear,
    scoreWindow: windows.scoreWindow,
    threeYearWindow: windows.threeYearWindow,
    tenYearWindow: windows.tenYearWindow,
    provisionalYear: manifest.provisionalYears[0]!,
    datasetPackage: OPPORTUNITY_DISCOVERY_V1_DATASET_DECLARATION,
    sourceArtifact: {
      schemaVersion: manifest.artifact.schemaVersion,
      buildId: manifest.artifact.buildId,
      sha256: manifest.artifact.sha256,
      bytes: sourceBytes,
    },
    previousReleaseArtifact: null,
    index: {
      relativePath: INDEX_RELATIVE_PATH,
      buildId: indexBuildId,
      bytes: indexIdentity.bytes,
      sha256: indexIdentity.sha256,
    },
    exporterCount: shared.eligibleExporterCodes.length,
    totalRowCount: buildResult.totalRowCount,
    universeW10Pairs: shared.universeW10Pairs,
    w5EligiblePairs: shared.w5EligiblePairs,
    buildGitSha,
    duckdbVersion,
    builtAt,
  };
  const indexManifestBytes = jsonBytes(indexManifest);

  const report = {
    schemaVersion: INDEX_REPORT_SCHEMA_VERSION,
    status: "accepted" as const,
    indexManifestSha256: sha256(indexManifestBytes),
    indexManifest,
    sizeGate: {
      indexBytes: indexIdentity.bytes,
      indexTargetBytes: INDEX_SIZE_TARGET_BYTES,
      indexStatus: indexSizeReviewRequired ? "review-required" : "accepted",
      combinedBytes,
      combinedTargetBytes: COMBINED_SIZE_TARGET_BYTES,
      combinedHardLimitBytes: COMBINED_SIZE_HARD_LIMIT_BYTES,
      combinedStatus:
        combinedBytes <= COMBINED_SIZE_TARGET_BYTES
          ? "accepted"
          : "review-required",
    },
    reconciliation: {
      rowUniqueness: "verified",
      cohortCompleteness: "verified",
      sourceArtifactSha256: manifest.artifact.sha256,
      sourcePreservation: "verified",
      universeW10Pairs: shared.universeW10Pairs,
      w5EligiblePairs: shared.w5EligiblePairs,
    },
    rowDistribution: summarizeRowDistribution(buildResult.perExporterStats),
    benchmarkExporters,
    perExporterStats: buildResult.perExporterStats,
    timingsMs: timings,
    peakRssBytes: process.memoryUsage().rss,
    builtAt,
  };
  const reportBytes = jsonBytes(report);

  const publicationPath = join(
    workspacePath,
    "opportunity-index",
    indexIdentity.sha256,
  );
  const partialPublicationPath = join(
    workspacePath,
    "opportunity-index",
    `.${indexIdentity.sha256}-${process.pid}.partial`,
  );
  try {
    await rm(partialPublicationPath, { force: true, recursive: true });
    await mkdir(partialPublicationPath, { recursive: true });
    await rename(
      partialIndexPath,
      join(partialPublicationPath, INDEX_RELATIVE_PATH),
    );
    await writeFile(
      join(partialPublicationPath, "opportunity-index-manifest.json"),
      indexManifestBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(partialPublicationPath, "opportunity-index-build-report.json"),
      reportBytes,
      { flag: "wx" },
    );
    await rm(publicationPath, { force: true, recursive: true });
    await rename(partialPublicationPath, publicationPath);
    await writeFile(resolve(reportPath), reportBytes);
  } catch (error) {
    await rm(partialPublicationPath, { force: true, recursive: true });
    throw new OpportunityIndexBuildError(
      "INDEX_PUBLICATION_FAILED",
      `Index publication failed: ${errorMessage(error)}`,
    );
  }

  return {
    status: "accepted",
    indexSha256: indexIdentity.sha256,
    indexBytes: indexIdentity.bytes,
    totalRowCount: buildResult.totalRowCount,
    exporterCount: shared.eligibleExporterCodes.length,
    publicationPath,
    reportPath,
    indexSizeReviewRequired,
  };
}

function selectBenchmarkExporters(
  stats: readonly ExporterStats[],
): Record<string, { exporterCode: number; cohortRows: number }> {
  if (stats.length === 0) {
    return {};
  }
  const sorted = [...stats].sort((left, right) => left.cohortRows - right.cohortRows);
  const at = (fraction: number): ExporterStats => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(fraction * (sorted.length - 1))),
    );
    return sorted[index]!;
  };
  const shape = (entry: ExporterStats) => ({
    exporterCode: entry.exporterCode,
    cohortRows: entry.cohortRows,
  });
  return {
    sparse: shape(sorted[0]!),
    median: shape(at(0.5)),
    upperQuartile: shape(at(0.75)),
    maximumRow: shape(sorted[sorted.length - 1]!),
  };
}

function summarizeRowDistribution(stats: readonly ExporterStats[]): {
  minCohortRows: number;
  maxCohortRows: number;
  totalGapRows: number;
  totalExpansionRows: number;
  totalGeneralRows: number;
} {
  let minCohortRows = Number.POSITIVE_INFINITY;
  let maxCohortRows = 0;
  let totalGapRows = 0;
  let totalExpansionRows = 0;
  let totalGeneralRows = 0;
  for (const entry of stats) {
    minCohortRows = Math.min(minCohortRows, entry.cohortRows);
    maxCohortRows = Math.max(maxCohortRows, entry.cohortRows);
    totalGapRows += entry.gapRows;
    totalExpansionRows += entry.expansionRows;
    totalGeneralRows += entry.generalRows;
  }
  return {
    minCohortRows: stats.length === 0 ? 0 : minCohortRows,
    maxCohortRows,
    totalGapRows,
    totalExpansionRows,
    totalGeneralRows,
  };
}

async function streamRows(
  connection: DuckDBConnection,
  sql: string,
  onRow: (columns: unknown[][], rowIndex: number) => void,
): Promise<void> {
  const result = await connection.stream(sql);
  for (;;) {
    const chunk = await result.fetchChunk();
    if (chunk === null || chunk.rowCount === 0) {
      break;
    }
    const columnCount = chunk.columnCount;
    const columns: unknown[][] = [];
    for (let column = 0; column < columnCount; column += 1) {
      columns.push(chunk.getColumnValues(column) as unknown[]);
    }
    for (let rowIndex = 0; rowIndex < chunk.rowCount; rowIndex += 1) {
      onRow(columns, rowIndex);
    }
  }
}

async function queryScalarNumber(
  connection: DuckDBConnection,
  sql: string,
): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  const rows = reader.getRows();
  return Number(rows[0]![0]);
}

async function queryScalarString(
  connection: DuckDBConnection,
  sql: string,
): Promise<string> {
  const reader = await connection.runAndReadAll(sql);
  const rows = reader.getRows();
  return String(rows[0]![0]);
}

async function readIndexSchema(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(resolve(INDEX_SCHEMA_PATH), "utf8");
}

async function fileIdentity(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const metadata = await stat(path);
  const digest = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => resolvePromise());
    stream.on("error", rejectPromise);
  });
  return { bytes: metadata.size, sha256: digest.digest("hex") };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const OPPORTUNITY_INDEX_TESTING = {
  INDEX_SCHEMA_VERSION,
  OPPORTUNITY_TYPE_ORDER,
  CONFIDENCE_FLAG_ORDER,
  EVIDENCE_FLAG_ORDER,
  IDENTITY_PROXY_ECONOMY_CODE,
};
