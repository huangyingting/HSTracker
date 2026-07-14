# HS12 product-language inputs

These files build the immutable Simplified-Chinese auxiliary catalog for the
5,202 CEPII BACI HS12 products. They are language/search inputs only and never
affect the Candidate Market Score.

| Input | Purpose | Provenance |
|---|---|---|
| `taiwan-customs-hs2012-terminology-v1.json` | Traditional-Chinese HS2012 hierarchy | Taiwan Customs, OGDL Taiwan 1.0 |
| `taiwan-customs-legacy-glyph-review-v1.json` | Auditable repair of 59 historical private-use code points | Same-code current Taiwan tariff labels plus nomenclature review |
| `opencc-tw2sp-hs12-v2.json` | Pinned phrase- and character-aware conversion | OpenCC Python Reimplemented 0.1.7, Apache-2.0 |
| `baci-hs12-aggregate-corrections-v1.json` | Two reviewed BACI-only aggregate labels | Project-authored |
| `baci-hs12-project-reviewed-corrections-v1.json` | Reviewed numeric, unit, inequality, and scope corrections | Project-authored |
| `baci-hs12-reviewed-aliases-v1.json` | Curated discovery aliases | Project-reviewed |
| `baci-hs12-catalog-review-v1.json` | Accepted flagged-row and risk/chapter-stratified review manifest | Project-reviewed |

The source ODS is pinned by SHA-256
`74a0f1c3b4d85d27fb8ed0983eb203d8587df02cb517fa34a4177ac39b8d12ce`.
The normalized terminology covers 5,200 BACI codes; reviewed corrections supply
the BACI aggregates `271000` and `999999`. The offline translation build retains
source chemical formulas and Latin names verbatim, while every reviewed alias
stores the exact normalized search text published in the immutable index.

`baci-hs12-reviewed-aliases-v1.json` carries curated common-language discovery
aliases (for example `computer`, `television`, `car`, and their Simplified
Chinese equivalents) that map everyday search terms onto the formal HS12
nomenclature. Alias edits take effect only after the runtime product-catalog
artifact is rebuilt from the raw BACI source with `npm run build:product-catalog`;
`tests/integration/reviewed-aliases.test.ts` validates the curated input against
the current source products so the expansion is verifiable before that rebuild.

Build the translation input by passing all independently versioned correction
catalogs:

```sh
npm run build:product-translations -- \
  --staging-manifest /path/to/staging-manifest.json \
  --terminology data/catalog/inputs/taiwan-customs-hs2012-terminology-v1.json \
  --corrections data/catalog/inputs/baci-hs12-aggregate-corrections-v1.json \
  --corrections data/catalog/inputs/baci-hs12-project-reviewed-corrections-v1.json \
  --traditional-to-simplified data/catalog/inputs/opencc-tw2sp-hs12-v2.json \
  --output /path/to/translations.json \
  --report /path/to/translation-report.json
```

Build the immutable runtime catalog from the accepted translations and review:

```sh
npm run build:product-catalog -- \
  --staging-manifest /path/to/staging-manifest.json \
  --translations /path/to/translations.json \
  --aliases data/catalog/inputs/baci-hs12-reviewed-aliases-v1.json \
  --traditional-to-simplified data/catalog/inputs/opencc-tw2sp-hs12-v2.json \
  --review-manifest data/catalog/inputs/baci-hs12-catalog-review-v1.json \
  --workspace data/artifacts/product-catalog \
  --report reports/releases/V202601.product-catalog-build-report.json \
  --pipeline-git-sha <40-hex-git-sha> \
  --built-at <UTC-timestamp>
```

Published Chinese text is an **HS Tracker project auxiliary translation** of
the CEPII BACI English source description, with terminology adapted from Taiwan
Customs HS2012 data. It is not an official BACI, WCO, or customs-filing
description. Catalog promotion measures the isolated retained V8 heap for the
loaded search index and blocks above 32 MiB.
