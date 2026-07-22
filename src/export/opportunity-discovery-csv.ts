import type { MarketInvestigationCandidate } from "../domain/opportunity-discovery/result";
import { marketInvestigationCandidateKey } from "../domain/opportunity-discovery/candidate-identity";
import type { OpportunityDiscoveryV1Payload } from "../domain/trade-analytics/opportunity-discovery-v1-adapter";
import { encodeCsvRecord, protectHumanText } from "./csv-grammar";

export const OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION =
  "opportunity-discovery-csv-v1";

export type OpportunityExportScope = "cross-product" | "portfolio";

const COLUMNS = [
  "export_schema_version",
  "scope_mode",
  "canonical_rank",
  "analysis_identity",
  "dataset_package_identity",
  "analysis_build_id",
  "exporter_code_baci",
  "exporter_name_en",
  "exporter_iso3",
  "hs_revision",
  "product_code",
  "product_description_en",
  "market_code_baci",
  "market_name_en",
  "market_iso3",
  "investigation_priority",
  "market_attractiveness",
  "exporter_fit",
  "opportunity_type",
  "bilateral_flow_state",
  "observed_market_years",
  "missing_market_years",
  "confidence_score",
  "confidence_label",
  "confidence_deductions",
  "evidence_flags",
  "competition_rank",
  "competition_rank_tie_size",
  "baci_release",
  "source_update_date",
  "finalized_cutoff_year",
  "score_window_start",
  "score_window_end",
  "provisional_year",
  "recipe_version",
  "artifact_build_id",
  "artifact_schema_version",
  "artifact_sha256",
  "value_unit",
  "discovery_disclaimer",
] as const;

type Column = (typeof COLUMNS)[number];

export type OpportunityCsvRepresentation = {
  schemaVersion: typeof OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION;
  filename: string;
  rowCount: number;
  bytes: Uint8Array<ArrayBuffer>;
};

export function serializeOpportunityDiscoveryCsv({
  page,
  candidateKeys,
  scope,
}: {
  page: OpportunityDiscoveryV1Payload;
  candidateKeys: readonly string[] | null;
  scope: OpportunityExportScope;
}): OpportunityCsvRepresentation {
  if (
    page.page.nextCursor !== null ||
    page.candidates.length !== page.cohortSize ||
    page.page.returnedCount !== page.cohortSize
  ) {
    throw new TypeError(
      "Opportunity CSV requires the complete underlying candidate cohort.",
    );
  }

  const selectedKeys =
    candidateKeys === null ? null : new Set(candidateKeys);
  if (
    candidateKeys !== null &&
    selectedKeys !== null &&
    selectedKeys.size !== candidateKeys.length
  ) {
    throw new TypeError("Opportunity CSV candidate selection repeats a row.");
  }
  const rows = page.candidates.flatMap((candidate, index) =>
    selectedKeys === null ||
    selectedKeys.has(marketInvestigationCandidateKey(candidate))
      ? [{ candidate, canonicalRank: index + 1 }]
      : [],
  );
  if (selectedKeys !== null && rows.length !== selectedKeys.size) {
    throw new TypeError(
      "Opportunity CSV candidate selection is outside the complete cohort.",
    );
  }

  const escapedColumns = new Set<Column>();
  const records = [
    encodeCsvRecord(COLUMNS),
    ...rows.map(({ candidate, canonicalRank }) =>
      encodeCsvRecord(
        createRow(
          page,
          candidate,
          canonicalRank,
          scope,
          escapedColumns,
        ),
      ),
    ),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  return {
    schemaVersion: OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION,
    filename: [
      "hs-tracker_opportunities_",
      scope,
      "_from-",
      page.exporter.code,
      "_",
      safeFilenameSegment(page.analysisBuildId),
      ".csv",
    ].join(""),
    rowCount: rows.length,
    bytes,
  };
}

function createRow(
  page: OpportunityDiscoveryV1Payload,
  candidate: MarketInvestigationCandidate,
  canonicalRank: number,
  scope: OpportunityExportScope,
  escapedColumns: Set<Column>,
): string[] {
  const provenance = page.provenance;
  return [
    OPPORTUNITY_DISCOVERY_CSV_SCHEMA_VERSION,
    scope,
    String(canonicalRank),
    page.analysisIdentity,
    page.datasetPackageIdentity,
    page.analysisBuildId,
    page.exporter.code,
    protectedHumanCell(page.exporter.name, "exporter_name_en", escapedColumns),
    page.exporter.iso3 ?? "",
    candidate.product.hsRevision,
    candidate.product.code,
    protectedHumanCell(
      candidate.product.descriptionEn,
      "product_description_en",
      escapedColumns,
    ),
    candidate.market.code,
    protectedHumanCell(
      candidate.market.name,
      "market_name_en",
      escapedColumns,
    ),
    candidate.market.iso3 ?? "",
    String(candidate.investigationPriority.display),
    String(candidate.marketAttractiveness.display),
    String(candidate.exporterFit.display),
    candidate.opportunityType,
    candidate.bilateralFlowState,
    candidate.observedMarketYears.join("|"),
    candidate.missingMarketYears.join("|"),
    String(candidate.confidence.score),
    candidate.confidence.label,
    candidate.confidence.deductions
      .map((deduction) => `${deduction.code}:${deduction.points}`)
      .join("|"),
    candidate.evidenceFlags.join("|"),
    String(candidate.competitionRank),
    String(candidate.competitionRankTieSize),
    provenance.baciRelease,
    provenance.sourceUpdateDate,
    String(provenance.finalizedCutoffYear),
    String(provenance.scoreWindow.start),
    String(provenance.scoreWindow.end),
    String(provenance.provisionalYear),
    provenance.recipeVersion,
    provenance.artifactBuildId,
    provenance.artifactSchemaVersion,
    provenance.artifactSha256,
    provenance.valueUnit,
    protectedHumanCell(
      page.discoveryDisclaimer,
      "discovery_disclaimer",
      escapedColumns,
    ),
  ];
}

function protectedHumanCell(
  value: string,
  column: Column,
  escapedColumns: Set<Column>,
): string {
  return protectHumanText(value, column, escapedColumns);
}

function safeFilenameSegment(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/gu, "-");
  return safe.length === 0 ? "analysis" : safe;
}
