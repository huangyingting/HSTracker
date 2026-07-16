# Decision: Cross-product market-opportunity discovery recipe

**Status:** Decision complete  
**Decided:** 2026-07-16  
**Accessed:** 2026-07-16

## Decision

Add Analysis Recipe `opportunity-discovery-v1`. It produces one canonical,
deterministic **Market Investigation Candidate** for each eligible tuple:

```text
selected export economy x HS12 product x importing economy
```

A Market Investigation Candidate is market-level public evidence that the
tuple may warrant commercial investigation. It is not a prediction of sales,
profit, market access, company fit, or commercial success. Product copy may
use "opportunity discovery" for the workflow, but the analytical result and
API contract use `MarketInvestigationCandidate`; they must not call a row a
recommended investment or guaranteed opportunity.

The recipe exposes two visible axes:

| Axis | Weight in Investigation Priority | Components within axis |
|---|---:|---|
| Market Attractiveness | 55% | 65% Market Size, 35% Market Growth |
| Exporter Fit | 45% | 60% Exporter Product Presence, 40% Recorded Market Foothold |

Every component is normalized as a midrank percentile against one fixed
cohort containing all eligible product-import-market combinations for the
selected exporter and exact Dataset Package. The recipe never compares
`cms-v1` values across products. It does not change `cms-v1`; the existing
detailed Candidate Market result remains the drill-down for an explicitly
selected exporter-product pair.

The fixed total is:

```text
MarketAttractiveness = 0.65 * MarketSizePct + 0.35 * MarketGrowthPct
ExporterFit = 0.60 * ExporterProductPresencePct + 0.40 * RecordedFootholdPct

InvestigationPriority =
    0.55 * MarketAttractiveness
  + 0.45 * ExporterFit
```

The total is justified because the product requires one unified discovery
feed and all four terms are bounded, visibly decomposed, and derived from
distinct questions. It is an ordering aid, not a cardinal estimate of value.
No user-adjustable weight, account attribute, saved portfolio, click history,
company characteristic, or inferred preference enters the calculation.

## 1. Canonical terminology and identities

Add these terms without weakening the existing domain language.

**Market Investigation Candidate**: One eligible importing economy for one
selected export economy and one exact HS12 product under
`opportunity-discovery-v1`. It carries public evidence for further
investigation, not a commercial recommendation.

**Market Attractiveness**: A 0-100 cross-product percentile composite of the
import market's recorded product-specific size and nominal growth. It does not
measure addressability, regulation, tariffs, profitability, or buyer demand
for a particular company.

**Exporter Fit**: A 0-100 cross-product percentile composite of the selected
economy's recorded world export presence in the product and its recorded
foothold in the importing market. "Fit" means fit in BACI public trade
evidence only; it does not describe a company's production capability,
certification, price, capacity, channel access, or strategy.

**Investigation Priority**: The fixed weighted total used to order the unified
feed. It is ordinal. A difference of 20 points does not mean twice the
commercial potential of a difference of 10 points.

**Unvalidated Market Gap**: High Market Attractiveness paired with weak or
unrecorded selected-exporter foothold. It is a hypothesis requiring market
access and company-level validation, not automatically a good opportunity.

**Opportunity Index**: The immutable, compact, derived DuckDB object that
persists the complete ordered `opportunity-discovery-v1` cohort. It is not a
user index, mutable search index, raw BACI table, or store of personalized
results.

Version identities are exact:

```text
recipe_id = opportunity-discovery-v1
result_schema_version = market-investigation-result-v1
index_schema_version = opportunity-index-v1
index_capability = opportunity-discovery/ordered-candidate-index@1
```

Changing an indicator, window, eligibility rule, normalization pool,
missingness treatment, weight, threshold, type precedence, confidence rule,
rounding rule, or ordering rule requires a new recipe version. Changing only
labels or locale does not.

The Analysis Identity is the digest of:

```text
recipe_id
+ exact Dataset Package identity
+ normalized selected export economy code
```

Product and importer are result-row identities, not analysis inputs for the
complete feed. A filtered known-product view remains a projection of the same
complete analysis and must retain the same Analysis Identity and row values.

## 2. Semantic inputs and fixed cohort

### 2.1 Public semantic input

The recipe has one analytical input:

```ts
type OpportunityDiscoveryV1Request = Readonly<{
  recipe: "opportunity-discovery-v1"
  analysisBuildId: string
  exportEconomyCode: string
  page: Readonly<{ limit: number; cursor: string | null }>
  productFilter?: Readonly<{
    hsRevision: "HS12"
    codes: readonly string[]
  }>
}>
```

`page` and `productFilter` are representation inputs. They do not change the
analysis or normalization cohort. The analytical input is the normalized BACI
economy code. An account may establish one primary export economy outside this
recipe, but account design is not part of this decision. Changing the primary
economy executes a different Analysis Identity; it does not personalize one.

A natural-language product query belongs to Product Catalog discovery. It may
return candidate HS12 codes, but analysis starts only after explicit selection
of one or more exact six-character HS12 codes. Free text, embeddings, or model
output never enters the recipe.

### 2.2 Time and source identity

For Dataset Package `D`, let `C` be its Finalized Year cutoff and:

```text
W5  = {C-4, ..., C}       primary window
W3  = {C-2, ..., C}       short stability window
W10 = {C-9, ..., C}       long stability window
P   = the one Provisional Year, when declared
```

For `V202601`, `C=2023`, `W5=2019..2023`, `W3=2021..2023`,
`W10=2014..2023`, and `P=2024`.

The exact Dataset Package binds BACI release, source archive checksum, HS12,
artifact checksum, coverage, quality approval, and recipe capability. Evidence
from different BACI releases is never mixed in one result.

### 2.3 Eligibility universe

For selected exporter `e`, product `k`, importer `j`, and year `t`, define:

```text
M[k,j,t] = sum(v[t,i,j,k]) over every recorded supplier i
B[e,k,j,t] = recorded v[t,e,j,k], otherwise no recorded contribution
X[e,k,t] = sum(v[t,e,j,k]) over every recorded importer j
G[k,t] = sum(v[t,i,j,k]) over every recorded exporter i and importer j
```

`v` is BACI reconciled FOB-equivalent value in thousands of current USD.
An annual market observation exists only when at least one positive row
contributes to `M`. Absence is never rewritten as a measured zero.

A tuple `(e,k,j)` is eligible when all conditions hold:

1. `e` and `j` are BACI individual economies or separately reported
   territories accepted by the Dataset Package.
2. `j != e`.
3. `k` is an exact product in the package's authoritative HS12 catalog.
4. At least one `M[k,j,t]` observation exists in `W5`.

No selected-exporter bilateral flow is required. Code 490 remains eligible
with its existing identity caveat. Regional/customs aggregates, unknown
economies, products absent from the package catalog, self-imports, and tuples
with no observed positive market flow in `W5` are excluded.

### 2.4 Fixed normalization cohort

For exporter `e` and package `D`:

```text
H(e,D) = every eligible (k,j) pair under the rules above
```

Every component pool and every public rank is computed over all rows in
`H(e,D)`. The cohort is not the current page, a search result, selected product
codes, an account portfolio, a shortlist, or all exporters. Two companies with
the same primary export economy and exact Dataset Package receive identical
analytical rows and ordering.

The complete `H(e,D)` is computed offline before publication. Runtime filters
only project already-normalized rows.

## 3. Raw indicators and transformations

All primary indicators use `W5`. Decimal sums and ratios use fixed-point or
decimal arithmetic. Retain unrounded values through normalization and formulas.

### 3.1 Market Size

```text
MarketSize[k,j] = mean(M[k,j,t]) over observed t in W5
```

Unit: thousands of current USD per observed year. Direction: higher is more
attractive. One observed year is sufficient for computation; missing years
are omitted and reduce Data Confidence.

This indicator is product-importer demand evidence. Exporter bilateral value
does not enter it.

### 3.2 Market Growth

Fit ordinary least squares to observed annual market values:

```text
ln(M[k,j,t]) = a + b*t
MarketGrowth[k,j] = exp(b) - 1
```

Compute growth only when at least three `W5` years are observed and
`MarketSize >= 500` BACI units, equivalent to mean annual imports of USD
500,000. Otherwise its state is `NEUTRAL` with all applicable reason codes:
`TOO_FEW_OBSERVED_YEARS` and/or `SMALL_MARKET_BASE`.

Do not cap the raw value. Add `EXTREME_NOMINAL_GROWTH` when absolute annual
growth exceeds 75%. Growth is nominal current-USD evidence, not real growth or
a forecast. The least-squares form and missing-period restraint follow the
World Bank's documented period-growth method; HS Tracker applies it to BACI
market values, not to World Bank national accounts.

### 3.3 Exporter Product Presence

```text
ExporterProductPresence[e,k] =
    sum(X[e,k,t]) over t in W5
    / sum(G[k,t]) over observed t in W5
```

The denominator uses every positive BACI product flow in the window. An absent
selected-exporter row contributes nothing to the numerator and remains tagged
`NO_RECORDED_PRODUCT_EXPORT`. Clamp only defensive floating-point drift to
`[0,1]`.

This is the selected economy's recorded share of world exports of the product,
not proof of a company's capability. It is deliberately not bilateral, so it
does not reward the same destination relationship twice.

### 3.4 Recorded Market Foothold

```text
RecordedFoothold[e,k,j] =
    sum(B[e,k,j,t]) over observed market years in W5
    / sum(M[k,j,t]) over those years
```

An absent bilateral row is a zero contribution to this dataset ratio while
the evidence state remains `NO_RECORDED_POSITIVE_FLOW`. Public copy must say
"No recorded bilateral flow in the finalized window", never "zero exports".

Foothold is destination-specific. Dividing by the market total prevents the
bilateral value from duplicating Market Size.

### 3.5 Cross-product normalization

Normalize each raw indicator independently over `H(e,D)`:

1. Keep only `COMPUTED` raw values in the component pool.
2. Sort ascending and give ties their average rank.
3. For pool size `N`, compute `100 * (averageRank - 0.5) / N`.
4. `N=1` and an all-equal pool yield 50.
5. A `NEUTRAL` component receives exactly 50 and is excluded from its computed
   pool.

Exporter Product Presence repeats for each eligible importer of a product.
That repetition is intentional: the confirmed normalization unit is every
eligible product-market combination, so each feed row receives a percentile
from the same fixed row-weighted cohort. It must not be normalized first by
product and then again by row.

Midrank percentiles make unlike raw units comparable without pretending that
USD, annual growth, and shares have a common cardinal scale. They preserve the
complete ordering and bound outliers. They do not make a percentile stable
across Dataset Packages; source identity remains mandatory.

### 3.6 Axis formulas and no double counting

Using unrounded component percentiles:

```text
MarketAttractivenessRaw =
    0.65 * MarketSizePct
  + 0.35 * MarketGrowthPct

ExporterFitRaw =
    0.60 * ExporterProductPresencePct
  + 0.40 * RecordedFootholdPct
```

The four terms answer non-substitutable questions:

- Market Size: how much of this product the market records importing.
- Market Growth: how that market-product evidence changes over time.
- Exporter Product Presence: whether the selected economy records supplying
  this product to the world.
- Recorded Foothold: whether it records supplying this particular market.

Do not add supplier diversity to the cross-product total. The existing
`cms-v1` drill-down already exposes it, and including it here would turn
incumbent structure into a second indirect access claim without tariff,
regulatory, or route evidence. Do not add raw bilateral value: it would count
both market size and exporter presence again.

## 4. Investigation Priority and deterministic ordering

Using unrounded axes:

```text
InvestigationPriorityRaw =
    0.55 * MarketAttractivenessRaw
  + 0.45 * ExporterFitRaw
```

Public component, axis, and total displays use decimal round-half-up to the
nearest integer. Rounded values never feed another formula.

The fixed total is methodologically acceptable only as an ordinal discovery
aid. It does not estimate latent export potential as ITC's methodology does:
HS Tracker lacks tariffs, market access, distance, GDP, supply capacity, and
ease-of-trade factors. The weights intentionally give observed destination
demand a modest majority while preserving substantial exporter evidence. They
are product policy, not learned coefficients.

Canonical feed order is:

```text
1. InvestigationPriority display integer descending
2. MarketAttractiveness display integer descending
3. ExporterFit display integer descending
4. HS12 code ascending as a six-character string
5. BACI importing-economy numeric code ascending
```

Competition rank uses the displayed Investigation Priority integer only.
Equal totals share rank (`1,2,2,4`). The remaining keys give deterministic
display order but do not imply a better rank. Do not use hidden decimals to
break a public-score tie.

No user-adjustable weights or sorting key may replace canonical order. A UI
may offer clearly labelled projections such as one confirmed product, one
opportunity type, or confidence, but "All candidates" always returns to the
canonical order.

## 5. Opportunity types

Every eligible row receives exactly one type. Evaluate in this precedence
order using unrounded axis/component percentiles:

1. `UNVALIDATED_MARKET_GAP` when `MarketAttractivenessRaw >= 70` and
   (`RecordedFootholdPct <= 20` or no bilateral flow is recorded anywhere in
   `W5`).
2. `EXPANSION_EVIDENCE` when a positive bilateral flow is recorded in at least
   one `W5` year, `MarketAttractivenessRaw >= 60`, and
   `ExporterFitRaw >= 60`.
3. `GENERAL_INVESTIGATION_EVIDENCE` for every other eligible row.

Boundary equality is included. Percentile ties at 20, 60, or 70 therefore
receive the same classification. Type never changes score, rank, or
eligibility.

Gap precedence is binding. A row with high attractiveness, weak destination
foothold, and high exporter product presence remains an Unvalidated Market
Gap, not Expansion Evidence. Required copy is:

> High recorded market attractiveness with weak or unrecorded exporter
> foothold. Validate access, competition, company capability, and commercial
> fit before treating this as an opportunity.

Expansion Evidence means public evidence supports investigating expansion of
an existing recorded trade relationship. It does not mean expansion is
feasible or recommended.

## 6. Missingness, confidence, stability, and non-claims

### 6.1 Component states

| Indicator | State behavior |
|---|---|
| Market Size | `COMPUTED` for every eligible row |
| Market Growth | `COMPUTED` or `NEUTRAL` under the exact rules above |
| Exporter Product Presence | `COMPUTED`; no recorded exporter-product flow contributes zero to the ratio but keeps its evidence tag |
| Recorded Market Foothold | `COMPUTED`; no recorded bilateral flow contributes zero to the ratio but keeps its evidence tag |

Unknown evidence is never inferred from Provisional Year data. Weights are
never redistributed. Neutral Growth contributes its percentile midpoint and
must show why it is neutral.

### 6.2 Data Confidence

Data Confidence answers whether the public evidence behind this row is
complete and stable. It never changes a component, type, score, rank, or feed
eligibility.

Start at 100, apply every deduction in table order, floor at zero, and apply
the sparse-evidence cap last:

| Reason | Trigger | Deduction |
|---|---|---:|
| Missing finalized market years | Each missing `M[k,j,t]` in `W5` | 10 each, maximum 40 |
| Missing cutoff-year market evidence | No `M[k,j,C]` | 15 |
| Neutral Market Growth | Growth is neutral for either reason | 10 once |
| No exporter-product history | No positive `X[e,k,t]` anywhere in `W5` | 20 |
| Possible product-series discontinuity | Existing `cms-v1` product check flags any finalized year | 15 |
| Low alternate-window stability | Section 6.3 rule flags the row | 10 |
| Material Release Revision | Section 6.4 flags the row | 10 |
| Identity proxy | Importer code is 490 | 10 |

If at most two `W5` market years are observed, cap the result at 40. Map the
integer to `HIGH=80..100`, `MEDIUM=50..79`, and `LOW=0..49`.

The absence of a bilateral flow is not itself a confidence deduction; it is
the evidence that defines foothold and may define a gap. Absence of all
selected-exporter product history is a deduction because Exporter Fit then
rests on no positive recorded exporter-product flow.

Quantity availability remains separate supporting evidence. Quantity does not
enter this recipe or Data Confidence.

### 6.3 Alternate-window stability

Offline, recompute the complete recipe for `W3` and `W10`. Each alternate
window has its own eligible fixed cohort under the same one-observed-market-
year rule and independently normalized component pools. Growth still requires
three observations and the USD 500,000 mean threshold; thus `W3` Growth
requires all three years.

For a row eligible in both primary and alternate cohorts, compute:

```text
priorityDelta = alternate unrounded priority - W5 unrounded priority
```

The row is `LOW_ALTERNATE_WINDOW_STABILITY` when either absolute `W3` or
`W10` delta is at least 15. Equality flags. If a row enters or exits an
alternate cohort, report `COHORT_ENTRY` or `COHORT_EXIT` for that window but
do not invent a delta and do not apply this deduction. Missing a required
`W3` or `W10` package range makes the recipe incompatible rather than silently
shortening a window.

Also publish global Spearman correlations between primary and alternate
competition ranks over common rows for diagnostics. Calculate Pearson
correlation on the vectors of competition-rank numbers without ranking them a
second time. These global diagnostics do not alter row confidence.

### 6.4 Release Revision

When the deployment binds a compatible previous Dataset Package, recompute
that package with the current implementation and the current `W5`. Compare
only if both packages contain every current-window year. Never mix rows or
shorten the window.

For common rows, flag `MATERIAL_RELEASE_REVISION` when either:

```text
abs(current priority - previous priority) >= 10
abs(current rank percentile - previous rank percentile) >= 15
```

Use unrounded priority and rank percentiles. Classify entries and exits
separately. With no compatible comparison, return `NOT_COMPARED` and apply no
deduction. Release Revision is source-version sensitivity, not historical
growth.

### 6.5 Provisional evidence

The Provisional Year never changes eligibility, component pools, axes, type,
priority, confidence, stability, or rank. On demand, the detail view may show:

- provisional market value and its recorded/not-recorded state;
- provisional selected-exporter bilateral value/state and derived share; and
- quantity coverage.

Every value is labelled Provisional and carries the exact release. A mutation
to only Provisional Year evidence must leave the complete Opportunity Index
row values byte-identical while changing the Dataset Package/index identity if
the bound artifact bytes change.

### 6.6 Required non-claims

The result must state all of the following in result metadata and nearby UI
copy:

- public BACI economy-product-market evidence only;
- nominal current USD, not inflation-adjusted values;
- no tariff, regulation, logistics, sanctions, distribution, buyer, company,
  margin, capacity, certification, or product-market-fit evidence;
- absent positive flow is not proof of zero real-world trade;
- percentile position is package- and exporter-specific;
- no forecast, sales estimate, profit estimate, or success probability;
- no company personalization; and
- deeper investigation is required.

## 7. Opportunity Index and execution plan

### 7.1 Measured baseline

The accepted `V202601` build report records:

| Evidence | Measured value |
|---|---:|
| Existing DuckDB artifact | 1,002,975,232 bytes, about 1.003 GB |
| `bilateral_year` | 142,112,452 rows |
| `market_year` | 11,184,765 rows |
| `product_year` | 67,585 rows |
| Economy dimension | 238 rows |
| HS12 product dimension | 5,202 rows |
| Existing complete build time | 115,666.366 ms |
| Largest measured candidate query | 178,380 complete bilateral rows, 225 candidates, 304,583 result bytes |

Those facts replace the architecture document's earlier 2-6 GB artifact
estimate. They do not predict the Opportunity Index size; the first complete
build must measure it.

### 7.2 Persisted grain and columns

Persist one row per `(exporter_code, product_id, importer_code)` in the fixed
eligible cohort:

```text
opportunity_candidate
  exporter_code                 USMALLINT
  product_id                    USMALLINT
  importer_code                 USMALLINT
  priority_display              UTINYINT
  attractiveness_display        UTINYINT
  exporter_fit_display           UTINYINT
  market_size_percentile_bp      USMALLINT
  market_growth_percentile_bp    USMALLINT
  product_presence_percentile_bp USMALLINT
  foothold_percentile_bp         USMALLINT
  competition_rank              UINTEGER
  opportunity_type              UTINYINT enum
  confidence_score              UTINYINT
  confidence_flags              UINTEGER bitset
  evidence_flags                UINTEGER bitset
```

Percentile basis points are `round_half_up(unrounded * 100)` and exist for
compact explanation/filtering. The build computes axis and total displays and
types from full-precision decimals before quantization. Basis points never
feed formulas.

Physically order by the canonical feed key within exporter:

```text
(exporter_code,
 priority_display DESC,
 attractiveness_display DESC,
 exporter_fit_display DESC,
 hs12_code ASC,
 importer_code ASC)
```

The index also contains small immutable metadata and enum/flag dictionaries:

```text
opportunity_index_metadata(key, value)
opportunity_index_build_stats(exporter_code, cohort_rows, ...)
```

Do not duplicate economy/product labels, raw annual values, raw indicators,
provisional values, confidence-reason prose, or complete `cms-v1` results in
each row. Join labels from the compatible dimensions/catalog and compute
drill-down evidence from the existing analysis artifact.

### 7.3 Persisted versus on-demand evidence

The index persists only what is needed to serve and filter a deterministic
feed: identities, canonical displays/order, component percentiles, type,
confidence, and flags.

On selection, `OpportunityDiscovery` loads exact raw indicators, observed-year
counts, confidence deductions, stability deltas, release comparison, and
Provisional Year evidence through an internal evidence seam. The existing
`candidate-market-v1` recipe supplies the full detailed Candidate Market
worksheet for the same exporter/product, with the selected importer focused.
The two recipes remain separately identified; neither copies or rewrites the
other's score.

### 7.4 Offline build

For every eligible export economy in the package:

1. Validate the exact Dataset Package and all `W3/W5/W10` coverage.
2. Derive market indicators once from `market_year` and product totals once
   from `product_year`/`bilateral_year`.
3. Derive exporter-product and exporter-product-importer ratios using
   set-based DuckDB aggregation.
4. Enumerate the complete `H(e,D)` and compute component midranks, axes,
   priority, types, confidence, and stability.
5. Recompute compatible previous-release evidence under the current `W5` when
   available.
6. Write rows in canonical physical order, `ANALYZE`, `CHECKPOINT`, close, and
   reopen read-only.
7. Reconcile counts and sampled/full aggregate oracles against the source
   artifact and a pure reference implementation.
8. Hash and publish the index as an immutable physical object in the Dataset
   Package; activate only after capability, schema, checksum, and smoke-query
   validation.

The build is all-exporter and offline. Runtime never builds, updates, or
renormalizes a cohort. The artifact may remain one DuckDB file or a separately
checksummed DuckDB physical object in the same package; the Dataset Package,
not a filename, is the public identity.

### 7.5 Artifact identity and gates

The Opportunity Index manifest records recipe/result/index versions, source
and Dataset Package identities, current and comparison artifact checksums,
row count per exporter, total row count, excluded-row counts by reason,
indicator pool counts, tie counts, min/max values, build implementation Git
SHA, DuckDB version, build time, file bytes, SHA-256, and benchmark queries.

Promotion gates are:

| Gate | Requirement |
|---|---|
| Row uniqueness | Exactly one row per eligible `(e,k,j)`; no duplicate key |
| Cohort completeness | Independent SQL eligibility count equals persisted count for every exporter |
| Formula parity | Pure reference fixtures and stratified artifact samples match exact public integers/types/flags |
| Source preservation | Existing artifact remains read-only and its reconciliation totals unchanged |
| Index target | Opportunity Index `<= 4 GiB`; above 4 GiB requires explicit size review |
| Combined analytical package target | Existing artifact plus index `<= 8 GiB` |
| Hard architecture gate | Combined package `> 10 GiB` blocks promotion pending a new decision |
| Volume | Existing current/previous/incoming-partial plus spill/free-space policy remains satisfied using measured combined bytes |
| Feed query | Loaded-artifact uncached origin p95 `<= 500 ms`, p99 `<= 1 s`, deadline `2 s` on intended Machine class |
| Detail query | Existing Candidate Market p95 `<= 2 s`, p99 `<= 4 s` remains unchanged |
| Page result | Default 50, maximum 100 rows; serialized JSON `<= 256 KiB` |
| Memory/concurrency | Existing 2-worker, 1-GiB DuckDB and 2-computation controls remain within cgroup and spill gates |

The 4-GiB index target is a product gate, not a size prediction. If a complete
build cannot meet it with the compact schema, do not drop cohort rows or
weaken reproducibility; revisit physical partitioning or the deployment
architecture.

### 7.6 Pagination and immutable serving

The default page size is 50 and maximum is 100. The opaque cursor encodes and
authenticates:

```text
analysis_identity
last priority_display
last attractiveness_display
last exporter_fit_display
last hs12_code
last importer_code
product_filter_digest
```

Cursor comparison uses the canonical order tuple, not offset pagination.
Changing build, exporter, or product projection invalidates the cursor with a
typed `INVALID_CURSOR` outcome. Identical requests return identical bytes and
ETags. No request-time timestamp enters the immutable payload.

## 8. Deep module and internal seams

Extend the existing `TradeAnalyticsPlatform` recipe union rather than adding a
storage-shaped public service.

```ts
type OpportunityDiscoveryV1NormalizedInputs = Readonly<{
  exportEconomyCode: string
}>

type OpportunityDiscoveryOutcome =
  | Readonly<{
      state: "success"
      recipe: "opportunity-discovery-v1"
      analysisIdentity: AnalysisIdentity
      datasetPackageIdentity: DatasetPackageIdentity
      normalizedInputs: OpportunityDiscoveryV1NormalizedInputs
      payload: MarketInvestigationPage
    }>
  | Readonly<{
      state: "empty"
      emptyReason: "NO_ELIGIBLE_MARKET_INVESTIGATION_CANDIDATES"
      analysisIdentity: AnalysisIdentity
      datasetPackageIdentity: DatasetPackageIdentity
      normalizedInputs: OpportunityDiscoveryV1NormalizedInputs
      payload: MarketInvestigationPage
    }>
  | Readonly<{
      state: "invalid-input"
      error:
        | { code: "INVALID_ANALYSIS_QUERY" }
        | { code: "UNKNOWN_EXPORT_ECONOMY"; economyCode: string }
        | { code: "UNKNOWN_HS_PRODUCT"; productCode: string }
        | { code: "INVALID_CURSOR" }
    }>
  | Readonly<{
      state: "incompatible-package" | "retired" | "budget" |
        "rate-limit" | "capacity" | "temporary-unavailability"
      error: OpportunityDiscoveryPlatformError
    }>
```

The public deep module remains:

```ts
interface TradeAnalyticsPlatform {
  execute<Request extends AnalysisRequest>(
    request: Request,
    options?: AnalysisExecutionOptions,
  ): Promise<AnalysisOutcome<Request["recipe"]>>
}
```

It hides Dataset Package selection, index lookup, cursor encoding, ordering,
projection, raw-evidence assembly, `cms-v1` drill-down linkage, caching,
coalescing, and provenance. Routes and React components never receive table,
column, SQL, path, object-key, or DuckDB vocabulary.

Two internal seams are justified because each has fixture and production
adapters and because index reads and raw evidence have different cost and
change patterns:

```ts
interface OpportunityCandidateIndex {
  page(request: OpportunityIndexPageRequest):
    Promise<OpportunityIndexPage>
}

interface OpportunityEvidenceSource {
  loadDetail(request: OpportunityDetailRequest):
    Promise<OpportunityDetailEvidence>
}
```

`FixtureOpportunityCandidateIndex` and `DuckDbOpportunityCandidateIndex`
prove ordering/pagination. `FixtureOpportunityEvidenceSource` and an adapter
over the existing `TradeEvidenceSource` prove raw/detail semantics. These are
internal recipe dependencies, not new generic repositories. Production should
reuse the verified DuckDB database lifecycle, Dataset Package validation,
runtime budgets, and existing Candidate Market execution rather than open a
parallel connection architecture.

## 9. Public routes and opportunity-first use cases

The first screen becomes discovery, not dimension selection. It may resolve a
primary export economy from an external account context, but this decision
does not design accounts or writes.

Required entry paths converge on the same canonical result:

1. **Opportunity feed:** exporter context -> canonical all-product/all-market
   page.
2. **Known product:** natural-language/catalog search -> explicit HS12
   confirmation -> projection of the same feed to that product -> existing
   Candidate Market drill-down.
3. **Capability/product discovery:** browse products represented in the same
   canonical feed; labels may group candidates, but scores are not recomputed.
4. **Shared candidate:** pinned analysis plus exact product/importer focuses
   one row and its evidence.

Recommended read-only routes are:

```text
GET /api/v1/analyses/{analysisBuildId}/opportunities
    ?exporter=&limit=&cursor=&products=

GET /api/v1/analyses/{analysisBuildId}/opportunities/{productCode}/{importerCode}
    ?exporter=
```

The first returns compact feed rows and complete provenance. The second returns
raw opportunity-recipe evidence plus a canonical link to:

```text
GET /api/v1/analyses/{analysisBuildId}/candidate-markets
    ?exporter=&product=
```

The existing Trade Trend, Supplier Competition, Trade Explorer, source scope,
freshness, export, and Candidate Market contracts remain available. No route
accepts company profile fields, weights, SQL, mutable annotations, or raw BACI
records. Filtered pages must not imply that omitted rows were ineligible.

## 10. Acceptance fixtures and implementation gates

Create `opportunity-discovery-fixtures-v1` alongside, not inside, the existing
`acceptance-fixtures-v1` score oracle.

### 10.1 Synthetic fixed-cohort oracle

Use exporters `100` and `200`, products `010001`, `010002`, `010003`, and
importers `300`, `400`, `500`. The authoritative primary cohort for exporter
`100` contains exactly these six rows:

```text
(010001,300) (010001,400)
(010002,300) (010002,500)
(010003,400) (010003,500)
```

Importer `100`, one aggregate economy, and product-market pairs with no
positive `W5` market row are excluded. Exporter `200` uses the same eligible
market-product rows but different bilateral/product-presence evidence.

Fixture values must force and assert:

- one strict ordering in each of all four component pools;
- a raw-value tie receiving the exact average midrank;
- one Growth neutral from two years and one from the small-base threshold;
- one no-exporter-product-history product;
- one no-recorded-bilateral row with computed foothold percentile;
- one exact displayed-priority tie whose hidden decimals differ;
- all three opportunity types, including gap precedence over expansion;
- exact equality at type thresholds 20, 60, and 70;
- missing-year deductions and the at-most-two-year confidence cap;
- code 490 identity deduction in a focused mutation;
- deterministic product-code/importer-code final tie ordering; and
- different exporter `200` normalization with identical results for two
  callers selecting exporter `100`.

The expected file pins every raw decimal string, component state, unrounded
percentile to six decimals, basis-point value, axis/priority display integer,
type, confidence reason/order, rank, and row order. Snapshot regeneration
without reviewed input or contract change is forbidden.

### 10.2 Metamorphic oracles

Exact mutations prove:

| Mutation | Required invariant/change |
|---|---|
| Reorder source rows | Entire result bytes unchanged |
| Change only locale/labels | Analysis Identity and analytical rows unchanged |
| Change only account/company metadata | Entire analytical result unchanged |
| Request one product filter | Returned rows equal projection of full result; percentiles/ranks/types unchanged |
| Remove a saved-portfolio item | Entire analytical result unchanged |
| Change Provisional Year only | Every finalized analytical field unchanged |
| Add one eligible cohort row | Dataset Package/index identity changes and full affected-exporter normalization is recomputed |
| Add one exporter `200` bilateral row | Exporter `100` result unchanged |
| Tie raw component values | Midrank shared exactly; no source-order tie break |
| Quantity all null | Scores, types, confidence, and order unchanged |
| Same exporter/package in two callers | Byte-identical pages and detail evidence |

### 10.3 Stability and revision oracles

Fixtures pin:

- alternate priority deltas `14.999999` not flagged, `15.000000` flagged;
- alternate cohort entry/exit with no invented numeric delta;
- current/previous priority delta `9.999999` not material and `10.000000`
  material;
- rank-percentile delta `14.999999` not material and `15.000000` material;
- missing current-window coverage -> `NOT_COMPARED`;
- global Spearman all-tied -> 50-equivalent documented state rather than
  divide-by-zero; and
- Provisional Year excluded from every comparison.

### 10.4 Index and route oracles

Prove:

- fixture adapter and DuckDB adapter return identical typed pages;
- every eligibility key occurs once and excluded keys never occur;
- page sizes 1, 50, and 100 concatenate to the exact full canonical order;
- no duplicate or skipped row across score/axis/code tie boundaries;
- cursor reuse under another build, exporter, or product filter returns
  `INVALID_CURSOR`;
- known-product route values equal the all-feed row values;
- detail raw indicators regenerate the persisted component/axis/priority
  displays;
- detail links to the exact existing Candidate Market Analysis Identity for
  exporter/product; and
- success, empty, invalid, incompatible, retired, budget, rate-limit,
  capacity, and temporary-unavailability outcomes remain distinct.

### 10.5 Complete-artifact and promotion proof

Before activation, retain a report tied to the exact source artifact and index
hash that includes:

1. all-exporter cohort counts and exclusions;
2. total and per-exporter uniqueness reconciliation;
3. min/median/p95/max rows per exporter and per product projection;
4. all component pool sizes, neutral counts, tie counts, type counts, and
   confidence distribution;
5. independent recomputation for at least sparse, median, upper-quartile, and
   maximum cohort exporters plus boundary products;
6. current/previous Release Revision availability and counts;
7. index bytes, combined package bytes, volume formula, build wall time, peak
   RSS, temporary disk, and spill;
8. read-only reopen and checksum verification;
9. 50- and 100-row first/middle/last-page p95/p99 benchmarks under existing
   mixed-load controls; and
10. non-regression runs for `cms-v1`, Trade Trend, Supplier Competition, Trade
    Explorer, exports, hydration, promotion, rollback, and retained links.

These fixtures and gates are sufficient to split implementation into issues
for domain recipe/oracles, index builder/schema, Dataset Package capability,
runtime adapters/platform outcome, routes, opportunity-first workspace, and
promotion/performance evidence without reopening formula decisions.

## 11. Migration and non-regression constraints

1. `cms-v1` formulas, cohorts, ranks, Data Confidence, result schema, routes,
   exports, cache identity, and acceptance fixtures do not change.
2. Existing `candidate-market-artifact-v1` tables remain read-only source
   evidence. Adding an immutable Opportunity Index object/capability must not
   rewrite their rows or reconciliation totals.
3. Existing analysis builds lacking the new capability remain valid for their
   declared recipes. An `opportunity-discovery-v1` request against them returns
   `NO_COMPATIBLE_DATASET_PACKAGE`; it never computes a partial runtime cohort.
4. A Recommended Dataset Mapping activates the new recipe only after its own
   capability, index checksum, schema, full-cohort reconciliation, and smoke
   queries pass.
5. Current plus two retained deployments each bind their own Opportunity Index
   and evidence objects. A retained link never borrows the current index.
6. Product catalog changes affect labels/search only unless canonical HS12
   membership changes through a new compatible Dataset Package.
7. No per-user analytical result is persisted in PostgreSQL or elsewhere.
   HTTP/process caches may hold immutable representation bytes under Analysis
   Identity; they are not source-of-truth result copies.
8. Same exporter and product inputs continue to yield the same public result
   for every company. A future company-data capability may link to a candidate
   but must not mutate this recipe.
9. Publication remains immutable and content-addressed; rollback changes the
   active mapping, never bytes at an existing identity.

## 12. Rejected alternatives

| Alternative | Rejection |
|---|---|
| Compare `cms-v1` scores across products | Each score is normalized within one product's market cohort; cross-product comparison has no defined meaning and would silently change its semantics |
| Normalize within a saved portfolio or current search | Makes scores depend on mutable user state and allows unrelated additions/removals to change a row |
| Normalize across all exporters | Violates the selected-exporter analytical context and lets other exporters change one exporter's result |
| Personalize weights or learn from clicks | Same public evidence would no longer yield the same result; weights would become opaque and non-reproducible |
| Rank only by Market Attractiveness | Produces a demand list, not exporter-aware discovery, and turns every weak-foothold market into an implied opportunity |
| Rank only by gaps | Confuses absence of recorded trade with accessibility and suppresses evidence for expansion |
| Estimate sales/export potential | BACI alone lacks supply capacity, market access, tariffs, distance, company fit, and commercial constraints required for such a claim |
| Add RCA as another Fit component | Relative specialization and world product presence reuse the same exporter-product numerator; adding both would overweight one evidence family and amplify tiny-base artifacts |
| Add supplier diversity to the total | It is already available in `cms-v1` drill-down and is not equivalent to ease of entry |
| Fill missing years with zero or Provisional Year values | Converts absence into negative evidence or mixes evidence clocks |
| Reallocate a missing Growth weight | Makes the formula differ by row and hides uncertainty |
| Compute the full cohort at request time | Violates fixed offline normalization, exceeds predictable request budgets, and risks page/filter-dependent results |
| Persist full explanation JSON per user | Duplicates public immutable evidence, creates write/storage lifecycle, and conflicts with identical public results |
| Store only top-N rows | Makes the normalization/output universe incomplete and prevents deterministic filtered discovery |
| Expose index tables/SQL through the platform | Leaks storage vocabulary and prevents the module from changing physical layout independently |

## 13. Primary-source basis

This decision uses primary sources only for external methodological and data
claims:

- CEPII, [The CEPII-BACI dataset and FAQ](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html): BACI value/quantity semantics, reconciled trade data, newest-year warning, release non-mixing, code 490, and licence statement.
- CEPII, [January 2026 BACI release notes](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/release_notes_202601.pdf): exact release context and revision warning.
- Gaulier and Zignago, [BACI: International Trade Database at the Product-Level](https://www.cepii.fr/PDF_PUB/wp/2010/wp2010-23.pdf): reconciliation and FOB-equivalent methodology.
- International Trade Centre, [Export Potential and Diversification Assessments methodology](https://umbraco.exportpotential.intracen.org/media/cklh2pi5/epa-methodology_230627.pdf): transparent supply/demand/ease-of-trade decomposition and the additional evidence needed for export-potential claims. HS Tracker adopts decomposition, not ITC's model or output claim.
- World Bank Data Help Desk, [How aggregate growth rates are computed for National Accounts](https://datahelpdesk.worldbank.org/knowledgebase/articles/114952-how-are-aggregate-growth-rates-computed-for-nation): least-squares log growth and missing-period restraint.
- UN Comtrade, [Data Conversion](https://uncomtrade.org/docs/data-conversion/) and [commodity conversion issues](https://uncomtrade.org/docs/reported-and-converted-data-commodity-conversion-issues/): HS conversion limitations and possible product-series discontinuity.
- DuckDB, [Compression](https://duckdb.org/docs/stable/internals/storage) and [Concurrency](https://duckdb.org/docs/stable/connect/concurrency): physical storage and embedded concurrency behavior. These support measuring a compact immutable index, not assuming a compression ratio.
- Etalab, [Open Licence 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf): reuse and attribution terms for the source publication.

Repository evidence is authoritative for implementation facts:

- `CONTEXT.md` owns domain language and Analysis Recipe, Dataset Package,
  Analysis Identity, outcome, retention, and non-claim semantics.
- `reports/releases/V202601.artifact-build-report.json` owns the measured
  1,002,975,232-byte artifact and exact row/build counts cited above.
- `candidate-market-score-and-confidence.md` owns `cms-v1`; this decision does
  not reinterpret it.
- `mvp-trade-dataset-and-hs-nomenclature.md` owns BACI/HS12/finalized/
  provisional/missingness semantics.
- `public-web-data-and-deployment-architecture.md` and the current
  `TradeAnalyticsPlatform`, Dataset Package, and `TradeEvidenceSource`
  interfaces own the module and deployment boundaries preserved here.

## Final recommendation

Implement `opportunity-discovery-v1` exactly as the fixed, exporter-scoped,
cross-product recipe above. Publish its complete cohort as one compact,
versioned Opportunity Index capability inside the immutable Dataset Package;
serve a canonical opportunity-first feed from that index; compute raw detail
on demand through existing evidence modules; and retain `cms-v1` unchanged as
the detailed exporter-product Candidate Market analysis.

This is the narrowest design that simultaneously provides cross-product
discovery, one stable feed, honest gap labelling, reproducibility, public-result
equality across companies, and the repository's existing source, missingness,
publication, performance, and deep-module guarantees.