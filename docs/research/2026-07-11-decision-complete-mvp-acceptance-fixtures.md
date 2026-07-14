# Decision: Decision-complete MVP acceptance fixtures

**Ticket:** [Define decision-complete MVP acceptance fixtures](https://github.com/huangyingting/HSTracker/issues/13)  
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)  
**Decided:** 2026-07-11

## Decision

Accept the public-data MVP only through one versioned fixture pack,
`acceptance-fixtures-v1`, with three complementary layers:

1. **Synthetic contract fixtures** prove score, missingness, language, freshness,
   revision, API, UI, and export behavior without committing BACI source rows.
2. **Artifact-derived fixtures** pin real product/query keys and measured metadata
   from each candidate BACI build without treating a tiny synthetic dataset as a
   performance proxy.
3. **Operational drills** prove load, cache, publication, failure, recovery, and
   cost gates on the complete production artifact and intended Machine class.

The representative analyst journey is:

```text
Export economy: BACI code 156 (China)
HS Product: HS 2012 code 010121
Source English: Horses: live, pure-bred breeding animals
Primary evidence record: BACI code 484 (Mexico)
Comparison records: codes 710 and 490
```

The trade values in the contract pack are intentionally synthetic. Economy and
product identities exercise the real public contracts, but fixture values must
never be described as BACI observations or shipped in a production release.

| Area | Binding fixture decision |
|---|---|
| Fixture schema | `acceptance-fixtures-v1` |
| Core query | exporter `"156"` + product `"010121"` |
| Core cohort | 13 eligible Candidate Markets |
| Finalized/provisional split | 2019-2023 / 2024 under `V202601` metadata |
| Main edge records | missing market-years, missing bilateral rows, neutral components, missing quantities, code 490, integer-score ties |
| Empty analysis | valid catalog product `"851712"` with no rows in the empty-evidence fixture |
| Discontinuity | separate `"851712"` fixture flags 2017 only |
| Cross-revision input | explicit `HS 2022 851713` is rejected, never converted to HS12 |
| Release comparison | exact below-threshold, material, newly eligible, no-longer-eligible, and not-compared fixtures |
| Freshness | exact `T-1s`, `T`, and `T+1s` cases at both UTC deadlines |
| Performance keys | deterministically selected from each complete candidate artifact; never hard-coded from synthetic data |
| End-to-end outcome | discover, inspect, compare, and export without an external calculation or data download |

## 1. What acceptance means

The MVP is accepted only when all of these statements are true:

1. One implementation of `CandidateMarketAnalysis` produces the result used by
   JSON, the focused workspace, comparison, and CSV.
2. The core fixture's exact public scores, ranks, evidence states, confidence,
   provisional separation, and provenance match the oracle below.
3. Search can reach an explicitly selected HS12 product in both supported
   interface languages without silently classifying free text or another HS
   revision.
4. The analyst can understand why a market is ranked, what is missing, and what
   is provisional in the primary reading path.
5. Comparison is derived from the already-loaded complete result and export
   contains the complete cohort, not only selected records.
6. Source, build, cache, status, and export identities change only under their
   documented inputs.
7. The complete production artifact passes the source, performance, reliability,
   storage, and cost gates. Passing the small synthetic pack is necessary but not
   sufficient.

Acceptance is automated wherever an exact oracle exists. A release checklist may
record a human bilingual-catalog approval or provider cost quote, but it may not
replace deterministic tests with visual opinion.

## 2. Fixture constitution

### 2.1 Repository shape

Implementation work must keep the logical fixture pack under one versioned root.
The exact test runner may adapt the leaf filenames, but it must preserve these
seams:

```text
fixtures/acceptance/v1/
  manifest
  catalog/
    products
    translations
    aliases
    search-cases
  evidence/
    core-current
    core-previous
    empty
    discontinuity
  status/
    source-snapshots
    cases
  expected/
    analyses
    searches
    exports
    errors
    ui
```

The manifest records:

```text
fixture_schema_version
fixture_content_sha256
fixture_only = true
score_version
export_schema_version
artifact_schema_version
analysis_result_schema_version
product_search_schema_version
source_status_schema_version
source release metadata
all fixture IDs and expected-file SHA-256 values
```

Fixture manifests are content-addressed and immutable. A semantic input or
expected output change requires a new fixture-content digest. A contract change
requires a new fixture schema version. Snapshot updates without a reviewed
contract/input change are forbidden.

### 2.2 Numeric and missing-value encoding

Fixture source values are decimal strings in BACI's thousands-of-current-USD
unit. Tests parse them into the same fixed-point domain type used by the DuckDB
adapter. A JavaScript binary float literal is not an authoritative fixture value.

An unobserved market-year is omitted. It is never represented by a row whose
value is zero. Selected-exporter evidence is tagged:

```text
RECORDED(value_kusd > 0)
NO_RECORDED_POSITIVE_FLOW
```

Only the second state contributes numeric zero to the defined Recorded Foothold
numerator. It remains a nonzero-information state everywhere else.

The normalized fixture evidence for one observed market-year contains:

```text
year
candidate_market_code
world_value_kusd
selected_exporter_state
selected_exporter_value_kusd when recorded
alternative_supplier_shares
source_flow_count
quantity_present_count
```

`alternative_supplier_shares` sum to one over suppliers other than the selected
exporter. An empty list means no alternative supplier and therefore unavailable
annual diversity. Supplier identities are unnecessary at this normalized
fixture seam; the DuckDB adapter separately proves that its aggregate count,
total, and square-sum projection produces the same input. `source_flow_count` is
the vector length plus one exactly when selected-exporter evidence is recorded.

### 2.3 Oracle precision

Tests assert exact public integers, enums, lists, dates, decimal serializations,
and bytes. Diagnostic hidden scores in this document are rounded to six decimal
places for review and may use a `1e-6` comparison tolerance; they never become a
public ranking key.

Resolve the display ambiguity left by earlier decisions as follows:

```text
component_percentile_display =
  round_half_up(component_percentile_unrounded)
```

`cms-v1` still computes its weighted total from unrounded component percentiles.
The UI and CSV expose the rounded integer. A four-member pool percentile of
`12.5` therefore displays and exports as `13`.

For rolling-window stability, "Spearman rho" means the Pearson correlation of
the two vectors of canonical competition-rank numbers for candidates common to
both cohorts. Do not rank those rank numbers a second time. Ties retain their
shared competition rank and gaps. Compare the unrounded rho with `0.70`, then
serialize it to six decimal places.

## 3. Core Candidate Market fixture

### 3.1 Fixed identities

The synthetic core build carries the real initial source scope so date, window,
and provenance presentation can be exercised:

```text
baci_release = V202601
source_update_date = 2026-01-22
hs_revision = HS12
ingested_years = 2012..2024
finalized_cutoff_year = 2023
primary_window = 2019..2023
short_window = 2021..2023
long_window = 2014..2023
provisional_year = 2024
score_version = cms-v1
exporter_code = 156
product_code = 010121
```

The exact exporter and economy display strings come from the fixture copy of the
pinned BACI country metadata. BACI source codes remain strings in public
contracts. Friendly names below aid review and do not replace source identity.

### 3.2 Primary-window evidence

`M19` through `M23` are recorded world-import values in thousands of current
USD. `-` means the market-year object does not exist. `B share` deterministically
creates the selected-exporter row as `M * share`; `absent` creates no such row.
The alternative vector splits `M - B` and is constant across each candidate's
observed years.

| Code | Friendly name | M19 | M20 | M21 | M22 | M23 | B share/state | Alternative supplier shares |
|---:|---|---:|---:|---:|---:|---:|---|---|
| `36` | Australia | 2000 | 2200 | 2400 | 2600 | 2800 | absent | `0.75,0.25` |
| `76` | Brazil | 4000 | 3800 | 3600 | 3400 | 3200 | `0.10` | `0.50,0.30,0.20` |
| `124` | Canada | 7000 | 7000 | 7000 | 7000 | 7000 | `0.05` | `0.60,0.40` |
| `152` | Chile | 3000 | - | 3500 | 3900 | 4300 | `0.25` | `0.90,0.10` |
| `392` | Japan | 7000 | 7000 | 7000 | 7000 | 7000 | `0.05` | `0.60,0.40` |
| `404` | Kenya | 300 | 400 | - | - | - | absent | `1.00` |
| `484` | Mexico | 8000 | 8500 | 9000 | 9500 | 10000 | `0.20` | `0.40,0.30,0.20,0.10` |
| `490` | Other Asia, n.e.s. | 1000 | 1100 | 1200 | 1300 | 1400 | `0.10` | `0.80,0.20` |
| `528` | Netherlands | 2000 | 2600 | 3400 | 4500 | 6000 | `0.30` | `0.25,0.25,0.25,0.25` |
| `616` | Poland | 5000 | 5300 | 5600 | 5900 | 6200 | `0.15` | `0.50,0.30,0.20` |
| `699` | India | 2000 | 2500 | 3200 | 4000 | 5000 | absent | `0.70,0.20,0.10` |
| `710` | South Africa | - | - | - | 1000 | 1200 | `1.00` | none |
| `842` | United States | 1500 | 1800 | 2200 | - | - | `0.28` | `0.95,0.05` |

For 2014-2018, repeat each candidate's 2019 market value, selected-exporter
state/share, and alternative distribution. Kenya therefore has long-window
evidence but no short-window evidence. South Africa has no pre-2022 object.
Those rules fully determine the 3-, 5-, and 10-year inputs without a second
hand-authored score fixture.

The core product-year totals are:

```text
2012=42000
2013=42400
2014=42800
2015=42800
2016=42800
2017=42800
2018=42800
2019=42800
2020=42200
2021=48100
2022=50100
2023=54100
```

The 2014-2023 totals are exactly the sums of the candidate rules above. The
2012-2013 totals feed only the full-period product check. They continue the
series without a flagged discontinuity. The core fixture has no excluded
aggregate, selected-exporter self-import, or other hidden market value from
2014 onward.

### 3.3 Quantity coverage

All source-flow rows have positive quantity by default. Mexico overrides its
five annual `(quantity_present_count/source_flow_count)` values:

```text
2019=4/5
2020=5/5
2021=3/5
2022=5/5
2023=5/5
```

Its finalized quantity coverage is therefore `22/25 = 0.880000`. A mutation
sets every quantity count in the core fixture to zero while preserving every
value row. The mutation must change quantity coverage only; eligibility,
components, score, rank, confidence, and stability remain byte-for-byte equal.

### 3.4 Provisional evidence

Only these three explicit states are required in the core oracle; other
candidate 2024 rows may be absent:

| Candidate | 2024 market | Selected exporter | Quantity coverage | Expected states |
|---|---:|---:|---:|---|
| Mexico `484` | 11000 | 2200 | `4/5` | market `RECORDED`, bilateral `RECORDED`, share `0.200000` |
| India `699` | 6000 | absent | `2/3` | market `RECORDED`, bilateral `NO_RECORDED_POSITIVE_FLOW`, value/share blank |
| South Africa `710` | absent | not applicable | blank | market `NO_RECORDED_POSITIVE_FLOW`, bilateral `NOT_APPLICABLE` |

A paired mutation changes all 2024 values, presence states, and quantity counts
while leaving finalized rows fixed. The analysis build identity changes because
artifact bytes changed, but every finalized score, rank, Data Confidence value,
and stability value remains equal.

### 3.5 Expected result oracle

The rank order below is authoritative. `Raw score` is review-only diagnostic
precision; public score and rank are exact.

| Code | Friendly name | Years | Growth | Diversity | Bilateral | Raw score | Score / rank | Confidence |
|---:|---|---:|---|---|---|---:|---:|---|
| `528` | Netherlands | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 84.761072 | 85 / 1 | `HIGH` 100 |
| `484` | Mexico | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 69.586247 | 70 / 2 | `HIGH` 100 |
| `152` | Chile | 4/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 56.789044 | 57 / 3 | `HIGH` 90 |
| `616` | Poland | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 55.967366 | 56 / 4 | `HIGH` 100 |
| `124` | Canada | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 54.289044 | 54 / 5 | `HIGH` 100 |
| `392` | Japan | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 54.289044 | 54 / 5 | `HIGH` 100 |
| `710` | South Africa | 2/5 | `NEUTRAL` | `NEUTRAL` | `RECORDED` | 50.000000 | 50 / 7 | `LOW` 40 |
| `842` | United States | 3/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 50.087413 | 50 / 7 | `MEDIUM` 65 |
| `699` | India | 5/5 | `COMPUTED` | `COMPUTED` | `NO_RECORDED_POSITIVE_FLOW` | 44.667832 | 45 / 9 | `HIGH` 100 |
| `76` | Brazil | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 39.341492 | 39 / 10 | `HIGH` 100 |
| `490` | Other Asia, n.e.s. | 5/5 | `COMPUTED` | `COMPUTED` | `RECORDED` | 36.777389 | 37 / 11 | `HIGH` 90 |
| `36` | Australia | 5/5 | `COMPUTED` | `COMPUTED` | `NO_RECORDED_POSITIVE_FLOW` | 36.072261 | 36 / 12 | `HIGH` 100 |
| `404` | Kenya | 2/5 | `NEUTRAL` | `COMPUTED` | `NO_RECORDED_POSITIVE_FLOW` | 17.371795 | 17 / 13 | `LOW` 40 |

Required deductions and reasons are:

- Chile: `MISSING_SCORE_WINDOW_YEARS=10`.
- Kenya: `MISSING_SCORE_WINDOW_YEARS=30`,
  `MISSING_CUTOFF_YEAR_EVIDENCE=15`, and `SMALL_BASE=15`; both Growth neutral
  reasons are present, and the sparse cap does not lower the already-40 result.
- South Africa: `MISSING_SCORE_WINDOW_YEARS=30` and
  `UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE=10`; the sparse cap lowers 60 to 40
  and is reported as applied.
- United States: `MISSING_SCORE_WINDOW_YEARS=20` and
  `MISSING_CUTOFF_YEAR_EVIDENCE=15`.
- Code 490: `IDENTITY_PROXY=10`; source name `Other Asia, nes`; blank public
  ISO3 even though the source metadata's special code is `S19`; UI display
  `Other Asia, n.e.s. (Taiwan proxy)`; and identity note `BACI code 490 is
  formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.`
  It remains eligible and is never renamed to Taiwan.
- India, Australia, and Kenya: no selected-exporter row is not itself a
  confidence deduction because the exporter has recorded product history
  elsewhere in the query.

Canada/Japan share rank 5, tie size 2, rank percentile `62.500`, and display in
numeric BACI-code order. South Africa/United States share rank 7, tie size 2, rank
percentile `45.833`, and display in numeric code order even though their hidden
raw scores differ. The next ranks are 7 and 9 respectively; no dense-rank rewrite
is allowed.

The core stability oracle is:

```text
W3 common candidates = 12
W3 rho = 0.954842
W3 state = NOT_FLAGGED
W10 common candidates = 13
W10 rho = 0.994681
W10 state = NOT_FLAGGED
```

## 4. Focused score and evidence microfixtures

The core fixture is not distorted to trigger every independent branch. Small
pure-domain microfixtures cover:

| Fixture | Input | Exact outcome |
|---|---|---|
| `component-pool-one` | one computed value | percentile `50`, display `50` |
| `component-all-equal` | four equal computed values | all percentile `50` |
| `component-half-display` | four strictly ordered values | lowest unrounded `12.5`, display/export `13` |
| `growth-both-neutral-reasons` | two years, mean below USD 500,000 | both reason codes in fixed order, raw blank, percentile `50` |
| `diversity-zero` | one alternative supplier | computed diversity `0`, not neutral |
| `diversity-neutral` | no alternative supplier in any observed year | neutral midpoint and confidence deduction |
| `extreme-growth` | computed absolute annual growth greater than `0.75` | score retained; caveat only |
| `dominant-size` | largest candidate greater than 50% of summed sizes | flag on that candidate only |
| `stability-low` | 10 common candidates with competition-rank vectors reversed | rho `-1.000000`, `LOW`, deduction applied |
| `stability-threshold` | unrounded rho exactly `0.70` | `NOT_FLAGGED` |
| `stability-small` | 9 common candidates | `NOT_ESTIMATED_SMALL_COMMON_COHORT`, rho blank, no stability deduction |
| `one-candidate` | one eligible Candidate Market | component percentiles `50`, score `50`, rank `1`, rank percentile `50.000` |
| `no-exporter-history` | no selected-exporter product row in any market/year | every candidate receives `NO_EXPORTER_PRODUCT_HISTORY=10`; zero footholds remain computed |

All confidence deductions are cumulative in the documented rule-table order,
floor at zero, and apply the sparse cap last.

## 5. Empty analysis and input boundaries

The fixture product catalog contains valid HS12 product `851712`, but the
`empty` evidence source contains no market row for it. With exporter `156`:

- search and explicit selection succeed;
- analysis returns `200`, cohort size zero, and
  `NO_ELIGIBLE_CANDIDATES_IN_SCORE_WINDOW`;
- the workspace preserves the selected context and explains the empty result;
- CSV returns its fixed header and one fully attributable `EMPTY_ANALYSIS` row;
- the valid empty result is process-cacheable.

Separate route cases prove:

| Input | Expected result |
|---|---|
| product `10121` | `400` malformed six-digit product |
| product `999999` absent from the fixture catalog | `404` unknown product |
| unknown exporter code | `404` |
| retired analysis build | `410`, then refresh current |
| unavailable compatible artifact | `503` |
| unexpected adapter failure | opaque `500` with correlation ID |

No case substitutes a default exporter/product or turns an error into an empty
analysis.

## 6. HS discontinuity and revision boundary

### 6.1 Possible product-series discontinuity

The `discontinuity` fixture reuses the core 2019-2023 candidate matrix under
valid HS12 product `851712` and supplies these complete product-year totals in
thousands of current USD:

```text
2012=10000
2013=10500
2014=11000
2015=11500
2016=12000
2017=40000
2018=41000
2019=42800
2020=42200
2021=48100
2022=50100
2023=54100
```

The documented median/MAD rule flags **2017 only**. Every candidate receives
`POSSIBLE_PRODUCT_SERIES_DISCONTINUITY=15` and the caveat. Score and rank remain
the same as the core matrix. Copy must say "possible discontinuity or
exceptional global shock"; it must not assert that conversion caused the jump.

### 6.2 Explicit other-revision input

The search fixture sends:

```text
HS 2022 851713
```

It produces a non-selectable other-revision message. It does not strip the
prefix, return HS12 `851712` as a correspondence, or start analysis. Searching
product words may return HS12 products, but the analyst must select one and the
application makes no official conversion claim.

This pair proves both boundaries: the analytical series can disclose a possible
conversion-related break without claiming causation, and the product selector
never performs silent cross-revision identity conversion.

## 7. Release Revision fixture

Use a pure comparison fixture with five current and five previous candidate
snapshots. Both artifacts are compatible HS12 artifacts recomputed with
`cms-v1` over the current window. Their displayed-score rankings are:

| Current candidate | Score / rank / percentile | Previous candidate | Score / rank / percentile | Expected state |
|---|---|---|---|---|
| Netherlands | `80 / 1 / 100.000` | Netherlands | `85 / 1 / 100.000` | `BELOW_THRESHOLD`, score delta `-5` |
| Mexico | `70 / 2 / 75.000` | Mexico | `55 / 4 / 25.000` | `MATERIAL_CHANGE`, score `+15`, rank percentile `+50.000` |
| Chile | `60 / 3 / 50.000` | Chile | `60 / 3 / 50.000` | `BELOW_THRESHOLD` |
| South Africa | `50 / 4 / 25.000` | absent | - | `NEWLY_ELIGIBLE` |
| Canada | `40 / 5 / 0.000` | Canada | `40 / 5 / 0.000` | `BELOW_THRESHOLD` |
| absent | - | Australia | `75 / 2 / 75.000` | analysis summary `NO_LONGER_ELIGIBLE`, count `1` |

Threshold microfixtures prove exact inclusive boundaries:

- absolute score delta `10` is material; `9` alone is not;
- absolute unrounded rank-percentile delta `15` is material; a value below 15
  that serializes to `15.000` is not;
- cohort entries and exits never receive invented numeric deltas.

Three separate analysis-level cases cover every not-compared reason:

```text
NO_PREVIOUS_ARTIFACT
NO_COMPATIBLE_PREVIOUS_ARTIFACT
PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW
```

The last case identifies the assessed artifact/release but omits candidate
deltas. A skipped release never shortens the current window. A guard test fails
if one score input combines rows from two release IDs.

## 8. Freshness and status fixtures

All clocks are injected UTC instants. No test depends on the wall clock.

### 8.1 Check-overdue boundary

```text
checked_at = 2026-03-01T00:00:00Z
check_overdue_at = 2026-03-15T00:00:00Z
latest_known_baci_release = V202601
served_baci_release = V202601
newer_release_detected_at = null
```

Expected states:

```text
2026-03-14T23:59:59Z -> LATEST_KNOWN
2026-03-15T00:00:00Z -> CHECK_OVERDUE
2026-03-15T00:00:01Z -> CHECK_OVERDUE
```

### 8.2 Refresh-due boundary

```text
checked_at = 2027-03-01T00:00:00Z
newer_release_detected_at = 2027-03-02T12:00:00Z
refresh_due_at = 2027-03-09T12:00:00Z
served_baci_release = V202601
latest_known_baci_release = V202701
```

Expected states:

```text
2027-03-09T11:59:59Z -> UPDATE_IN_PROGRESS
2027-03-09T12:00:00Z -> REFRESH_DELAYED
2027-03-09T12:00:01Z -> REFRESH_DELAYED
```

The effective transition snapshot uses the fixed deadline as `effective_at`, so
repeated requests after the deadline derive the same ID. Explicit refresh
failure or rollback yields `REFRESH_DELAYED` immediately and wins over every
other state. With no newer release known, overdue wins over latest-known.

Additional cases prove:

- startup uses the embedded validated snapshot before the first pointer poll;
- mid-run pointer failures preserve that snapshot and let it age through the
  exact deadline;
- a successful pointer update is observed by the origin within 60 seconds;
- current-manifest TTL is clipped at each boundary and no stale directive
  crosses it;
- a failed refresh continues to serve one complete old artifact with a
  persistent warning;
- an unreadable artifact is `503`, not a freshness badge over missing data.

## 9. Product catalog and search fixture

The compact search catalog copies these source rows byte-for-byte from the
pinned BACI product catalog:

| Code | Exact source description |
|---|---|
| `010121` | `Horses: live, pure-bred breeding animals` |
| `010129` | `Horses: live, other than pure-bred breeding animals` |
| `010130` | `Asses: live` |
| `010190` | `Mules and hinnies: live` |
| `851712` | `Telephones for cellular networks or for other wireless networks` |

`851713` is absent from the pinned HS12 catalog.

It adds accepted fixture translations and aliases as independent records. The
`010121` Simplified Chinese fixture string is
`"\u7eaf\u79cd\u7e41\u6b96\u7528\u6d3b\u9a6c"`; the Traditional input form is
`"\u7d14\u7a2e\u7e41\u6b96\u7528\u6d3b\u99ac"`. The common alias
`"\u9a6c"` intentionally targets multiple horse products and never
auto-selects.

Golden search cases cover:

1. exact `010121`, prefixes `01` and `0101`, and full-width
   `"\uff10\uff11\uff10\uff11\uff12\uff11"`;
2. exact source English, exact auxiliary Chinese, English prefix, multi-token,
   punctuation-normalized, and bounded Latin typo matching;
3. Traditional input returning the same canonical result as Simplified input;
4. meaningful qualifiers such as `not` and `other` distinguishing nearby rows;
5. one row matching description and alias, returning only its strongest match
   field/class;
6. an ambiguous alias and a fixture alias mapped to more than 20 valid catalog
   products, with stable code-order tie breaking and the 20-result cap;
7. a missing well-formed code, explicit old/non-HS12/future revision prefixes,
   one-character suppression, and input longer than 300 Unicode code points;
8. keyboard arrow, Enter, Escape, focus, late-response, cancellation, and
   explicit-selection behavior;
9. locale switching that changes primary/adjacent labels but not canonical
   identity, URL, selected product, or result set; and
10. all 5,202 production source products joining to an accepted translation or
    the explicit future fallback state at build time.

Search expected output includes ordered code, match class, matched field, and
matched text. A golden-order change requires a new `productSearchBuildId`; it
cannot be accepted by blindly refreshing snapshots.

## 10. API, cache, and CSV fixtures

### 10.1 One result through every surface

The fixture adapter and DuckDB adapter must both produce the same typed
`CandidateMarketResult` for an equivalent input. Route JSON, server rendering,
client selection/comparison, and CSV consume that object. Static dependency
tests forbid a second score formula in routes, React components, or the CSV
serializer.

The API pack covers every `200/400/404/405/409/410/429/500/503` outcome fixed by
the architecture, overload, and export contracts. Errors use JSON, `no-store`,
and an opaque public shape. Valid empty results remain successful and cacheable.

### 10.2 Cache identity mutations

| Mutation | Analysis build | Product-search build | Freshness ID | JSON analysis bytes | Export ID/bytes |
|---|---|---|---|---|---|
| Repeat same inputs | same | same | same | identical | identical |
| Change only accepted translation/alias catalog | same | changes | same | identical | changes |
| Change only freshness check/effective state | same | same | changes | identical | changes |
| Change provisional source rows | changes | same | same or compatible replacement | finalized values equal; provenance/provisional bytes change | changes |
| Change score formula/window rule | changes and new score version | unaffected | compatible replacement | changes | changes |
| Retire active analysis build | origin returns `410` before LRU lookup | - | - | no stale process hit | no substitution |

Tests exercise process miss, process hit, in-flight hit, browser/shared validation,
conditional `304`, matching `HEAD`, and every exact `Cache-Control` row. Errors,
timeouts, queue rejections, and serialization failures never enter the LRU or a
long-lived HTTP cache.

### 10.3 CSV byte pack

The expected core CSV has 13 `CANDIDATE` rows in the oracle order. The expected
empty CSV has one `EMPTY_ANALYSIS` row. Byte tests prove:

- UTF-8 BOM, one exact 105-column header, universal quoting, doubled quotes,
  CRLF records, and final CRLF;
- six-character `010121` in route, filename, cell, and parser round trip;
- bilingual text round trip;
- numeric negative growth remains numeric;
- every ASCII and full-width formula starter, including after leading Unicode
  whitespace, receives exactly one reversible apostrophe in human text and is
  listed in `formula_escaped_columns`;
- NUL, DEL, embedded controls, and misplaced TAB/CR/LF fail closed;
- missing finalized bilateral evidence serializes derived share `0.000000` plus
  its state, while missing provisional bilateral evidence has blank value/share;
- quantity, stability, discontinuity, revision, code-490, freshness, and
  provenance fields match their typed result;
- process locale, timezone, object insertion order, and platform newline do not
  change the uncompressed bytes or weak semantic ETag;
- candidate, supplier, annual-series, bulk-query, and company-shaped fields are
  absent.

The checked-in expected CSV and its SHA-256 become the byte oracle once the
serializer first implements this contract. Review compares it to the documented
logical oracle before the hash is accepted.

## 11. Browser journey fixture

Run the production Next.js build against the fixture adapters in both English
and Simplified Chinese. The primary browser scenario must:

1. open the no-login public workspace and see the discovery-aid boundary;
2. select export economy `156`;
3. find `010121` by code and by each supported language, then explicitly select
   it;
4. run analysis and receive the complete 13-market list before the result is
   declared interactive;
5. see `V202601`, source date, finalized 2019-2023, and separate provisional
   2024 scope in the persistent strip;
6. inspect Mexico and read score 70, rank 2, all four raw components, fixed
   weights, periods, integer percentiles, confidence 100, and provisional
   snapshot without calculating anything externally;
7. inspect South Africa and see Growth/Supplier Diversity neutral reasons,
   sparse cap, Low 40 confidence, and no provisional positive-flow wording;
8. inspect India and see "No recorded bilateral flow in the score window"
   without "no trade";
9. inspect code 490 and see the proxy identity caveat without a fabricated ISO3;
10. add Mexico, South Africa, and code 490 to comparison and verify comparison
    uses already-loaded data with no analysis request;
11. switch locale without changing query identity, URL product code, score,
    rank, selection, or comparison;
12. revalidate current immediately before export, download the complete
    13-candidate CSV, and prove it is not reduced to the three compared records.

The scenario also covers direct canonical-URL reload, back/forward navigation,
keyboard-only product selection, narrow-screen stacked evidence rows, loading,
empty, retryable-capacity, stale-build refresh, and fatal-unavailable states.
Core evidence cannot be available only through hover or a clipped table.

The task passes only when an Export Market Analyst can answer, from the
workspace/export alone:

- what exporter/product/release/window was analyzed;
- which observed markets rank above others and why;
- which evidence is missing or neutral;
- whether a selected-exporter flow was recorded;
- what is provisional and excluded;
- why confidence is lower;
- what changed between releases, when applicable; and
- what context must be investigated outside HS Tracker.

## 12. Artifact-derived performance fixtures

Synthetic data must never select or validate the performance keys. Every
candidate production artifact computes complete-period and primary-window
`bilateral_year` row counts for all 5,202 catalog products. The benchmarkable
set contains products with at least one primary-window row and sorts by:

```text
(row_count ascending, six-digit product code ascending)
```

and pins:

| Role | Deterministic selector |
|---|---|
| Sparse | first product in the benchmarkable ordering |
| Median | lower of the two middle entries for an even benchmarkable set; zero-based index `floor((N-1)/2)` |
| Upper quartile | zero-based index `floor(0.75*(N-1))` |
| Maximum-row | final benchmarkable entry |

For each product, the benchmark exporter is the eligible economy with the most
recorded bilateral rows for that product over the primary score window; ties use
numeric BACI code ascending. The manifest records product, exporter, complete
and primary-window row counts, candidate count, result bytes, and selection
algorithm/version.

Sparse, median, and maximum-row feed all single-route and browser benchmarks.
Sparse, median, upper-quartile, and maximum-row form the four different
uncached keys in coordinated bursts. The bounded hot-key set uses the same
manifest entries. A release may change the resulting codes, but no benchmark may
choose an easier key manually.

The complete production artifact then runs every fixed gate from the performance
decision:

- browser and payload budgets on median and maximum-row products;
- at least 100 timed origin samples per product/cache class;
- 20 sessions, 4 requests/s for 10 minutes, 10 requests/s for 30 seconds, the
  declared route mix, 80/20 hot/uncached analysis mix, and four-key bursts;
- identical-key coalescing, queue saturation, cancellation, memory, and forced
  spill;
- byte-bounded LRUs and HTTP cache/deadline matrices;
- object-store outage, restart, hydration, promotion, rollback, volume, image,
  availability, observability, and cost drills.

The performance report is invalid unless it names the fixture-manifest digest,
artifact SHA-256, Machine class, region, cache class, sample count/window, and
actual pass/fail threshold for every measurement.

## 13. Pipeline and production-data gates

The actual `V202601` candidate artifact must independently prove:

1. pinned archive byte count/SHA-256, safe ZIP members, member CRCs, exact
   `t,i,j,k,v,q` headers, and year/member agreement;
2. positive values, null-or-positive quantities, source numeric scale, unique
   annual keys, and complete economy/product metadata joins;
3. 5,202 unique six-digit HS12 source products and complete accepted Chinese
   catalog/review manifest;
4. expected 2012-2024 members, 2019-2023 primary window, and 2024 provisional
   separation;
5. reconciled source, Parquet, DuckDB table, and product-year totals;
6. read-only reopening through `DuckDbTradeEvidenceSource`;
7. equivalent normalized outputs from the DuckDB and fixture adapters for a
   small checked projection;
8. artifact/catalog/status/deployment checksums and compatibility;
9. no raw BACI rows, archives, Parquet, or DuckDB artifacts committed to git or
   exposed through public routes; and
10. all contract, artifact-derived, and operational gates before atomic
    promotion.

Source drift outside the pinned tolerances requires explicit release review; it
cannot be normalized away by snapshot refresh.

## 14. Traceability and release evidence

Each requirement is owned once and exercised at the lowest reliable layer:

| Contract | Primary fixture layer | Release evidence |
|---|---|---|
| HS identity, source parsing, absence/null semantics | pipeline + evidence-adapter integration | source/artifact verification report |
| `cms-v1`, confidence, stability, discontinuity | pure domain + fixture adapter | exact analysis snapshots |
| Product language and search | catalog build + search module | golden query manifest and coverage review |
| Freshness and Release Revision | pure state/comparison modules | boundary snapshots |
| HTTP and caching | Route Handler integration | header/status matrix |
| CSV | serializer + route integration | expected bytes and SHA-256 |
| Focused analyst task | Playwright on production build | English/Chinese journey report |
| Performance, resilience, cost | complete artifact on candidate deployment | signed promotion report |
| Company-data exclusion | static contract/schema scan | forbidden-surface report |

Every promotion report records pass/fail, tool and dependency versions, fixture
digests, build IDs, artifact SHA-256, timestamps, and links to retained logs.
Flaky retries are reported as failures until their cause is fixed; a rerun does
not erase the first result.

## 15. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Use prototype values as the oracle | Both prototypes explicitly used illustrative placeholder data and one used an HS22 smartphone code as if it were HS12 |
| Copy a sample of live BACI rows into git | Creates licensing/size/update ambiguity and still cannot target every branch deterministically |
| Use only synthetic fixtures | Cannot prove actual archive shape, worst-product latency, artifact size, or deployment cost |
| Use only live-data snapshots | Annual revisions make branch coverage and exact expected outputs unstable |
| One giant end-to-end test | Slow failures cannot identify whether source, domain, transport, or UI semantics broke |
| Snapshot every internal object | Couples tests to implementation rather than public/domain contracts |
| Refresh expected files automatically | Converts regressions into accepted output without a reviewed decision |
| Hard-code performance product codes now | The sparse/median/maximum rows are facts of each built release and must be selected from it |
| Treat missing rows as zeros for easier fixtures | Violates the dataset and score decisions and fabricates negative evidence |
| Use a provisional value to fill a finalized gap | Mixes clocks and silently changes score evidence |
| Accept manual spreadsheet inspection as CSV proof | Cannot prove deterministic bytes, formula safety, schema width, or reversible escaping |

## 16. Binding decisions

This fixture pack consumes and does not reopen:

- [MVP trade dataset and HS nomenclature](./2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md)
- [Candidate Market Score and data confidence](./2026-07-11-candidate-market-score-and-confidence.md)
- [Candidate Market discovery workflow](https://github.com/huangyingting/HSTracker/issues/3)
- [Public-web data and deployment architecture](./2026-07-11-public-web-data-and-deployment-architecture.md)
- [Company-level trade-data extension boundaries](./2026-07-11-company-level-trade-data-extension-boundaries.md)
- [HS product descriptions and search language](./2026-07-11-hs-product-description-and-search-language.md)
- [Trade-data freshness and provisional-year presentation](./2026-07-11-trade-data-freshness-and-provisional-presentation.md)
- [Candidate Market Score presentation](https://github.com/huangyingting/HSTracker/issues/10)
- [Result export contract](./2026-07-11-result-export-contract.md)
- [MVP performance and caching targets](./2026-07-11-mvp-performance-and-caching-targets.md)

The remaining work is implementation slicing and execution. New behavior may add
fixtures, but it may not weaken this pack or silently reinterpret an existing
fixture identity.
