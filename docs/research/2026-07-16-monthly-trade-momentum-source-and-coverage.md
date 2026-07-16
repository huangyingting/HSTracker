# Decision: Monthly trade momentum source, coverage, and recipe

**Status:** Decision complete  
**Decided:** 2026-07-16  
**Accessed:** 2026-07-16

## Decision

Add one independent Analysis Recipe, `recent-trade-momentum-v1`. Its first
release uses Eurostat Comext alone for detailed monthly import data.

The pilot supports the 27 current EU Member States as reporting import markets,
all individually identified partner economies in the source, and only canonical
HS 2012 six-digit products for which every applicable annual Combined
Nomenclature source code has an exact, reviewed mapping to HS 2012. The recipe
aggregates partners to one reporting-market/product/month observation; it does
not infer a bilateral opportunity for the selected export economy.

The public result is a **Recent Trade Momentum Signal**. It compares the latest
three complete source months with the same three calendar months one year
earlier, using nominal current-euro import statistical value. It is supporting
evidence beside annual BACI, not a forecast, score component, rank input, or
replacement for reconciled annual evidence.

| Area | Binding decision |
|---|---|
| Recipe | `recent-trade-momentum-v1` |
| First source | Eurostat Comext detailed monthly trade in goods |
| Reporting markets | Belgium, Bulgaria, Czechia, Denmark, Germany, Estonia, Ireland, Greece, Spain, France, Croatia, Italy, Cyprus, Latvia, Lithuania, Luxembourg, Hungary, Malta, Netherlands, Austria, Poland, Portugal, Romania, Slovenia, Slovakia, Finland, and Sweden |
| Flow | Imports into the reporting market |
| Partner scope | Sum of individually identified partner economies; source aggregates and confidential/unknown partners are not treated as identified partners |
| Product identity | Canonical HS 2012 six-digit, exact reviewed mapping only |
| Value | Nominal import statistical value in current EUR, normally CIF at the reporting-country border |
| Comparison | Latest three eligible months versus the same months one year earlier |
| Publication | Immutable, content-addressed DuckDB Dataset Package |
| Mutable storage | Watches, last evaluation state, alert events, and delivery attempts only |
| Update | Check after each Eurostat monthly release; publish accepted packages within 24 hours |
| UN Comtrade | Prohibited unless a later written licence/subscription decision explicitly authorizes the proposed use and re-dissemination |

The reusable source attribution is:

> Source: Eurostat Comext, detailed monthly international trade in goods,
> extraction [UTC timestamp], current-euro import statistical value. Licensed
> under CC BY 4.0. HS Tracker aggregated source CN codes and mapped eligible
> products to HS 2012; changes are indicated in source details.

This is a deliberately limited pilot. It is better to publish one coherent,
rights-cleared source with exact coverage than to imply worldwide monthly
coverage or silently combine reporters whose customs concepts, product
classifications, currencies, revision clocks, and legal terms differ.

## 1. Canonical terminology and identity

**Recent Trade Momentum Signal**: Source-specific, reporting-market-level
evidence describing the direction of recently recorded nominal imports for one
canonical HS Product. It is not a demand forecast, a seasonally adjusted volume
measure, an exporter-specific opportunity, or evidence of market accessibility.

**Monthly Source Observation**: One source-published fact at exact source,
extraction, reporting economy, partner, flow, reference month, source
classification, source product code, value unit, and source-state grain.

**Eligible Complete Month**: A reference month contained in a complete official
Comext monthly bulk file, acquired as a whole, whose bytes, schema, dimensions,
period, reporter coverage, product dictionary, and control totals pass this
decision's conformance gates. It means complete as a publication object, not
final or unrevisable statistics.

**Source Vintage**: One immutable extraction of official source bytes and
metadata at a recorded UTC instant. A later extraction is another Source
Vintage even when it has the same newest reference month.

**Mapping Status**: One of `EXACT_REVIEWED`, `AMBIGUOUS`, `SPLIT`, `MERGED`,
`UNMAPPED`, or `NOT_APPLICABLE`. Only `EXACT_REVIEWED` contributes to an HS12
product observation or signal.

**Update State**: `PRELIMINARY`, `FINAL_BY_SOURCE_SCHEDULE`, or
`HISTORICALLY_REVISED`. Eurostat considers monthly data final by October of the
following reference year but may still receive historical corrections; final
therefore never means immutable.

**Coverage State**: `SUPPORTED`, `SUPPORTED_NO_SIGNAL`, `NOT_OBSERVED`,
`SUPPRESSED_OR_REALLOCATED`, `UNSUPPORTED_MARKET`, `UNSUPPORTED_PRODUCT_MAPPING`,
or `SOURCE_UNAVAILABLE`. These states are not numeric values.

Exact version identities are:

```text
recipe_id = recent-trade-momentum-v1
result_schema_version = recent-trade-momentum-result-v1
package_schema_version = monthly-trade-dataset-package-manifest-v1
artifact_schema_version = monthly-trade-artifact-v1
capability = recent-trade-momentum/reporting-market-import-value@1
mapping_policy = cn-to-hs12-exact-complete-preimage-v1
```

The Analysis Identity digests:

```text
recipe_id
+ exact monthly Dataset Package identity
+ reporting economy identity
+ canonical HS12 product code
```

Locale, selected export economy, watch owner, delivery channel, request time,
and annual BACI build do not change this identity. A package identity digests
its canonical manifest, source object checksums, extraction timestamp, source
metadata version, all annual CN identities and mapping evidence, artifact
checksum, coverage, recipe capability, quality approval, and attribution.

Changing the comparison windows, eligibility, thresholds, small-base rule,
mapping acceptance, missingness treatment, value measure, aggregation, signal
states, or confidence rules requires a new recipe version.

## 2. Official source evaluation

### 2.1 Candidate comparison

| Source | Product/reporter/partner coverage | Update and revision behavior | Access | Reuse decision | Outcome |
|---|---|---|---|---|---|
| **Eurostat Comext detailed ITGS** | Monthly CN8 imports/exports by reporting country and partner; EU Member States, additional historical/non-EU reporters, aggregates, and confidential reallocations occur | Detailed data update monthly. Revised national data are transmitted and recomputed; data are generally final by October of the following year, with later historical corrections possible | Official Comext database and complete monthly/annual CSV bulk files from January 1988 to latest reference month | Commission-owned content is CC BY 4.0 unless otherwise indicated; credit and change indication required | **Select for v1**, restricted to current EU-27 reporters and exact HS12 mappings |
| **U.S. Census International Trade API** | Monthly U.S. imports and exports at HS2/4/6/10, country, district, value, quantity, and other dimensions | Monthly source; revised data and annual revisions require source-specific replay rules | Official API; variable catalogue is public, data extraction requires an API key under current behavior | Census publishes public data as open data and provides citation guidance, but production key, request limits, complete historical extraction, revision behavior, and redistribution notice still need a source-adapter conformance record | Strong next single-reporter adapter; reject from v1 to avoid a second source contract |
| **HMRC UK Trade Info** | Monthly UK trade by commodity and partner through official API and bulk datasets; UK-specific collection and geographic breaks require explicit treatment | Monthly releases and revised bulk files; Northern Ireland/Great Britain regime changes are material to time-series interpretation | Official API documentation and complete bulk datasets | UK Trade Info states OGL v3.0 except where otherwise stated; OGL permits commercial and non-commercial copying, adaptation, and publication with attribution | Strong next single-reporter adapter; reject from v1 to avoid a second source contract |
| **UN Comtrade** | Broad global reporter/partner/flow coverage and multiple HS revisions, including monthly observations where reporters provide them | Reporter-dependent availability, revisions, conversions, and flags | API and subscription products | Current Usage Agreement and re-dissemination FAQ restrict automated downloading, publication, redistribution, and commercial analytics without the applicable written permission, premium/institutional subscription, and fees | **Prohibited** under the current MVP decision; fail closed |

Eurostat's primary nomenclature is CN8. CN is based on HS with an EU two-digit
extension and is revised annually. The source describes reporting country,
partner country, reference month, flow, product, statistical value, and
quantity. Import statistical value is valued at the reporting-country border
and is normally CIF; exports are normally FOB. The pilot uses imports only.

Eurostat also documents late/non-response in intra-EU statistics and passive
confidentiality. Confidential detail can be hidden from the real product or
partner and retained only in a broader chapter or special code. Therefore a
missing detailed row is not a measured zero, and a confidential aggregate may
not be allocated back to an HS6 product.

### 2.2 Exact first pilot scope

The package reporter allowlist is the ISO alpha-2 set:

```text
AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK
```

Each reporter maps to one reviewed ISO 3166-1 alpha-2/alpha-3 identity and the
repository economy identity used for navigation. EU aggregates, euro-area
aggregates, EFTA reporters, candidate countries, historical UK, Northern
Ireland, and every source geography not in this allowlist are unsupported in
v1. A future EU accession or withdrawal changes the source coverage policy and
requires a new package capability version; an old package keeps its original
allowlist.

The source grain is retained before aggregation:

```text
source_id = EUROSTAT_COMEXT_DETAIL
source_vintage_id
reference_month
reporter_source_code
partner_source_code
flow = IMPORT
cn_edition_year
cn8_code
value_eur
source_confidentiality_or_special_code
source_update_state
```

The analytical observation is:

```text
source_vintage_id
reference_month
reporter_iso2
hs12_code
identified_partner_value_eur
contributing_partner_count
contributing_cn8_count
excluded_confidential_or_special_value_eur
mapping_status = EXACT_REVIEWED
update_state
```

`identified_partner_value_eur` sums only source rows for individually
identified partners and eligible CN8 codes. It does not sum source regional
aggregates, world totals, confidential partner codes, unknown partners, or
special residuals. Partner codes are mapped through a versioned Eurostat-to-ISO
table. One-to-one territories may remain individually identified; aggregates,
unknowns, and changing/non-equivalent entities are excluded and disclosed.

The pilot may not launch until a complete official extraction path is pinned
and reproducible from the Comext bulk facility, including stable file discovery,
checksums captured by HS Tracker, dictionaries, annual CN tables, and control
totals. The official page establishes that complete monthly CSV files exist; a
human download or undocumented browser call is not an accepted production
adapter.

## 3. Product classification and economy rules

### 3.1 Canonical product mapping

CN edition is identified by reference calendar year. For each edition, pin the
official CN code list and correspondence evidence. Derive the six-digit HS
edition represented by each CN8 code, then use official UNSD HS correspondence
tables for any required HS-edition steps to HS2012. Never map by description,
prefix similarity across HS editions, a model, or trade-value allocation.

For a source CN8 code `c` in edition `y`, calculate the complete set
`targets(c,y)` of reachable HS2012 six-digit codes through the reviewed official
correspondence chain. Accept `c` only when:

1. `c` is an ordinary product code, not confidential, unknown, total, chapter
   99 residual, or another special code;
2. every correspondence edge in the chain is present in pinned official
   evidence;
3. `targets(c,y)` contains exactly one HS2012 code; and
4. no edge is qualified, partial, ex-, split, merged, or otherwise requires an
   allocation judgment.

Product-level eligibility is stricter than row eligibility. For canonical
HS12 product `h` and edition `y`, identify the complete source-code preimage:

```text
P(h,y) = every active CN8 code whose correspondence path includes h
```

`h` is eligible in edition `y` only if every member of `P(h,y)` maps exactly
and exclusively to `h`. If any active source code touching `h` is ambiguous,
split, merged, qualified, unmapped, or special, the entire product is
`UNSUPPORTED_PRODUCT_MAPPING` for that edition. It is not acceptable to keep
only the convenient fragments and call the resulting subtotal the product.

A signal spanning two calendar years requires the product to be eligible under
every CN edition represented in both comparison windows. The package records
each edition, source checksum, correspondence-chain checksum, accepted CN8
preimage, rejected touching codes, reviewer approval, and mapping status.

### 3.2 Economy and partner mappings

Reporter mappings are closed by the EU-27 allowlist. Partner mappings are
versioned by source code and validity interval. Acceptance requires exactly one
individual ISO identity for the reference month. Do not silently treat an EU
aggregate, customs territory, free zone, stores/provisions code, confidential
partner, or area not elsewhere specified as a country.

Changing labels does not change identity. A geopolitical boundary or source
code change that prevents one-to-one comparison produces a coverage break and
`SUPPORTED_NO_SIGNAL` until the recipe again has the required comparable
history.

## 4. Values, absence, zero, and revision semantics

The only v1 measure is source import statistical value in integer current EUR.
Preserve source integer precision and sum with a checked 64-bit integer or
larger exact decimal. Do not convert to USD, deflate, seasonally adjust, divide
by quantity, or combine it numerically with BACI.

The states are exact:

| State | Meaning | Numeric treatment |
|---|---|---|
| `RECORDED_POSITIVE` | At least one eligible detailed source row contributes and the aggregate is greater than zero | Use exact sum |
| `RECORDED_ZERO` | The official source explicitly publishes eligible rows whose exact aggregate is zero | Preserve zero, but it is not eligible for the log/ratio recipe |
| `NOT_OBSERVED` | No eligible detailed row is published for the key in an otherwise accepted monthly file | Unknown; never fill with zero |
| `SUPPRESSED_OR_REALLOCATED` | Source flags or special codes show detail was hidden or moved | Unknown at HS6; never allocate |
| `UNSUPPORTED_PRODUCT_MAPPING` | Exact complete-preimage mapping failed | No product observation |
| `UNSUPPORTED_MARKET` | Reporter is outside the package allowlist | No market observation |
| `SOURCE_UNAVAILABLE` | Required source object or conformance evidence is unavailable | No observation or signal |

Every Source Vintage re-ingests the replay window from official bytes. Compare
it with the immediately preceding accepted package at identical source grain
and classify rows as inserted, deleted, value-changed, state-changed, or
unchanged. Do not update a published DuckDB file. Publish a new package with
`supersedes_package_identity` and a revision report containing affected
periods, reporters, products, row counts, and absolute value deltas.

The normal replay window is all months from January of the prior calendar year
through the newest reference month. In October, when Eurostat generally marks
the prior reference year final, replay at least the prior two complete calendar
years. If source metadata announces a broader historical correction, rebuild
all affected years. A same-period difference is a Source Revision, not trade
momentum.

## 5. Deterministic momentum recipe

### 5.1 Eligible cutoff and windows

For reporter `r`, product `h`, and accepted package `D`, let `C` be the latest
Eligible Complete Month for which `r` is present in source reporter controls
and `h` is `EXACT_REVIEWED` for every required CN edition.

Define:

```text
R = {C-2 months, C-1 month, C}             recent window
B = {C-14 months, C-13 months, C-12 months} seasonal baseline
H = {C-23 months, ..., C}                  coverage history
```

`B` is the same three calendar months one year before `R`. This is a direct
seasonal comparison, not a claim of formal seasonal adjustment. The recipe
requires 24 consecutive accepted monthly publication objects through `C`.

A numeric signal is eligible only when:

1. all six product-months in `R` and `B` are `RECORDED_POSITIVE`;
2. every month in `H` has a supported classification and reporter identity;
3. at least 18 of 24 months in `H` are `RECORDED_POSITIVE`;
4. neither comparison window contains suppression/reallocation or a coverage
   break;
5. `recent_value_eur >= 250,000` and `baseline_value_eur >= 250,000`; and
6. no single month contributes more than 80% of its three-month window.

The 24-month requirement makes coverage quality observable; the six exact
positive months avoid converting absence to zero. The EUR 250,000 floor and
80% concentration cap prevent a tiny denominator or one shipment from being
presented as broad momentum. These are product decisions, not Eurostat
thresholds.

### 5.2 Calculation and states

Calculate with exact integer sums and decimal division:

```text
recent_value_eur = sum(value_eur[m]) for m in R
baseline_value_eur = sum(value_eur[m]) for m in B
growth_rate = recent_value_eur / baseline_value_eur - 1
growth_percent = 100 * growth_rate
```

Retain `growth_rate` to at least 12 decimal places. Compare unrounded values to
thresholds. Display `growth_percent` rounded half away from zero to one decimal
place. Signal states are:

| State | Exact threshold |
|---|---:|
| `RISING_FAST` | `growth_rate >= 0.25` |
| `RISING` | `0.10 <= growth_rate < 0.25` |
| `BROADLY_STABLE` | `-0.10 < growth_rate < 0.10` |
| `FALLING` | `-0.25 < growth_rate <= -0.10` |
| `FALLING_FAST` | `growth_rate <= -0.25` |

Non-directional result reasons are:

```text
INSUFFICIENT_COMPLETE_HISTORY
INSUFFICIENT_RECORDED_MONTHS
MISSING_COMPARISON_MONTH
SMALL_BASE
WINDOW_CONCENTRATION
SUPPRESSED_OR_REALLOCATED
CLASSIFICATION_BREAK
UNSUPPORTED_PRODUCT_MAPPING
UNSUPPORTED_MARKET
SOURCE_UNAVAILABLE
```

These produce `SUPPORTED_NO_SIGNAL` where the source/market/product capability
exists but the numeric recipe is not eligible, or the applicable unsupported
state otherwise. None becomes `BROADLY_STABLE`, zero growth, or negative
evidence.

### 5.3 Confidence and coverage

Direction and confidence are separate. Confidence never changes the signal
threshold or direction.

Start at `HIGH`, then apply caps:

| Evidence condition | Confidence cap |
|---|---|
| 24/24 history months recorded positive, all comparison months final by source schedule | `HIGH` |
| 20-23/24 history months recorded positive | `MEDIUM` |
| 18-19/24 history months recorded positive | `LOW` |
| Any comparison month remains preliminary | `MEDIUM` |
| Any accepted month uses a multi-step but still exact HS correspondence chain | `MEDIUM` |
| A package revision changes either comparison-window sum by at least 5% relative to the superseded package | `LOW` |

Fewer than 18 recorded-positive history months is no signal, not `LOW`.
Expose recorded-month count, expected-month count, recent and baseline month
lists, source update states, mapping chain, identified-partner count, excluded
special/confidential value where measurable, and confidence reasons.

### 5.4 Relationship to annual BACI

Annual BACI remains the stable structural baseline and owns `cms-v1`,
`opportunity-discovery-v1`, Trade Trend, Supplier Competition, and Trade
Explorer evidence. The monthly signal:

- never enters either score, rank, component percentile, confidence value, or
  cohort;
- never replaces a BACI Finalized or Provisional Year;
- does not reconcile mirror reports or convert Eurostat CIF imports to BACI's
  reconciled FOB-equivalent values;
- may disagree with annual BACI without either result being overwritten; and
- is shown in a separate panel titled `Recent trade momentum - Eurostat
  coverage` with its own source, currency, period, and revision state.

The selected export economy may identify a watch and adjacent BACI context, but
does not enter the v1 monthly calculation. Copy must say that the signal covers
total recorded imports into the reporting market from identified partners, not
imports from the selected exporter.

## 6. Immutable publication and runtime contract

### 6.1 Pipeline and package

The offline pipeline is:

```text
official Comext file discovery
-> immutable raw source objects and HTTP metadata
-> checksum/schema/dictionary/control validation
-> normalized source-grain Parquet staging
-> exact CN-to-HS12 mapping and coverage report
-> reporter-product-month aggregation
-> recent-trade-momentum-v1 materialization
-> compact DuckDB artifact and manifest
-> independent capability validation and atomic activation
```

Raw objects, dictionaries, mappings, staging manifests, conformance reports,
and DuckDB artifacts use immutable content-addressed keys. Store source bytes
privately unless a separate publication decision explicitly authorizes raw
redistribution. Public APIs expose derived observations and signals, not bulk
source records.

The compact artifact contains:

```text
reporter(reporter_id, source_code, iso2, iso3, display_name, valid_from, valid_to)
partner(partner_id, source_code, iso2, iso3, kind, valid_from, valid_to)
product_mapping(cn_edition_year, cn8_code, hs12_code, mapping_status,
                correspondence_sha256, review_id)
market_month(reference_month, reporter_id, hs12_code, value_eur,
             contributing_partner_count, contributing_cn8_count,
             excluded_special_value_eur, observation_state, update_state)
momentum(reporter_id, hs12_code, cutoff_month, recent_value_eur,
         baseline_value_eur, growth_rate_decimal, signal_state,
         confidence, recorded_history_months, reason_codes)
artifact_metadata(key, value)
```

Primary keys are unique. Physically order `market_month` by
`(reporter_id, hs12_code, reference_month)` and `momentum` by
`(reporter_id, hs12_code)`. Public serving does not need partner-grain rows.

The manifest contains at least:

```text
schema/version identities and package identity
source owner, dataset, source URLs, extraction timestamp, source-vintage ID
every raw object byte length and SHA-256
source metadata, dictionary, CN edition, and correspondence identities
reporter allowlist and partner mapping version
reference-month range and newest eligible month by reporter
preliminary/final/revised periods
accepted/rejected HS12 products by edition and reason
row counts, value control totals, exclusions, and revision report identity
artifact path, bytes, SHA-256, DuckDB version, and build timestamp
recipe capability and exact parameters
quality approval and conformance report SHA-256
licence name/URL, attribution, documentation URLs, and change indication
superseded package identity, if any
benchmark queries and measured resource report
```

### 6.2 Cadence, SLO, retention, and replay

Check Eurostat's release calendar daily from day 35 through day 60 after each
reference month and weekly otherwise. Detect a changed source vintage by
official file identity/metadata plus acquired-byte checksum, not filename
alone.

After detecting new or revised bytes:

- publish `UPDATE_IN_PROGRESS` within 15 minutes;
- normally validate and publish an accepted package within 24 hours;
- warn at 24 hours and page at 48 hours;
- activate or publish `REFRESH_DELAYED` within seven days; and
- keep serving the last accepted package with its exact coverage warning on
  failure.

Retain current plus two preceding complete monthly packages resident, matching
the repository Deployment Retention Window, and retain all source objects,
manifests, mapping evidence, revision reports, and alert-referenced packages in
durable object storage for at least 25 months. Do not delete a package while an
alert event or retained canonical link references it.

### 6.3 Runtime module and activation

Use a new deep module rather than adding Eurostat columns to BACI interfaces:

```ts
type RecentTradeMomentumV1Request = Readonly<{
  recipe: "recent-trade-momentum-v1"
  monthlyPackageId: string
  reportingEconomyIso2: string
  product: Readonly<{ hsRevision: "HS12"; code: string }>
}>

interface RecentTradeMomentumAnalysis {
  analyze(
    request: RecentTradeMomentumV1Request,
  ): Promise<RecentTradeMomentumOutcome>
}
```

Typed outcomes distinguish success, supported-no-signal, unsupported market,
unsupported product mapping, invalid input, incompatible/retired package,
temporary unavailability, resource rejection, and internal failure.

Extend the Recommended Dataset Mapping with an optional, separately referenced
monthly package and `recent-trade-momentum-v1` declaration. Existing mappings
without it remain valid for every existing recipe. Startup activates the
monthly recipe only after verifying manifest identity, source rights approval,
artifact checksum, schema, capability version, coverage, mapping report, and
smoke queries. Failure disables only monthly momentum and surfaces
`NO_COMPATIBLE_MONTHLY_DATASET_PACKAGE`; it must not prevent BACI runtime
readiness or borrow evidence from another package.

Object-store recovery never hot-swaps a running process. A controlled restart
activates a newly recommended package. Each retained deployment binds its own
monthly recommendation or explicitly declares none. An old pin never resolves
against the current monthly package.

## 7. Watches and alerts

### 7.1 Watch identity and cadence

A watch records:

```text
watch_id
owner_id
reporting_economy_iso2
hs_revision = HS12
hs12_code
optional adjacent export_economy_code (navigation only)
cadence = MONTHLY | QUARTERLY
delivery preferences
created_at, paused_at, deleted_at
```

The optional export economy never enters the signal. Monthly watches evaluate
once for each newly activated package or revision affecting their evidence.
Quarterly watches evaluate only when the package contains a newly complete
calendar-quarter endpoint (`03`, `06`, `09`, or `12`); a revision can still
re-evaluate an already evaluated endpoint.

### 7.2 Trigger and material change

The evaluator compares the exact current result with the last evaluation for
the same watch and recipe version.

Create an alert when any condition holds:

1. first eligible result is `RISING`, `RISING_FAST`, `FALLING`, or
   `FALLING_FAST`;
2. direction crosses between rising, stable, and falling families;
3. state changes between ordinary and fast within one direction;
4. absolute unrounded growth-rate change is at least 0.10 (10 percentage
   points), even if the named state is unchanged;
5. a prior directional result becomes supported-no-signal or unsupported; or
6. a previously unavailable result becomes eligible and directional.

Do not alert on first `BROADLY_STABLE`, confidence-only changes, package
identity alone, label changes, or growth changes below 10 percentage points
that do not cross a state threshold. The UI may still show those evaluations.

The deterministic deduplication key is the SHA-256 of:

```text
watch_id + recipe_id + evaluated_cutoff_month + monthly_package_identity
+ event_kind + prior_alert_event_id_or_null
```

Retries reuse the same event and delivery IDs. Delivery is at-least-once;
providers' duplicate sends are suppressed by idempotency key where supported.

### 7.3 Revisions and retractions

Every newly activated package evaluates affected watches against its own
immutable facts. If a Source Revision would have prevented or materially
changed an alert, append one of:

```text
REVISION_UPDATE
REVISION_RETRACTION
REVISION_REINSTATEMENT
```

The event references the original alert, old and new package identities, old
and new states/rates, affected periods, and revision report. Never delete or
overwrite the original event. A retraction says the source revised the
underlying data; it does not claim the earlier computation was erroneous.

### 7.4 Mutable versus analytical storage

PostgreSQL is the standard production operational store. SQLite is a supported
lightweight deployment adapter with complete watch and alert behavior under a
strict single-application-process and single-evaluator constraint; local
development uses this mode by default. Both adapters satisfy one business
storage contract and the same behavioral contract suite. PostgreSQL has
additional concurrency and transaction-isolation tests; SQLite has additional
WAL, single-writer lease, backup, and recovery tests. Database-specific
branches stay inside the adapters.

Both stores contain only:

```text
watches and ownership/delivery preferences
last_evaluation(watch_id, recipe_id, package_id, cutoff_month,
                result_digest, state, growth_rate, confidence, evaluated_at)
alert_event(event_id, dedupe_key, watch_id, recipe_id, package IDs,
            cutoff_month, kind, prior_event_id, immutable payload, created_at)
delivery(delivery_id, event_id, channel, idempotency_key, status,
         attempt_count, last_attempt_at, provider_receipt)
```

They do not store source observations, monthly fact history, product mappings,
derived cohort tables, alternate analytical values, or mutable copies of
DuckDB results. `last_evaluation` is operational cursor/state, not analytical
source of truth; it can be rebuilt by replaying packages and events.

The SQLite file must reside on a local persistent volume, never object storage
or a general network share. Startup fails closed when another application or
evaluator lease is live. The supported upgrade path is a maintenance-mode,
one-way migration: export stable UUID-keyed canonical business records, import
them into PostgreSQL in one transaction, verify counts, references, and
digests, then retain the SQLite file as a read-only archive. There is no
dual-write or bidirectional replication mode.

## 8. User-facing copy and non-claims

Successful compact copy is:

```text
Recent trade momentum - Eurostat coverage
Germany imports, HS 2012 010121
Mar-May 2026 vs Mar-May 2025: Rising (+14.2%)
Current EUR - preliminary - 24/24 months recorded
Source: Eurostat Comext. Total recorded imports from identified partners;
not specific to the selected exporter and excluded from BACI scores and ranks.
```

Source details always expose source, reporting economy, exact comparison
months, source extraction, newest eligible month, CN editions and mapping
status, value/currency/border valuation, update/revision state, coverage,
excluded confidential/special treatment, package/recipe identity, attribution,
and link to the annual BACI context.

Exact missing/coverage copy is:

| State | Public copy |
|---|---|
| `SUPPORTED` | `Recent momentum available for this Eurostat reporting market and exact HS 2012 mapping.` |
| `SUPPORTED_NO_SIGNAL` | `Eurostat coverage exists, but the fixed momentum recipe does not have sufficient comparable evidence.` |
| `NOT_OBSERVED` | `No eligible detailed observation was published for one or more required months. This is unknown, not zero trade.` |
| `SUPPRESSED_OR_REALLOCATED` | `Some detailed trade was confidential or reallocated by the source, so no HS 2012 product signal is calculated.` |
| `UNSUPPORTED_PRODUCT_MAPPING` | `This product cannot be mapped exactly and completely from the applicable source classifications to HS 2012.` |
| `UNSUPPORTED_MARKET` | `Recent momentum is not available for this reporting market in the Eurostat pilot.` |
| `SOURCE_UNAVAILABLE` | `Recent momentum is temporarily unavailable. Annual BACI evidence is unchanged.` |

Never say `live`, `real-time`, `worldwide`, `demand is growing`, `sales
opportunity`, `market will grow`, `no trade`, `zero imports`, or `recommended
market`. Use `recorded nominal imports rose/fell in this source comparison`.
Do not compare current EUR values numerically with BACI current USD values or
place the monthly badge inside a score/rank label.

## 9. Acceptance and rollout gates

### 9.1 Synthetic oracle

Create `recent-trade-momentum-fixtures-v1` with two reporters, three HS12
products, 25 months, two CN editions, identified and special partners, and two
Source Vintages. Pin exact expected bytes and cover:

- exact three-month sums and same-month-prior-year selection across a year
  boundary;
- thresholds immediately below, exactly at, and above -25%, -10%, +10%, and
  +25%;
- half-away-from-zero one-decimal display without rounded-threshold logic;
- 24/24, 20/24, 18/24, and 17/24 coverage outcomes;
- one missing comparison month, explicit zero, suppression, EUR 249,999 and
  250,000 bases, and exactly 80% versus above-80% concentration;
- direct exact mapping, exact multi-step mapping, split, merge, qualified,
  unmapped, and one ambiguous code poisoning the complete HS12 preimage;
- source-code reorder producing byte-identical output;
- partner aggregate exclusion and no double-counting of world totals;
- preliminary/final confidence caps; and
- revision insert/delete/value/state changes with update, retraction, and
  reinstatement alert events.

### 9.2 Source conformance and licensing gates

Promotion blocks unless all are true:

1. The official Eurostat source URL, metadata, acquired bytes, lengths,
   checksums, extraction time, and dictionaries are retained.
2. Complete-file discovery is reproducible without browser automation or an
   undocumented private endpoint.
3. File period, schema, dimension domains, reporter allowlist, uniqueness, and
   integer value constraints pass.
4. Source totals reconcile to independently acquired official control totals
   at reporter/month/flow within exact equality where definitions match;
   otherwise the mismatch and its documented dimensional cause are zero before
   promotion.
5. Every accepted product's complete CN preimage and every rejected touching
   code are proven from pinned correspondence evidence.
6. Aggregate, confidential, residual, and unknown partner/product codes are
   classified and excluded without allocation.
7. Current Commission legal notice still covers the source content under CC BY
   4.0, required attribution/change indication is present, and no dataset-level
   exception contradicts it.
8. A recorded human rights review approves the exact acquisition, derived
   display, alerts, commercial use, retention, and public output. Any ambiguity
   blocks activation pending written Eurostat permission.
9. No UN Comtrade bytes, API result, conversion output, or copied trade fact is
   present.

Rights are fail-closed. API availability, absence of a paywall, or a general
open-data slogan is not licence evidence.

### 9.3 Artifact, performance, and cost gates

The complete production package must prove:

- source-grain and aggregate row uniqueness and value reconciliation;
- deterministic rebuild to identical analytical rows from identical inputs;
- read-only DuckDB reopen, manifest/hash validation, and all smoke queries;
- current plus two previous monthly artifacts fit inside the existing 50 GiB
  volume while preserving at least 25% free at peak activation;
- each monthly artifact is <= 1 GiB target and > 2 GiB blocks promotion pending
  a size/architecture review;
- momentum route loaded-artifact uncached p95 <= 200 ms, p99 <= 500 ms, process
  hit p95 <= 50 ms, and response <= 64 KiB uncompressed;
- watch evaluation of 100,000 active watches completes within 15 minutes with
  peak cgroup memory <= 85%, bounded concurrency, no duplicate events, and no
  fact copies in PostgreSQL/SQLite;
- existing Candidate Market, opportunity, Trade Trend, Supplier Competition,
  Trade Explorer, export, hydration, rollback, and retained-link gates do not
  regress; and
- standard hosted core infrastructure, including managed PostgreSQL, remains
  within the accepted approximately USD 100/month architecture-review budget;
  source licensing and message delivery are reported as separate product-data
  and delivery budgets. Crossing USD 100/month blocks rollout pending a new
  recorded cost decision.

Benchmark sparse, median, upper-quartile, and maximum-history products selected
deterministically from the complete candidate package. Report cache state,
package identity, machine class, p50/p95/p99/max, bytes, errors, queue time,
memory, spill, and evaluation throughput.

### 9.4 Rollout and rollback

Roll out in this order:

1. Build and approve source, mapping, and rights conformance with no public
   capability.
2. Shadow-build at least three consecutive monthly Source Vintages and compare
   revisions, mapping eligibility, coverage, package size, and SLOs.
3. Activate read-only momentum for the EU-27 pilot behind its independent
   capability; BACI remains primary.
4. Run one full monthly cycle with internal watch evaluation and delivery
   disabled.
5. Enable opted-in monthly and quarterly watches only after event, dedupe,
   revision, and delivery drills pass.

Rollback changes the active monthly recommendation to the last accepted
package or to `none`. It never mutates package bytes, deletes alert history, or
rolls back BACI. Automatically disable the monthly capability on checksum,
schema, rights, mapping, reporter-control, reconciliation, or smoke-query
failure. Pause new alert delivery when the source refresh is delayed seven days
or a revision/conformance anomaly exceeds its gate; continue showing the last
accepted package with an explicit delay state.

## 10. Rejected alternatives

| Alternative | Rejection |
|---|---|
| Add monthly values to `cms-v1` or `opportunity-discovery-v1` | Mixes raw reporter data with reconciled BACI and changes stable structural scores for only covered markets |
| Launch with Eurostat, Census, and HMRC blended | Different reporters, classifications, valuation/collection concepts, currencies, revisions, and legal paths would make one unexplained signal family |
| Use UN Comtrade now | Current repository decision and owner terms do not authorize the proposed automated commercial reuse/re-dissemination |
| Convert all CN/HS codes using proportional weights | Allocates ambiguous product identity and can manufacture a product trend |
| Accept only exact-looking fragments of an ambiguous product | Produces an undocumented subtotal while labelling it as the complete HS12 product |
| Truncate CN8 to six digits across all years | CN's HS basis changes with HS revisions; the same six characters are not a cross-edition identity guarantee |
| Fill absent months with zero | Turns non-reporting, confidentiality, or no published positive detail into negative market evidence |
| Compare latest month with previous month | Confounds seasonality, working days, holidays, and shipment timing |
| Formal seasonal adjustment at HS6 in v1 | Sparse, revised product series need model selection and diagnostics that the pilot cannot defend uniformly |
| Deflate or convert EUR to USD | Adds price/FX sources and recipes without making the source a volume measure; annual BACI remains independently labelled |
| Treat preliminary months as final | Contradicts Eurostat's documented routine revision cycle |
| Store monthly facts in PostgreSQL | Duplicates immutable analytical evidence in a mutable store and weakens package replay |
| Treat SQLite as an unverified PostgreSQL test double | Hides type, locking, and transaction differences; both are supported adapters with shared contract tests and database-specific operational tests |
| Run hosted PostgreSQL beside DuckDB in the same application Machine | Places reconstructible analysis and non-reconstructible account/watch state in one resource and failure domain |
| Overwrite an alert after revision | Destroys the exact evidence and message previously delivered |
| Infer zero from a complete monthly file | File completeness does not establish a product-level measured zero |

## 11. Primary-source references

External facts above rely only on data-owner or classification-owner sources,
all accessed 2026-07-16:

- Eurostat, [International trade in goods - detailed data metadata](https://ec.europa.eu/eurostat/cache/metadata/en/ext_go_detail_sims.htm): statistical grain, CN, reporter/partner concepts, current-price statistical value, CIF/FOB border valuation, confidentiality, monthly dissemination, timeliness, completeness limits, and revision/finality practice.
- Eurostat, [International trade in goods database](https://ec.europa.eu/eurostat/web/international-trade-in-goods/database): Comext full detailed data and complete monthly/annual CSV bulk files from January 1988 to the latest reference month.
- Eurostat, [Comext database](https://ec.europa.eu/eurostat/comext/newxtweb/): official detailed-data access surface, product classifications, and correspondence tables.
- Eurostat, [Bulk download facility](https://ec.europa.eu/eurostat/databrowser/bulk?lang=en&selectedTab=fileComext): official Comext bulk publication surface.
- European Commission, [Legal notice](https://commission.europa.eu/legal-notice): Commission reuse policy, CC BY 4.0 default, attribution, change indication, and third-party-rights caveat.
- European Commission, [Decision 2011/833/EU on reuse of Commission documents](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011D0833): governing Commission reuse decision.
- Creative Commons, [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode): licence permissions and conditions.
- U.S. Census Bureau, [International Trade Data API](https://www.census.gov/data/developers/data-sets/international-trade.html) and [imports HS variables](https://api.census.gov/data/timeseries/intltrade/imports/hs/variables.json): monthly API scope and HS aggregation levels.
- U.S. Census Bureau, [Open Data](https://www.census.gov/about/policies/open-gov/open-data.html): owner open-data and citation policy.
- HM Revenue & Customs, [UK Trade Info API documentation](https://www.uktradeinfo.com/uk-trade-data-api/) and [bulk datasets](https://www.uktradeinfo.com/trade-data/latest-bulk-data-sets/): official UK monthly source access.
- HM Revenue & Customs, [bulk dataset guidance and technical specifications](https://www.uktradeinfo.com/trade-data/latest-bulk-data-sets/bulk-data-sets-guidance-and-technical-specifications/): source fields and file contract.
- The National Archives, [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/): commercial/non-commercial reuse and attribution conditions.
- UN Comtrade, [Usage Agreement](https://comtrade.un.org/licenseagreement.html) and [FAQs on use and re-dissemination](https://uncomtrade.org/docs/faqs-on-use-and-re-dissemination/): automation, subscription, publication, transformation, and dissemination restrictions.
- UN Comtrade, [Data Conversion](https://uncomtrade.org/docs/data-conversion/) and [commodity conversion issues](https://uncomtrade.org/docs/reported-and-converted-data-commodity-conversion-issues/): split/merge and individual-product conversion limitations.
- United Nations Statistics Division, [classification correspondence tables](https://unstats.un.org/unsd/classifications/Econ#corresp-hs): official HS revision correspondences used only as reviewed classification evidence, not as UN Comtrade trade facts.
- European Commission, [Combined Nomenclature](https://taxation-customs.ec.europa.eu/customs-4/calculation-customs-duties/customs-tariff/combined-nomenclature_en): annual CN legal/product identity context.

Repository contracts remain authoritative for implementation:

- `CONTEXT.md` defines HS Product, Analysis Recipe, Dataset Package, Analysis
  Identity, Recommended Dataset Mapping, typed outcomes, and deployment
  retention.
- `2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md` owns BACI, HS12,
  missingness, and the UN Comtrade prohibition.
- `2026-07-11-trade-data-freshness-and-provisional-presentation.md` owns the
  distinction between source period, source update, release revision, and
  operational freshness.
- `2026-07-11-public-web-data-and-deployment-architecture.md` owns immutable
  DuckDB publication, read-only runtime, object-store activation, and module
  boundaries.
- `2026-07-11-mvp-performance-and-caching-targets.md` owns the existing runtime,
  volume, load, cost, and rollback gates preserved here.
- `reports/releases/V202601.artifact-build-report.json` records the current
  1,002,975,232-byte BACI artifact and confirms why the monthly package must be
  independently bounded and activated.
- Current Dataset Package capability declarations, Recommended Dataset Mapping
  validation, and `VerifiedReleaseRuntime` establish the fail-closed extension
  pattern used by this decision.

## Final recommendation

Implement `recent-trade-momentum-v1` as a Eurostat Comext-only EU-27 pilot.
Publish exact-mapped reporting-market/product/month facts and the fixed
three-month seasonal comparison in an independent immutable DuckDB Dataset
Package; keep annual BACI and every structural score unchanged; store only
watches and append-only alert operations in PostgreSQL/SQLite; and fail closed
on source rights, mapping ambiguity, missing observations, suppression,
revision, or incompatible activation.

This is the narrowest first release that provides useful monthly and quarterly
alerts while preserving reproducibility, product identity, source honesty,
licensing discipline, and the repository's existing analytical boundaries.