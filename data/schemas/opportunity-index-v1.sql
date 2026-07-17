-- Opportunity Index physical schema (index_schema_version = opportunity-index-v1).
--
-- The immutable, compact, derived DuckDB object that persists the complete
-- ordered `opportunity-discovery-v1` cohort for every eligible export economy
-- in one exact Dataset Package. It is defined by
-- docs/research/2026-07-16-cross-product-market-opportunity-recipe.md section 7.
--
-- Per the architecture decision recorded for issue #52, the index persists the
-- full rich Market Investigation feed grain so serving is a pure index read
-- with byte-identical rows: identities, canonical displays/order, the
-- six-decimal unrounded axis/percentile values, component raw values, component
-- states, observed/missing years, confidence, stability, and flags. Only truly
-- derivable data is left out and reconstructed at read time (public copy,
-- wording, confidence labels/deductions, the competition tie size, the
-- drill-down link, and the first-release NOT_COMPARED revision constant).
-- Economy/product labels are still joined from the compatible dimensions and
-- never duplicated here; drill-down detail is computed from the analysis
-- artifact. Storing the rich grain deliberately raises the combined package
-- size past the original 10 GiB gate (see the build module size constants).

-- One row per eligible (exporter_code, product_id, importer_code) tuple in the
-- fixed cohort. Rows are physically written in canonical feed order within
-- exporter (see section 7.2):
--   (exporter_code,
--    priority_display DESC,
--    attractiveness_display DESC,
--    exporter_fit_display DESC,
--    hs12_code ASC,
--    importer_code ASC)
CREATE TABLE opportunity_candidate (
  exporter_code                  USMALLINT NOT NULL,
  product_id                     USMALLINT NOT NULL,
  importer_code                  USMALLINT NOT NULL,
  priority_display               UTINYINT  NOT NULL,
  attractiveness_display         UTINYINT  NOT NULL,
  exporter_fit_display           UTINYINT  NOT NULL,
  market_size_percentile_bp      USMALLINT NOT NULL,
  market_growth_percentile_bp    USMALLINT NOT NULL,
  product_presence_percentile_bp USMALLINT NOT NULL,
  foothold_percentile_bp         USMALLINT NOT NULL,
  competition_rank               UINTEGER  NOT NULL,
  opportunity_type               UTINYINT  NOT NULL,
  confidence_score               UTINYINT  NOT NULL,
  confidence_flags               UINTEGER  NOT NULL,
  evidence_flags                 UINTEGER  NOT NULL,
  -- Rich grain (issue #52). Six-decimal unrounded axis/percentile values are
  -- stored as scaled integers (value*1e6) parsed straight from their fixed
  -- strings so the round trip is exact. Growth is signed and may be large, so
  -- its raw value uses BIGINT micros and is NULL exactly when growth is NEUTRAL.
  priority_raw_micros                 UINTEGER NOT NULL,
  attractiveness_raw_micros           UINTEGER NOT NULL,
  exporter_fit_raw_micros             UINTEGER NOT NULL,
  market_size_percentile_micros       UINTEGER NOT NULL,
  market_growth_percentile_micros     UINTEGER NOT NULL,
  product_presence_percentile_micros  UINTEGER NOT NULL,
  foothold_percentile_micros          UINTEGER NOT NULL,
  market_size_percentile_display      UTINYINT NOT NULL,
  market_growth_percentile_display    UTINYINT NOT NULL,
  product_presence_percentile_display UTINYINT NOT NULL,
  foothold_percentile_display         UTINYINT NOT NULL,
  market_size_raw_value               VARCHAR  NOT NULL,
  market_growth_raw_value_micros      BIGINT,
  product_presence_raw_value_micros   UINTEGER NOT NULL,
  foothold_raw_value_micros           UINTEGER NOT NULL,
  observed_years_mask                 UTINYINT NOT NULL,
  growth_neutral_reasons              UTINYINT NOT NULL,
  stability_three_year_state          UTINYINT NOT NULL,
  stability_ten_year_state            UTINYINT NOT NULL,
  stability_three_year_delta_micros   UINTEGER,
  stability_ten_year_delta_micros     UINTEGER
);

-- Small immutable index metadata (recipe/result/index versions, source and
-- Dataset Package identities, window bounds, build identity, row totals).
CREATE TABLE opportunity_index_metadata (
  key   VARCHAR NOT NULL,
  value VARCHAR NOT NULL
);

-- Per-exporter build statistics used for cohort-completeness reconciliation,
-- benchmark selection, and the accepted build report.
CREATE TABLE opportunity_index_build_stats (
  exporter_code           USMALLINT NOT NULL,
  cohort_rows             UINTEGER  NOT NULL,
  size_pool_count         UINTEGER  NOT NULL,
  growth_pool_count       UINTEGER  NOT NULL,
  presence_pool_count     UINTEGER  NOT NULL,
  foothold_pool_count     UINTEGER  NOT NULL,
  priority_tie_groups     UINTEGER  NOT NULL,
  max_priority_display    UTINYINT  NOT NULL,
  min_priority_display    UTINYINT  NOT NULL,
  gap_rows                UINTEGER  NOT NULL,
  expansion_rows          UINTEGER  NOT NULL,
  general_rows            UINTEGER  NOT NULL
);

-- Enum dictionary for opportunity_candidate.opportunity_type. Values are the
-- section 5 precedence order and are a stable part of the index identity.
CREATE TABLE opportunity_type_dictionary (
  code  UTINYINT NOT NULL,
  label VARCHAR  NOT NULL
);

-- Bit dictionary for opportunity_candidate.confidence_flags. `bit` is the
-- zero-based bit position; the flag is set when a section 6.2 deduction fired.
CREATE TABLE opportunity_confidence_flag_dictionary (
  bit  UTINYINT NOT NULL,
  code VARCHAR  NOT NULL
);

-- Bit dictionary for opportunity_candidate.evidence_flags (section 6.6 / 3.x
-- evidence tags). `bit` is the zero-based bit position.
CREATE TABLE opportunity_evidence_flag_dictionary (
  bit  UTINYINT NOT NULL,
  code VARCHAR  NOT NULL
);

-- Bit dictionary for opportunity_candidate.growth_neutral_reasons (section 4.x
-- Market Growth neutral reasons). `bit` is the zero-based bit position; a bit is
-- set only when Market Growth is NEUTRAL.
CREATE TABLE opportunity_growth_neutral_reason_dictionary (
  bit  UTINYINT NOT NULL,
  code VARCHAR  NOT NULL
);

-- Enum dictionary for the two stability state columns. `code` is the stored
-- UTINYINT; the ordering is a stable part of the index identity.
CREATE TABLE opportunity_stability_state_dictionary (
  code  UTINYINT NOT NULL,
  label VARCHAR  NOT NULL
);
