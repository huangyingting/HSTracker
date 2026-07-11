import { describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureCandidateMarketAnalysis } from "../../src/evidence/fixture-trade-evidence-source";
import {
  CANDIDATE_MARKETS_CSV_COLUMNS,
  CandidateMarketCsvRepresentationError,
  serializeCandidateMarketCsv,
} from "../../src/export/candidate-market-csv";
import {
  FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
  FIXTURE_CURRENT_AS_OF,
  FIXTURE_SOURCE_STATUS_SNAPSHOT,
} from "../../src/release/fixture-current-analysis";
import { resolveCurrentAnalysisManifest } from "../../src/domain/release/current-analysis";
import type { CandidateReleaseRevision } from "../../src/domain/release/release-revision";

const EXPECTED_COLUMNS = [
  "row_type",
  "export_schema_version",
  "export_id",
  "empty_reason",
  "exporter_name_en",
  "exporter_code_baci",
  "exporter_iso3",
  "hs_revision",
  "product_code",
  "product_description_en",
  "product_description_zh_hans",
  "product_translation_status",
  "product_translation_attribution",
  "candidate_market_name_en",
  "candidate_market_code_baci",
  "candidate_market_iso3",
  "candidate_market_identity_note",
  "rank",
  "rank_tie_size",
  "rank_percentile",
  "cohort_size",
  "candidate_market_score",
  "data_confidence_label",
  "data_confidence_score",
  "observed_score_year_count",
  "observed_score_years",
  "missing_score_years",
  "latest_finalized_observed_year",
  "finalized_cutoff_year",
  "score_window_start",
  "score_window_end",
  "score_formula",
  "market_size_state",
  "market_size_mean_current_usd",
  "market_size_percentile",
  "market_growth_state",
  "market_growth_reason_codes",
  "market_growth_annual_rate",
  "market_growth_percentile",
  "recorded_foothold_state",
  "recorded_foothold_share",
  "bilateral_flow_state",
  "recorded_foothold_percentile",
  "supplier_diversity_state",
  "supplier_diversity_reason_code",
  "supplier_diversity_index",
  "supplier_diversity_years_used",
  "supplier_diversity_percentile",
  "confidence_deductions",
  "sparse_evidence_cap_applied",
  "quantity_coverage_rate",
  "stability_3y_window_start",
  "stability_3y_window_end",
  "stability_3y_state",
  "stability_3y_spearman",
  "stability_10y_window_start",
  "stability_10y_window_end",
  "stability_10y_state",
  "stability_10y_spearman",
  "product_series_discontinuity_years",
  "caveat_codes",
  "caveat_text",
  "provisional_year",
  "provisional_state",
  "provisional_market_import_current_usd",
  "provisional_bilateral_current_usd",
  "provisional_bilateral_state",
  "provisional_recorded_bilateral_share",
  "provisional_quantity_coverage_rate",
  "revision_comparison_release",
  "release_revision_state",
  "previous_release_recomputed_score",
  "score_change",
  "previous_release_recomputed_rank_percentile",
  "rank_percentile_change",
  "release_revision_material_change",
  "release_revision_not_compared_reason",
  "release_revision_no_longer_eligible_count",
  "previous_artifact_sha256",
  "baci_release",
  "source_update_date",
  "ingested_year_start",
  "ingested_year_end",
  "score_version",
  "analysis_id",
  "analysis_build_id",
  "analysis_release_catalog_sha256",
  "product_search_build_id",
  "source_status_snapshot_id",
  "freshness_status_id",
  "freshness_state",
  "freshness_checked_at",
  "freshness_effective_at",
  "served_baci_release",
  "latest_known_baci_release",
  "artifact_build_id",
  "artifact_schema_version",
  "artifact_built_at",
  "artifact_sha256",
  "source_attribution",
  "source_documentation_url",
  "source_license",
  "source_license_url",
  "discovery_disclaimer",
  "formula_escaped_columns",
] as const;

describe("candidate-markets-csv-v1 serializer", () => {
  it("serializes the complete bilingual cohort with fixed framing and order", async () => {
    const input = await fixtureExportInput("010121");

    const exported = serializeCandidateMarketCsv(input);
    const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      exported.bytes,
    );
    const records = parseQuotedCsv(decoded);
    const byColumn = Object.fromEntries(
      records[0]!.map((column, index) => [column, index]),
    );

    expect(CANDIDATE_MARKETS_CSV_COLUMNS).toEqual(EXPECTED_COLUMNS);
    expect(exported.bytes.slice(0, 3)).toEqual(
      Uint8Array.from([0xef, 0xbb, 0xbf]),
    );
    expect(decoded.endsWith("\r\n")).toBe(true);
    expect(decoded.replaceAll("\r\n", "")).not.toContain("\n");
    expect(records).toHaveLength(14);
    expect(records.every((record) => record.length === 105)).toBe(true);
    expect(records[0]).toEqual(EXPECTED_COLUMNS);

    const first = records[1]!;
    expect(first[byColumn.row_type]).toBe("CANDIDATE");
    expect(first[byColumn.product_code]).toBe("010121");
    expect(first[byColumn.product_description_en]).toBe(
      "Horses: live, pure-bred breeding animals",
    );
    expect(first[byColumn.product_description_zh_hans]).toBe("纯种繁殖用活马");
    expect(first[byColumn.candidate_market_code_baci]).toBe("528");
    expect(first[byColumn.candidate_market_name_en]).toBe("Netherlands");
    expect(first[byColumn.rank]).toBe("1");
    expect(first[byColumn.cohort_size]).toBe("13");

    const tieRows = records
      .slice(1)
      .filter((record) => record[byColumn.rank] === "5");
    expect(
      tieRows.map((record) => record[byColumn.candidate_market_code_baci]),
    ).toEqual(["124", "392"]);
    expect(new Set(records.slice(1).map((record) => record[byColumn.export_id])))
      .toEqual(new Set([exported.exportId]));
    expect(exported.sha256).toBe(
      "128c0696b800ed2cb685cb4d0a8a29df9a4441a5db029380e36a4d9276c309b3",
    );
    await expect(decoded).toMatchFileSnapshot(
      "../../test/fixtures/acceptance/v1/expected/candidate-markets-core.csv",
    );
  });

  it("keeps an empty analysis attributable in one explicit data row", async () => {
    const exported = serializeCandidateMarketCsv(
      await fixtureExportInput("851712"),
    );
    const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      exported.bytes,
    );
    const [header, empty] = parseQuotedCsv(decoded);
    const row = recordObject(header!, empty!);

    expect(row).toMatchObject({
      row_type: "EMPTY_ANALYSIS",
      empty_reason: "NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW",
      exporter_code_baci: "156",
      hs_revision: "HS12",
      product_code: "851712",
      product_description_zh_hans: "蜂窝网络或其他无线网络用电话机",
      cohort_size: "0",
      score_window_start: "2019",
      score_window_end: "2023",
      provisional_year: "2024",
      baci_release: "V202601",
      analysis_build_id: "acceptance-fixtures-v1",
      freshness_state: "LATEST_KNOWN",
    });
    expect(row.candidate_market_code_baci).toBe("");
    expect(row.candidate_market_score).toBe("");
    expect(row.provisional_state).toBe("");
    expect(row.release_revision_state).toBe("");
    expect(exported.sha256).toBe(
      "3e82127c219a6b8af7b0f91ad23de90dd25c03e5fa297f2698dc00a46ee8d5af",
    );
    await expect(decoded).toMatchFileSnapshot(
      "../../test/fixtures/acceptance/v1/expected/candidate-markets-empty.csv",
    );
  });

  it.each([
    "=SUM(\"quoted\")",
    "+command",
    "-command",
    "@command",
    "＝command",
    "＋command",
    "－command",
    "＠command",
    "\u00A0=after-unicode-space",
    "\tleading-tab",
    "\rleading-carriage-return",
    "\nleading-line-feed",
  ])("reversibly protects the formula starter in %j", async (dangerousText) => {
    const input = await fixtureExportInput("010121");
    const mutated = withProductDescription(input, dangerousText);

    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeCandidateMarketCsv(mutated).bytes),
    );
    const row = recordObject(records[0]!, records[1]!);

    expect(row.product_description_en).toBe(`'${dangerousText}`);
    expect(row.formula_escaped_columns).toBe("product_description_en");
    expect(row.product_description_en.slice(1)).toBe(dangerousText);
  });

  it("sorts the reversible formula manifest and leaves negative numbers numeric", async () => {
    const input = await fixtureExportInput("010121");
    const mutated = withProductDescription(
      {
        ...input,
        result: {
          ...input.result,
          query: {
            ...input.result.query,
            exporter: {
              ...input.result.query.exporter,
              name: "@formula exporter",
            },
          },
        },
      },
      "=formula product",
    );
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeCandidateMarketCsv(mutated).bytes),
    );
    const rows = records
      .slice(1)
      .map((record) => recordObject(records[0]!, record));
    const negativeGrowth = rows.find((row) =>
      row.market_growth_annual_rate.startsWith("-"),
    );

    expect(rows[0]!.formula_escaped_columns).toBe(
      "exporter_name_en|product_description_en",
    );
    expect(negativeGrowth).toBeDefined();
    expect(negativeGrowth!.formula_escaped_columns).not.toContain(
      "market_growth_annual_rate",
    );
  });

  it("represents an accepted translation fallback and rounds current USD half up", async () => {
    const input = await fixtureExportInput("010121");
    const first = input.result.candidates[0]!;
    const mutated = {
      ...input,
      product: {
        ...input.product,
        translationStatus: "fallback-english" as const,
      },
      result: {
        ...input.result,
        candidates: [
          {
            ...first,
            components: {
              ...first.components,
              marketSize: {
                ...first.components.marketSize,
                meanCurrentUsd: "12.5",
              },
            },
            provisionalEvidence: {
              ...first.provisionalEvidence,
              marketImportCurrentUsd: "2.5",
              bilateralCurrentUsd: "1.49",
            },
          },
          ...input.result.candidates.slice(1),
        ],
      },
    };
    const records = parseQuotedCsv(
      new TextDecoder().decode(serializeCandidateMarketCsv(mutated).bytes),
    );
    const row = recordObject(records[0]!, records[1]!);

    expect(row.product_description_zh_hans).toBe(
      "Horses: live, pure-bred breeding animals",
    );
    expect(row.product_translation_status).toBe("FALLBACK_ENGLISH");
    expect(row.market_size_mean_current_usd).toBe("13");
    expect(row.provisional_market_import_current_usd).toBe("3");
    expect(row.provisional_bilateral_current_usd).toBe("1");
  });

  it.each([
    "\u0000nul",
    "\u007fdel",
    "\u0001control",
    "embedded\tcontrol",
    "embedded\rcontrol",
    "embedded\ncontrol",
  ])("fails closed for forbidden human-text control %j", async (invalidText) => {
    const input = await fixtureExportInput("010121");

    expect(() =>
      serializeCandidateMarketCsv(withProductDescription(input, invalidText)),
    ).toThrow(/forbidden control character/u);
  });

  it("binds deterministic bytes to freshness and product-catalog identities", async () => {
    const input = await fixtureExportInput("010121");
    const repeated = serializeCandidateMarketCsv(input);
    const reordered = serializeCandidateMarketCsv({
      ...input,
      result: {
        ...input.result,
        candidates: [...input.result.candidates].reverse(),
      },
    });
    expect(reordered).toEqual(repeated);

    const originalTimezone = process.env.TZ;
    const originalLanguage = process.env.LANG;
    let alternateEnvironment:
      | ReturnType<typeof serializeCandidateMarketCsv>
      | undefined;
    try {
      process.env.TZ = "Pacific/Auckland";
      process.env.LANG = "zh_CN.UTF-8";
      alternateEnvironment = serializeCandidateMarketCsv(input);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
      if (originalLanguage === undefined) {
        delete process.env.LANG;
      } else {
        process.env.LANG = originalLanguage;
      }
    }
    expect(alternateEnvironment).toEqual(repeated);

    const freshnessMutation = serializeCandidateMarketCsv({
      ...input,
      manifest: {
        ...input.manifest,
        freshness: {
          ...input.manifest.freshness,
          freshnessStatusId: `${input.manifest.freshness.freshnessStatusId}-next`,
        },
      },
    });
    expect(freshnessMutation.exportId).not.toBe(repeated.exportId);
    expect(freshnessMutation.filename).not.toBe(repeated.filename);
    expect(freshnessMutation.sha256).not.toBe(repeated.sha256);
    expect(changedColumns(repeated.bytes, freshnessMutation.bytes)).toEqual([
      "export_id",
      "freshness_status_id",
    ]);

    const catalogMutation = serializeCandidateMarketCsv({
      ...input,
      product: {
        ...input.product,
        auxiliaryDescriptionZhHans: "目录修订后的纯种繁殖用活马",
      },
      manifest: {
        ...input.manifest,
        productSearchBuildId: "acceptance-product-search-v2",
      },
    });
    expect(catalogMutation.exportId).not.toBe(repeated.exportId);
    expect(catalogMutation.filename).not.toBe(repeated.filename);
    expect(catalogMutation.sha256).not.toBe(repeated.sha256);
    expect(changedColumns(repeated.bytes, catalogMutation.bytes)).toEqual([
      "export_id",
      "product_description_zh_hans",
      "product_search_build_id",
    ]);
  });

  it("rejects incompatible context and representation overflow", async () => {
    const input = await fixtureExportInput("010121");
    expect(() =>
      serializeCandidateMarketCsv({
        ...input,
        manifest: {
          ...input.manifest,
          source: {
            ...input.manifest.source,
            baciRelease: "V202602",
          },
        },
      }),
    ).toThrow(/incompatible BACI Release binding/u);

    const candidates = Array.from(
      { length: 251 },
      (_, index) => ({
        ...input.result.candidates[0]!,
        economy: {
          ...input.result.candidates[0]!.economy,
          code: String(index + 1),
        },
      }),
    );
    expect(() =>
      serializeCandidateMarketCsv({
        ...input,
        result: {
          ...input.result,
          cohortSize: candidates.length,
          candidates,
        },
      }),
    ).toThrow(CandidateMarketCsvRepresentationError);

    const emptyInput = await fixtureExportInput("851712");
    const oversizedText = "x".repeat(5 * 1024 * 1024);
    expect(() =>
      serializeCandidateMarketCsv(
        withProductDescription(emptyInput, oversizedText),
      ),
    ).toThrow(CandidateMarketCsvRepresentationError);
  });

  it("preserves audited missingness, provisional, stability, and identity evidence", async () => {
    const exported = serializeCandidateMarketCsv(
      await fixtureExportInput("010121"),
    );
    const records = parseQuotedCsv(new TextDecoder().decode(exported.bytes));
    const rows = records
      .slice(1)
      .map((record) => recordObject(records[0]!, record));
    const byCode = new Map(
      rows.map((row) => [row.candidate_market_code_baci, row]),
    );

    expect(byCode.get("484")).toMatchObject({
      market_size_mean_current_usd: "9000000",
      market_growth_annual_rate: "0.057335",
      recorded_foothold_share: "0.200000",
      supplier_diversity_index: "0.933333",
      quantity_coverage_rate: "0.880000",
      provisional_market_import_current_usd: "11000000",
      provisional_bilateral_current_usd: "2200000",
      provisional_recorded_bilateral_share: "0.200000",
      provisional_quantity_coverage_rate: "0.800000",
      stability_3y_state: "NOT_FLAGGED",
      stability_3y_spearman: "0.954842",
      stability_10y_state: "NOT_FLAGGED",
      stability_10y_spearman: "0.994681",
    });
    expect(byCode.get("699")).toMatchObject({
      recorded_foothold_share: "0.000000",
      bilateral_flow_state: "NO_RECORDED_POSITIVE_FLOW",
      provisional_state: "RECORDED",
      provisional_bilateral_state: "NO_RECORDED_POSITIVE_FLOW",
      provisional_bilateral_current_usd: "",
      provisional_recorded_bilateral_share: "",
      caveat_codes: "NO_RECORDED_POSITIVE_FLOW",
      caveat_text: "No recorded bilateral flow in the score window.",
    });
    expect(byCode.get("710")).toMatchObject({
      market_growth_state: "NEUTRAL",
      market_growth_reason_codes: "INSUFFICIENT_OBSERVED_YEARS",
      market_growth_annual_rate: "",
      market_growth_percentile: "50",
      supplier_diversity_state: "NEUTRAL",
      supplier_diversity_reason_code:
        "NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR",
      supplier_diversity_index: "",
      confidence_deductions:
        "MISSING_SCORE_WINDOW_YEARS=30|UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE=10",
      sparse_evidence_cap_applied: "true",
      provisional_state: "NO_RECORDED_POSITIVE_FLOW",
      provisional_bilateral_state: "NOT_APPLICABLE",
    });
    expect(byCode.get("404")!.market_growth_reason_codes).toBe(
      "INSUFFICIENT_OBSERVED_YEARS|BELOW_MATERIALITY_THRESHOLD",
    );
    expect(byCode.get("490")).toMatchObject({
      candidate_market_iso3: "",
      candidate_market_identity_note:
        "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
      confidence_deductions: "IDENTITY_PROXY=10",
      caveat_codes: "IDENTITY_PROXY",
    });
    expect(rows[0]).toMatchObject({
      analysis_release_catalog_sha256:
        "3b1ff899c301d11a2bb5c29e3040e9261a68633b54a7d94f4b15338129d4fcff",
      artifact_built_at: "2026-01-23T00:00:00Z",
      artifact_sha256:
        "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
      source_attribution:
        "Source: CEPII BACI, HS 2012, V202601 (updated 2026-01-22), Etalab Open Licence 2.0.",
    });
  });

  it.each([
    {
      state: "BELOW_THRESHOLD",
      previousReleaseRecomputedScore: 82,
      scoreChange: 3,
      previousReleaseRecomputedRankPercentile: "95.000",
      rankPercentileChange: "5.000",
      materialChange: false,
    },
    {
      state: "MATERIAL_CHANGE",
      previousReleaseRecomputedScore: 70,
      scoreChange: 15,
      previousReleaseRecomputedRankPercentile: "80.000",
      rankPercentileChange: "20.000",
      materialChange: true,
    },
    {
      state: "NEWLY_ELIGIBLE",
      previousReleaseRecomputedScore: null,
      scoreChange: null,
      previousReleaseRecomputedRankPercentile: null,
      rankPercentileChange: null,
      materialChange: null,
    },
  ] satisfies readonly CandidateReleaseRevision[])(
    "serializes $state Release Revision evidence",
    async (revision) => {
      const input = await fixtureExportInput("010121");
      const previousArtifactSha256 = "a".repeat(64);
      const fallbackRevision: CandidateReleaseRevision = {
        state: "BELOW_THRESHOLD",
        previousReleaseRecomputedScore: 80,
        scoreChange: 1,
        previousReleaseRecomputedRankPercentile: "90.000",
        rankPercentileChange: "1.000",
        materialChange: false,
      };
      const mutated = {
        ...input,
        result: {
          ...input.result,
          releaseRevisionSummary: {
            comparisonRelease: "V202501",
            previousArtifactSha256,
            notComparedReason: null,
            noLongerEligibleCount: 2,
          },
          candidates: input.result.candidates.map((candidate, index) => ({
            ...candidate,
            releaseRevision: index === 0 ? revision : fallbackRevision,
          })),
        },
        manifest: {
          ...input.manifest,
          revisionComparison: {
            comparisonRelease: "V202501",
            previousArtifactSha256,
            notComparedReason: null,
          },
        },
      };
      const records = parseQuotedCsv(
        new TextDecoder().decode(serializeCandidateMarketCsv(mutated).bytes),
      );
      const row = recordObject(records[0]!, records[1]!);

      expect(row).toMatchObject({
        revision_comparison_release: "V202501",
        release_revision_state: revision.state,
        previous_release_recomputed_score:
          revision.previousReleaseRecomputedScore === null
            ? ""
            : String(revision.previousReleaseRecomputedScore),
        score_change:
          revision.scoreChange === null ? "" : String(revision.scoreChange),
        previous_release_recomputed_rank_percentile:
          revision.previousReleaseRecomputedRankPercentile ?? "",
        rank_percentile_change: revision.rankPercentileChange ?? "",
        release_revision_material_change:
          revision.materialChange === null
            ? ""
            : String(revision.materialChange),
        release_revision_not_compared_reason: "",
        release_revision_no_longer_eligible_count: "2",
        previous_artifact_sha256: previousArtifactSha256,
      });
    },
  );

  it.each([
    {
      reason: "NO_PREVIOUS_ARTIFACT",
      comparisonRelease: null,
      previousArtifactSha256: null,
    },
    {
      reason: "NO_COMPATIBLE_PREVIOUS_ARTIFACT",
      comparisonRelease: null,
      previousArtifactSha256: null,
    },
    {
      reason: "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW",
      comparisonRelease: "V202501",
      previousArtifactSha256: "b".repeat(64),
    },
  ] as const)(
    "serializes the $reason not-compared identity",
    async ({ reason, comparisonRelease, previousArtifactSha256 }) => {
      const input = await fixtureExportInput("010121");
      const comparison = {
        comparisonRelease,
        previousArtifactSha256,
        notComparedReason: reason,
      };
      const mutated = {
        ...input,
        result: {
          ...input.result,
          releaseRevisionSummary: {
            ...comparison,
            noLongerEligibleCount: null,
          },
        },
        manifest: {
          ...input.manifest,
          revisionComparison: comparison,
        },
      };
      const records = parseQuotedCsv(
        new TextDecoder().decode(serializeCandidateMarketCsv(mutated).bytes),
      );
      const row = recordObject(records[0]!, records[1]!);

      expect(row).toMatchObject({
        revision_comparison_release: comparisonRelease ?? "",
        release_revision_state: "NOT_COMPARED",
        previous_release_recomputed_score: "",
        score_change: "",
        previous_release_recomputed_rank_percentile: "",
        rank_percentile_change: "",
        release_revision_material_change: "",
        release_revision_not_compared_reason: reason,
        release_revision_no_longer_eligible_count: "",
        previous_artifact_sha256: previousArtifactSha256 ?? "",
      });
    },
  );
});

async function fixtureExportInput(productCode: string) {
  const result = await createFixtureCandidateMarketAnalysis().analyze({
    analysisBuildId: "acceptance-fixtures-v1",
    exporterCode: "156",
    productCode,
  });
  const productSearch = await createFixtureProductCatalog().search({
    productSearchBuildId: "acceptance-product-search-v1",
    query: productCode,
    locale: "en",
    limit: 1,
  });
  const product = productSearch.matches[0]?.product;
  if (product === undefined) {
    throw new Error(`Fixture product ${productCode} is unavailable.`);
  }

  return {
    result,
    product,
    manifest: resolveCurrentAnalysisManifest(
      FIXTURE_CURRENT_ANALYSIS_DEPLOYMENT,
      FIXTURE_SOURCE_STATUS_SNAPSHOT,
      FIXTURE_CURRENT_AS_OF,
    ),
  };
}

function parseQuotedCsv(csvWithBom: string): string[][] {
  const csv = csvWithBom.startsWith("\uFEFF")
    ? csvWithBom.slice(1)
    : csvWithBom;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let index = 0;

  while (index < csv.length) {
    if (csv[index] !== '"') {
      throw new Error(`Expected an opening quote at byte ${index}.`);
    }
    index += 1;
    cell = "";
    while (index < csv.length) {
      if (csv[index] !== '"') {
        cell += csv[index];
        index += 1;
        continue;
      }
      if (csv[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    record.push(cell);
    if (csv[index] === ",") {
      index += 1;
      continue;
    }
    if (csv.slice(index, index + 2) !== "\r\n") {
      throw new Error(`Expected CRLF at byte ${index}.`);
    }
    records.push(record);
    record = [];
    index += 2;
  }
  return records;
}

function recordObject(
  header: readonly string[],
  record: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    header.map((column, index) => [column, record[index]!]),
  );
}

function withProductDescription(
  input: Awaited<ReturnType<typeof fixtureExportInput>>,
  descriptionEn: string,
) {
  return {
    ...input,
    product: {
      ...input.product,
      sourceDescriptionEn: descriptionEn,
    },
    result: {
      ...input.result,
      query: {
        ...input.result.query,
        product: {
          ...input.result.query.product,
          descriptionEn,
        },
      },
    },
  };
}

function changedColumns(
  originalBytes: Uint8Array,
  mutatedBytes: Uint8Array,
): string[] {
  const original = parseQuotedCsv(
    new TextDecoder().decode(originalBytes),
  );
  const mutated = parseQuotedCsv(
    new TextDecoder().decode(mutatedBytes),
  );
  const originalRow = recordObject(original[0]!, original[1]!);
  const mutatedRow = recordObject(mutated[0]!, mutated[1]!);
  return original[0]!.filter(
    (column) => originalRow[column] !== mutatedRow[column],
  );
}
