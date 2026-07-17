import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import {
  buildCnToHs12MappingReport,
  evaluateHs12ProductMappingAcrossEditions,
  type CnToHs12MappingEvidence,
  type CnToHs12MappingReport,
} from "../../src/domain/recent-trade-momentum/cn-to-hs12-mapping";
import {
  computeRecentTradeMomentumV1,
  type RecentTradeMomentumMonthObservation,
  type RecentTradeMomentumOutcome,
  type RecentTradeMomentumUpdateState,
} from "../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";
import {
  createRecentTradeMomentumDatasetPackage,
  RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
  type RecentTradeMomentumDatasetPackage,
  type RecentTradeMomentumDatasetPackageManifest,
} from "../../src/domain/trade-analytics/recent-trade-momentum-v1-dataset-package";

const GIB = 1024 * 1024 * 1024;
export const RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES = GIB;
export const RECENT_TRADE_MOMENTUM_ARTIFACT_HARD_LIMIT_BYTES = 2 * GIB;
const DECLARED_SERVING_VOLUME_BYTES = 50 * GIB;
const MINIMUM_FREE_FRACTION = 0.25;
const ARTIFACT_RELATIVE_PATH = "recent-trade-momentum.duckdb";

export type RecentTradeMomentumSourceVintage = Readonly<{
  schemaVersion: "recent-trade-momentum-fixtures-v1";
  sourceVintageId: string;
  extractionTimestamp: string;
  sourceMetadataVersion: string;
  sourceUrl: string;
  sourceObjects: readonly RecentTradeMomentumSourceObject[];
  referenceMonths: readonly string[];
  eligibleCompleteMonths: readonly string[];
  reporters: readonly RecentTradeMomentumReporter[];
  partners: readonly RecentTradeMomentumPartner[];
  hs12Products: readonly string[];
  mappingEvidence: CnToHs12MappingEvidence;
  rows: readonly RecentTradeMomentumSourceRow[];
}>;

export type RecentTradeMomentumSourceObject = Readonly<{
  objectId: string;
  url: string;
  content: string;
}>;

export type RecentTradeMomentumReporter = Readonly<{
  reporterId: number;
  sourceCode: string;
  iso2: string;
  iso3: string;
  displayName: string;
  validFrom: string;
  validTo: string | null;
}>;

export type RecentTradeMomentumPartner = Readonly<{
  partnerId: number;
  sourceCode: string;
  iso2: string | null;
  iso3: string | null;
  kind: "INDIVIDUAL" | "AGGREGATE" | "CONFIDENTIAL" | "UNKNOWN";
  validFrom: string;
  validTo: string | null;
}>;

export type RecentTradeMomentumSourceRow = Readonly<{
  referenceMonth: string;
  reporterSourceCode: string;
  partnerSourceCode: string;
  flow: "IMPORT";
  cnEditionYear: number;
  cn8Code: string;
  valueEur: number;
  sourceSpecialCode: "NONE" | "WORLD_TOTAL" | "CONFIDENTIAL" | "SPECIAL";
  updateState: RecentTradeMomentumUpdateState;
}>;

export type RecentTradeMomentumBuildOptions = Readonly<{
  sourceVintage: RecentTradeMomentumSourceVintage;
  previousPackage?: RecentTradeMomentumBuildOutcome;
  workspacePath: string;
  reportPath: string;
  builtAt: string;
  buildGitSha: string;
  shadowVintagesPassed: number;
}>;

export type RecentTradeMomentumBuildOutcome = Readonly<{
  status: "accepted";
  datasetPackage: RecentTradeMomentumDatasetPackage;
  manifest: RecentTradeMomentumDatasetPackageManifest;
  artifactPath: string;
  packagePath: string;
  reportPath: string;
  gates: RecentTradeMomentumBuildGates;
  reconciliation: RecentTradeMomentumReconciliation;
  revisionReport: RecentTradeMomentumRevisionReport;
  sourceGrainRows: readonly StagedSourceRow[];
  momentumRows: readonly MomentumArtifactRow[];
}>;

export type RecentTradeMomentumBuildGates = Readonly<{
  artifactBytes: number;
  artifactSizeReviewRequired: boolean;
  artifactPromotionBlocked: boolean;
  retentionFitsDeclaredVolume: boolean;
  sourceRowUniqueness: boolean;
  aggregateRowUniqueness: boolean;
  valueReconciled: boolean;
  readOnlySmokePassed: boolean;
}>;

export type RecentTradeMomentumReconciliation = Readonly<{
  sourceIdentifiedValueEur: string;
  aggregateIdentifiedValueEur: string;
  excludedSpecialValueEur: string;
  worldTotalExcludedValueEur: string;
}>;

export type RecentTradeMomentumRevisionReport = Readonly<{
  schemaVersion: "recent-trade-momentum-revision-report-v1";
  previousSourceVintageId: string | null;
  sourceVintageId: string;
  sourceGrain: Readonly<{
    inserted: number;
    deleted: number;
    valueChanged: number;
    stateChanged: number;
    unchanged: number;
  }>;
  momentum: Readonly<{
    valueChanged: number;
    stateChanged: number;
    alertEventKinds: readonly (
      | "REVISION_UPDATE"
      | "REVISION_RETRACTION"
      | "REVISION_REINSTATEMENT"
    )[];
  }>;
  affectedPeriods: readonly string[];
  affectedReporters: readonly string[];
  affectedProducts: readonly string[];
  absoluteValueDeltaEur: string;
}>;

type StagedSourceRow = RecentTradeMomentumSourceRow &
  Readonly<{
    reporterIso2: string | null;
    partnerKind: RecentTradeMomentumPartner["kind"] | null;
    partnerIso2: string | null;
    rowMappingStatus: string;
    hs12Code: string | null;
    eligibleForAggregation: boolean;
  }>;

type MarketMonthArtifactRow = Readonly<{
  referenceMonth: string;
  reporterId: number;
  reporterIso2: string;
  hs12Code: string;
  valueEur: bigint | null;
  contributingPartnerCount: number;
  contributingCn8Count: number;
  excludedSpecialValueEur: bigint;
  observationState: RecentTradeMomentumMonthObservation["observationState"];
  updateState: RecentTradeMomentumUpdateState;
  mappingChain: "DIRECT_EXACT" | "MULTI_STEP_EXACT";
}>;

type MomentumArtifactRow = Readonly<{
  reporterId: number;
  reporterIso2: string;
  hs12Code: string;
  cutoffMonth: string;
  recentValueEur: string | null;
  baselineValueEur: string | null;
  growthRateDecimal: string | null;
  growthPercentDisplay: string | null;
  signalState: RecentTradeMomentumOutcome["signalState"];
  coverageState: RecentTradeMomentumOutcome["coverageState"];
  confidence: RecentTradeMomentumOutcome["confidence"];
  recordedHistoryMonths: number;
  expectedHistoryMonths: 24;
  reasonCodes: readonly string[];
  confidenceReasons: readonly string[];
}>;

export async function buildRecentTradeMomentumPackage(
  options: RecentTradeMomentumBuildOptions,
): Promise<RecentTradeMomentumBuildOutcome> {
  const workspacePath = resolve(options.workspacePath);
  const packageRoot = join(workspacePath, "recent-trade-momentum-package");
  const partialPath = join(packageRoot, ".partial");
  const artifactPath = join(partialPath, ARTIFACT_RELATIVE_PATH);
  await rm(partialPath, { force: true, recursive: true });
  await mkdir(partialPath, { recursive: true });

  const sourceObjects = sourceObjectIdentities(options.sourceVintage.sourceObjects);
  const mappingReport = buildCnToHs12MappingReport(options.sourceVintage.mappingEvidence);
  const sourceRows = stageSourceRows(options.sourceVintage, mappingReport);
  assertUniqueSourceRows(sourceRows);
  await writeSourceGrainParquet(sourceRows, join(partialPath, "source-grain.parquet"));

  const aggregate = aggregateMarketMonths(options.sourceVintage, mappingReport, sourceRows);
  assertUniqueMarketMonths(aggregate.marketMonths);
  const momentumRows = buildMomentumRows(options.sourceVintage, mappingReport, aggregate.marketMonths);

  await writeArtifact({
    artifactPath,
    sourceVintage: options.sourceVintage,
    mappingReport,
    marketMonths: aggregate.marketMonths,
    momentumRows,
    sourceObjects,
    builtAt: options.builtAt,
    buildGitSha: options.buildGitSha,
  });
  const artifactIdentity = await fileIdentity(artifactPath);
  const artifactGates = evaluateRecentTradeMomentumArtifactGates(artifactIdentity.bytes);
  const retention = evaluateRecentTradeMomentumRetentionGate(artifactIdentity.bytes);
  const smoke = await smokeReadOnlyArtifact(artifactPath);
  const reconciliation = reconcileValues(aggregate);
  const revisionReport = buildRevisionReport(
    options.sourceVintage,
    sourceRows,
    momentumRows,
    options.previousPackage,
  );
  const revisionReportBytes = jsonBytes(revisionReport);
  await writeFile(join(partialPath, "revision-report.json"), revisionReportBytes);
  const conformanceReport = {
    schemaVersion: "recent-trade-momentum-conformance-report-v1",
    sourceVintageId: options.sourceVintage.sourceVintageId,
    sourceRows: sourceRows.length,
    marketMonths: aggregate.marketMonths.length,
    momentumRows: momentumRows.length,
    reconciliation,
    gates: {
      sourceRowUniqueness: true,
      aggregateRowUniqueness: true,
      valueReconciled: reconciliation.sourceIdentifiedValueEur === reconciliation.aggregateIdentifiedValueEur,
    },
  };
  const conformanceReportBytes = jsonBytes(conformanceReport);
  await writeFile(join(partialPath, "conformance-report.json"), conformanceReportBytes);

  const manifest = monthlyManifest({
    sourceVintage: options.sourceVintage,
    sourceObjectsSha256: sourceObjects.collectionSha256,
    sourceMetadataSha256: sha256Text(options.sourceVintage.sourceMetadataVersion),
    mappingEvidenceSha256: sha256Json(options.sourceVintage.mappingEvidence),
    artifactIdentity,
    rowCounts: {
      reporters: options.sourceVintage.reporters.length,
      partners: options.sourceVintage.partners.length,
      productMappings: mappingReport.productMappings.length,
      marketMonths: aggregate.marketMonths.length,
      momentum: momentumRows.length,
    },
    revisionReportSha256: sha256Bytes(revisionReportBytes),
    conformanceReportSha256: sha256Bytes(conformanceReportBytes),
    supersedesPackageIdentity: options.previousPackage?.datasetPackage.identity ?? null,
    shadowVintagesPassed: options.shadowVintagesPassed,
  });
  const datasetPackage = createRecentTradeMomentumDatasetPackage(manifest);
  await writeFile(join(partialPath, "dataset-package-manifest.json"), datasetPackage.serializedManifest);
  const acceptedPath = join(packageRoot, datasetPackage.identity);
  await rm(acceptedPath, { force: true, recursive: true });
  await mkdir(dirname(acceptedPath), { recursive: true });
  await rename(partialPath, acceptedPath);

  const gates = {
    ...artifactGates,
    retentionFitsDeclaredVolume: retention.fits,
    sourceRowUniqueness: true,
    aggregateRowUniqueness: true,
    valueReconciled: reconciliation.sourceIdentifiedValueEur === reconciliation.aggregateIdentifiedValueEur,
    readOnlySmokePassed: smoke,
  };
  const outcome: RecentTradeMomentumBuildOutcome = {
    status: "accepted",
    datasetPackage,
    manifest,
    artifactPath: join(acceptedPath, ARTIFACT_RELATIVE_PATH),
    packagePath: acceptedPath,
    reportPath: resolve(options.reportPath),
    gates,
    reconciliation,
    revisionReport,
    sourceGrainRows: sourceRows,
    momentumRows,
  };
  await mkdir(dirname(outcome.reportPath), { recursive: true });
  await writeFile(
    outcome.reportPath,
    jsonBytes({
      schemaVersion: "recent-trade-momentum-build-report-v1",
      status: "accepted",
      sourceVintageId: options.sourceVintage.sourceVintageId,
      packageIdentity: datasetPackage.identity,
      rowCounts: manifest.rowCounts,
      gates,
      reconciliation,
      revisionReport,
    }),
  );
  return outcome;
}

export function evaluateRecentTradeMomentumArtifactGates(
  artifactBytes: number,
): Readonly<{
  artifactBytes: number;
  artifactSizeReviewRequired: boolean;
  artifactPromotionBlocked: boolean;
}> {
  return {
    artifactBytes,
    artifactSizeReviewRequired: artifactBytes > RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES,
    artifactPromotionBlocked: artifactBytes > RECENT_TRADE_MOMENTUM_ARTIFACT_HARD_LIMIT_BYTES,
  };
}

export function evaluateRecentTradeMomentumActivationGate(
  shadowVintagesPassed: number,
): Readonly<{
  publicCapabilityActivated: false;
  shadowVintagesPassed: number;
  activationAllowed: boolean;
  reason: "THREE_SHADOW_VINTAGES_REQUIRED" | null;
}> {
  return {
    publicCapabilityActivated: false,
    shadowVintagesPassed,
    activationAllowed: shadowVintagesPassed >= 3,
    reason: shadowVintagesPassed >= 3 ? null : "THREE_SHADOW_VINTAGES_REQUIRED",
  };
}

export async function canonicalRecentTradeMomentumAnalyticalRows(
  artifactPath: string,
): Promise<string> {
  const instance = await DuckDBInstance.create(artifactPath, {
    access_mode: "READ_ONLY",
  });
  try {
    const connection = await instance.connect();
    try {
      const momentum = await connection.runAndReadAll(`
        SELECT
          reporter_id,
          reporter_iso2,
          hs12_code,
          cutoff_month,
          recent_value_eur,
          baseline_value_eur,
          growth_rate_decimal,
          growth_percent_display,
          signal_state,
          coverage_state,
          confidence,
          recorded_history_months,
          expected_history_months,
          reason_codes,
          confidence_reasons
        FROM momentum
        ORDER BY reporter_iso2, hs12_code
      `);
      return `${JSON.stringify({ momentum: momentum.getRowObjectsJson() }, null, 2)}\n`;
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

function stageSourceRows(
  sourceVintage: RecentTradeMomentumSourceVintage,
  mappingReport: CnToHs12MappingReport,
): StagedSourceRow[] {
  const reporters = new Map(sourceVintage.reporters.map((reporter) => [reporter.sourceCode, reporter]));
  const partners = new Map(sourceVintage.partners.map((partner) => [partner.sourceCode, partner]));
  const rowMappingByKey = new Map(
    mappingReport.rowMappings.map((row) => [`${row.cnEditionYear}|${row.cn8Code}`, row]),
  );
  const productMappingByKey = new Map(
    mappingReport.productMappings.map((row) => [`${row.cnEditionYear}|${row.hs12Code}`, row]),
  );

  return [...sourceVintage.rows]
    .sort(compareSourceRows)
    .map((row) => {
      const reporter = reporters.get(row.reporterSourceCode) ?? null;
      const partner = partners.get(row.partnerSourceCode) ?? null;
      const rowMapping = rowMappingByKey.get(`${row.cnEditionYear}|${row.cn8Code}`);
      const hs12Code = rowMapping?.targets.length === 1 ? rowMapping.targets[0]! : null;
      const productMapping =
        hs12Code === null
          ? undefined
          : productMappingByKey.get(`${row.cnEditionYear}|${hs12Code}`);
      const eligibleForAggregation =
        reporter !== null &&
        partner?.kind === "INDIVIDUAL" &&
        row.sourceSpecialCode === "NONE" &&
        rowMapping?.status === "EXACT_REVIEWED" &&
        rowMapping.rejectionReasons.length === 0 &&
        productMapping?.productStatus === "EXACT_REVIEWED";
      return {
        ...row,
        reporterIso2: reporter?.iso2 ?? null,
        partnerKind: partner?.kind ?? null,
        partnerIso2: partner?.iso2 ?? null,
        rowMappingStatus: rowMapping?.status ?? "UNMAPPED",
        hs12Code,
        eligibleForAggregation,
      };
    });
}

function aggregateMarketMonths(
  sourceVintage: RecentTradeMomentumSourceVintage,
  mappingReport: CnToHs12MappingReport,
  sourceRows: readonly StagedSourceRow[],
): {
  marketMonths: readonly MarketMonthArtifactRow[];
  sourceIdentifiedValueEur: bigint;
  aggregateIdentifiedValueEur: bigint;
  excludedSpecialValueEur: bigint;
  worldTotalExcludedValueEur: bigint;
} {
  const reporters = [...sourceVintage.reporters].sort((left, right) => left.iso2.localeCompare(right.iso2));
  const products = [...sourceVintage.hs12Products].sort();
  const months = [...sourceVintage.eligibleCompleteMonths].sort();
  const aggregate = new Map<string, {
    value: bigint;
    partners: Set<string>;
    cn8Codes: Set<string>;
    updateStates: Set<RecentTradeMomentumUpdateState>;
    mappingChains: Set<"DIRECT_EXACT" | "MULTI_STEP_EXACT">;
  }>();
  let sourceIdentifiedValueEur = 0n;
  let excludedSpecialValueEur = 0n;
  let worldTotalExcludedValueEur = 0n;

  for (const row of sourceRows) {
    if (row.eligibleForAggregation && row.reporterIso2 !== null && row.hs12Code !== null) {
      const key = marketKey(row.referenceMonth, row.reporterIso2, row.hs12Code);
      const bucket = aggregate.get(key) ?? {
        value: 0n,
        partners: new Set<string>(),
        cn8Codes: new Set<string>(),
        updateStates: new Set<RecentTradeMomentumUpdateState>(),
        mappingChains: new Set<"DIRECT_EXACT" | "MULTI_STEP_EXACT">(),
      };
      bucket.value += BigInt(row.valueEur);
      bucket.partners.add(row.partnerSourceCode);
      bucket.cn8Codes.add(row.cn8Code);
      bucket.updateStates.add(row.updateState);
      bucket.mappingChains.add(mappingChain(mappingReport, row.cnEditionYear, row.cn8Code));
      aggregate.set(key, bucket);
      sourceIdentifiedValueEur += BigInt(row.valueEur);
      continue;
    }
    if (row.sourceSpecialCode === "WORLD_TOTAL") {
      worldTotalExcludedValueEur += BigInt(row.valueEur);
    } else if (row.sourceSpecialCode !== "NONE" || row.partnerKind === "CONFIDENTIAL") {
      excludedSpecialValueEur += BigInt(row.valueEur);
    }
  }

  const marketMonths: MarketMonthArtifactRow[] = [];
  for (const reporter of reporters) {
    for (const hs12Code of products) {
      const productAcrossEditions = evaluateHs12ProductMappingAcrossEditions(
        mappingReport,
        hs12Code,
        editionsForHistory(months),
      );
      for (const referenceMonth of months) {
        const key = marketKey(referenceMonth, reporter.iso2, hs12Code);
        const bucket = aggregate.get(key);
        const unsupported = productAcrossEditions.status !== "EXACT_REVIEWED";
        const observationState = unsupported
          ? "UNSUPPORTED_PRODUCT_MAPPING"
          : bucket === undefined
            ? "NOT_OBSERVED"
            : bucket.value > 0n
              ? "RECORDED_POSITIVE"
              : "RECORDED_ZERO";
        marketMonths.push({
          referenceMonth,
          reporterId: reporter.reporterId,
          reporterIso2: reporter.iso2,
          hs12Code,
          valueEur: bucket?.value ?? null,
          contributingPartnerCount: bucket?.partners.size ?? 0,
          contributingCn8Count: bucket?.cn8Codes.size ?? 0,
          excludedSpecialValueEur: 0n,
          observationState,
          updateState: bucket?.updateStates.has("PRELIMINARY")
            ? "PRELIMINARY"
            : "FINAL_BY_SOURCE_SCHEDULE",
          mappingChain:
            bucket?.mappingChains.has("MULTI_STEP_EXACT") === true
              ? "MULTI_STEP_EXACT"
              : "DIRECT_EXACT",
        });
      }
    }
  }
  const aggregateIdentifiedValueEur = marketMonths.reduce(
    (sum, row) => sum + (row.valueEur ?? 0n),
    0n,
  );
  return {
    marketMonths,
    sourceIdentifiedValueEur,
    aggregateIdentifiedValueEur,
    excludedSpecialValueEur,
    worldTotalExcludedValueEur,
  };
}

function buildMomentumRows(
  sourceVintage: RecentTradeMomentumSourceVintage,
  mappingReport: CnToHs12MappingReport,
  marketMonths: readonly MarketMonthArtifactRow[],
): MomentumArtifactRow[] {
  const cutoffMonth = sourceVintage.eligibleCompleteMonths.at(-1);
  if (cutoffMonth === undefined) {
    throw new Error("Monthly source vintage has no eligible complete months.");
  }
  const marketMonthByKey = new Map(
    marketMonths.map((row) => [marketKey(row.referenceMonth, row.reporterIso2, row.hs12Code), row]),
  );
  const momentumRows: MomentumArtifactRow[] = [];
  for (const reporter of [...sourceVintage.reporters].sort((left, right) => left.iso2.localeCompare(right.iso2))) {
    for (const hs12Code of [...sourceVintage.hs12Products].sort()) {
      const productMapping = evaluateHs12ProductMappingAcrossEditions(
        mappingReport,
        hs12Code,
        editionsForHistory(sourceVintage.eligibleCompleteMonths),
      );
      const observations = sourceVintage.eligibleCompleteMonths.map((referenceMonth) => {
        const row = marketMonthByKey.get(marketKey(referenceMonth, reporter.iso2, hs12Code));
        if (row === undefined) {
          throw new Error("Market-month aggregation is incomplete.");
        }
        return {
          referenceMonth,
          observationState: row.observationState,
          valueEur: row.valueEur === null ? null : Number(row.valueEur),
          updateState: row.updateState,
          mappingChain: row.mappingChain,
        } satisfies RecentTradeMomentumMonthObservation;
      });
      const outcome = computeRecentTradeMomentumV1({
        recipe: "recent-trade-momentum-v1",
        resultSchemaVersion: "recent-trade-momentum-result-v1",
        monthlyPackageId: "pending-package",
        sourceVintageId: sourceVintage.sourceVintageId,
        reporterIso2: reporter.iso2,
        hs12Code,
        cutoffMonth,
        eligibleCompleteMonths: sourceVintage.eligibleCompleteMonths,
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
        expectedHistoryMonths: outcome.expectedHistoryMonths,
        reasonCodes: outcome.reasonCodes,
        confidenceReasons: outcome.confidenceReasons,
      });
    }
  }
  return momentumRows;
}

async function writeArtifact(input: {
  artifactPath: string;
  sourceVintage: RecentTradeMomentumSourceVintage;
  mappingReport: CnToHs12MappingReport;
  marketMonths: readonly MarketMonthArtifactRow[];
  momentumRows: readonly MomentumArtifactRow[];
  sourceObjects: ReturnType<typeof sourceObjectIdentities>;
  builtAt: string;
  buildGitSha: string;
}): Promise<void> {
  await rm(input.artifactPath, { force: true });
  const instance = await DuckDBInstance.create(input.artifactPath);
  try {
    const connection = await instance.connect();
    try {
      await connection.run(await readFile("data/schemas/recent-trade-momentum-artifact-v1.sql", "utf8"));
      for (const reporter of input.sourceVintage.reporters) {
        await connection.run(`
          INSERT INTO reporter VALUES (
            ${reporter.reporterId}, ${sqlString(reporter.sourceCode)}, ${sqlString(reporter.iso2)},
            ${sqlString(reporter.iso3)}, ${sqlString(reporter.displayName)},
            ${sqlString(reporter.validFrom)}, ${nullableSqlString(reporter.validTo)}
          )
        `);
      }
      for (const partner of input.sourceVintage.partners) {
        await connection.run(`
          INSERT INTO partner VALUES (
            ${partner.partnerId}, ${sqlString(partner.sourceCode)}, ${nullableSqlString(partner.iso2)},
            ${nullableSqlString(partner.iso3)}, ${sqlString(partner.kind)},
            ${sqlString(partner.validFrom)}, ${nullableSqlString(partner.validTo)}
          )
        `);
      }
      for (const mapping of input.mappingReport.productMappings) {
        for (const cn8Code of [...mapping.acceptedCn8Codes, ...mapping.rejectedTouchingCodes].sort()) {
          await connection.run(`
            INSERT INTO product_mapping VALUES (
              ${mapping.cnEditionYear}, ${sqlString(cn8Code)}, ${sqlString(mapping.hs12Code)},
              ${sqlString(mapping.productStatus)}, ${sqlString(mapping.correspondenceSha256)},
              ${sqlString(mapping.reviewId)}
            )
          `);
        }
      }
      for (const row of input.marketMonths) {
        await connection.run(`
          INSERT INTO market_month VALUES (
            ${sqlString(row.referenceMonth)}, ${row.reporterId}, ${sqlString(row.hs12Code)},
            ${row.valueEur === null ? "NULL" : row.valueEur.toString()},
            ${row.contributingPartnerCount}, ${row.contributingCn8Count},
            ${row.excludedSpecialValueEur.toString()}, ${sqlString(row.observationState)},
            ${sqlString(row.updateState)}, ${sqlString(row.mappingChain)}
          )
        `);
      }
      for (const row of input.momentumRows) {
        await connection.run(`
          INSERT INTO momentum VALUES (
            ${row.reporterId}, ${sqlString(row.reporterIso2)}, ${sqlString(row.hs12Code)},
            ${sqlString(row.cutoffMonth)}, ${nullableSqlNumber(row.recentValueEur)},
            ${nullableSqlNumber(row.baselineValueEur)}, ${nullableSqlString(row.growthRateDecimal)},
            ${nullableSqlString(row.growthPercentDisplay)}, ${nullableSqlString(row.signalState)},
            ${sqlString(row.coverageState)}, ${nullableSqlString(row.confidence)},
            ${row.recordedHistoryMonths}, ${row.expectedHistoryMonths},
            ${sqlString(row.reasonCodes.join(","))},
            ${sqlString(row.confidenceReasons.join(","))}
          )
        `);
      }
      const metadata = {
        sourceVintageId: input.sourceVintage.sourceVintageId,
        sourceObjectsSha256: input.sourceObjects.collectionSha256,
        builtAt: input.builtAt,
        buildGitSha: input.buildGitSha,
      };
      for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
        await connection.run(`INSERT INTO artifact_metadata VALUES (${sqlString(key)}, ${sqlString(value)})`);
      }
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

async function writeSourceGrainParquet(
  rows: readonly StagedSourceRow[],
  parquetPath: string,
): Promise<void> {
  await mkdir(dirname(parquetPath), { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  try {
    const connection = await instance.connect();
    try {
      await connection.run(`
        CREATE TABLE source_grain (
          reference_month VARCHAR,
          reporter_source_code VARCHAR,
          partner_source_code VARCHAR,
          flow VARCHAR,
          cn_edition_year INTEGER,
          cn8_code VARCHAR,
          value_eur BIGINT,
          source_special_code VARCHAR,
          update_state VARCHAR,
          reporter_iso2 VARCHAR,
          partner_kind VARCHAR,
          hs12_code VARCHAR,
          eligible_for_aggregation BOOLEAN
        )
      `);
      for (const row of rows) {
        await connection.run(`
          INSERT INTO source_grain VALUES (
            ${sqlString(row.referenceMonth)}, ${sqlString(row.reporterSourceCode)},
            ${sqlString(row.partnerSourceCode)}, ${sqlString(row.flow)},
            ${row.cnEditionYear}, ${sqlString(row.cn8Code)}, ${row.valueEur},
            ${sqlString(row.sourceSpecialCode)}, ${sqlString(row.updateState)},
            ${nullableSqlString(row.reporterIso2)}, ${nullableSqlString(row.partnerKind)},
            ${nullableSqlString(row.hs12Code)}, ${row.eligibleForAggregation ? "TRUE" : "FALSE"}
          )
        `);
      }
      await connection.run(`COPY source_grain TO ${sqlString(parquetPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

function buildRevisionReport(
  sourceVintage: RecentTradeMomentumSourceVintage,
  sourceRows: readonly StagedSourceRow[],
  momentumRows: readonly MomentumArtifactRow[],
  previousPackage: RecentTradeMomentumBuildOutcome | undefined,
): RecentTradeMomentumRevisionReport {
  if (previousPackage === undefined) {
    return {
      schemaVersion: "recent-trade-momentum-revision-report-v1",
      previousSourceVintageId: null,
      sourceVintageId: sourceVintage.sourceVintageId,
      sourceGrain: { inserted: 0, deleted: 0, valueChanged: 0, stateChanged: 0, unchanged: sourceRows.length },
      momentum: { valueChanged: 0, stateChanged: 0, alertEventKinds: [] },
      affectedPeriods: [],
      affectedReporters: [],
      affectedProducts: [],
      absoluteValueDeltaEur: "0",
    };
  }
  const previousByKey = new Map(previousPackage.sourceGrainRows.map((row) => [sourceRevisionKey(row), row]));
  const currentByKey = new Map(sourceRows.map((row) => [sourceRevisionKey(row), row]));
  let inserted = 0;
  let deleted = 0;
  let valueChanged = 0;
  let stateChanged = 0;
  let unchanged = 0;
  let absoluteValueDeltaEur = 0n;
  const affectedPeriods = new Set<string>();
  const affectedReporters = new Set<string>();
  const affectedProducts = new Set<string>();

  for (const [key, current] of currentByKey) {
    const previous = previousByKey.get(key);
    if (previous === undefined) {
      inserted += 1;
      recordAffected(current);
      absoluteValueDeltaEur += BigInt(current.valueEur);
      continue;
    }
    let changed = false;
    if (current.valueEur !== previous.valueEur) {
      valueChanged += 1;
      changed = true;
      recordAffected(current);
      absoluteValueDeltaEur += absBigInt(BigInt(current.valueEur) - BigInt(previous.valueEur));
    }
    if (current.updateState !== previous.updateState || current.sourceSpecialCode !== previous.sourceSpecialCode) {
      stateChanged += 1;
      changed = true;
      recordAffected(current);
    }
    if (!changed) {
      unchanged += 1;
    }
  }
  for (const [key, previous] of previousByKey) {
    if (!currentByKey.has(key)) {
      deleted += 1;
      recordAffected(previous);
      absoluteValueDeltaEur += BigInt(previous.valueEur);
    }
  }

  const previousMomentum = new Map(previousPackage.momentumRows.map((row) => [momentumKey(row), row]));
  let momentumValueChanged = 0;
  let momentumStateChanged = 0;
  for (const current of momentumRows) {
    const previous = previousMomentum.get(momentumKey(current));
    if (previous === undefined) {
      continue;
    }
    if (
      current.recentValueEur !== previous.recentValueEur ||
      current.baselineValueEur !== previous.baselineValueEur ||
      current.growthRateDecimal !== previous.growthRateDecimal
    ) {
      momentumValueChanged += 1;
    }
    if (
      current.coverageState !== previous.coverageState ||
      current.signalState !== previous.signalState
    ) {
      momentumStateChanged += 1;
    }
  }
  const eventKinds = [
    ...(valueChanged > 0 ? ["REVISION_UPDATE" as const] : []),
    ...(deleted > 0 ? ["REVISION_RETRACTION" as const] : []),
    ...(inserted > 0 ? ["REVISION_REINSTATEMENT" as const] : []),
  ];

  return {
    schemaVersion: "recent-trade-momentum-revision-report-v1",
    previousSourceVintageId: previousPackage.manifest.sourceVintageId,
    sourceVintageId: sourceVintage.sourceVintageId,
    sourceGrain: { inserted, deleted, valueChanged, stateChanged, unchanged },
    momentum: {
      valueChanged: momentumValueChanged,
      stateChanged: momentumStateChanged,
      alertEventKinds: eventKinds,
    },
    affectedPeriods: [...affectedPeriods].sort(),
    affectedReporters: [...affectedReporters].sort(),
    affectedProducts: [...affectedProducts].sort(),
    absoluteValueDeltaEur: absoluteValueDeltaEur.toString(),
  };

  function recordAffected(row: StagedSourceRow): void {
    affectedPeriods.add(row.referenceMonth);
    if (row.reporterIso2 !== null) {
      affectedReporters.add(row.reporterIso2);
    }
    if (row.hs12Code !== null) {
      affectedProducts.add(row.hs12Code);
    }
  }
}

function monthlyManifest(input: {
  sourceVintage: RecentTradeMomentumSourceVintage;
  sourceObjectsSha256: string;
  sourceMetadataSha256: string;
  mappingEvidenceSha256: string;
  artifactIdentity: { bytes: number; sha256: string };
  rowCounts: RecentTradeMomentumDatasetPackageManifest["rowCounts"];
  revisionReportSha256: string;
  conformanceReportSha256: string;
  supersedesPackageIdentity: RecentTradeMomentumDatasetPackageManifest["supersedesPackageIdentity"];
  shadowVintagesPassed: number;
}): RecentTradeMomentumDatasetPackageManifest {
  return {
    schemaVersion: "monthly-trade-dataset-package-manifest-v1",
    artifactSchemaVersion: "monthly-trade-artifact-v1",
    resultSchemaVersion: "recent-trade-momentum-result-v1",
    recipeId: "recent-trade-momentum-v1",
    capability: "recent-trade-momentum/reporting-market-import-value@1",
    mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
    sourceOwner: "Eurostat",
    sourceDataset: "EUROSTAT_COMEXT_DETAIL",
    sourceVintageId: input.sourceVintage.sourceVintageId,
    extractionTimestamp: input.sourceVintage.extractionTimestamp,
    sourceObjectsSha256: input.sourceObjectsSha256,
    sourceMetadataSha256: input.sourceMetadataSha256,
    mappingEvidenceSha256: input.mappingEvidenceSha256,
    partnerMappingVersion: "synthetic-eurostat-partners-v1",
    reporterAllowlist: input.sourceVintage.reporters.map((reporter) => reporter.iso2),
    referenceMonthRange: {
      start: input.sourceVintage.referenceMonths[0]!,
      end: input.sourceVintage.referenceMonths.at(-1)!,
    },
    newestEligibleMonthByReporter: Object.fromEntries(
      input.sourceVintage.reporters.map((reporter) => [
        reporter.iso2,
        input.sourceVintage.eligibleCompleteMonths.at(-1)!,
      ]),
    ),
    artifact: {
      relativePath: ARTIFACT_RELATIVE_PATH,
      bytes: input.artifactIdentity.bytes,
      sha256: input.artifactIdentity.sha256,
    },
    artifactSha256: input.artifactIdentity.sha256,
    rowCounts: input.rowCounts,
    coverage: {
      expectedHistoryMonths: 24,
      shadowVintagesPassed: input.shadowVintagesPassed,
      publicCapabilityActivated: false,
    },
    revisionReportSha256: input.revisionReportSha256,
    conformanceReportSha256: input.conformanceReportSha256,
    capabilities: RECENT_TRADE_MOMENTUM_V1_CAPABILITY_REQUIREMENTS,
    quality: { status: "accepted", reason: null },
    attribution: {
      statement:
        "Source: Eurostat Comext, detailed monthly international trade in goods, synthetic fixture extraction; HS Tracker aggregated source CN codes and mapped eligible products to HS 2012; changes are indicated in source details.",
      license: {
        name: "CC BY 4.0",
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
    supersedesPackageIdentity: input.supersedesPackageIdentity,
  };
}

function reconcileValues(input: {
  sourceIdentifiedValueEur: bigint;
  aggregateIdentifiedValueEur: bigint;
  excludedSpecialValueEur: bigint;
  worldTotalExcludedValueEur: bigint;
}): RecentTradeMomentumReconciliation {
  return {
    sourceIdentifiedValueEur: input.sourceIdentifiedValueEur.toString(),
    aggregateIdentifiedValueEur: input.aggregateIdentifiedValueEur.toString(),
    excludedSpecialValueEur: input.excludedSpecialValueEur.toString(),
    worldTotalExcludedValueEur: input.worldTotalExcludedValueEur.toString(),
  };
}

async function smokeReadOnlyArtifact(artifactPath: string): Promise<boolean> {
  const instance = await DuckDBInstance.create(artifactPath, {
    access_mode: "READ_ONLY",
  });
  try {
    const connection = await instance.connect();
    try {
      const result = await connection.runAndReadAll(`
        SELECT
          (SELECT COUNT(*) FROM momentum) AS momentum_count,
          (SELECT COUNT(*) FROM market_month) AS market_month_count
      `);
      const row = result.getRowObjectsJson()[0] as Record<string, unknown> | undefined;
      return row !== undefined && row.momentum_count !== "0" && row.market_month_count !== "0";
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

function evaluateRecentTradeMomentumRetentionGate(artifactBytes: number): { fits: boolean } {
  const requiredFreeBytes = artifactBytes * 3 + Math.ceil(DECLARED_SERVING_VOLUME_BYTES * MINIMUM_FREE_FRACTION);
  return { fits: requiredFreeBytes <= DECLARED_SERVING_VOLUME_BYTES };
}

function sourceObjectIdentities(sourceObjects: readonly RecentTradeMomentumSourceObject[]): {
  objects: readonly { objectId: string; url: string; bytes: number; sha256: string }[];
  collectionSha256: string;
} {
  const objects = sourceObjects
    .map((object) => ({
      objectId: object.objectId,
      url: object.url,
      bytes: Buffer.byteLength(object.content, "utf8"),
      sha256: sha256Text(object.content),
    }))
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  return { objects, collectionSha256: sha256Json(objects) };
}

function assertUniqueSourceRows(rows: readonly StagedSourceRow[]): void {
  const keys = rows.map(sourceRevisionKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Source-grain rows must be unique.");
  }
}

function assertUniqueMarketMonths(rows: readonly MarketMonthArtifactRow[]): void {
  const keys = rows.map((row) => marketKey(row.referenceMonth, row.reporterIso2, row.hs12Code));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Market-month rows must be unique.");
  }
}

function marketKey(referenceMonth: string, reporterIso2: string, hs12Code: string): string {
  return `${referenceMonth}|${reporterIso2}|${hs12Code}`;
}

function momentumKey(row: MomentumArtifactRow): string {
  return `${row.reporterIso2}|${row.hs12Code}`;
}

function sourceRevisionKey(row: RecentTradeMomentumSourceRow): string {
  return [
    row.referenceMonth,
    row.reporterSourceCode,
    row.partnerSourceCode,
    row.flow,
    row.cnEditionYear,
    row.cn8Code,
    row.sourceSpecialCode,
  ].join("|");
}

function compareSourceRows(
  left: RecentTradeMomentumSourceRow,
  right: RecentTradeMomentumSourceRow,
): number {
  return sourceRevisionKey(left).localeCompare(sourceRevisionKey(right));
}

function mappingChain(
  report: CnToHs12MappingReport,
  cnEditionYear: number,
  cn8Code: string,
): "DIRECT_EXACT" | "MULTI_STEP_EXACT" {
  const row = report.rowMappings.find(
    (entry) => entry.cnEditionYear === cnEditionYear && entry.cn8Code === cn8Code,
  );
  return row?.chain === "MULTI_STEP_EXACT" ? "MULTI_STEP_EXACT" : "DIRECT_EXACT";
}

function editionsForHistory(months: readonly string[]): number[] {
  return [...new Set(months.map((month) => Number(month.slice(0, 4))))]
    .filter((year) => year >= 2025)
    .sort((left, right) => left - right);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function nullableSqlString(value: string | null): string {
  return value === null ? "NULL" : sqlString(value);
}

function nullableSqlNumber(value: string | null): string {
  return value === null ? "NULL" : value;
}

async function fileIdentity(path: string): Promise<{ bytes: number; sha256: string }> {
  const metadata = await stat(path);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return { bytes: metadata.size, sha256: digest.digest("hex") };
}

function sha256Json(value: unknown): string {
  return sha256Bytes(jsonBytes(value));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}
