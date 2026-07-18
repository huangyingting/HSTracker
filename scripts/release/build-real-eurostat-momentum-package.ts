/**
 * Build a real Eurostat Comext monthly Recent Trade Momentum Dataset Package.
 *
 * Unlike {@link ../release/recent-trade-momentum-package} — which validates the
 * recipe and gates against small synthetic oracles held in memory — this builder
 * aggregates the real detailed Comext monthly files (millions of rows per month)
 * in DuckDB-native SQL, then reuses the validated domain modules for mapping,
 * the momentum recipe, the Dataset Package manifest, and the promotion gates.
 *
 * Source rights, extraction conformance, and control totals are recorded in
 * docs/research/2026-07-18-eurostat-comext-rights-and-extraction-conformance.md
 * (issue #58). The eligible complete-preimage CN-to-HS12 mapping is pinned under
 * data/recent-trade-momentum/inputs (issue #59).
 */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

import {
  buildCnToHs12MappingReport,
  evaluateHs12ProductMappingAcrossEditions,
  type CnToHs12MappingReport,
} from "../../src/domain/recent-trade-momentum/cn-to-hs12-mapping";
import {
  buildEurostatCnToHs12MappingEvidence,
  type EurostatCnEditionInput,
} from "../../src/domain/recent-trade-momentum/eurostat-cn-hs12-evidence";
import {
  computeRecentTradeMomentumV1,
  type RecentTradeMomentumMonthObservation,
  type RecentTradeMomentumUpdateState,
} from "../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";
import type { DatasetPackageIdentity } from "../../src/domain/trade-analytics/dataset-package";
import {
  createRecentTradeMomentumDatasetPackage,
  RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
  type RecentTradeMomentumDatasetPackageManifest,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-dataset-package";
import {
  canonicalRecentTradeMomentumAnalyticalRows,
  evaluateRecentTradeMomentumActivationGate,
  evaluateRecentTradeMomentumArtifactGates,
} from "./recent-trade-momentum-package";

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** EU-27 reporting economies (the v1 pilot allowlist), ISO2 -> ISO3 + name. */
const EU27: ReadonlyArray<readonly [string, string, string]> = [
  ["AT", "AUT", "Austria"], ["BE", "BEL", "Belgium"], ["BG", "BGR", "Bulgaria"],
  ["CY", "CYP", "Cyprus"], ["CZ", "CZE", "Czechia"], ["DE", "DEU", "Germany"],
  ["DK", "DNK", "Denmark"], ["EE", "EST", "Estonia"], ["ES", "ESP", "Spain"],
  ["FI", "FIN", "Finland"], ["FR", "FRA", "France"], ["GR", "GRC", "Greece"],
  ["HR", "HRV", "Croatia"], ["HU", "HUN", "Hungary"], ["IE", "IRL", "Ireland"],
  ["IT", "ITA", "Italy"], ["LT", "LTU", "Lithuania"], ["LU", "LUX", "Luxembourg"],
  ["LV", "LVA", "Latvia"], ["MT", "MLT", "Malta"], ["NL", "NLD", "Netherlands"],
  ["PL", "POL", "Poland"], ["PT", "PRT", "Portugal"], ["RO", "ROU", "Romania"],
  ["SE", "SWE", "Sweden"], ["SI", "SVN", "Slovenia"], ["SK", "SVK", "Slovakia"],
];

/**
 * Geonomenclature partner codes that are NOT individually identified trading
 * partners: stores/provisions, high seas, secret, not-specified, and regional
 * aggregates. Their value is excluded from the reporting-market total. Every
 * other 2-letter code (ISO countries plus identified territories such as XK
 * Kosovo, XC Ceuta, XL Melilla, XS Serbia, QA Qatar) is INDIVIDUAL.
 */
const NON_INDIVIDUAL_PARTNERS: ReadonlySet<string> = new Set([
  "QP", "QQ", "QR", "QS", "QU", "QV", "QW", "QX", "QY", "QZ", "QT",
  "XA", "XO", "XZ", "XR",
]);

const CONFIDENTIAL_PARTNERS: ReadonlySet<string> = new Set(["QY", "QZ", "QX"]);

const CSV_COLUMNS = {
  REPORTER: "VARCHAR", PARTNER: "VARCHAR", TRADE_TYPE: "VARCHAR",
  PRODUCT_NC: "VARCHAR", PRODUCT_SITC: "VARCHAR", PRODUCT_CPA21: "VARCHAR",
  PRODUCT_CPA22: "VARCHAR", PRODUCT_BEC: "VARCHAR", PRODUCT_BEC5: "VARCHAR",
  PRODUCT_SECTION: "VARCHAR", FLOW: "VARCHAR", STAT_PROCEDURE: "VARCHAR",
  SUPPL_UNIT: "VARCHAR", PERIOD: "VARCHAR", VALUE_EUR: "VARCHAR",
  VALUE_NAC: "VARCHAR", QUANTITY_KG: "VARCHAR", QUANTITY_SUPPL_UNIT: "VARCHAR",
} as const;

const EXPECTED_HISTORY_MONTHS = 24;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Args = Readonly<{
  cutoff: string; // YYYYMM
  datDir: string;
  inputDir: string;
  out: string;
  extractionMonth: string; // YYYY-MM, controls preliminary/final classification
  gitSha: string;
  previous: string | null;
  shadowVintagesPassed: number;
}>;

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith("--")) {
      map.set(token.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }
  const cutoff = map.get("cutoff");
  if (cutoff === undefined || !/^\d{6}$/u.test(cutoff)) {
    throw new Error("Provide --cutoff YYYYMM");
  }
  return {
    cutoff,
    datDir: resolve(map.get("dat-dir") ?? "/tmp/comext/build/dat"),
    inputDir: resolve(map.get("input-dir") ?? "data/recent-trade-momentum/inputs"),
    out: resolve(map.get("out") ?? `data/work/recent-trade-momentum/${cutoff}`),
    extractionMonth: map.get("extraction-month") ?? currentMonth(),
    gitSha: map.get("git-sha") ?? "uncommitted",
    previous: map.get("previous") ?? null,
    shadowVintagesPassed: Number(map.get("shadow-vintages-passed") ?? "0"),
  };
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** All YYYYMM periods for the 24-month window ending at (and including) cutoff. */
function windowPeriods(cutoff: string, count: number): string[] {
  let year = Number(cutoff.slice(0, 4));
  let month = Number(cutoff.slice(4, 6));
  const periods: string[] = [];
  for (let index = 0; index < count; index += 1) {
    periods.push(`${year}${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return periods.reverse();
}

function toReferenceMonth(period: string): string {
  return `${period.slice(0, 4)}-${period.slice(4, 6)}`;
}

/**
 * Eurostat considers a monthly reference period final by October of the
 * following reference year; earlier extractions see it as preliminary
 * (docs/research/2026-07-16-monthly-trade-momentum-source-and-coverage.md).
 */
export function updateStateFor(period: string, extractionMonth: string): RecentTradeMomentumUpdateState {
  const year = Number(period.slice(0, 4));
  const [extractYear, extractMonth] = extractionMonth.split("-").map(Number) as [number, number];
  const finalByYear = year + 1;
  const isFinal = extractYear > finalByYear || (extractYear === finalByYear && extractMonth >= 10);
  return isFinal ? "FINAL_BY_SOURCE_SCHEDULE" : "PRELIMINARY";
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const periods = windowPeriods(args.cutoff, EXPECTED_HISTORY_MONTHS);
  const referenceMonths = periods.map(toReferenceMonth);
  const cutoffMonth = referenceMonths.at(-1)!;
  const editionYears = [...new Set(periods.map((period) => Number(period.slice(0, 4))))].sort();

  console.log(`[build] cutoff=${args.cutoff} window=${periods[0]}..${periods.at(-1)} editions=${editionYears.join(",")}`);

  // 1) Mapping evidence + report from pinned inputs -----------------------
  const editionInputs = await loadEditionInputs(args.inputDir, editionYears);
  const evidence = buildEurostatCnToHs12MappingEvidence(editionInputs);
  const report = buildCnToHs12MappingReport(evidence);
  const eligibleProducts = eligibleProductsAcrossEditions(report, editionYears);
  const acceptedCn8 = acceptedCn8Rows(report, editionYears, new Set(eligibleProducts));
  console.log(`[build] eligible complete-preimage products: ${eligibleProducts.length}; accepted CN8 rows: ${acceptedCn8.length}`);

  // 2) Verify source files exist -----------------------------------------
  const datFiles = periods.map((period) => join(args.datDir, `full_${period}.dat`));
  for (const file of datFiles) {
    await stat(file).catch(() => {
      throw new Error(`Missing source file ${file}`);
    });
  }

  // 3) DuckDB staging: aggregate market months + partners in SQL ----------
  const workspace = args.out;
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  const stagingPath = join(workspace, "staging.duckdb");
  await rm(stagingPath, { force: true });

  const staging = await DuckDBInstance.create(stagingPath, {
    memory_limit: "10GB",
    threads: "4",
    temp_directory: join(workspace, "duck-temp"),
  });
  let aggregation: EligibleMarketMonthAggregation;
  try {
    const connection = await staging.connect();
    try {
      await loadAcceptedCn8(connection, acceptedCn8);
      await loadReporterAllowlist(connection, EU27.map(([iso2]) => iso2));
      console.log(`[build] scanning ${datFiles.length} monthly files ...`);
      aggregation = await aggregateEligibleMarketMonths(connection, datFiles);
    } finally {
      connection.closeSync();
    }
  } finally {
    staging.closeSync();
  }
  const { marketMonths, partnerCodes, sourceIdentifiedValueEur, excludedSpecialValueEur } = aggregation;
  console.log(`[build] observed market-months: ${marketMonths.size}; contributing partners: ${partnerCodes.size}`);
  console.log(`[build] source identified value (EUR): ${sourceIdentifiedValueEur}`);

  // 4) Momentum via the validated recipe ---------------------------------
  const reporters = EU27.map(([iso2, iso3, name], index) => ({
    reporterId: index + 1, iso2, iso3, displayName: name,
  }));
  const sortedProducts = [...eligibleProducts].sort();
  const productMappingAcrossEditions = new Map(
    sortedProducts.map((hs12Code) => [
      hs12Code,
      evaluateHs12ProductMappingAcrossEditions(report, hs12Code, editionYears),
    ]),
  );

  type MomentumRow = {
    reporterId: number; reporterIso2: string; hs12Code: string; cutoffMonth: string;
    recentValueEur: string | null; baselineValueEur: string | null;
    growthRateDecimal: string | null; growthPercentDisplay: string | null;
    signalState: string | null; coverageState: string; confidence: string | null;
    recordedHistoryMonths: number; reasonCodes: string; confidenceReasons: string;
  };
  const momentumRows: MomentumRow[] = [];
  const updateStateByPeriod = new Map(periods.map((period) => [period, updateStateFor(period, args.extractionMonth)]));

  for (const reporter of reporters) {
    for (const hs12Code of sortedProducts) {
      const productMapping = productMappingAcrossEditions.get(hs12Code)!;
      const observations: RecentTradeMomentumMonthObservation[] = periods.map((period) => {
        const bucket = marketMonths.get(marketKey(period, reporter.iso2, hs12Code));
        return {
          referenceMonth: toReferenceMonth(period),
          observationState: bucket === undefined ? "NOT_OBSERVED" : bucket.value > 0n ? "RECORDED_POSITIVE" : "RECORDED_ZERO",
          valueEur: bucket === undefined ? null : Number(bucket.value),
          updateState: updateStateByPeriod.get(period)!,
          mappingChain: "DIRECT_EXACT",
        };
      });
      const outcome = computeRecentTradeMomentumV1({
        recipe: "recent-trade-momentum-v1",
        resultSchemaVersion: "recent-trade-momentum-result-v1",
        monthlyPackageId: "pending-package",
        sourceVintageId: `eurostat-comext-${args.cutoff}`,
        reporterIso2: reporter.iso2,
        hs12Code,
        cutoffMonth,
        eligibleCompleteMonths: referenceMonths,
        marketStatus: "SUPPORTED",
        productMappingStatus: productMapping.status,
        observations,
        revisionComparisonWindowChangeRate: 0,
      });
      momentumRows.push({
        reporterId: reporter.reporterId,
        reporterIso2: reporter.iso2,
        hs12Code,
        cutoffMonth,
        recentValueEur: outcome.recentValueEur,
        baselineValueEur: outcome.baselineValueEur,
        growthRateDecimal: outcome.growthRateDecimal,
        growthPercentDisplay: outcome.growthPercentDisplay,
        signalState: outcome.signalState,
        coverageState: outcome.coverageState,
        confidence: outcome.confidence,
        recordedHistoryMonths: outcome.recordedHistoryMonths,
        reasonCodes: outcome.reasonCodes.join(","),
        confidenceReasons: outcome.confidenceReasons.join(","),
      });
    }
  }
  const signalCount = momentumRows.filter((row) => row.signalState !== null).length;
  console.log(`[build] momentum rows: ${momentumRows.length}; with signal: ${signalCount}`);

  // 5) Write the immutable artifact --------------------------------------
  const partialDir = join(workspace, ".partial");
  await rm(partialDir, { recursive: true, force: true });
  await mkdir(partialDir, { recursive: true });
  const artifactPath = join(partialDir, "recent-trade-momentum.duckdb");
  const partners = [...partnerCodes].sort().map((code, index) => ({
    partnerId: index + 1,
    sourceCode: code,
    iso2: NON_INDIVIDUAL_PARTNERS.has(code) ? null : code,
    kind: NON_INDIVIDUAL_PARTNERS.has(code)
      ? (CONFIDENTIAL_PARTNERS.has(code) ? "CONFIDENTIAL" : "AGGREGATE")
      : "INDIVIDUAL",
  }));

  await writeArtifact({
    artifactPath, stagingPath, reporters, partners, report, eligibleProducts,
    momentumRows, periods, updateStateByPeriod, referenceMonths,
    sourceVintageId: `eurostat-comext-${args.cutoff}`,
    extractionTimestamp: `${args.extractionMonth}-15T00:00:00.000Z`,
    gitSha: args.gitSha,
  });

  const artifactBytes = (await stat(artifactPath)).size;
  const artifactSha256 = await fileSha256(artifactPath);
  const artifactGates = evaluateRecentTradeMomentumArtifactGates(artifactBytes);
  const activationGate = evaluateRecentTradeMomentumActivationGate(args.shadowVintagesPassed);
  const analyticalRows = await canonicalRecentTradeMomentumAnalyticalRows(artifactPath);
  const analyticalRowsSha256 = sha256(analyticalRows);

  const aggregateIdentifiedValueEur = await sumMarketMonthValue(artifactPath);
  const valueReconciled = aggregateIdentifiedValueEur === sourceIdentifiedValueEur;

  // 6) Reports + manifest -------------------------------------------------
  const reconciliation = {
    sourceIdentifiedValueEur: sourceIdentifiedValueEur.toString(),
    aggregateIdentifiedValueEur: aggregateIdentifiedValueEur.toString(),
    excludedSpecialValueEur: excludedSpecialValueEur.toString(),
    worldTotalExcludedValueEur: "0",
  };
  const conformanceReport = {
    schemaVersion: "recent-trade-momentum-conformance-report-v1",
    sourceVintageId: `eurostat-comext-${args.cutoff}`,
    observedMarketMonths: marketMonths.size,
    momentumRows: momentumRows.length,
    momentumWithSignal: signalCount,
    reconciliation,
    gates: { valueReconciled, analyticalRowsSha256 },
  };
  const conformanceReportBytes = jsonBytes(conformanceReport);
  await writeFile(join(partialDir, "conformance-report.json"), conformanceReportBytes);

  const revisionReport = await buildRevisionReport(args, `eurostat-comext-${args.cutoff}`, momentumRows);
  const revisionReportBytes = jsonBytes(revisionReport);
  await writeFile(join(partialDir, "revision-report.json"), revisionReportBytes);

  const sourceObjects = await sourceObjectIdentities(args, periods);

  const manifest: RecentTradeMomentumDatasetPackageManifest = {
    schemaVersion: "monthly-trade-dataset-package-manifest-v1",
    artifactSchemaVersion: "monthly-trade-artifact-v1",
    resultSchemaVersion: "recent-trade-momentum-result-v1",
    recipeId: "recent-trade-momentum-v1",
    capability: "recent-trade-momentum/reporting-market-import-value@1",
    mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
    sourceOwner: "Eurostat",
    sourceDataset: "EUROSTAT_COMEXT_DETAIL",
    sourceVintageId: `eurostat-comext-${args.cutoff}`,
    extractionTimestamp: `${args.extractionMonth}-15T00:00:00.000Z`,
    sourceObjectsSha256: sourceObjects.collectionSha256,
    sourceMetadataSha256: sha256(`eurostat-comext-metadata:${editionYears.join(",")}`),
    mappingEvidenceSha256: sha256Json(evidence),
    partnerMappingVersion: "eurostat-geonomenclature-individual-v1",
    reporterAllowlist: reporters.map((reporter) => reporter.iso2),
    referenceMonthRange: { start: referenceMonths[0]!, end: referenceMonths.at(-1)! },
    newestEligibleMonthByReporter: Object.fromEntries(reporters.map((reporter) => [reporter.iso2, cutoffMonth])),
    artifact: { relativePath: "recent-trade-momentum.duckdb", bytes: artifactBytes, sha256: artifactSha256 },
    artifactSha256,
    rowCounts: {
      reporters: reporters.length,
      partners: partners.length,
      productMappings: eligibleProducts.length,
      marketMonths: marketMonths.size,
      momentum: momentumRows.length,
    },
    coverage: {
      expectedHistoryMonths: EXPECTED_HISTORY_MONTHS,
      shadowVintagesPassed: args.shadowVintagesPassed,
      publicCapabilityActivated: false,
    },
    revisionReportSha256: sha256Bytes(revisionReportBytes),
    conformanceReportSha256: sha256Bytes(conformanceReportBytes),
    capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
    quality: { status: "accepted", reason: null },
    attribution: {
      statement:
        "Source: Eurostat Comext, detailed monthly international trade in goods (dataset EUROSTAT_COMEXT_DETAIL); HS Tracker aggregated eligible EU-27 reporter import values across identified partners and mapped source CN codes to HS 2012 using exact complete-preimage correspondences; changes are indicated in source details.",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    },
    supersedesPackageIdentity: revisionReport.previousPackageIdentity,
  };

  const datasetPackage = createRecentTradeMomentumDatasetPackage(manifest);
  await writeFile(join(partialDir, "dataset-package-manifest.json"), datasetPackage.serializedManifest);

  const acceptedPath = join(workspace, datasetPackage.identity);
  await rm(acceptedPath, { recursive: true, force: true });
  await rename(partialDir, acceptedPath);
  await rm(stagingPath, { force: true });
  await rm(join(workspace, "duck-temp"), { recursive: true, force: true });

  const buildReport = {
    schemaVersion: "recent-trade-momentum-build-report-v1",
    status: valueReconciled && !artifactGates.artifactPromotionBlocked ? "accepted" : "blocked",
    sourceVintageId: `eurostat-comext-${args.cutoff}`,
    packageIdentity: datasetPackage.identity,
    packagePath: acceptedPath,
    referenceMonthRange: manifest.referenceMonthRange,
    rowCounts: manifest.rowCounts,
    momentumWithSignal: signalCount,
    gates: {
      valueReconciled,
      artifactSizeReviewRequired: artifactGates.artifactSizeReviewRequired,
      artifactPromotionBlocked: artifactGates.artifactPromotionBlocked,
      activationAllowed: activationGate.activationAllowed,
    },
    reconciliation,
  };
  await writeFile(join(workspace, "build-report.json"), jsonBytes(buildReport));
  console.log(JSON.stringify(buildReport, null, 2));
  if (!valueReconciled) {
    throw new Error("Reconciliation failed: source and aggregate totals differ.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function marketKey(period: string, reporterIso2: string, hs12Code: string): string {
  return `${period}|${reporterIso2}|${hs12Code}`;
}

async function loadEditionInputs(inputDir: string, editionYears: readonly number[]): Promise<EurostatCnEditionInput[]> {
  return Promise.all(
    editionYears.map(async (cnEditionYear) => ({
      cnEditionYear,
      cn8CodeListText: await readFile(join(inputDir, `cn8-codes-${cnEditionYear}.txt`), "utf8"),
      correspondenceCsvText: await readFile(join(inputDir, `cn8-to-hs2012-${cnEditionYear}.csv`), "utf8"),
    })),
  );
}

function eligibleProductsAcrossEditions(report: CnToHs12MappingReport, editionYears: readonly number[]): string[] {
  const codes = [...new Set(report.productMappings.map((product) => product.hs12Code))];
  return codes
    .filter((hs12Code) => evaluateHs12ProductMappingAcrossEditions(report, hs12Code, editionYears).status === "EXACT_REVIEWED")
    .sort();
}

function acceptedCn8Rows(
  report: CnToHs12MappingReport,
  editionYears: readonly number[],
  eligible: ReadonlySet<string>,
): Array<{ editionYear: number; cn8: string; hs12: string }> {
  const rows: Array<{ editionYear: number; cn8: string; hs12: string }> = [];
  const editionYearSet = new Set(editionYears);
  for (const product of report.productMappings) {
    if (!editionYearSet.has(product.cnEditionYear)) continue;
    if (product.productStatus !== "EXACT_REVIEWED") continue;
    if (!eligible.has(product.hs12Code)) continue;
    for (const cn8 of product.acceptedCn8Codes) {
      rows.push({ editionYear: product.cnEditionYear, cn8, hs12: product.hs12Code });
    }
  }
  return rows;
}

async function loadAcceptedCn8(
  connection: DuckDBConnection,
  rows: ReadonlyArray<{ editionYear: number; cn8: string; hs12: string }>,
): Promise<void> {
  await connection.run(`CREATE TABLE accepted_cn8 (edition_year INTEGER, cn8 VARCHAR, hs12 VARCHAR)`);
  const appender = await connection.createAppender("accepted_cn8");
  for (const row of rows) {
    appender.appendInteger(row.editionYear);
    appender.appendVarchar(row.cn8);
    appender.appendVarchar(row.hs12);
    appender.endRow();
  }
  appender.closeSync();
}

async function loadReporterAllowlist(connection: DuckDBConnection, iso2Codes: readonly string[]): Promise<void> {
  await connection.run(`CREATE TABLE reporter_allowlist (iso2 VARCHAR)`);
  const appender = await connection.createAppender("reporter_allowlist");
  for (const iso2 of iso2Codes) {
    appender.appendVarchar(iso2);
    appender.endRow();
  }
  appender.closeSync();
}

/** One aggregated cell of the reporting-market history. */
export type MarketMonthCell = { value: bigint; partners: number; cn8s: number };

export type EligibleMarketMonthAggregation = {
  marketMonths: Map<string, MarketMonthCell>;
  partnerCodes: Set<string>;
  sourceIdentifiedValueEur: bigint;
  excludedSpecialValueEur: bigint;
};

/**
 * Scan the detailed monthly Comext files and aggregate the eligible
 * reporting-market history. The connection must already hold `accepted_cn8`
 * (edition_year, cn8, hs12) and `reporter_allowlist` (iso2) tables.
 *
 * A source row contributes to a market-month iff: FLOW='1' (import), REPORTER
 * is on the allowlist, PRODUCT_NC is an 8-digit CN leaf (excludes the XX-suffixed
 * hierarchical subtotals that would double-count), VALUE_EUR casts to an integer,
 * and PRODUCT_NC is an accepted CN8 for that period's CN edition year. Value from
 * non-individual partners is excluded from the market total but summed separately
 * for reconciliation transparency.
 */
export async function aggregateEligibleMarketMonths(
  connection: DuckDBConnection,
  datFiles: readonly string[],
): Promise<EligibleMarketMonthAggregation> {
  const marketMonths = new Map<string, MarketMonthCell>();
  const partnerCodes = new Set<string>();
  let sourceIdentifiedValueEur = 0n;

  const fileList = datFiles.map((file) => `'${file}'`).join(", ");
  const readClause = `read_csv([${fileList}], header=true, delim=',', quote='', all_varchar=true, columns=${JSON.stringify(CSV_COLUMNS)})`;
  const nonIndividual = [...NON_INDIVIDUAL_PARTNERS].map((code) => `'${code}'`).join(", ");

  await connection.run(`
    CREATE OR REPLACE TABLE market_month_agg AS
    SELECT
      d.PERIOD AS period,
      d.REPORTER AS reporter_iso2,
      ac.hs12 AS hs12_code,
      SUM(CAST(d.VALUE_EUR AS HUGEINT)) AS value_eur,
      COUNT(DISTINCT d.PARTNER) AS partner_count,
      COUNT(DISTINCT d.PRODUCT_NC) AS cn8_count
    FROM ${readClause} d
    JOIN reporter_allowlist r ON d.REPORTER = r.iso2
    JOIN accepted_cn8 ac
      ON ac.edition_year = CAST(substr(d.PERIOD, 1, 4) AS INTEGER)
     AND ac.cn8 = d.PRODUCT_NC
    WHERE d.FLOW = '1'
      AND d.PARTNER NOT IN (${nonIndividual})
      AND d.PRODUCT_NC SIMILAR TO '[0-9]{8}'
      AND TRY_CAST(d.VALUE_EUR AS HUGEINT) IS NOT NULL
    GROUP BY 1, 2, 3
  `);

  // All partners (individual + special/aggregate) seen in eligible trade; the
  // partner dimension records their classification, while non-individual value
  // is excluded from the market total above.
  const partnerResult = await connection.runAndReadAll(`
    SELECT DISTINCT d.PARTNER AS partner
    FROM ${readClause} d
    JOIN reporter_allowlist r ON d.REPORTER = r.iso2
    JOIN accepted_cn8 ac
      ON ac.edition_year = CAST(substr(d.PERIOD, 1, 4) AS INTEGER)
     AND ac.cn8 = d.PRODUCT_NC
    WHERE d.FLOW = '1'
      AND d.PRODUCT_NC SIMILAR TO '[0-9]{8}'
      AND TRY_CAST(d.VALUE_EUR AS HUGEINT) IS NOT NULL
  `);
  for (const row of partnerResult.getRowObjectsJson()) {
    partnerCodes.add(String(row.partner));
  }

  // Excluded (special/aggregate) value for reconciliation transparency.
  const excludedResult = await connection.runAndReadAll(`
    SELECT COALESCE(SUM(CAST(d.VALUE_EUR AS HUGEINT)), 0) AS excluded
    FROM ${readClause} d
    JOIN reporter_allowlist r ON d.REPORTER = r.iso2
    JOIN accepted_cn8 ac
      ON ac.edition_year = CAST(substr(d.PERIOD, 1, 4) AS INTEGER)
     AND ac.cn8 = d.PRODUCT_NC
    WHERE d.FLOW = '1'
      AND d.PARTNER IN (${nonIndividual})
      AND d.PRODUCT_NC SIMILAR TO '[0-9]{8}'
      AND TRY_CAST(d.VALUE_EUR AS HUGEINT) IS NOT NULL
  `);
  const excludedSpecialValueEur = BigInt(String(excludedResult.getRowObjectsJson()[0]!.excluded ?? "0"));

  const aggResult = await connection.runAndReadAll(`
    SELECT period, reporter_iso2, hs12_code, value_eur, partner_count, cn8_count
    FROM market_month_agg
  `);
  for (const row of aggResult.getRowObjectsJson()) {
    const value = BigInt(String(row.value_eur));
    marketMonths.set(marketKey(String(row.period), String(row.reporter_iso2), String(row.hs12_code)), {
      value,
      partners: Number(row.partner_count),
      cn8s: Number(row.cn8_count),
    });
    sourceIdentifiedValueEur += value;
  }

  return { marketMonths, partnerCodes, sourceIdentifiedValueEur, excludedSpecialValueEur };
}

async function writeArtifact(input: {
  artifactPath: string;
  stagingPath: string;
  reporters: ReadonlyArray<{ reporterId: number; iso2: string; iso3: string; displayName: string }>;
  partners: ReadonlyArray<{ partnerId: number; sourceCode: string; iso2: string | null; kind: string }>;
  report: CnToHs12MappingReport;
  eligibleProducts: readonly string[];
  momentumRows: ReadonlyArray<{
    reporterId: number; reporterIso2: string; hs12Code: string; cutoffMonth: string;
    recentValueEur: string | null; baselineValueEur: string | null;
    growthRateDecimal: string | null; growthPercentDisplay: string | null;
    signalState: string | null; coverageState: string; confidence: string | null;
    recordedHistoryMonths: number; reasonCodes: string; confidenceReasons: string;
  }>;
  periods: readonly string[];
  updateStateByPeriod: ReadonlyMap<string, RecentTradeMomentumUpdateState>;
  referenceMonths: readonly string[];
  sourceVintageId: string;
  extractionTimestamp: string;
  gitSha: string;
}): Promise<void> {
  await rm(input.artifactPath, { force: true });
  const instance = await DuckDBInstance.create(input.artifactPath);
  try {
    const connection = await instance.connect();
    try {
      await connection.run(await readFile("data/schemas/recent-trade-momentum-artifact-v1.sql", "utf8"));

      const reporterAppender = await connection.createAppender("reporter");
      for (const reporter of input.reporters) {
        reporterAppender.appendInteger(reporter.reporterId);
        reporterAppender.appendVarchar(reporter.iso2);
        reporterAppender.appendVarchar(reporter.iso2);
        reporterAppender.appendVarchar(reporter.iso3);
        reporterAppender.appendVarchar(reporter.displayName);
        reporterAppender.appendVarchar("1988-01");
        reporterAppender.appendNull();
        reporterAppender.endRow();
      }
      reporterAppender.closeSync();

      const partnerAppender = await connection.createAppender("partner");
      for (const partner of input.partners) {
        partnerAppender.appendInteger(partner.partnerId);
        partnerAppender.appendVarchar(partner.sourceCode);
        if (partner.iso2 === null) partnerAppender.appendNull(); else partnerAppender.appendVarchar(partner.iso2);
        partnerAppender.appendNull();
        partnerAppender.appendVarchar(partner.kind);
        partnerAppender.appendVarchar("1988-01");
        partnerAppender.appendNull();
        partnerAppender.endRow();
      }
      partnerAppender.closeSync();

      // product_mapping: accepted CN8 codes for each eligible product/edition.
      const eligibleSet = new Set(input.eligibleProducts);
      const productAppender = await connection.createAppender("product_mapping");
      for (const product of input.report.productMappings) {
        if (product.productStatus !== "EXACT_REVIEWED" || !eligibleSet.has(product.hs12Code)) continue;
        for (const cn8 of product.acceptedCn8Codes) {
          productAppender.appendInteger(product.cnEditionYear);
          productAppender.appendVarchar(cn8);
          productAppender.appendVarchar(product.hs12Code);
          productAppender.appendVarchar(product.productStatus);
          productAppender.appendVarchar(product.correspondenceSha256);
          productAppender.appendVarchar(product.reviewId);
          productAppender.endRow();
        }
      }
      productAppender.closeSync();

      // market_month: observed rows, projected from staging with reporter ids.
      await connection.run(`ATTACH '${input.stagingPath}' AS staging (READ_ONLY)`);
      const reporterValues = input.reporters.map((r) => `('${r.iso2}', ${r.reporterId})`).join(", ");
      const periodValues = input.periods
        .map((period) => `('${period}', '${toReferenceMonth(period)}', '${input.updateStateByPeriod.get(period)}')`)
        .join(", ");
      await connection.run(`
        INSERT INTO market_month
        SELECT
          pm.reference_month,
          rm.reporter_id,
          a.hs12_code,
          a.value_eur,
          a.partner_count,
          a.cn8_count,
          0,
          CASE WHEN a.value_eur > 0 THEN 'RECORDED_POSITIVE' ELSE 'RECORDED_ZERO' END,
          pm.update_state,
          'DIRECT_EXACT'
        FROM staging.market_month_agg a
        JOIN (VALUES ${reporterValues}) AS rm(iso2, reporter_id) ON rm.iso2 = a.reporter_iso2
        JOIN (VALUES ${periodValues}) AS pm(period, reference_month, update_state) ON pm.period = a.period
      `);
      await connection.run(`DETACH staging`);

      const momentumAppender = await connection.createAppender("momentum");
      for (const row of input.momentumRows) {
        momentumAppender.appendInteger(row.reporterId);
        momentumAppender.appendVarchar(row.reporterIso2);
        momentumAppender.appendVarchar(row.hs12Code);
        momentumAppender.appendVarchar(row.cutoffMonth);
        appendNullableBigInt(momentumAppender, row.recentValueEur);
        appendNullableBigInt(momentumAppender, row.baselineValueEur);
        appendNullableVarchar(momentumAppender, row.growthRateDecimal);
        appendNullableVarchar(momentumAppender, row.growthPercentDisplay);
        appendNullableVarchar(momentumAppender, row.signalState);
        momentumAppender.appendVarchar(row.coverageState);
        appendNullableVarchar(momentumAppender, row.confidence);
        momentumAppender.appendInteger(row.recordedHistoryMonths);
        momentumAppender.appendInteger(EXPECTED_HISTORY_MONTHS);
        momentumAppender.appendVarchar(row.reasonCodes);
        momentumAppender.appendVarchar(row.confidenceReasons);
        momentumAppender.endRow();
      }
      momentumAppender.closeSync();

      const metadata: Record<string, string> = {
        sourceVintageId: input.sourceVintageId,
        extractionTimestamp: input.extractionTimestamp,
        buildGitSha: input.gitSha,
      };
      const metaAppender = await connection.createAppender("artifact_metadata");
      for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
        metaAppender.appendVarchar(key);
        metaAppender.appendVarchar(value);
        metaAppender.endRow();
      }
      metaAppender.closeSync();
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

function appendNullableBigInt(appender: { appendBigInt(v: bigint): void; appendNull(): void }, value: string | null): void {
  if (value === null) appender.appendNull(); else appender.appendBigInt(BigInt(value));
}
function appendNullableVarchar(appender: { appendVarchar(v: string): void; appendNull(): void }, value: string | null): void {
  if (value === null) appender.appendNull(); else appender.appendVarchar(value);
}

async function sumMarketMonthValue(artifactPath: string): Promise<bigint> {
  const instance = await DuckDBInstance.create(artifactPath, { access_mode: "READ_ONLY" });
  try {
    const connection = await instance.connect();
    try {
      const result = await connection.runAndReadAll(`SELECT COALESCE(SUM(value_eur), 0) AS total FROM market_month`);
      return BigInt(String(result.getRowObjectsJson()[0]!.total));
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

async function buildRevisionReport(
  args: Args,
  sourceVintageId: string,
  momentumRows: ReadonlyArray<{ hs12Code: string; reporterIso2: string; recentValueEur: string | null; signalState: string | null }>,
): Promise<{
  schemaVersion: "recent-trade-momentum-revision-report-v1";
  previousSourceVintageId: string | null;
  previousPackageIdentity: DatasetPackageIdentity | null;
  sourceVintageId: string;
  momentum: { valueChanged: number; stateChanged: number };
  affectedReporters: string[];
  affectedProducts: string[];
}> {
  let previousSourceVintageId: string | null = null;
  let previousPackageIdentity: DatasetPackageIdentity | null = null;
  let previousMomentum: Map<string, { recent: string | null; signal: string | null }> | null = null;

  if (args.previous !== null) {
    const manifestText = await readFile(join(args.previous, "dataset-package-manifest.json"), "utf8").catch(() => null);
    if (manifestText !== null) {
      const manifest = JSON.parse(manifestText) as RecentTradeMomentumDatasetPackageManifest;
      previousSourceVintageId = manifest.sourceVintageId;
      previousPackageIdentity = createRecentTradeMomentumDatasetPackage(manifest).identity;
      const previousArtifact = join(args.previous, "recent-trade-momentum.duckdb");
      previousMomentum = await loadMomentumSnapshot(previousArtifact);
    }
  }

  let valueChanged = 0;
  let stateChanged = 0;
  const affectedReporters = new Set<string>();
  const affectedProducts = new Set<string>();
  if (previousMomentum !== null) {
    for (const row of momentumRows) {
      const key = `${row.reporterIso2}|${row.hs12Code}`;
      const previous = previousMomentum.get(key);
      if (previous === undefined) continue;
      if (previous.recent !== row.recentValueEur) { valueChanged += 1; affectedReporters.add(row.reporterIso2); affectedProducts.add(row.hs12Code); }
      if (previous.signal !== row.signalState) { stateChanged += 1; affectedReporters.add(row.reporterIso2); affectedProducts.add(row.hs12Code); }
    }
  }
  return {
    schemaVersion: "recent-trade-momentum-revision-report-v1",
    previousSourceVintageId,
    previousPackageIdentity,
    sourceVintageId,
    momentum: { valueChanged, stateChanged },
    affectedReporters: [...affectedReporters].sort(),
    affectedProducts: [...affectedProducts].sort(),
  };
}

async function loadMomentumSnapshot(artifactPath: string): Promise<Map<string, { recent: string | null; signal: string | null }>> {
  const snapshot = new Map<string, { recent: string | null; signal: string | null }>();
  const instance = await DuckDBInstance.create(artifactPath, { access_mode: "READ_ONLY" });
  try {
    const connection = await instance.connect();
    try {
      const result = await connection.runAndReadAll(`SELECT reporter_iso2, hs12_code, recent_value_eur, signal_state FROM momentum`);
      for (const row of result.getRowObjectsJson()) {
        snapshot.set(`${row.reporter_iso2}|${row.hs12_code}`, {
          recent: row.recent_value_eur === null ? null : String(row.recent_value_eur),
          signal: row.signal_state === null ? null : String(row.signal_state),
        });
      }
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
  return snapshot;
}

async function sourceObjectIdentities(args: Args, periods: readonly string[]): Promise<{ collectionSha256: string }> {
  const objects: Array<{ objectId: string; sha256: string; bytes: number }> = [];
  const files = await readdir(args.datDir).catch(() => [] as string[]);
  for (const period of periods) {
    const zipName = `full_v2_${period}.7z`;
    const datName = `full_${period}.dat`;
    if (files.includes(datName)) {
      const path = join(args.datDir, datName);
      objects.push({ objectId: zipName, sha256: await fileSha256(path), bytes: (await stat(path)).size });
    }
  }
  objects.sort((left, right) => left.objectId.localeCompare(right.objectId));
  return { collectionSha256: sha256Json(objects) };
}

async function fileSha256(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}
function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
