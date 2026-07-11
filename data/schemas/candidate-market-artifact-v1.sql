CREATE TABLE product (
  product_id USMALLINT NOT NULL,
  hs12_code VARCHAR NOT NULL,
  source_description VARCHAR NOT NULL
);

CREATE TABLE economy (
  code USMALLINT NOT NULL,
  display_name VARCHAR NOT NULL,
  iso2 VARCHAR,
  iso3 VARCHAR,
  kind VARCHAR NOT NULL,
  is_taiwan_proxy BOOLEAN NOT NULL,
  identity_note VARCHAR,
  has_trade_evidence BOOLEAN NOT NULL
);

CREATE TABLE bilateral_year (
  year USMALLINT NOT NULL,
  product_id USMALLINT NOT NULL,
  exporter_code USMALLINT NOT NULL,
  importer_code USMALLINT NOT NULL,
  value_kusd DECIMAL(38,3) NOT NULL
);

CREATE TABLE market_year (
  year USMALLINT NOT NULL,
  product_id USMALLINT NOT NULL,
  importer_code USMALLINT NOT NULL,
  world_value_kusd DECIMAL(38,3) NOT NULL,
  supplier_count USMALLINT NOT NULL,
  supplier_value_square_sum DECIMAL(38,6) NOT NULL,
  source_flow_count USMALLINT NOT NULL,
  quantity_present_count USMALLINT NOT NULL,
  quantity_sum_tons DECIMAL(38,3)
);

CREATE TABLE product_year (
  year USMALLINT NOT NULL,
  product_id USMALLINT NOT NULL,
  world_value_kusd DECIMAL(38,3) NOT NULL
);

CREATE TABLE artifact_metadata (
  key VARCHAR NOT NULL,
  value VARCHAR NOT NULL
);
