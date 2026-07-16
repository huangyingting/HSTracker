-- Opportunity Index physical schema (index_schema_version = opportunity-index-v1).
--
-- The immutable, compact, derived DuckDB object that persists the complete
-- ordered `opportunity-discovery-v1` cohort for every eligible export economy
-- in one exact Dataset Package. It is defined by
-- docs/research/2026-07-16-cross-product-market-opportunity-recipe.md section 7.
--
-- The index persists only what is needed to serve and filter a deterministic
-- feed: identities, canonical displays/order, component percentiles, type,
-- confidence, and flags. Economy/product labels, raw annual values, raw
-- indicators, provisional values, and confidence-reason prose are never
-- duplicated here; serving joins those from the compatible dimensions/catalog
-- and computes drill-down evidence from the existing analysis artifact.

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
  evidence_flags                 UINTEGER  NOT NULL
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
