# Decision: HS product descriptions and search language

**Ticket:** [Choose the HS product description and search-language strategy](https://github.com/huangyingting/HSTracker/issues/8)
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)
**Decided:** 2026-07-11

## Decision

The MVP will provide one code-first, bilingual product combobox over the 5,202
products in the pinned BACI HS12 catalog.

- Canonical identity is always the pair **`HS 2012` + six-character code**.
- The exact BACI English description is the authoritative source label for this
  application and is never overwritten.
- The MVP also ships a complete **Simplified Chinese (`zh-Hans`) auxiliary
  translation catalog**. It is project-produced, independently versioned, and
  visibly identified as an auxiliary translation rather than an official BACI,
  WCO, or China Customs description.
- Search accepts codes, source English, auxiliary Simplified Chinese, and
  reviewed aliases regardless of the current interface language. Traditional
  Chinese query input is folded through one pinned, deterministic
  Traditional-to-Simplified conversion dataset, but the MVP does not publish a
  Traditional Chinese label catalog.
- Search is deterministic lexical retrieval, not semantic or generative
  classification. A user must explicitly select one returned HS12 product
  before analysis can run.
- HS 2017 and HS 2022 input is never silently interpreted or converted to
  HS 2012. The field is explicitly an HS 2012 field.

The selected control should look conceptually like:

```text
HS 2012 · 010121
Horses: live, pure-bred breeding animals
纯种繁殖用活马（项目辅助译文）
```

The exact Chinese wording above is illustrative until it is emitted by the
versioned translation pipeline.

## Evidence

The pinned BACI archive contains `product_codes_HS12_V202601.csv`. Direct
extraction and validation found:

| Property | Observed value |
|---|---:|
| Header | `code,description` |
| Data rows | 5,202 |
| Unique six-digit codes | 5,202 |
| Uncompressed bytes | 573,394 |
| Compressed bytes | 103,232 |
| Maximum description length | 254 characters |
| Description language | English |
| Chinese/CJK characters | None |

All inspected descriptions are ASCII English. For example:

```csv
010121,"Horses: live, pure-bred breeding animals"
```

This supports treating BACI's bundled English text as source metadata, but it
does not provide a Chinese catalog. No independently versioned Chinese text may
be presented as if it came from BACI.

The previous dataset decision established that BACI's bundled HS12 product list
is authoritative for the MVP and that leading zeroes are significant. This
decision adds discovery text without changing that identity.

## Product catalog model

### Source record

Every selectable product has exactly one source record:

```text
revision             = HS12
revisionYear         = 2012
code                 = six-character string
sourceDescriptionEn  = exact BACI description
sourceRelease        = V202601
sourceFileSha256     = pinned checksum
```

The source description remains byte-preserved in provenance. The UI may wrap or
highlight it, but must not silently rewrite, title-case, shorten, or translate
the stored value.

The application calls this a **BACI product description**, not a complete legal
tariff definition or customs-classification opinion. HS explanatory notes,
national tariff-line extensions, duty rates, and filing advice are outside this
MVP.

### Chinese auxiliary record

Chinese text is a separate join on `(revisionYear, code)`:

```text
locale               = zh-Hans
description          = project auxiliary translation
translationStatus    = machine-assisted | reviewed
translationVersion   = immutable catalog version
sourceDescriptionSha = checksum of translated English input
```

Rules:

1. The MVP product-search catalog contains a non-empty Chinese auxiliary
   description for all 5,202 source products.
2. Translation is performed offline. No request-time translation service or
   model may alter search results.
3. Machine assistance is allowed, but every row must pass structural and
   terminology checks before publication. Bilingual review is required for all
   flagged rows and a risk-stratified sample spanning every HS chapter.
4. Checks preserve numbers, units, inequality direction, chemical formulas,
   Latin names, and meaning-bearing qualifiers such as `other`, `excluding`,
   `not`, `whether or not`, and `not elsewhere specified`.
5. `translationStatus` remains available to the product-details UI. Chinese
   copy is always accompanied by the source English description in the focused
   workflow.
6. If a future source release lacks an accepted translation, the safe fallback
   is the English source description. The build must report the coverage gap;
   it must not invent text or reuse a translation whose source checksum differs.
7. Published text retains BACI attribution and identifies the project
   translation as a modification, following the source-data license decision.
8. The translation build emits a review manifest naming the glossary version,
   automatic checks, flagged codes, reviewed codes, sample coverage, reviewer,
   and disposition. Promotion fails without an accepted manifest.

The selector and help text use the visible phrase **项目辅助译文** ("project
auxiliary translation"). A concise note explains that it helps discovery and is
not customs-filing guidance.

Producing and accepting the complete Chinese catalog is an explicit MVP launch
gate and must be tracked as implementation work. It is not assumed to be free
seed data.

### Aliases

Aliases are discovery aids, not product names or classification assertions.
Each accepted alias records:

```text
locale
display text
normalized search text
one or more HS12 target codes
alias kind
review status
catalog version
provenance or reviewer
```

- English and Chinese common-language terms may be curated incrementally.
- One alias may point to multiple products. Ambiguity is shown; it is never
  collapsed to a preferred product.
- Automatically inferred synonyms do not enter the public index without review.
- A matched alias may be shown as "Matched: …", but it does not replace either
  displayed description.
- Aliases never enter the Candidate Market identity, score, analysis cache key,
  or default product description.
- Pinyin search is outside the MVP. Traditional input is normalized at query
  time with the pinned conversion dataset; no Traditional display labels or
  expanded Traditional index records are generated.

## Interface language

The focused workflow supports English and Simplified Chinese interface chrome.
Browser preference supplies the first default, and the user can switch it. The
selected locale affects ordering and explanatory copy, not which fields are
searched.

| UI locale | Primary description | Adjacent description |
|---|---|---|
| English | BACI source English | Chinese auxiliary translation |
| Simplified Chinese | Chinese auxiliary translation | BACI source English |

Every product row and selected-product summary starts with `HS 2012` and the
six-digit code. Locale changes must not change the selected product or URL.

## Search contract

### Input and normalization

Search receives an untrusted string and applies one versioned normalization
pipeline:

1. reject input over 300 Unicode code points without truncation, a limit that
   still admits the longest observed source description;
2. apply Unicode NFKC normalization, which also normalizes full-width digits;
3. trim and collapse whitespace;
4. case-fold Latin text;
5. normalize punctuation to token boundaries while retaining the original query
   for display;
6. create a deterministic Simplified-Chinese search form for Chinese input;
7. preserve all numeric code characters as a string.

At catalog-build time, searchable descriptions and aliases pass through the
same applicable NFKC, whitespace, case, and punctuation stages. Only the query
passes through Traditional-to-Simplified conversion. Supported locale and limit
values are allowlisted.

Do not remove English stop words or qualifiers: words such as `not`, `other`,
`with`, and `without` can distinguish HS products. Do not use opaque stemming,
embeddings, an LLM, browser locale, click history, popularity, or personalized
ranking.

A query starts after two normalized characters. Numeric queries use digit-prefix
matching, so `01`, `0101`, and `010121` support progressive code discovery.

### Match order

Results are ordered by the following first matching class:

1. exact six-digit HS12 code;
2. HS12 code prefix;
3. exact source English or Chinese auxiliary description;
4. exact reviewed alias;
5. description starts with the query;
6. reviewed alias starts with the query;
7. every query token occurs in one description;
8. every query token occurs in one reviewed alias;
9. bounded typo match for Latin tokens of at least four characters.

Within a class:

1. fewer unmatched or edited characters wins;
2. a field in the current UI locale wins only as a tie-breaker;
3. source/auxiliary descriptions win over aliases;
4. six-digit code ascending is the final stable tie-breaker.

Each indexed field produces its own match candidate. A product is represented
once by its strongest candidate under the class and tie-break rules above; that
candidate's field and text are the match evidence returned for highlighting.

The API returns at most 20 results. It also returns the match class and matched
field so the UI can highlight the evidence. Search ranking is covered by golden
fixtures and may change only under a new product-search build.

### Selection and states

- Opening the control explains: "Search HS 2012 code or English/Chinese product
  words." It does not render a native 5,202-option select.
- Empty or one-character input does not issue a broad search.
- A two- or four-digit code prefix offers lightweight browse-by-code behavior.
- Keyboard arrows move through results, Enter selects, Escape closes, and focus
  follows the WAI-ARIA combobox pattern.
- Free text is never accepted as a product. The analysis action remains disabled
  until one result is explicitly selected.
- Ambiguous aliases return all qualifying products and never auto-select.
- No result says that no HS 2012 product matched and suggests checking the
  revision or searching by product words.
- The URL stores `revision=HS12` and the canonical six-digit `product` code, not
  a label or alias.

## HS revision handling

The MVP has no revision selector. The label `HS 2012` is persistent before,
during, and after selection.

- An unprefixed six-digit input is interpreted as HS 2012 because the control is
  explicitly scoped to HS 2012.
- Any leading explicit `HS` revision token other than HS 2012 produces a
  non-selectable revision message. This includes older forms such as
  `HS07`/`HS 2007`, current forms such as `HS17`/`HS 2022`, and syntactically
  valid future or unknown forms. The application does not strip the prefix and
  reuse the digits.
- A well-formed six-digit code absent from the BACI HS12 catalog is not accepted.
  The no-result state warns that it may belong to another revision.
- The user may search the product wording and explicitly choose an HS12 result,
  but the application does not claim that this is an official correspondence.
- If a future correspondence feature is added, it must show the source revision,
  every candidate HS12 target, the mapping cardinality, and provenance. It must
  require explicit confirmation and must never resolve one-to-many or
  many-to-one mappings automatically.

This avoids the false precision of treating equal-looking six-digit codes across
HS revisions as equivalent.

## Module and version boundaries

Product discovery is a separate deep module from candidate-market analysis:

```ts
ProductCatalog.search({
  productSearchBuildId,
  query,
  locale,
  limit,
})
```

The module owns normalization, code handling, multilingual fields, ranking,
result limits, and typed errors. Route handlers and UI components do not
reimplement those rules.

`productSearchBuildId` is a digest over:

- the exact BACI source product catalog checksum;
- the accepted Chinese translation catalog;
- the accepted alias catalog;
- the pinned Traditional-to-Simplified query-conversion data;
- normalization and ranking implementation/version; and
- the search response schema.

It is deliberately separate from `analysisBuildId`. A corrected translation or
alias may change discovery without pretending that BACI facts or `cms-v1`
results changed. `/api/v1/analyses/current` names the compatible current IDs.
Versioned search responses are immutable under:

```text
product_search_build_id + normalized_query + locale + limit
```

The Candidate Market result continues to contain canonical `HS12` identity and
the exact BACI English source description. Localized display text is joined from
the product catalog and cannot affect score computation.

## Acceptance fixtures handed forward

Implementation fixtures must cover at least:

- exact `010121` with its leading zero;
- code prefixes `01` and `0101`;
- English exact, prefix, multi-token, punctuation, and typo queries;
- one product matching multiple indexed fields, with only its strongest field
  returned as evidence;
- Simplified and Traditional Chinese forms for the same product;
- full-width numeric input;
- a many-result common Chinese alias that does not auto-select;
- qualifiers and negation that distinguish nearby products;
- stable code-order ties and the 20-result cap;
- a missing but well-formed six-digit code;
- explicit older, current non-HS12, and future/unknown revision input;
- locale switching without identity or URL changes;
- complete 5,202-row source and Chinese catalog coverage; and
- a valid catalog product with zero observations in the fixture evidence source;
- proof that a translation/alias-only change does not alter analysis bytes or
  `analysisBuildId`.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| English-only product discovery | Does not meet the bilingual discovery goal and makes the product vocabulary unnecessarily inaccessible to Chinese-speaking analysts |
| Treat Chinese text as BACI or official customs metadata | The pinned BACI file contains English only; doing so would misstate provenance |
| Use a native HTML select | Scanning 5,202 opaque options is not a usable discovery workflow |
| Runtime machine translation | Non-deterministic, externally dependent, difficult to cache and reproduce, and unsafe for classification terminology |
| Vector or LLM semantic search | Harder to explain, reproduce, fixture, and constrain against false one-code certainty |
| Automatically choose the top text result | Product terms are often ambiguous; analysis must use an explicit selected code |
| Silently reinterpret HS17/HS22 digits as HS12 | Same-looking codes can change meaning and official correspondences can split or merge |
| Fold translations into `analysisBuildId` | Product-language corrections do not change trade facts or score computation |

## Primary sources

All sources were accessed 2026-07-11.

- CEPII,
  [BACI data page](https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37)
  and
  [HS12 V202601 archive](https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS12_V202601.zip).
- Project,
  [MVP trade dataset and HS nomenclature decision](./2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md).
- United Nations Statistics Division,
  [classification correspondence tables](https://unstats.un.org/unsd/classifications/Econ#Correspondences).
- Unicode Consortium,
  [Unicode Normalization Forms (UAX #15)](https://unicode.org/reports/tr15/).
- W3C,
  [WAI-ARIA Authoring Practices: Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
