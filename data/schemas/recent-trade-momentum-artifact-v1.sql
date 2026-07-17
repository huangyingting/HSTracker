CREATE TABLE reporter (
  reporter_id INTEGER PRIMARY KEY,
  source_code VARCHAR NOT NULL,
  iso2 VARCHAR NOT NULL,
  iso3 VARCHAR NOT NULL,
  display_name VARCHAR NOT NULL,
  valid_from VARCHAR NOT NULL,
  valid_to VARCHAR
);

CREATE TABLE partner (
  partner_id INTEGER PRIMARY KEY,
  source_code VARCHAR NOT NULL,
  iso2 VARCHAR,
  iso3 VARCHAR,
  kind VARCHAR NOT NULL,
  valid_from VARCHAR NOT NULL,
  valid_to VARCHAR
);

CREATE TABLE product_mapping (
  cn_edition_year INTEGER NOT NULL,
  cn8_code VARCHAR NOT NULL,
  hs12_code VARCHAR NOT NULL,
  mapping_status VARCHAR NOT NULL,
  correspondence_sha256 VARCHAR NOT NULL,
  review_id VARCHAR NOT NULL,
  PRIMARY KEY (cn_edition_year, cn8_code, hs12_code)
);

CREATE TABLE market_month (
  reference_month VARCHAR NOT NULL,
  reporter_id INTEGER NOT NULL,
  hs12_code VARCHAR NOT NULL,
  value_eur BIGINT,
  contributing_partner_count INTEGER NOT NULL,
  contributing_cn8_count INTEGER NOT NULL,
  excluded_special_value_eur BIGINT NOT NULL,
  observation_state VARCHAR NOT NULL,
  update_state VARCHAR NOT NULL,
  PRIMARY KEY (reference_month, reporter_id, hs12_code)
);

CREATE TABLE momentum (
  reporter_id INTEGER NOT NULL,
  reporter_iso2 VARCHAR NOT NULL,
  hs12_code VARCHAR NOT NULL,
  cutoff_month VARCHAR NOT NULL,
  recent_value_eur BIGINT,
  baseline_value_eur BIGINT,
  growth_rate_decimal VARCHAR,
  growth_percent_display VARCHAR,
  signal_state VARCHAR,
  coverage_state VARCHAR NOT NULL,
  confidence VARCHAR,
  recorded_history_months INTEGER NOT NULL,
  expected_history_months INTEGER NOT NULL,
  reason_codes VARCHAR NOT NULL,
  confidence_reasons VARCHAR NOT NULL,
  PRIMARY KEY (reporter_id, hs12_code)
);

CREATE TABLE artifact_metadata (
  key VARCHAR PRIMARY KEY,
  value VARCHAR NOT NULL
);
