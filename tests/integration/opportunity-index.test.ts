import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildOpportunityIndex,
  candidateToCompactRow,
  OPPORTUNITY_INDEX_TESTING,
} from "../../scripts/release/opportunity-index";
import { computeOpportunityCohort } from "../../src/domain/opportunity-discovery/opportunity-discovery-v1";
import type {
  MarketInvestigationCandidate,
  OpportunityAxis,
  OpportunityComponent,
} from "../../src/domain/opportunity-discovery/result";
import type {
  OpportunityMarketEvidence,
  OpportunityProductEvidence,
} from "../../src/evidence/opportunity-evidence-source";
import { CANDIDATE_MARKET_V1_DATASET_DECLARATION } from "../../src/domain/trade-analytics/dataset-package";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

// --- Synthetic analysis-artifact fixture -----------------------------------

const W10_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
const W5_YEARS = [2019, 2020, 2021, 2022, 2023];

type EconomyRow = {
  code: number;
  name: string;
  iso3: string | null;
  kind: "ECONOMY" | "AGGREGATE";
  isTaiwanProxy: boolean;
  identityNote: string | null;
  hasTradeEvidence: boolean;
};

const PRODUCTS = [
  { productId: 1, hs12: "010121", description: "Alpha product" },
  { productId: 2, hs12: "010129", description: "Beta product" },
  { productId: 3, hs12: "020110", description: "Gamma product" },
  { productId: 4, hs12: "030111", description: "Delta product" },
];

const ECONOMIES: EconomyRow[] = [
  {
    code: 100,
    name: "Alpha",
    iso3: "ALP",
    kind: "ECONOMY",
    isTaiwanProxy: false,
    identityNote: null,
    hasTradeEvidence: true,
  },
  {
    code: 200,
    name: "Beta",
    iso3: "BET",
    kind: "ECONOMY",
    isTaiwanProxy: false,
    identityNote: null,
    hasTradeEvidence: true,
  },
  {
    code: 300,
    name: "Gamma",
    iso3: "GAM",
    kind: "ECONOMY",
    isTaiwanProxy: false,
    identityNote: null,
    hasTradeEvidence: true,
  },
  {
    code: 490,
    name: "Other Asia, n.e.s.",
    iso3: null,
    kind: "ECONOMY",
    isTaiwanProxy: true,
    identityNote: "Taiwan proxy",
    hasTradeEvidence: true,
  },
  // Defunct economy: an individual-economy identity with no trade evidence.
  // It must never be an eligible exporter and never a candidate market.
  {
    code: 810,
    name: "USSR (...1990)",
    iso3: "SUN",
    kind: "ECONOMY",
    isTaiwanProxy: false,
    identityNote: null,
    hasTradeEvidence: false,
  },
  // Regional aggregate: excluded from exporters and markets.
  {
    code: 697,
    name: "Europe EFTA, nes",
    iso3: null,
    kind: "AGGREGATE",
    isTaiwanProxy: false,
    identityNote: null,
    hasTradeEvidence: false,
  },
];

const MARKET_IMPORTERS = [100, 200, 300, 490];
// Present only in 2014-2016, so it is a W10 pool member but never a W5-eligible
// candidate. Exercises the "no W5 observation" exclusion.
const W10_ONLY_PAIR = { productId: 4, importerCode: 490 };

type MarketYearRow = {
  year: number;
  productId: number;
  importerCode: number;
  world: number;
};

type ProductYearRow = { year: number; productId: number; world: number };

type BilateralRow = {
  year: number;
  productId: number;
  exporterCode: number;
  importerCode: number;
  value: number;
};

function buildMarketYearRows(): MarketYearRow[] {
  const rows: MarketYearRow[] = [];
  for (const product of PRODUCTS) {
    for (const importerCode of MARKET_IMPORTERS) {
      const isW10Only =
        product.productId === W10_ONLY_PAIR.productId &&
        importerCode === W10_ONLY_PAIR.importerCode;
      const years = isW10Only ? [2014, 2015, 2016] : W10_YEARS;
      for (const year of years) {
        const world =
          product.productId * 800 +
          (importerCode / 100) * 90 +
          (year - 2014) * (product.productId * 40 + 30);
        rows.push({
          year,
          productId: product.productId,
          importerCode,
          world: round3(world),
        });
      }
    }
  }
  return rows;
}

function buildProductYearRows(): ProductYearRow[] {
  const rows: ProductYearRow[] = [];
  for (const product of PRODUCTS) {
    for (const year of W10_YEARS) {
      rows.push({
        year,
        productId: product.productId,
        world: round3(
          product.productId * 100_000 + (year - 2014) * product.productId * 5_000,
        ),
      });
    }
  }
  return rows;
}

function buildBilateralRows(): BilateralRow[] {
  const rows: BilateralRow[] = [];
  const push = (
    exporterCode: number,
    productId: number,
    importerCode: number,
    years: number[],
  ): void => {
    for (const year of years) {
      rows.push({
        year,
        productId,
        exporterCode,
        importerCode,
        value: round3(
          50 + productId * 20 + (importerCode / 100) * 7 + (year - 2019) * 15,
        ),
      });
    }
  };
  // Exporter 100 supplies several markets across products (footholds + presence).
  push(100, 1, 200, W5_YEARS);
  push(100, 1, 300, [2021, 2022, 2023]);
  push(100, 2, 490, W10_YEARS);
  push(100, 3, 200, [2022, 2023]);
  // Exporter 200 supplies a couple of markets.
  push(200, 1, 100, W5_YEARS);
  push(200, 2, 300, [2020, 2021, 2022, 2023]);
  // Identity-proxy exporter 490 supplies one market.
  push(490, 3, 100, W5_YEARS);
  // Exporter 300 supplies nothing: a gap-only eligible cohort.
  return rows;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function decimalLiteral(value: number): string {
  return value.toFixed(3);
}

async function createSyntheticArtifact(
  directory: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const path = join(directory, "candidate-market.duckdb");
  const instance = await DuckDBInstance.create(path);
  try {
    const connection = await instance.connect();
    await connection.run("SET preserve_insertion_order = true");
    await connection.run(
      await readFile("data/schemas/candidate-market-artifact-v1.sql", "utf8"),
    );
    for (const product of PRODUCTS) {
      await connection.run(
        `INSERT INTO product VALUES (${product.productId}, '${product.hs12}', '${product.description}')`,
      );
    }
    for (const economy of ECONOMIES) {
      await connection.run(
        `INSERT INTO economy VALUES (${economy.code}, '${economy.name.replace(/'/g, "''")}', NULL, ${economy.iso3 === null ? "NULL" : `'${economy.iso3}'`}, '${economy.kind}', ${economy.isTaiwanProxy}, ${economy.identityNote === null ? "NULL" : `'${economy.identityNote}'`}, ${economy.hasTradeEvidence})`,
      );
    }
    for (const row of buildProductYearRows()) {
      await connection.run(
        `INSERT INTO product_year VALUES (${row.year}, ${row.productId}, ${decimalLiteral(row.world)})`,
      );
    }
    for (const row of buildMarketYearRows()) {
      await connection.run(
        `INSERT INTO market_year VALUES (${row.year}, ${row.productId}, ${row.importerCode}, ${decimalLiteral(row.world)}, 3, 0.0, 3, 0, NULL)`,
      );
    }
    for (const row of buildBilateralRows()) {
      await connection.run(
        `INSERT INTO bilateral_year VALUES (${row.year}, ${row.productId}, ${row.exporterCode}, ${row.importerCode}, ${decimalLiteral(row.value)})`,
      );
    }
    await connection.run("ANALYZE");
    await connection.run("CHECKPOINT");
    connection.closeSync();
  } finally {
    instance.closeSync();
  }
  const identity = await fileIdentity(path);
  return { path, sha256: identity.sha256, bytes: identity.bytes };
}

async function writeSyntheticManifest(
  directory: string,
  artifact: { sha256: string; bytes: number },
): Promise<void> {
  const manifest = {
    schemaVersion: "candidate-market-artifact-manifest-v1",
    baciRelease: "VTEST001",
    sourceUrl: "https://example.com/baci.zip",
    sourceBytes: 1000,
    sourceSha256: "a".repeat(64),
    sourceUpdateDate: "2026-01-22",
    license: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    attribution: "CEPII BACI",
    hsRevision: "HS12",
    ingestedYears: [
      2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
      2024,
    ],
    finalizedYears: [
      2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ],
    provisionalYears: [2024],
    finalizedCutoffYear: 2023,
    scoreWindow: { start: 2019, end: 2023 },
    stagingManifestSha256: "b".repeat(64),
    coverageApprovalSha256: "c".repeat(64),
    sourceReportSha256: "d".repeat(64),
    datasetPackage: CANDIDATE_MARKET_V1_DATASET_DECLARATION,
    scoreVersionsSupported: ["cms-v1"],
    artifact: {
      schemaVersion: "candidate-market-artifact-v1",
      buildId: `candidate-market-artifact-v1-${artifact.sha256.slice(0, 16)}`,
      relativePath: "candidate-market.duckdb",
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    },
    builtAt: "2026-07-16T00:00:00Z",
    benchmarkQueries: [],
  };
  await writeFile(
    join(directory, "artifact-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

// Reference oracle: build the recipe inputs for one exporter directly from the
// in-memory fixture (never from the index), run the pure recipe, and project
// through the same compact mapping the build uses.
function referenceRows(exporterCode: number): number[][] {
  const marketRows = buildMarketYearRows();
  const productRows = buildProductYearRows();
  const bilateralRows = buildBilateralRows();
  const economyByCode = new Map(ECONOMIES.map((e) => [e.code, e]));
  const productById = new Map(PRODUCTS.map((p) => [p.productId, p]));

  const products: OpportunityProductEvidence[] = PRODUCTS.map((product) => {
    const worldYearTotals = productRows
      .filter((row) => row.productId === product.productId)
      .map((row) => ({ year: row.year, worldValueKusd: decimalLiteral(row.world) }));
    const totalsByYear = new Map<number, number>();
    for (const row of bilateralRows) {
      if (row.exporterCode === exporterCode && row.productId === product.productId) {
        totalsByYear.set(row.year, (totalsByYear.get(row.year) ?? 0) + row.value);
      }
    }
    return {
      product: { hsRevision: "HS12" as const, code: product.hs12, descriptionEn: product.description },
      worldYearTotals,
      exporterExportTotals: [...totalsByYear].map(([year, value]) => ({
        year,
        valueKusd: decimalLiteral(round3(value)),
      })),
    };
  });

  const marketsByPair = new Map<string, OpportunityMarketEvidence>();
  for (const row of marketRows) {
    const key = `${row.productId}|${row.importerCode}`;
    let market = marketsByPair.get(key);
    if (market === undefined) {
      const product = productById.get(row.productId)!;
      const importer = economyByCode.get(row.importerCode)!;
      market = {
        product: { hsRevision: "HS12", code: product.hs12, descriptionEn: product.description },
        market: {
          code: String(importer.code),
          name: importer.name,
          iso3: importer.iso3,
          identityNote: importer.identityNote,
        },
        marketYears: [],
      };
      marketsByPair.set(key, market);
    }
    const bilateral = bilateralRows.find(
      (b) =>
        b.exporterCode === exporterCode &&
        b.productId === row.productId &&
        b.importerCode === row.importerCode &&
        b.year === row.year,
    );
    (market.marketYears as { year: number; worldValueKusd: string; bilateralValueKusd: string | null }[]).push({
      year: row.year,
      worldValueKusd: decimalLiteral(row.world),
      bilateralValueKusd: bilateral === undefined ? null : decimalLiteral(bilateral.value),
    });
  }

  const exporter = economyByCode.get(exporterCode)!;
  const cohort = computeOpportunityCohort({
    analysisBuildId: "candidate-market-artifact-v1-testbuild0000",
    artifact: {
      baciRelease: "VTEST001",
      buildId: "candidate-market-artifact-v1-testbuild0000",
      schemaVersion: "candidate-market-artifact-v1",
      sha256: "e".repeat(64),
    },
    release: {
      baciRelease: "VTEST001",
      sourceUpdateDate: "2026-01-22",
      hsRevision: "HS12",
      ingestedYears: { start: 2012, end: 2024 },
      finalizedCutoffYear: 2023,
      provisionalYear: 2024,
    },
    exporter: {
      code: String(exporter.code),
      name: exporter.name,
      iso3: exporter.iso3,
      identityNote: exporter.identityNote,
    },
    products,
    markets: [...marketsByPair.values()],
    previousRelease: null,
  });
  const pidByHs = new Map(PRODUCTS.map((p) => [p.hs12, p.productId]));
  return cohort.candidates.map((candidate) => {
    const row = candidateToCompactRow(
      candidate,
      exporterCode,
      pidByHs.get(candidate.product.code)!,
    );
    return compactRowToTuple(row);
  });
}

function compactRowToTuple(row: ReturnType<typeof candidateToCompactRow>): number[] {
  return [
    row.exporterCode,
    row.productId,
    row.importerCode,
    row.priorityDisplay,
    row.attractivenessDisplay,
    row.exporterFitDisplay,
    row.marketSizePercentileBp,
    row.marketGrowthPercentileBp,
    row.productPresencePercentileBp,
    row.footholdPercentileBp,
    row.competitionRank,
    row.opportunityType,
    row.confidenceScore,
    row.confidenceFlags,
    row.evidenceFlags,
  ];
}

async function readPersistedRows(
  indexPath: string,
  exporterCode: number,
): Promise<number[][]> {
  const instance = await DuckDBInstance.create(indexPath, {
    access_mode: "READ_ONLY",
  });
  try {
    const connection = await instance.connect();
    const reader = await connection.runAndReadAll(
      `SELECT exporter_code, product_id, importer_code, priority_display, attractiveness_display, exporter_fit_display, market_size_percentile_bp, market_growth_percentile_bp, product_presence_percentile_bp, foothold_percentile_bp, competition_rank, opportunity_type, confidence_score, confidence_flags, evidence_flags FROM opportunity_candidate WHERE exporter_code = ${exporterCode}`,
    );
    return reader.getRows().map((row) => row.map((value) => Number(value)));
  } finally {
    instance.closeSync();
  }
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

async function temporaryWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "opportunity-index-"));
  temporaryDirectories.push(path);
  return path;
}

// --- Tests -----------------------------------------------------------------

describe("candidateToCompactRow", () => {
  it("projects axes, percentiles, type code, and flag bitsets", () => {
    const candidate = fakeCandidate();
    const row = candidateToCompactRow(candidate, 100, 7);
    expect(row).toStrictEqual({
      exporterCode: 100,
      productId: 7,
      importerCode: 200,
      priorityDisplay: 82,
      attractivenessDisplay: 71,
      exporterFitDisplay: 64,
      marketSizePercentileBp: 8123,
      marketGrowthPercentileBp: 5000,
      productPresencePercentileBp: 2500,
      footholdPercentileBp: 0,
      competitionRank: 3,
      opportunityType: 1,
      confidenceScore: 78,
      // NEUTRAL_MARKET_GROWTH (bit 2) + IDENTITY_PROXY (bit 7) = 4 + 128 = 132.
      confidenceFlags: 0b1000_0100,
      // NO_RECORDED_BILATERAL_FLOW (bit 0) + IDENTITY_PROXY (bit 3) = 1 + 8 = 9.
      evidenceFlags: 0b1001,
    });
  });

  it("keeps the published dictionaries aligned with the mapping", () => {
    expect(OPPORTUNITY_INDEX_TESTING.OPPORTUNITY_TYPE_ORDER[1]).toBe(
      "EXPANSION_EVIDENCE",
    );
    expect(OPPORTUNITY_INDEX_TESTING.CONFIDENCE_FLAG_ORDER[2]).toBe(
      "NEUTRAL_MARKET_GROWTH",
    );
    expect(OPPORTUNITY_INDEX_TESTING.CONFIDENCE_FLAG_ORDER[7]).toBe(
      "IDENTITY_PROXY",
    );
    expect(OPPORTUNITY_INDEX_TESTING.EVIDENCE_FLAG_ORDER[3]).toBe(
      "IDENTITY_PROXY",
    );
  });
});

describe("buildOpportunityIndex against a synthetic analysis artifact", () => {
  it("persists a complete, ordered, parity-faithful cohort for every eligible exporter", async () => {
    const workspace = await temporaryWorkspace();
    const artifact = await createSyntheticArtifact(workspace);
    await writeSyntheticManifest(workspace, artifact);
    const reportPath = join(workspace, "report.json");

    const outcome = await buildOpportunityIndex({
      analysisArtifactPath: workspace,
      workspacePath: join(workspace, "out"),
      reportPath,
      buildGitSha: "testsha",
      builtAt: "2026-07-16T00:00:00Z",
    });

    expect(outcome.status).toBe("accepted");
    // Eligible exporters are the four ECONOMY identities with trade evidence;
    // the defunct 810 and the aggregate 697 are excluded.
    expect(outcome.exporterCount).toBe(4);
    expect(outcome.indexSizeReviewRequired).toBe(false);

    const indexPath = join(
      outcome.publicationPath,
      "opportunity-index.duckdb",
    );

    for (const exporterCode of [100, 200, 300, 490]) {
      const expected = referenceRows(exporterCode);
      const persisted = await readPersistedRows(indexPath, exporterCode);
      expect(persisted.length).toBeGreaterThan(0);
      expect(persisted).toStrictEqual(expected);
    }

    // Excluded identities never appear as an exporter.
    for (const excluded of [810, 697]) {
      const rows = await readPersistedRows(indexPath, excluded);
      expect(rows).toHaveLength(0);
    }

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.status).toBe("accepted");
    expect(report.reconciliation.rowUniqueness).toBe("verified");
    expect(report.reconciliation.cohortCompleteness).toBe("verified");
    expect(report.reconciliation.sourcePreservation).toBe("verified");
    expect(report.sizeGate.indexStatus).toBe("accepted");
  });

  it("excludes self-imports and W10-only pairs from every cohort", async () => {
    const workspace = await temporaryWorkspace();
    const artifact = await createSyntheticArtifact(workspace);
    await writeSyntheticManifest(workspace, artifact);

    const outcome = await buildOpportunityIndex({
      analysisArtifactPath: workspace,
      workspacePath: join(workspace, "out"),
      reportPath: join(workspace, "report.json"),
      buildGitSha: "testsha",
      builtAt: "2026-07-16T00:00:00Z",
    });
    const indexPath = join(outcome.publicationPath, "opportunity-index.duckdb");

    const instance = await DuckDBInstance.create(indexPath, {
      access_mode: "READ_ONLY",
    });
    try {
      const connection = await instance.connect();
      // No candidate may target the exporter's own economy.
      const selfRows = await connection.runAndReadAll(
        "SELECT COUNT(*) FROM opportunity_candidate WHERE exporter_code = importer_code",
      );
      expect(Number(selfRows.getRows()[0]![0])).toBe(0);
      // The W10-only pair (product 4, importer 490) never becomes a candidate.
      const w10Only = await connection.runAndReadAll(
        "SELECT COUNT(*) FROM opportunity_candidate WHERE product_id = 4 AND importer_code = 490",
      );
      expect(Number(w10Only.getRows()[0]![0])).toBe(0);
      // Dictionaries are published with the stable ordering.
      const typeRows = await connection.runAndReadAll(
        "SELECT code, label FROM opportunity_type_dictionary ORDER BY code",
      );
      expect(typeRows.getRows().map((row) => [Number(row[0]), row[1]])).toEqual([
        [0, "UNVALIDATED_MARKET_GAP"],
        [1, "EXPANSION_EVIDENCE"],
        [2, "GENERAL_INVESTIGATION_EVIDENCE"],
      ]);
    } finally {
      instance.closeSync();
    }
  });
});

function fakeComponent(percentileBasisPoints: number): OpportunityComponent {
  return {
    state: "COMPUTED",
    rawValue: "1.0",
    percentileUnrounded: "50.000000",
    percentileBasisPoints,
    percentileDisplay: Math.round(percentileBasisPoints / 100),
  };
}

function fakeAxis(display: number): OpportunityAxis {
  return { rawUnrounded: `${display}.000000`, display };
}

function fakeCandidate(): MarketInvestigationCandidate {
  return {
    product: { hsRevision: "HS12", code: "010121", descriptionEn: "x" },
    market: { code: "200", name: "Beta", iso3: "BET", identityNote: null },
    investigationPriority: fakeAxis(82),
    marketAttractiveness: fakeAxis(71),
    exporterFit: fakeAxis(64),
    components: {
      marketSize: fakeComponent(8123),
      marketGrowth: fakeComponent(5000),
      exporterProductPresence: fakeComponent(2500),
      recordedFoothold: fakeComponent(0),
    },
    opportunityType: "EXPANSION_EVIDENCE",
    opportunityTypeCopy: "x",
    bilateralFlowState: "NO_RECORDED_POSITIVE_FLOW",
    bilateralWording: null,
    observedMarketYears: [2019, 2020, 2021, 2022, 2023],
    missingMarketYears: [],
    confidence: {
      score: 78,
      label: "MEDIUM",
      deductions: [
        { code: "NEUTRAL_MARKET_GROWTH", points: 10 },
        { code: "IDENTITY_PROXY", points: 12 },
      ],
      sparseEvidenceCapApplied: false,
    },
    stability: {
      threeYear: {
        window: { start: 2021, end: 2023 },
        state: "NOT_FLAGGED",
        priorityDelta: null,
      },
      tenYear: {
        window: { start: 2014, end: 2023 },
        state: "NOT_FLAGGED",
        priorityDelta: null,
      },
    },
    releaseRevision: {
      state: "NOT_COMPARED",
      priorityDelta: null,
      rankPercentileDelta: null,
      cohortTransition: null,
    },
    evidenceFlags: ["NO_RECORDED_BILATERAL_FLOW", "IDENTITY_PROXY"],
    competitionRank: 3,
    competitionRankTieSize: 2,
    candidateMarketDrillDown: {
      recipe: "candidate-market-v1",
      exporterCode: "100",
      product: { hsRevision: "HS12", code: "010121", descriptionEn: "x" },
      focusMarketCode: "200",
    },
  };
}
