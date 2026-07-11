# Research: MVP trade dataset and HS analysis nomenclature

**Ticket:** [Choose the MVP trade dataset and HS analysis nomenclature](https://github.com/huangyingting/HSTracker/issues/2)  
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)  
**Accessed:** 2026-07-11

## Decision

Use CEPII BACI HS12 as the MVP's only trade-fact dataset and canonical
analytical nomenclature.

| Area | Decision |
|---|---|
| Dataset | CEPII BACI, pinned to one dated release |
| Initial release | `BACI_HS12_V202601.zip` |
| Canonical product identity | HS 2012 6-digit code |
| Finalized evidence | 2012-2023 from `V202601`; `cms-v1` initially scores 2019-2023 |
| Provisional evidence | Show 2024 separately with a provisional warning; do not let it affect the default rank |
| Values | Reconciled FOB-equivalent trade value, thousands of current USD |
| Quantities | Metric tons; nullable and partly derived through unit conversion and mirror reconciliation |
| Missing flows | Unknown/no observed positive flow, not a measured zero |
| Refresh | Review CEPII's annual January release, ingest it as one version, and never mix BACI versions in an analysis |
| UN Comtrade | Do not use its trade facts in the MVP |
| License | Etalab Open Licence 2.0, with CEPII/BACI source and update-date attribution |

The reusable attribution should be:

> Source: CEPII BACI, HS 2012, V202601 (updated 2026-01-22),
> Etalab Open Licence 2.0.

Every result view and export should carry that attribution and link to the
[BACI documentation](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html).

## Why BACI

BACI is derived from UN Comtrade but resolves the two mirror reports for a
bilateral flow into one observation. CEPII estimates and removes CIF costs
from import reports, then weights exporter and importer reports according to
reporting reliability. That gives the MVP one reconciled, FOB-equivalent value
per year, exporter, importer, and product instead of asking the product to
choose between conflicting raw reports.

Sources:

- [CEPII BACI presentation](https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37)
- [CEPII BACI current documentation](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- [Gaulier and Zignago, BACI working paper](https://www.cepii.fr/PDF_PUB/wp/2010/wp2010-23.pdf), especially sections 2.1-2.3

## HS edition comparison

The January 2026 release offers these editions:

| Edition | Available years | Years | Assessment |
|---|---:|---:|---|
| HS92 | 1995-2024 | 30 | Longest, but an unnecessarily old product vocabulary |
| HS96 | 1996-2024 | 29 | Same concern |
| HS02 | 2002-2024 | 23 | Long series, older product vocabulary |
| HS07 | 2007-2024 | 18 | Viable, but older than needed |
| **HS12** | **2012-2024** | **13** | Latest edition with more than a decade of non-provisional history |
| HS17 | 2017-2024 | 8 | Only seven non-provisional years in this release |
| HS22 | 2022-2024 | 3 | Only two non-provisional years; unsuitable for trend scoring |

The year ranges come from the
[current BACI documentation](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html).
HS12 is the balance point: it preserves 12 finalized annual observations in
`V202601` while remaining newer than HS07. This implements the map's stated
preference for a sufficiently long consistent series over HS 2022 recency.

UN Comtrade converts data reported under newer HS editions into earlier
editions. It warns that split and merged headings make some correlations
approximate and can break individual product time series. Therefore, HS12 is
a canonical comparison frame, not a guarantee that every 6-digit series is
structurally unchanged. The score decision must test product-level stability
and lower confidence where HS conversion creates a discontinuity.

Sources:

- [UN Comtrade: Data Conversion](https://uncomtrade.org/docs/data-conversion/)
- [UN Comtrade: Reported and Converted Data - Commodity Conversion Issues](https://uncomtrade.org/docs/reported-and-converted-data-commodity-conversion-issues/)
- [UNSD classification correspondence tables](https://unstats.un.org/unsd/classifications/Econ#corresp-hs)

## Time-window policy

For `V202601`:

1. Ingest the complete HS12 archive, 2012-2024.
2. Treat 2012-2023 as Finalized Years available to quality and stability checks;
   the primary rank uses the five-year `cms-v1` window.
3. Permit 2024 in supporting evidence only, visibly marked provisional and
   excluded from the default Candidate Market Score.
4. On later annual releases, apply the same rule: the newest year remains
   provisional until a later BACI release has revised it.

`cms-v1` uses the five latest Finalized Years, so an accepted annual release
rolls the score cutoff and all stability windows forward by one year. For
`V202601`, the five-year window is 2019-2023. The
[freshness presentation decision](./2026-07-11-trade-data-freshness-and-provisional-presentation.md)
defines the general rolling rule and how each period is communicated.

CEPII says the newest BACI year can be incomplete because its Comtrade source
is downloaded in January, and that its values and quantities may be
significantly revised. CEPII also warns against mixing observations from
different BACI versions. The 2026 release notes confirm both a Comtrade source
update and a change to the fobization process, reinforcing the need to treat a
release as an indivisible version.

Sources:

- [BACI FAQ, questions 1, 3, and 4](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- [January 2026 BACI release notes](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/release_notes_202601.pdf)

The score never adds 2024 to the default rank for this release.

## Economy and product scope

Preserve BACI's numeric economy code as the source identifier and use the
bundled country metadata for display and ISO mappings. Candidate Markets
should:

- include individual economies and separately reported territories;
- exclude the selected export economy itself;
- exclude regional aggregates and customs-union residuals;
- retain code 490 only as `Other Asia, n.e.s. (Taiwan proxy)`, with an explicit
  caveat and reduced confidence, never silently relabel it as Taiwan.

The `V202601` country metadata contains 238 codes. Each of the checked years
contains 226 exporter codes and 226 importer codes. All sampled trade codes
join to the bundled metadata.

Use BACI's bundled `product_codes_HS12_V202601.csv` as the authoritative MVP
product list. It contains 5,202 unique six-digit HS12 codes. Product codes are
strings; leading zeroes are significant. A later bilingual/search decision
may add aliases, but HS12 code remains the canonical identity.

CEPII documents code 490 as a practical Taiwan proxy while warning that it is
formally `Asia, not elsewhere specified`.

Source:
[BACI FAQ, questions 7 and 8](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html).

## Value and quantity semantics

The actual annual-file header is:

```text
t,i,j,k,v,q
```

where:

- `t` is year;
- `i` is exporter;
- `j` is importer;
- `k` is the HS 2012 six-digit product code;
- `v` is reconciled trade value in thousands of current USD;
- `q` is quantity in metric tons.

Treat `v` as nominal. The MVP must label value and growth measures as current
USD and must not imply inflation adjustment.

Treat `q` as auxiliary evidence, not a direct physical measurement in every
row. CEPII's methodology converts quantities reported in other units into
tons using estimated conversion rates, then reconciles mirror quantities.
Blank quantities remain in the current files. Do not impute them, and do not
compute unit value for a row with blank or nonpositive quantity. Any
quantity- or unit-value-derived indicator must reduce data confidence.

Sources:

- [BACI current documentation](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- [BACI working paper, section 2.2](https://www.cepii.fr/PDF_PUB/wp/2010/wp2010-23.pdf)

## Missing and zero policy

The current BACI archive stores only strictly positive trade flows. It does
not bundle a reporting matrix or a suppression reason that would let the MVP
distinguish a true zero from unreported, confidential, or otherwise absent
data.

Therefore:

- an absent `(t, i, j, k)` row is `unknown/no observed positive flow`, not
  numeric zero;
- a blank `q` is null, not zero;
- do not forward-fill, interpolate, or replace absent values with zero;
- include a market in a product analysis only when it has at least one
  positive observed flow in the selected period;
- expose observation count and recency to the score's data-confidence logic;
- never use missingness itself as negative market evidence.

This is deliberately conservative. It prevents the ranking from confusing
source coverage with market weakness.

Source:
[BACI current documentation, Description](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html).

## Release pinning and refresh

For every ingestion:

1. Record HS edition, BACI version, release date, source URL, archive checksum,
   and ingestion timestamp.
2. Validate the exact header and metadata joins before publishing.
3. Read the release notes and compare row, economy, product, value, and
   quantity coverage with the prior release.
4. Publish one complete version atomically; never combine files from two BACI
   releases.
5. Keep previous derived releases reproducible even after a refresh.

The initial source is:

```text
https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS12_V202601.zip
```

The archive advertises a size of 1,267,950,839 bytes and was last modified
2026-01-22. The bundled readme identifies version `202601` and release date
2026-01-22.

## UN Comtrade supplementation

Do not supplement BACI with UN Comtrade trade values or quantities in the
MVP.

Mixing a raw current-year Comtrade observation with historical BACI would
mix unreconciled CIF/FOB mirror reports with BACI's reconciled methodology.
It would make one score internally inconsistent for only a small recency
gain. It also creates a licensing and subscription dependency:

- the [UN Comtrade Usage Agreement](https://comtrade.un.org/licenseagreement.html)
  broadly prohibits automated downloading, redistribution, publication, or
  commercial exploitation without prior written permission;
- the [UN Comtrade re-dissemination FAQ](https://uncomtrade.org/docs/faqs-on-use-and-re-dissemination/)
  says transformed data still requires an active premium subscription, and
  for-profit visualization or analytics requires an institutional
  subscription and dissemination fee.

The MVP needs neither Comtrade trade facts nor a cross-revision product
crosswalk. Use BACI's bundled country and HS12 product metadata. If a future
decision adds cross-revision search aliases, evaluate UNSD classification
correspondence terms separately; do not expand this data decision by default.

## Licensing boundary

CEPII explicitly distributes BACI under
[Etalab Open Licence 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf).
The licence permits copying, transformation, redistribution, publication,
and commercial reuse. It requires acknowledgement of the source and the date
of the most recent update. The attribution above satisfies the documented
minimum when linked to CEPII.

The product may publish derived rankings, charts, comparisons, and result
exports. The MVP should not offer bulk redistribution of the raw BACI archive
or a raw-data API; those are already out of scope for the map and are
unnecessary for the analyst workflow.

This research records the source terms for product planning; it is not legal
advice. Recheck the current licence text before public launch.

Sources:

- [BACI FAQ, question 5](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- [Etalab Open Licence 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf)

## Representative archive checks

Checks were run directly against the official `BACI_HS12_V202601.zip` archive
using HTTP byte ranges. The ZIP central directory and local member
descriptors were parsed, each sampled member was streamed through raw DEFLATE,
and its uncompressed size and CRC were verified.

| Check | 2012 | 2023 | 2024 |
|---|---:|---:|---:|
| Compressed CSV bytes | 81,500,769 | 103,920,206 | 98,443,218 |
| Uncompressed CSV bytes | 293,857,522 | 381,982,615 | 361,446,720 |
| Data rows | 9,012,155 | 11,755,559 | 11,109,411 |
| Exporter codes | 226 | 226 | 226 |
| Importer codes | 226 | 226 | 226 |
| Product codes observed | 5,199 | 5,199 | 5,198 |
| Blank quantity | 261,795 (2.905%) | 416,492 (3.543%) | 361,162 (3.251%) |

For all three sampled years:

- the header was exactly `t,i,j,k,v,q`;
- every row had six fields and the expected year;
- every exporter, importer, and product joined to bundled metadata;
- all stored values were positive;
- every present quantity was positive;
- rows were ordered by `(i, j, k)` with no duplicate key;
- the member's CRC and documented uncompressed size matched.

The 2024 file has 5.50% fewer rows than 2023 despite retaining all 226 sampled
exporter and importer codes. That does not prove which flows are incomplete,
but it is consistent with CEPII's explicit latest-year warning and supports
excluding 2024 from the default rank.

## Risks handed to later decisions

- HS conversion can create product-specific structural breaks; the score
  decision must test stability rather than assume it.
- BACI does not expose row-level flags for original versus converted
  classification, suppression reason, or quantity-estimation method.
- Values are nominal current USD.
- Code 490 is only a proxy and needs explicit presentation.
- Freshness and provisional-year messaging still need a product decision.
- Search aliases and bilingual descriptions must not change canonical HS12
  identity.

## Primary sources

All sources were accessed 2026-07-11.

- CEPII, [The CEPII-BACI dataset](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html)
- CEPII, [BACI presentation](https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37)
- CEPII, [January 2026 BACI release notes](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/release_notes_202601.pdf)
- Gaulier and Zignago, [BACI: International Trade Database at the Product-Level](https://www.cepii.fr/PDF_PUB/wp/2010/wp2010-23.pdf)
- Etalab, [Open Licence 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf)
- UN Comtrade, [Usage Agreement](https://comtrade.un.org/licenseagreement.html)
- UN Comtrade, [FAQs on use and re-dissemination](https://uncomtrade.org/docs/faqs-on-use-and-re-dissemination/)
- UN Comtrade, [Data Conversion](https://uncomtrade.org/docs/data-conversion/)
- UN Comtrade, [Reported and Converted Data - Commodity Conversion Issues](https://uncomtrade.org/docs/reported-and-converted-data-commodity-conversion-issues/)
- UNSD, [HS correspondence tables](https://unstats.un.org/unsd/classifications/Econ#corresp-hs)
