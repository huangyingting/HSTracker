# Decision: Result export contract

**Ticket:** [Define the result export contract](https://github.com/huangyingting/HSTracker/issues/11)  
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)  
**Decided:** 2026-07-11

## Decision

The MVP has one result export: a deterministic CSV containing the complete
eligible Candidate Market cohort for one analysis build, export economy, and
HS Product. It serializes the same `CandidateMarketResult` used by the focused
workspace; it does not recalculate evidence through a separate path.

| Property | Contract |
|---|---|
| Scope | One export economy, one HS12 product, every eligible Candidate Market |
| Row grain | One `CANDIDATE` row per current ranked market |
| Empty result | One `EMPTY_ANALYSIS` row retaining context and provenance |
| Format | One flat CSV; no JSON, XLSX, ZIP, or sidecar |
| Encoding | UTF-8 with BOM |
| Dialect | Comma delimiter, CRLF, every field quoted, final CRLF |
| Language | Stable English headers and labels; English and Simplified Chinese product descriptions |
| Ordering | Competition rank ascending, then numeric BACI economy code ascending |
| Identity | Analysis, query, product-search build, freshness status, and export schema |
| Exclusions | Raw BACI rows, annual or supplier extracts, UI selections, and all company evidence |

This artifact is a **Candidate Market Result Export**: a contextual, derived
result for analyst follow-up. It is not a BACI download, buyer list, or proof of
commercial viability.

## 1. Scope

### Complete cohort, not transient UI state

The CSV always contains the complete eligible cohort returned by:

```ts
CandidateMarketAnalysis.analyze({
  analysisBuildId,
  exporterCode,
  productCode,
})
```

The route does not accept a selected market, comparison shortlist, current
viewport, custom sort, field list, offset, or page. An analyst filters or sorts
the downloaded table locally. This preserves one reproducible export per
analytical query rather than making temporary browser state part of identity.
The original free-text product query, matched alias, interface locale, and
comparison-tray state are discovery interactions, not analytical context, and
are not exported. The canonical selected exporter and HS Product reproduce the
analysis.

The v1 transport permits at most 250 `CANDIDATE` rows and 5 MiB of uncompressed
CSV bytes. The pinned BACI release has only 226 source economy codes, so the
normal complete cohort is below the row guard. The build validates this bound;
the runtime also fails with `503 EXPORT_REPRESENTATION_LIMIT_EXCEEDED` if an
incompatible artifact breaches either guard. It never truncates or paginates an
export.

### Derived evidence only

Permitted values are selected identities, the published `cms-v1` result,
candidate-level aggregates, quality evidence, separately labelled provisional
evidence, Release Revision evidence, and provenance already available to the
public result.

The CSV never contains:

- source rows at BACI grain `(year, exporter, importer, product, value,
  quantity)`;
- an annual market series or supplier-level values, names, counts, or shares;
- arbitrary products, exporters, or analyses in one request;
- a raw archive, bulk extraction route, or public SQL surface;
- a company, party, brand, model, document, shipment, relationship, or
  commercial-provider field.

These limits preserve the dataset decision's derived-result boundary and the
separate entitled plane required by the
[company-data boundary](./2026-07-11-company-level-trade-data-extension-boundaries.md).

## 2. Row model

### Candidate rows

Every eligible current market produces exactly one
`row_type = CANDIDATE` row. Query, source, build, and freshness columns repeat
on every row so any extracted row remains attributable.

### Empty analysis row

A valid query with no eligible markets returns `200` with the normal header and
exactly one `row_type = EMPTY_ANALYSIS` row:

- `empty_reason = NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW`;
- `cohort_size = 0`;
- exporter, product, score-window, source, build, freshness, attribution, and
  disclaimer columns remain populated;
- candidate identity, candidate evidence, score, confidence, provisional
  evidence state/value, and candidate-level revision columns are blank;
- `provisional_year` remains populated as analysis context;
- analysis-level revision metadata may remain populated when a comparison was
  performed.

A header-only file would lose offline context. Treating an honest empty analysis
as an HTTP error would disagree with the public result contract.

## 3. CSV framing

The file uses an RFC 4180-style dialect plus explicit UTF-8:

1. Bytes begin with the UTF-8 BOM `EF BB BF`.
2. The next bytes are one fixed header record.
3. The delimiter is comma.
4. Every field, including headers, numbers, booleans, and empty cells, is
   enclosed in ASCII double quotes.
5. An embedded double quote is doubled.
6. Records end with CRLF, including the final record.
7. Every record has exactly the schema's column count.

The media type is:

```text
text/csv; charset=utf-8; header=present
```

[RFC 4180](https://datatracker.ietf.org/doc/html/rfc4180) documents comma
separation, CRLF records, optional headers, quoted fields, and doubled quotes.
The current [IANA `text/csv`
registration](https://www.iana.org/assignments/media-types/text/csv) defines the
`charset` and `header` parameters and recommends an explicit charset. RFC 4180
does not require a BOM; HS Tracker deliberately adds one because the CSV carries
Chinese text and Microsoft documents BOM-bearing UTF-8 CSV as the direct-open
path for Excel. The accepted cost is that low-level consumers must strip the
standard UTF-8 signature before reading the first header.

The serializer emits stored Unicode text without request-time normalization,
translation, title-casing, or localization. Upstream catalog validation owns
normalization and accepted content.

## 4. Formula-injection protection

[OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
identifies `=`, `+`, `-`, `@`, TAB, CR, LF, and full-width variants such as
`＝`, `＋`, `－`, and `＠` as possible spreadsheet formula starters. Quoting
alone is not sufficient.

HS Tracker uses one centralized, schema-aware serializer:

1. Validate code, enum, date, timestamp, boolean, integer, and decimal cells
   against their declared grammar. These cells are never formula-escaped.
2. For each declared human-text cell, scan past leading Unicode White_Space
   code points other than TAB/CR/LF, which remain triggers, and inspect the next
   code point.
3. If that code point is an OWASP formula starter, prefix one ASCII apostrophe
   to the complete logical value before CSV quoting.
4. Put the exact affected header names in that row's
   `formula_escaped_columns`, sorted alphabetically and separated by `|`.
5. A machine consumer may remove exactly one leading apostrophe only from
   columns named in `formula_escaped_columns`. It must not infer escaping from
   content.

Escapable human-text columns are:

```text
exporter_name_en
product_description_en
product_description_zh_hans
product_translation_attribution
candidate_market_name_en
candidate_market_identity_note
score_formula
caveat_text
source_attribution
discovery_disclaimer
```

All other fields have controlled grammars and cannot carry free text.

NUL, DEL, and C0 control characters other than a leading TAB/CR/LF formula
trigger are rejected. A leading TAB/CR/LF in an escapable cell is allowed only
at the inspected trigger position and is apostrophe-prefixed; TAB/CR/LF
elsewhere is rejected. The serializer never silently removes or replaces a
control character. Reaching this path indicates an upstream catalog or result
defect and returns the normal opaque unexpected-failure response with a logged
correlation ID.

OWASP warns that spreadsheet applications can remove escape characters when a
CSV is saved and reopened. No portable CSV convention eliminates that risk for
every spreadsheet and machine parser. The original immutable download remains
the authoritative artifact; a spreadsheet-resaved copy does not.

## 5. Canonical values

### Null, zero, and state

- Null or not applicable is the empty quoted cell `""`.
- Zero is a numeric value at the declared serialization precision. It never
  means unknown or not recorded.
- A missing BACI row is represented by a state enum and blank raw value unless
  a published derived formula explicitly defines a zero contribution.
- Finalized Recorded Foothold is the exception: when no selected-exporter row
  exists in the score window, its published aggregate numerator is zero,
  `recorded_foothold_share = 0.000000`, and
  `bilateral_flow_state = NO_RECORDED_POSITIVE_FLOW`. That derived share is not
  a claim that real-world trade was exactly zero.
- Provisional evidence has no scoring formula. A missing provisional bilateral
  row therefore leaves value and share blank and carries
  `NO_RECORDED_POSITIVE_FLOW`; it is not converted to numeric zero.

### Scalar formatting

| Kind | Encoding |
|---|---|
| Boolean | `true` or `false` |
| Enum | Uppercase `SNAKE_CASE` |
| Year/count/rank/score | Base-10 integer, no grouping |
| Date | `YYYY-MM-DD` |
| Timestamp | UTC `YYYY-MM-DDTHH:mm:ssZ`, fixed to whole seconds in the immutable manifest |
| Current USD | Base-10 integer, no currency sign or grouping |
| Rate/share/index/Spearman rho | Decimal fraction with exactly six places, no percent sign or exponent |
| Rank percentile and delta | Decimal percentage points with exactly three places |
| Component percentile | Integer `0` through `100` |

BACI `v` is thousands of current USD. Monetary cells use:

```text
current_usd = round_half_up(baci_thousand_usd * 1000)
```

Rates, shares, indices, Spearman rho, and rank percentiles use decimal
round-half-up; for signed ties this is away from zero. Score and material-change
rules use their unrounded internal Decimal values where their defining decision
requires it. The CSV precision is presentation precision and never feeds back
into score, rank, confidence, or revision classification.

### Lists

List cells use `|` with no spaces or trailing delimiter. Empty lists serialize
as `""`.

| Field | Element and order |
|---|---|
| Year lists | Four-digit years ascending |
| `market_growth_reason_codes` | `INSUFFICIENT_OBSERVED_YEARS`, then `BELOW_MATERIALITY_THRESHOLD` |
| `confidence_deductions` | Data Confidence rule-table order; each token is `CODE=POINTS` |
| `caveat_codes` | Fixed order defined below |
| `formula_escaped_columns` | Header name alphabetically ascending |

Controlled list elements cannot contain `|`.

### Language

The CSV has no `locale` or `Accept-Language` variant:

- headers and human explanation text are stable English;
- economy names are BACI source English;
- BACI economy code is canonical and ISO3 is nullable;
- each product has canonical `HS12` plus six-character code;
- `product_description_en` is the logical exact BACI English source text;
- `product_description_zh_hans` is the accepted project auxiliary translation;
- a future accepted catalog gap uses the English value in both description
  columns and `product_translation_status = FALLBACK_ENGLISH`;
- the source-English logical value remains exact even if its serialized cell
  receives the reversible formula prefix described above.

## 6. Exact column order

`candidate-markets-csv-v1` has the following fixed 105-column header. Line
wrapping below is documentary only; the CSV header is one record.

```text
row_type,export_schema_version,export_id,empty_reason,
exporter_name_en,exporter_code_baci,exporter_iso3,
hs_revision,product_code,product_description_en,product_description_zh_hans,product_translation_status,product_translation_attribution,
candidate_market_name_en,candidate_market_code_baci,candidate_market_iso3,candidate_market_identity_note,
rank,rank_tie_size,rank_percentile,cohort_size,candidate_market_score,data_confidence_label,data_confidence_score,
observed_score_year_count,observed_score_years,missing_score_years,latest_finalized_observed_year,finalized_cutoff_year,score_window_start,score_window_end,score_formula,
market_size_state,market_size_mean_current_usd,market_size_percentile,
market_growth_state,market_growth_reason_codes,market_growth_annual_rate,market_growth_percentile,
recorded_foothold_state,recorded_foothold_share,bilateral_flow_state,recorded_foothold_percentile,
supplier_diversity_state,supplier_diversity_reason_code,supplier_diversity_index,supplier_diversity_years_used,supplier_diversity_percentile,
confidence_deductions,sparse_evidence_cap_applied,quantity_coverage_rate,
stability_3y_window_start,stability_3y_window_end,stability_3y_state,stability_3y_spearman,
stability_10y_window_start,stability_10y_window_end,stability_10y_state,stability_10y_spearman,
product_series_discontinuity_years,caveat_codes,caveat_text,
provisional_year,provisional_state,provisional_market_import_current_usd,provisional_bilateral_current_usd,provisional_bilateral_state,provisional_recorded_bilateral_share,provisional_quantity_coverage_rate,
revision_comparison_release,release_revision_state,previous_release_recomputed_score,score_change,previous_release_recomputed_rank_percentile,rank_percentile_change,release_revision_material_change,release_revision_not_compared_reason,release_revision_no_longer_eligible_count,previous_artifact_sha256,
baci_release,source_update_date,ingested_year_start,ingested_year_end,score_version,
analysis_id,analysis_build_id,analysis_release_catalog_sha256,product_search_build_id,source_status_snapshot_id,freshness_status_id,freshness_state,freshness_checked_at,freshness_effective_at,served_baci_release,latest_known_baci_release,
artifact_build_id,artifact_schema_version,artifact_built_at,artifact_sha256,
source_attribution,source_documentation_url,source_license,source_license_url,discovery_disclaimer,formula_escaped_columns
```

Adding, removing, reordering, renaming, or changing the meaning or grammar of a
column requires a new export schema. A new enum token that an older consumer
cannot interpret also requires a new schema.

## 7. Column semantics

### Row, query, and product

| Column | Contract |
|---|---|
| `row_type` | `CANDIDATE` or `EMPTY_ANALYSIS` |
| `export_schema_version` | Constant `candidate-markets-csv-v1` |
| `export_id` | Derived immutable identity defined below |
| `empty_reason` | Blank for candidates; `NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW` for the empty row |
| `exporter_name_en` | BACI country metadata English name |
| `exporter_code_baci` | Exact BACI economy code string |
| `exporter_iso3` | ISO3 crosswalk if available, else blank |
| `hs_revision` | Constant `HS12` |
| `product_code` | Six ASCII digits; leading zeroes preserved |
| `product_description_en` | Exact logical BACI English source description |
| `product_description_zh_hans` | Accepted auxiliary Simplified Chinese description or documented English fallback |
| `product_translation_status` | `MACHINE_ASSISTED`, `REVIEWED`, or `FALLBACK_ENGLISH` |
| `product_translation_attribution` | Fixed English notice that the Chinese text is an HS Tracker auxiliary translation/modification of the BACI source description |

### Candidate, rank, score, and coverage

| Column | Contract |
|---|---|
| `candidate_market_name_en` | BACI metadata English name |
| `candidate_market_code_baci` | Exact BACI economy code string |
| `candidate_market_iso3` | ISO3 crosswalk if available, else blank |
| `candidate_market_identity_note` | Identity caveat for code 490; otherwise blank |
| `rank` | Competition rank on displayed integer score |
| `rank_tie_size` | Number of candidates sharing the displayed score |
| `rank_percentile` | Displayed-score tie-group midrank percentile |
| `cohort_size` | Complete eligible candidate count |
| `candidate_market_score` | Public integer score `0..100`, rounded half-up |
| `data_confidence_label` | `HIGH`, `MEDIUM`, or `LOW` |
| `data_confidence_score` | Integer `0..100` after deductions and sparse cap |
| `observed_score_year_count` | Number of observed market years in primary `W5` |
| `observed_score_years` | Ascending observed `W5` year list |
| `missing_score_years` | Ascending missing `W5` year list |
| `latest_finalized_observed_year` | Maximum observed finalized year |
| `finalized_cutoff_year` | Current release's scoring cutoff |
| `score_window_start`, `score_window_end` | Primary five-Finalized-Year boundaries |
| `score_formula` | Fixed literal `round_half_up(0.30*market_size_percentile+0.25*market_growth_percentile+0.25*recorded_foothold_percentile+0.20*supplier_diversity_percentile)` |

`rank_percentile` uses the rule fixed in the score decision:

```text
average_rank = mean(one-based positions occupied by the displayed-score tie)
rank_percentile = 100 * (cohort_size - average_rank) / (cohort_size - 1)
```

A one-market cohort receives `50.000`.

### Components

| Column | Contract |
|---|---|
| `market_size_state` | `COMPUTED` for every eligible `cms-v1` candidate |
| `market_size_mean_current_usd` | Mean over observed primary-window years, converted to current USD |
| `market_size_percentile` | Integer midrank percentile |
| `market_growth_state` | `COMPUTED` or `NEUTRAL` |
| `market_growth_reason_codes` | Blank when computed; one or both neutral reasons |
| `market_growth_annual_rate` | Signed decimal fraction; blank when neutral |
| `market_growth_percentile` | Integer midrank percentile; neutral is `50` |
| `recorded_foothold_state` | `COMPUTED` for every eligible `cms-v1` candidate |
| `recorded_foothold_share` | Selected exporter's aggregate share of recorded market flows |
| `bilateral_flow_state` | `RECORDED` or `NO_RECORDED_POSITIVE_FLOW` |
| `recorded_foothold_percentile` | Integer midrank percentile |
| `supplier_diversity_state` | `COMPUTED` or `NEUTRAL` |
| `supplier_diversity_reason_code` | Blank when computed; otherwise `NO_COMPUTABLE_ALTERNATIVE_SUPPLIER_YEAR` |
| `supplier_diversity_index` | Mean annual inverse normalized concentration; blank when neutral |
| `supplier_diversity_years_used` | Ascending years with a computable annual diversity value; blank when neutral |
| `supplier_diversity_percentile` | Integer midrank percentile; neutral is `50` |

Growth may fail both minimum rules, so its reason field is plural and preserves
both causes rather than choosing one by implementation order.

### Confidence, quantity, stability, and caveats

`confidence_deductions` contains every applied deduction as `CODE=POINTS` in
this fixed order:

```text
MISSING_SCORE_WINDOW_YEARS
MISSING_CUTOFF_YEAR_EVIDENCE
SMALL_BASE
UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE
POSSIBLE_PRODUCT_SERIES_DISCONTINUITY
LOW_WINDOW_STABILITY
SMALL_CANDIDATE_COHORT
NO_EXPORTER_PRODUCT_HISTORY
IDENTITY_PROXY
```

For example:

```text
MISSING_SCORE_WINDOW_YEARS=20|MISSING_CUTOFF_YEAR_EVIDENCE=15
```

`sparse_evidence_cap_applied` reports whether the at-most-two-observed-years
cap lowered the post-deduction score to 40. Starting from 100, the deduction
tokens, cap flag, and final score make the confidence ledger reproducible.

`quantity_coverage_rate` is:

```text
count(recorded positive-v BACI rows with non-null positive q)
/
count(recorded positive-v BACI rows)
```

for the candidate importer and product across the primary score window and all
recorded exporters. `provisional_quantity_coverage_rate` uses the same ratio for
the provisional year. Quantity coverage is evidence only; it never changes
eligibility, score, rank, or Data Confidence.

The 3-year and 10-year stability columns repeat the alternate-window boundaries
and use:

- `NOT_FLAGGED` when Spearman rho was estimated and is at least `0.70`;
- `LOW` when estimated rho is below `0.70`;
- `NOT_ESTIMATED_SMALL_COMMON_COHORT` when fewer than ten candidates are common.

The rho cell is blank only for the not-estimated state.
`product_series_discontinuity_years` lists every flagged finalized year.

`caveat_codes` uses this fixed order:

```text
NO_RECORDED_POSITIVE_FLOW
IDENTITY_PROXY
EXTREME_NOMINAL_GROWTH
DOMINANT_SIZE_OUTLIER
POSSIBLE_PRODUCT_SERIES_DISCONTINUITY
LOW_WINDOW_STABILITY
STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT
```

The first four codes are candidate-specific and appear only on affected rows:
no recorded selected-exporter flow, code 490 identity proxy, extreme candidate
growth, and the one dominant-size candidate. The final three are query-level:
product-series discontinuity and either low or not-estimated window stability
repeat on every candidate row. The shared
`NO_RECORDED_POSITIVE_FLOW` token deliberately matches
`bilateral_flow_state`; `caveat_text` supplies the contextual phrase "No
recorded bilateral flow in the score window."

`caveat_text` gives stable English sentences for the same codes, separated by
`; ` in code order. Codes are machine-readable authority; text is additive
presentation.

### Provisional evidence

| Column | Contract |
|---|---|
| `provisional_year` | Newest year in the served BACI release |
| `provisional_state` | `RECORDED` or `NO_RECORDED_POSITIVE_FLOW` for candidate world imports |
| `provisional_market_import_current_usd` | Aggregate candidate imports; blank when not recorded |
| `provisional_bilateral_state` | `RECORDED`, `NO_RECORDED_POSITIVE_FLOW`, or `NOT_APPLICABLE` when the market denominator is absent |
| `provisional_bilateral_current_usd` | Selected-exporter value; blank unless recorded |
| `provisional_recorded_bilateral_share` | Selected-exporter share; blank unless bilateral value is recorded |
| `provisional_quantity_coverage_rate` | Provisional-year quantity-row coverage; blank when market imports are not recorded |

These columns are explicitly supporting evidence. The export contains no
provisional score, rank, confidence, growth conclusion, or direction badge.

### Release Revision

| Column | Contract |
|---|---|
| `revision_comparison_release` | Previous accepted BACI release when an artifact is available |
| `release_revision_state` | `NOT_COMPARED`, `BELOW_THRESHOLD`, `MATERIAL_CHANGE`, or `NEWLY_ELIGIBLE` |
| `previous_release_recomputed_score` | Previous artifact recomputed over current `W5`; common markets only |
| `score_change` | Current score minus previous recomputed score |
| `previous_release_recomputed_rank_percentile` | Previous displayed-score tie-group percentile |
| `rank_percentile_change` | Current minus previous percentile, in percentage points |
| `release_revision_material_change` | `true` for `MATERIAL_CHANGE`, `false` for `BELOW_THRESHOLD`, blank for other states |
| `release_revision_not_compared_reason` | Blank unless `NOT_COMPARED`; see enum below |
| `release_revision_no_longer_eligible_count` | Previous-only market count when comparison ran, including numeric zero; blank when not compared |
| `previous_artifact_sha256` | Exact previous artifact used or assessed for comparison |

`release_revision_not_compared_reason` is one of:

```text
NO_PREVIOUS_ARTIFACT
NO_COMPATIBLE_PREVIOUS_ARTIFACT
PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW
```

For `NO_PREVIOUS_ARTIFACT` and `NO_COMPATIBLE_PREVIOUS_ARTIFACT`,
`revision_comparison_release` and `previous_artifact_sha256` are blank: no
artifact entered the comparison seam. For
`PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW`, both identify the compatible artifact
that was assessed but could not cover current `W5`. They are also populated for
all performed comparisons, including `NEWLY_ELIGIBLE`.

Old values and deltas are blank for `NOT_COMPARED` and `NEWLY_ELIGIBLE`.
Markets classified `NO_LONGER_ELIGIBLE` are not inserted into the current
ranking; only the analysis-level count is repeated.

### Source, build, freshness, and warning

| Column | Contract |
|---|---|
| `baci_release` | Served indivisible BACI release, for example `V202601` |
| `source_update_date` | CEPII update date, not ingest or download date |
| `ingested_year_start`, `ingested_year_end` | Complete source-year range in the artifact |
| `score_version` | `cms-v1` |
| `analysis_id` | Deterministic exporter/product result identity |
| `analysis_build_id` | Immutable analysis build identity |
| `analysis_release_catalog_sha256` | SHA-256 of the one immutable release-catalog document naming the exact current artifact and compatible previous artifact or `none`; it is not a combined artifact hash |
| `product_search_build_id` | Accepted source/translation/search catalog identity |
| `source_status_snapshot_id` | Immutable monitor snapshot identity |
| `freshness_status_id` | Immutable effective public freshness identity |
| `freshness_state` | `LATEST_KNOWN`, `UPDATE_IN_PROGRESS`, `REFRESH_DELAYED`, or `CHECK_OVERDUE` |
| `freshness_checked_at` | Latest successful source-check instant |
| `freshness_effective_at` | UTC instant at which the bound public state became effective |
| `served_baci_release`, `latest_known_baci_release` | Relationship summarized by freshness state |
| `artifact_build_id`, `artifact_schema_version`, `artifact_built_at`, `artifact_sha256` | Exact serving artifact provenance |
| `source_attribution` | Dynamic CEPII/BACI release, update-date, HS revision, and Etalab license attribution |
| `source_documentation_url` | `https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html` |
| `source_license` | `Etalab Open Licence 2.0` |
| `source_license_url` | Official Etalab Open Licence 2.0 URL |
| `discovery_disclaimer` | Fixed Candidate Market discovery-aid warning |
| `formula_escaped_columns` | Reversible formula-prefix manifest for this row |

The attribution template is:

```text
Source: CEPII BACI, HS 2012, {baci_release} (updated {source_update_date}), Etalab Open Licence 2.0.
```

The translation attribution template is:

```text
Simplified Chinese product description: HS Tracker project auxiliary translation of the CEPII BACI English source description.
```

The disclaimer is:

```text
This Candidate Market Score is discovery evidence for further investigation. It is not a prediction of profit or sales success, and it is not a recommendation.
```

No request-time `generated_at`, `exported_at`, or download timestamp appears.
Build timestamps identify processing, not source recency.

## 8. Immutable identity and deterministic bytes

The export identity has six inputs:

```text
analysis_build_id
  + exporter_code_baci
  + product_code
  + product_search_build_id
  + freshness_status_id
  + export_schema_version
```

`product_search_build_id` is necessary because the CSV embeds its accepted
Chinese product text and translation status. A catalog correction must create a
new export identity without pretending trade evidence or `analysis_build_id`
changed. Binding the whole current product-search build conservatively
invalidates the CSV for an alias-only catalog change as well; this is accepted
because no narrower immutable translation-catalog identity currently exists.

`export_id` is:

```text
cmx1-{lowercase hex SHA-256}
```

The digest input is UTF-8 bytes of this exact LF-terminated text with the actual
values substituted:

```text
schema=candidate-markets-csv-v1
analysis_build_id={analysis_build_id}
exporter_code_baci={exporter_code_baci}
product_code={product_code}
product_search_build_id={product_search_build_id}
freshness_status_id={freshness_status_id}
```

Allowlisted value grammars exclude LF and `=`, so the framing is unambiguous.

For the same export ID, regeneration must produce identical uncompressed entity
bytes: BOM, header, rows, values, formula prefixes, rounding, quoting, CRLF, and
final CRLF. A request-time clock, process locale, object iteration order, SQL
row order, or platform newline must not affect output.

Candidate rows sort by competition rank ascending and then numeric BACI
candidate code ascending. Numeric comparison is required even if stored source
codes have different string widths.

## 9. HTTP contract

### Route

```text
GET /api/v1/analyses/{analysisBuildId}/candidate-markets.csv
    ?exporter={exporterCode}
    &product={productCode}
    &productSearchBuildId={productSearchBuildId}
    &freshnessStatusId={freshnessStatusId}
    &schema=candidate-markets-csv-v1
```

All five query parameters are required. The route accepts no `locale`,
candidate list, shortlist, sort, pagination, or field-selection parameter.
`HEAD` returns the same status and representation headers without a body.
Unsupported methods return `405`.

Immediately before download, the client refreshes
`/api/v1/analyses/current`, updates the visible warning, and supplies the
compatible product-search build and latest effective freshness-status ID. The
server validates every requested identity and never substitutes a newer,
older, or "close enough" artifact, catalog, or status snapshot.

### Filename and response headers

```text
hs-tracker_candidate-markets_from-{exporterCode}_HS12-{productCode}_{baciRelease}_{exportId}.csv
```

The filename uses only ASCII letters, digits, `.`, `_`, and `-`. It contains no
human name, locale, or request timestamp. The full `exportId` prevents a schema,
catalog, or freshness update from reusing a local filename.

Successful `GET` responses include:

```text
Content-Type: text/csv; charset=utf-8; header=present
Content-Disposition: attachment; filename="{deterministic filename}"
Cache-Control: public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable
ETag: W/"sha256-{SHA-256 of the uncompressed CSV entity bytes}"
X-Content-Type-Options: nosniff
Vary: Accept-Encoding
```

The representation does not vary by `Accept-Language`. Content coding, if a
reverse proxy applies one, follows normal HTTP representation rules and does
not change the uncompressed CSV identity.

### Responses

| Condition | Response |
|---|---|
| Valid identity, eligible cohort | `200`, header plus `CANDIDATE` rows |
| Valid identity, empty cohort | `200`, header plus one `EMPTY_ANALYSIS` row |
| Malformed code, ID, or missing parameter | `400` with stable code |
| Unsupported `schema` | `400 UNSUPPORTED_EXPORT_SCHEMA` |
| Well-formed economy/product absent from release | `404` |
| Unknown or retired product-search build | `404` |
| Unknown freshness-status snapshot | `404` |
| Product-search build not compatible with analysis build | `409`; client refreshes current manifest |
| Freshness snapshot's served release differs from analysis release | `409`; client refreshes current manifest |
| Analysis build no longer active at origin | `410`; client refreshes current manifest |
| Artifact/catalog unavailable or incompatible | `503` |
| Candidate/file representation guard exceeded | `503 EXPORT_REPRESENTATION_LIMIT_EXCEEDED`; never truncate |
| Unexpected serialization or internal failure | `500` with opaque message and correlation ID |

Errors use the existing JSON error contract, are never emitted as CSV, and are
not long-cached.

## 10. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Current row, viewport, or shortlist export | Makes transient browser state part of identity and can hide the cohort used for ranking |
| Multiple files or ZIP with a sidecar manifest | Adds packaging and import friction; bounded repeated context keeps one flat table self-contained |
| Header-only empty CSV | Drops the query and provenance needed to understand the empty result offline |
| JSON or XLSX export | Creates another schema/library and formula-handling surface without improving the MVP discovery task |
| Locale-specific files or display-formatted percentages | Mutates bytes by browser locale and weakens machine parsing |
| UTF-8 without BOM | Avoids three signature bytes but weakens direct bilingual spreadsheet compatibility |
| Blanket apostrophe on every cell | Corrupts machine-typed numbers, codes, booleans, and dates |
| Formula quoting without a prefix | OWASP documents quoting alone as insufficient |
| Silent control-character deletion | Hides an upstream catalog defect and changes source text without evidence |
| Raw annual, supplier, or all-query export | Becomes a bulk data surface outside the contextual analyst workflow |
| Company fields in the public CSV | Violates the public/entitled data-plane boundary |
| Omitting `product_search_build_id` | Allows localized bytes to change at an allegedly immutable export URL |
| Request-time generated/exported timestamp | Makes the same analytical identity produce different bytes and falsely suggests source recency |

## 11. Acceptance handoff

Implementation fixtures must prove:

1. Byte-level BOM, one fixed header, universal quoting, doubled quotes, CRLF,
   and final CRLF.
2. Every row has the exact schema column count and order.
3. A bilingual value survives a standards-compliant CSV round trip.
4. Each ASCII and full-width formula starter is escaped in a human-text field,
   including after leading Unicode space, listed in
   `formula_escaped_columns`, and exactly reversible.
5. A negative numeric growth value remains numeric and is not formula-escaped.
6. NUL, DEL, embedded controls, and misplaced TAB/CR/LF fail rather than being
   deleted.
7. A valid zero-cohort query produces one fully attributable
   `EMPTY_ANALYSIS` row.
8. Leading-zero product code `010121` remains six characters through route,
   filename, CSV, and parser round trip.
9. Equal integer scores share competition rank and rank percentile, report the
   right tie size, and sort by numeric BACI code.
10. A one-market cohort receives rank percentile `50.000`.
11. Growth can export both neutral reason codes; neutral raw value is blank and
    percentile is `50`.
12. No-recorded finalized bilateral evidence exports derived share
    `0.000000` with its explicit state, while missing provisional bilateral
    evidence exports blank value/share with its state; absent provisional
    market evidence separately exercises bilateral state `NOT_APPLICABLE`.
13. `confidence_deductions` carries every code and point value, and the sparse
    cap remains independently visible.
14. Quantity coverage uses row counts, excludes null `q` from the numerator,
    and never changes score or confidence.
15. Estimated, low, and small-common-cohort stability states plus flagged
    discontinuity years serialize deterministically.
16. Code 490 carries its identity note, deduction, and caveat without acquiring
    a fabricated ISO3.
17. All four current-candidate Release Revision states, each not-compared
    reason, material flag, signed deltas, and a nonzero no-longer-eligible
    summary.
18. Provisional data never changes score, rank, Data Confidence, or stability.
19. A freshness-status change creates a new export ID/filename and changes only
    status-bound fields plus those identities.
20. A product-catalog change creates a new export ID/filename without changing
    `analysis_build_id`, score, rank, or trade evidence.
21. Unknown and incompatible build/status combinations produce their exact
    `404`/`409` outcomes with no fallback substitution.
22. Repeated generation of one export ID is byte-identical across process
    locale and platform newline settings.
23. Public result and CSV rows originate from the same
    `CandidateMarketResult`; no duplicated score calculation exists.
24. Static contract tests forbid raw-row, supplier, and company-shaped columns
    and forbid candidate-list or bulk-query parameters.

## Primary sources

All sources were accessed 2026-07-11.

- IETF, [RFC 4180: Common Format and MIME Type for CSV
  Files](https://datatracker.ietf.org/doc/html/rfc4180)
- IANA, [`text/csv` media type
  registration](https://www.iana.org/assignments/media-types/text/csv)
- OWASP, [CSV
  Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- Microsoft Support, [Opening CSV UTF-8 files correctly in
  Excel](https://support.microsoft.com/en-us/excel/opening-csv-utf-8-files-correctly-in-excel)
- CEPII, [The CEPII-BACI dataset](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- Etalab, [Open Licence
  2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf)
- HSTracker, [MVP trade dataset and HS analysis
  nomenclature](./2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md)
- HSTracker, [Candidate Market Score and data
  confidence](./2026-07-11-candidate-market-score-and-confidence.md)
- HSTracker, [Trade-data freshness and provisional-year
  presentation](./2026-07-11-trade-data-freshness-and-provisional-presentation.md)
- HSTracker, [HS product description and search-language
  strategy](./2026-07-11-hs-product-description-and-search-language.md)
- HSTracker, [Public-web data and deployment
  architecture](./2026-07-11-public-web-data-and-deployment-architecture.md)
- HSTracker, [Company-level trade-data extension
  boundaries](./2026-07-11-company-level-trade-data-extension-boundaries.md)
