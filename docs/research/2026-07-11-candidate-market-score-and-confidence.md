# Research: Candidate Market Score and data confidence

**Ticket:** [Define the Candidate Market Score and data confidence](https://github.com/huangyingting/HSTracker/issues/4)  
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)  
**Accessed:** 2026-07-11

## Decision

Define score version `cms-v1` as a deterministic, fixed-weight composite of
four BACI value-derived components:

| Component | Weight | Raw indicator |
|---|---:|---|
| Market Size | 30 | Mean annual world imports into the market |
| Market Growth | 25 | Log-linear annual growth in world imports |
| Recorded Foothold | 25 | Selected export economy's recorded share of market imports |
| Supplier Diversity | 20 | Mean annual inverse normalized supplier concentration, excluding the selected exporter |
| **Total** | **100** | |

Every raw component is converted to a within-query midrank percentile. Missing
components receive the neutral midpoint, never a silently redistributed
weight. Data Confidence is a separate rule-based rating; it never changes the
score or rank.

Only BACI `v` values from the five latest Finalized Years enter the primary
`cms-v1` score. For `V202601`, that window is 2019-2023. Quantity `q` and the
newest Provisional Year are supporting evidence only.

## Design rationale

The International Trade Centre's export-potential methodology decomposes
export potential into understandable supply, demand, and ease-of-trade
factors. It also warns that fixed-effect models make the source of a potential
value opaque and difficult to interpret. HS Tracker adopts the decomposition
principle, not ITC's formula: the MVP lacks ITC's tariff, GDP, distance, and
market-access inputs, so it must not imitate those factors with unsupported
proxies.

The score is intentionally descriptive:

- it summarizes observed product demand, trend, recorded exporter presence,
  and supplier structure;
- it does not estimate unrealized sales or profit;
- it does not claim that an unserved market is accessible;
- it does not learn weights or personalize a recommendation.

Source:
[ITC, Export Potential and Diversification Assessments](https://umbraco.exportpotential.intracen.org/media/cklh2pi5/epa-methodology_230627.pdf),
especially pp. 1-5.

## Inputs and notation

For selected export economy `e`, HS12 product `k`, candidate import economy
`j`, finalized cutoff `C`, and five-year primary score window
`W5 = {C-4, ..., C}`:

```text
M[j,t] = sum(v[t,i,j,k]) for every recorded supplier i
B[j,t] = v[t,e,j,k] when recorded, otherwise no recorded contribution
```

`v` is BACI's reconciled FOB-equivalent value in thousands of current USD.
All displayed growth is therefore nominal current-USD growth.

An annual market observation exists only when at least one positive BACI row
contributes to `M[j,t]`. A missing year remains missing; it is never filled
with zero.

## Candidate universe

An economy is eligible for the ranked Candidate Market cohort when:

1. it is not the selected export economy;
2. its BACI country metadata identifies an individual economy or separately
   reported territory, rather than a regional/customs aggregate;
3. at least one positive world-import flow for the selected product is
   recorded into it during `W5`.

Code 490 remains eligible as `Other Asia, n.e.s. (Taiwan proxy)`, with the
identity caveat and confidence deduction defined below.

A bilateral flow from the selected exporter is not required. Unserved markets
remain discoverable because their demand, growth, and supplier structure may
still warrant investigation.

If no candidate is eligible, return an honest empty state rather than a score.

## Raw components

### Market Size - 30 points

```text
Size[j] = mean(M[j,t]) over observed t in W5
```

- Unit: thousands of current USD; display in an appropriately rounded USD
  unit.
- Direction: higher is better.
- Minimum data: one observed year, already guaranteed by eligibility.
- Missing years are omitted from the mean and reduce Data Confidence.

This is the most direct product-specific measure of observed import demand.
It is deliberately not economy-wide GDP or total merchandise imports.

### Market Growth - 25 points

Fit an ordinary least-squares trend to every observed annual market value:

```text
ln(M[j,t]) = a + b*t
Growth[j] = exp(b) - 1
```

Growth is computed only when:

- at least three of the five years are observed; and
- `Size[j] >= 500` in BACI units, equivalent to USD 500,000 mean annual
  imports.

Otherwise Growth is `NEUTRAL`.

The log-linear estimator uses all available years instead of depending on two
endpoints. The World Bank uses the same least-squares form for period growth
and declines to calculate growth when more than half of a period is missing.

Do not cap Growth before percentile ranking. Rank normalization already bounds
its score contribution, while a cap would erase real ordering among extreme
values. When `abs(Growth) > 75%` per year, retain the computed rank but add an
`Extreme nominal growth` evidence flag.

Source:
[World Bank Data Help Desk, aggregate growth rates for National Accounts](https://datahelpdesk.worldbank.org/knowledgebase/articles/114952-how-are-aggregate-growth-rates-computed-for-nation).

### Recorded Foothold - 25 points

```text
Foothold[j] =
    sum(B[j,t]) over observed market years in W5
    / sum(M[j,t]) over the same years
```

Clamp only defensive floating-point drift to `[0, 1]`.

When the selected exporter has no BACI row in an observed market year, its
recorded contribution to that dataset sum is zero. This is a valid derived
share of recorded BACI flows, not proof that real-world trade was exactly
zero. The UI and export must say:

```text
No recorded bilateral flow in the score window
```

They must not say that the exporter sold exactly zero.

Using share rather than bilateral value prevents Market Size from being
counted twice: the same USD flow represents a different foothold in a USD 2
million market than in a USD 2 billion market.

### Supplier Diversity - 20 points

For each observed year, remove the selected exporter's flow and calculate
supplier shares among the remaining recorded suppliers.

For `N >= 2` remaining suppliers:

```text
s[i] = v[t,i,j,k] / sum(v[t,i',j,k]) for remaining suppliers i'
HHI[t] = (sum(s[i]^2) - 1/N) / (1 - 1/N)
Diversity[t] = 1 - HHI[t]
```

For `N = 1`, `Diversity[t] = 0`: one alternative supplier is maximally
concentrated.

For `N = 0`, annual Diversity is unavailable. If no year has a computable
Diversity, the whole component is `NEUTRAL`; otherwise:

```text
SupplierDiversity[j] = mean(Diversity[t]) over computable years
```

Excluding the selected exporter keeps this component distinct from Recorded
Foothold. It describes how diversified the incumbent alternatives are; it is
not a claim about tariffs, regulation, or ease of entry.

The normalized HHI is adapted from UNCTAD's product-level export-market
concentration index. UNCTAD defines zero as equal shares across suppliers and
one as a single supplier.

Source:
[UNCTAD, Export Market Concentration Index](https://unctadstat.unctad.org/EN/IndicatorsExplained/statie2018d1_en.pdf).

## Normalization

Normalize each component independently within the eligible cohort for the
current `(export economy, HS12 product, BACI version)` query.

For each component:

1. Keep only `COMPUTED` raw values in its ranking pool.
2. Sort ascending.
3. Give tied values their average rank.
4. For pool size `N`, calculate:

```text
Percentile = 100 * (rank - 0.5) / N
```

5. If `N = 1`, the formula yields 50.
6. If all computed values are equal, their shared average rank yields 50.
7. Assign every `NEUTRAL` component exactly 50 and exclude it from the
   computed ranking pool.

Use this same method for every cohort size. Do not switch to unspecified
absolute buckets for small cohorts. A cohort below ten markets receives a
Data Confidence deduction instead.

Midrank percentiles are scale-free. A very large market or extreme growth
rate can lead its component but cannot stretch every other market against an
unbounded min-max denominator.

## Missing-data states

| State | Meaning | Score value | Confidence effect |
|---|---|---:|---|
| `COMPUTED` | Component meets its explicit data rule | Midrank percentile | Normal confidence rules |
| `NEUTRAL` | Evidence cannot support a directional component | 50 | Named deduction where applicable |
| `INELIGIBLE` | Economy fails the candidate-universe rule | No score | Not ranked |

Exact component behavior:

- Market Size is computed for every eligible market.
- Market Growth is neutral below three observed years or below the USD
  500,000 materiality threshold.
- Recorded Foothold is computed for every eligible market; absence is used
  only as no recorded contribution to the dataset ratio.
- Supplier Diversity is neutral only when no year contains an alternative
  recorded supplier.

Weights remain fixed. A neutral component contributes its midpoint:

```text
weight * 50 / 100
```

Neutral can rank above a genuinely below-median computed result. That is
intentional: unknown evidence is placed at the midpoint rather than disguised
as bad evidence. Data Confidence and the component reason expose the
uncertainty.

## Composite and rank

For unrounded component percentiles:

```text
raw_score =
    0.30 * SizePercentile
  + 0.25 * GrowthPercentile
  + 0.25 * FootholdPercentile
  + 0.20 * SupplierDiversityPercentile

score = round-half-up(raw_score)
```

The public score is an integer from 0 to 100.

Canonical rank is calculated from the displayed integer score, descending.
Equal integer scores share a competition rank (`1, 2, 2, 4`). BACI numeric
economy code ascending gives a deterministic display order within a tie but
does not imply a better rank.

Do not rank on hidden decimal differences.

Release Revision comparisons use a percentile of the displayed integer-score
ordering, not hidden component decimals. For cohort size `N > 1`, let
`averageRank` be the mean of the one-based positions occupied by a score's tie
group and calculate:

```text
rankPercentile = 100 * (N - averageRank) / (N - 1)
```

For `N = 1`, assign 50. Unique first and last positions are therefore 100 and
0, tied scores share a percentile, and an all-tied cohort receives 50. Compare
unrounded percentiles and serialize them to at most three decimal places.

## Data Confidence

Data Confidence answers `How complete and stable is the evidence behind this
score?`, not `How attractive is the market?`

Start at 100, apply every observable deduction, floor at zero, then apply the
sparse-evidence cap:

| Reason | Trigger | Deduction |
|---|---|---:|
| Missing score-window years | Each year in `W5` with no observed `M[j,t]` | 10 each, maximum 40 |
| Missing cutoff-year evidence | Finalized cutoff `C` is missing | 15 |
| Small base | `Size[j] < USD 500,000` | 15 |
| Unknown alternative-supplier structure | Supplier Diversity is neutral | 10 |
| Possible product-series discontinuity | Product check below is flagged | 15 |
| Low window stability | Either eligible rolling-window comparison has Spearman rho below 0.70 | 10 |
| Small candidate cohort | Eligible cohort has fewer than 10 markets | 10 |
| No exporter/product history | Selected exporter has no recorded exports of the product to any market in `W5` | 10 |
| Identity proxy | Candidate code is 490 | 10 |

If a candidate has at most two observed score-window years, cap confidence at
40 after deductions.

Map the result to:

- `High`: 80-100
- `Medium`: 50-79
- `Low`: 0-49

Show the label as the primary badge. The integer and deduction reasons belong
in the explanation detail and export.

Confidence:

- never changes list eligibility;
- never changes a component weight;
- never changes score or rank;
- never includes quantity availability, because `q` is not used by
  `cms-v1`.

Quantity completeness remains a separate evidence-panel field.

## Stability and quality checks

### Possible product-series discontinuity

For world imports of product `k` over the full finalized period from the HS12
series start through cutoff `C`:

```text
G[t] = sum(v[t,i,j,k]) over every recorded exporter and importer
d[t] = ln(G[t] / G[t-1])
center = median(d)
MAD = median(abs(d - center))
flag t when abs(d[t] - center) > max(4 * MAD, ln(3))
```

The flag means `possible discontinuity or exceptional global shock`; it must
not claim that HS conversion caused the change. It applies a 15-point
confidence deduction to every market for that product and identifies the
flagged year.

### Rolling-window rank stability

Recompute the complete score using:

- `W3 = {C-2, ..., C}` (3 years);
- `W5 = {C-4, ..., C}` (primary 5 years);
- `W10 = {C-9, ..., C}` (10 years).

For `V202601`, these are 2021-2023, 2019-2023, and 2014-2023.

For alternate windows:

- eligibility requires one observed market year in that window;
- Growth requires at least three observed years, including all three in the
  3-year window;
- all other formulas and thresholds remain unchanged.

Compare competition ranks for candidates common to the primary and alternate
cohorts. When at least ten candidates are common, calculate Spearman rank
correlation. A rho below 0.70 is `Low window stability` and triggers the
confidence deduction. With fewer than ten common candidates, report
`Stability not estimated - small common cohort` and apply no separate
stability deduction beyond the small-cohort rule.

### Informational checks

- `Dominant size outlier`: the largest candidate represents more than 50% of
  summed candidate Market Size.
- `Extreme nominal growth`: absolute computed annual Growth exceeds 75%.
- `Release Revision impact`: on a later BACI release, recompute both the current
  and previous artifacts with the current `cms-v1` implementation and current
  `W5`. Flag a common market when its score changes by at least 10 points or its
  rank percentile changes by at least 15 points. Classify cohort entries and
  exits separately rather than inventing deltas. If either artifact does not
  contain every year in current `W5`, report `NOT_COMPARED`; never shorten the
  comparison window.
- The newest Provisional Year never enters a published score, rank, stability,
  or Data Confidence calculation.

These flags explain evidence; they do not mutate the score.

## Calculation sequence

```text
computePublishedCmsV1(exporter e, product k, release):
  assert release.hsRevision == "HS12"
  C = max(release.finalizedYears)
  W5 = C-4..C
  assert release.finalizedYears includes every year in W5
  return computeCmsV1ForWindow(e, k, release, W5)

computeCmsV1ForWindow(exporter e, product k, release, W5):
  assert release.hsRevision == "HS12"
  assert release.ingestedYears includes every year in W5

  candidates = eligible importers with >=1 observed market year in W5
  if candidates is empty:
    return empty analysis

  for each candidate j:
    build M[j,t] for observed years
    size[j] = mean(observed M[j,t])

    growth[j] =
      OLS(log(M[j,t])) when observed_years >= 3 and size >= USD 500,000
      else NEUTRAL

    foothold[j] =
      sum(recorded v[t,e,j,k]) / sum(observed M[j,t])

    annual_diversity =
      1 - normalized_hhi(other suppliers) when N >= 2
      0 when N == 1
      unavailable when N == 0
    diversity[j] =
      mean(computable annual_diversity)
      or NEUTRAL when none is computable

  for each component:
    percentile = midrank(computed raw values)
    neutral percentile = 50

  for each candidate:
    raw_score =
      .30*size_pct + .25*growth_pct + .25*foothold_pct + .20*diversity_pct
    public_score = round_half_up(raw_score)
    confidence = confidence_rules(candidate, query_stability)

  rank by public_score descending
  assign shared competition ranks to equal public scores
  order ties by BACI numeric economy code
```

`computeCmsV1ForWindow` is an internal seam used for the three stability
windows and same-window Release Revision comparison. Only
`computePublishedCmsV1` may produce the public primary result. A previous
artifact's then-provisional year may enter an internal revision recomputation
when it belongs to the current `W5`; that result is comparison evidence, not a
retroactively published score.

## Worked miniature example

Illustrative raw values for four candidates:

| Market | Size USD M/year | Growth | Supplier Diversity | Recorded Foothold |
|---|---:|---:|---:|---:|
| A | 100 | 10% | 0.90 | 10% |
| B | 50 | -5% | 0.70 | 30% |
| C | 10 | 40% | 0.40 | No recorded flow |
| D | 1 | Neutral: only two years | Neutral: no alternative supplier | No recorded flow |

Midrank percentiles:

| Market | Size | Growth | Diversity | Foothold |
|---|---:|---:|---:|---:|
| A | 87.5 | 50.0 | 83.3 | 62.5 |
| B | 62.5 | 16.7 | 50.0 | 87.5 |
| C | 37.5 | 83.3 | 16.7 | 25.0 |
| D | 12.5 | 50.0 neutral | 50.0 neutral | 25.0 |

Weighted results:

| Market | Calculation | Score |
|---|---|---:|
| A | `.30*87.5 + .25*50 + .25*62.5 + .20*83.3` | 71 |
| B | `.30*62.5 + .25*16.7 + .25*87.5 + .20*50` | 55 |
| C | `.30*37.5 + .25*83.3 + .25*25 + .20*16.7` | 42 |
| D | `.30*12.5 + .25*50 + .25*25 + .20*50` | 33 |

Candidate D remains ranked but must show Low confidence because it has at most
two score-window years. Candidates C and D share the same Recorded Foothold
percentile because both have no recorded bilateral flow; the score does not
invent a hidden ordering between them.

## Explanation contract

Every ranked result must expose:

- integer score and shared rank;
- the four fixed weights;
- each raw indicator, unit, component state, and integer percentile;
- the years actually used;
- `No recorded bilateral flow` wording where applicable;
- High/Medium/Low confidence and every deduction reason;
- product/query stability flags;
- BACI version, HS12, finalized score window, and nominal-current-USD label;
- the discovery-aid disclaimer.

Display raw numbers with no more than three significant figures. Display
component percentiles and total score as integers. Do not display hidden score
decimals.

Allowed language:

- `ranks above the other observed markets on the components shown`;
- `evidence warrants deeper investigation`;
- `no recorded bilateral flow in the score window`;
- `low confidence because only two years are observed`.

Prohibited language:

- `best market`;
- `recommended market`;
- `success probability`;
- `will grow`;
- `guaranteed opportunity`;
- `safe investment`.

## Versioned constants

```text
score_version = cms-v1
score_window_rule = five years ending at latest finalized cutoff
weights = {size: 30, growth: 25, foothold: 25, diversity: 20}
growth_min_observed_years = 3
growth_min_mean_import_usd = 500000
small_cohort_count = 10
extreme_growth_abs_rate = 0.75
series_outlier_mad_multiplier = 4
series_outlier_min_log_change = ln(3)
low_stability_spearman = 0.70
rank_percentile_rule = displayed-score tie-group midrank
revision_score_change = 10
revision_rank_percentile_change = 15
```

These are best-guess product parameters, not universal statistical truths.
Rolling all score windows forward under the rule above changes the analysis
build but not the formula version. Changing any score formula, weight, threshold,
normalization rule, or window rule requires a new score version; it must never
silently alter `cms-v1`.

## Primary sources

All sources were accessed 2026-07-11.

- International Trade Centre,
  [Export Potential and Diversification Assessments](https://umbraco.exportpotential.intracen.org/media/cklh2pi5/epa-methodology_230627.pdf)
- UNCTAD,
  [Export Market Concentration Index](https://unctadstat.unctad.org/EN/IndicatorsExplained/statie2018d1_en.pdf)
- World Bank Data Help Desk,
  [How aggregate growth rates are computed for National Accounts](https://datahelpdesk.worldbank.org/knowledgebase/articles/114952-how-are-aggregate-growth-rates-computed-for-nation)
- CEPII,
  [The CEPII-BACI dataset](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- UN Comtrade,
  [Reported and Converted Data - Commodity Conversion Issues](https://uncomtrade.org/docs/reported-and-converted-data-commodity-conversion-issues/)
- HSTracker,
  [MVP trade dataset and HS analysis nomenclature](./2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md)
