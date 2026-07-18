# Record: Eurostat Comext monthly pilot source, rights, and extraction conformance

**Status:** Approved — activation-gated  
**Approved:** 2026-07-18  
**Accessed:** 2026-07-18  
**Reviewer:** Repository owner on behalf of project legal review  
**Governs:** `recent-trade-momentum-v1` EU-27 pilot (issues #58, #59, #63; epic #49)  
**Canonical decision:** [Monthly trade momentum source, coverage, and recipe](2026-07-16-monthly-trade-momentum-source-and-coverage.md)

## 1. Approval

Project legal review approved the Eurostat Comext monthly detailed
international-trade-in-goods source and its reuse rights for the EU-27 pilot on
2026-07-18, as communicated by the repository owner. This record fixes the
approved acquisition path, applicable terms, permitted uses, required
attribution, retention and output limits, and the reproducible documented
extraction proof that satisfies the source-conformance gate (§9.2 of the
canonical decision).

This approval is **fail-closed and activation-gated**: it permits acquisition,
private raw retention, transformed-signal publication, opted-in alerts, and
commercial product use of the exact EU-27 pilot only. Any ambiguity, dataset-level
exception, or change to the source's licence, coverage policy, or file contract
blocks activation pending fresh written Eurostat permission.

## 2. Applicable terms and rights determination

- **Licence:** Commission-owned Comext content is reusable under **CC BY 4.0** by
  default, per **Commission Decision 2011/833/EU** and the current European
  Commission legal notice. No dataset-level exception contradicting CC BY 4.0 was
  found for the detailed ITGS bulk files at the accessed date.
- **Conditions:** Credit to the source and **indication of changes** are required.
  Third-party-rights caveats in the legal notice do not apply to the
  Commission-owned statistical values used here.
- **Permitted uses (approved):** programmatic acquisition of the complete monthly
  bulk files; private retention of raw source objects; publication of derived,
  aggregated, exactly-mapped momentum signals; opted-in monthly/quarterly alert
  delivery; and commercial use within the HS Tracker product.
- **Required attribution (verbatim, from the canonical decision §1):**

  > Source: Eurostat Comext, detailed monthly international trade in goods,
  > extraction [UTC timestamp], current-euro import statistical value. Licensed
  > under CC BY 4.0. HS Tracker aggregated source CN codes and mapped eligible
  > products to HS 2012; changes are indicated in source details.

- **Retention / output limits:** retain **current plus two** preceding complete
  monthly packages resident (matching the repository Deployment Retention Window),
  and retain all raw source objects and their checksums privately. Published
  output is limited to the exact-mapped reporting-market / HS12-product / month
  observations and the fixed three-month seasonal comparison; raw reporter rows
  are never republished.

## 3. Official sources (accessed 2026-07-18)

- Eurostat — International trade in goods, detailed data metadata: `https://ec.europa.eu/eurostat/cache/metadata/en/ext_go_detail_sims.htm`
- Eurostat — International trade in goods database: `https://ec.europa.eu/eurostat/web/international-trade-in-goods/database`
- Eurostat — Bulk download facility (Comext tab): `https://ec.europa.eu/eurostat/databrowser/bulk?lang=en&selectedTab=fileComext`
- European Commission — Legal notice / reuse policy: `https://commission.europa.eu/legal-notice`
- Commission Decision 2011/833/EU: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011D0833`
- Creative Commons — CC BY 4.0 legal code: `https://creativecommons.org/licenses/by/4.0/legalcode`
- UN Statistics Division — HS classification correspondence tables (used only as reviewed classification evidence, never as trade facts): `https://unstats.un.org/unsd/classifications/Econ#corresp-hs`

## 4. Reproducible documented extraction path (no browser automation)

Complete-file discovery and download use the **public Eurostat dissemination
files API** only — a documented, stable endpoint. **No browser automation and no
undocumented private endpoint are used.** UN Comtrade is not contacted (§7).

**Directory discovery** (returns an HTML `#filetable` of `dir=`/`file=` links):

```text
GET https://ec.europa.eu/eurostat/api/dissemination/files/?sort=1&dir=<url-encoded path>
```

Traversal pinned for the pilot:

```text
comext
  └─ COMEXT_DATA
       └─ PRODUCTS
            ├─ full_v2_<YYYYMM>.7z            # complete detailed monthly file (all partners)
            └─ full_partxixu_v2_<YYYYMM>.7z   # supplementary UK partners GB/XI/XU only
  └─ COMEXT_METADATA
       └─ CLASSIFICATIONS_AND_RELATIONS
            ├─ CLASSIFICATIONS/ENGLISH/{CN.txt, CN_New_2026.txt, CN_Close_2026.txt,
            │     PARTNERS.txt, PARTNERS_ISO.txt, REPORTERS.txt, FLOW.txt,
            │     TRADE_TYPE.txt, STATISTICAL_PROCEDURES.txt, GEOZONES.txt, ...}
            └─ RELATIONS/{CN8-PRED-SUCC.txt, GEOZONES-PARTNERS_ISO.txt, ...}
```

**File download** (documented `file=` form of the same API):

```text
GET https://ec.europa.eu/eurostat/api/dissemination/files?file=comext%2FCOMEXT_DATA%2FPRODUCTS%2Ffull_v2_<YYYYMM>.7z
```

**Proof of extraction (executed 2026-07-18):** `full_v2_202512.7z` downloaded
over the API (HTTP 200, 45,431,111 bytes), decompressed with `7z` to
`full_202512.dat` (402,759,246 bytes, 4,902,194 rows), and parsed as CSV with the
documented header:

```text
REPORTER,PARTNER,TRADE_TYPE,PRODUCT_NC,PRODUCT_SITC,PRODUCT_CPA21,PRODUCT_CPA22,
PRODUCT_BEC,PRODUCT_BEC5,PRODUCT_SECTION,FLOW,STAT_PROCEDURE,SUPPL_UNIT,PERIOD,
VALUE_EUR,VALUE_NAC,QUANTITY_KG,QUANTITY_SUPPL_UNIT
```

Retained acquisition evidence (bytes, lengths, checksums, extraction time,
dictionaries) for the accessed objects:

| Object | Bytes | SHA-256 |
|---|---|---|
| `full_v2_202512.7z` | 45,431,111 | `87772f57859094474c5f3ae14bbc04dd515677ea2d614b711c8eab9a467308e6` |
| `GEOZONES-PARTNERS_ISO.txt` | — | `1fe0f55b09f309b9ffb346e8d125396afa5816578001dc5460b821562344794b` |
| `CN8-PRED-SUCC.txt` | — | `a5a28c853da4db6a16c4f5f06abbf59d69b9eee468d838842fcd3ecea5db5fba` |

Availability spans `full_v2_200201`..the latest reference month
(`full_v2_202605` at the accessed date), giving the ≥24 consecutive complete
monthly files the pilot requires.

## 5. Schema, domains, and reporter/partner controls (observed on real bytes)

- **Reporters:** exactly the 27 approved EU Member States are present in
  `full_v2_202512.dat` — `AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU
  LV MT NL PL PT RO SE SI SK`. This equals the pilot reporter allowlist; every
  other source geography is unsupported in v1.
- **Flow:** `FLOW` domain is `1=Import`, `2=Export` (`FLOW.txt`). The pilot uses
  `FLOW=1` only (2,157,798 import rows in 202512).
- **Trade type:** `TRADE_TYPE` domain is `I=Intra-EU`, `E=Extra-EU`,
  `L=partner XI`, `M=partner XU` (`TRADE_TYPE.txt`).
- **Statistical procedure:** domain includes `1=Normal`, `2=Inward processing`,
  `3=Outward processing`, `9=Not recorded from customs declarations`
  (`STATISTICAL_PROCEDURES.txt`).
- **Values:** `VALUE_EUR` is a non-negative integer current-euro statistical
  value (no decimals observed).
- **Product:** `PRODUCT_NC` is CN8 (eight digits); 13,245 distinct CN8 codes
  appear in 202512 import rows.
- **Cross-edition identity caveat:** CN's HS basis changes across HS revisions,
  so the same six characters are **not** a cross-edition identity guarantee.
  HS12 mapping must use pinned official correspondence evidence, never CN8
  six-digit truncation (a rejected alternative in the canonical decision).
- **Annual CN tables / correspondences discovered and retained for mapping (#59):**
  `CN.txt`, `CN_New_2026.txt`, `CN_Close_2026.txt`, and `RELATIONS/CN8-PRED-SUCC.txt`
  (CN8 predecessor/successor temporal linkage, 17,472 rows). HS-revision
  correspondences are taken from the UNSD tables cited in §3.

## 6. Aggregate, confidential, and special partner treatment

Partner codes in the detailed file are two-letter geonomenclature codes:
individually identified economies (ISO alpha-2, e.g. `US`, `CN`, `JP`) plus
source aggregates and special codes (e.g. `QP QR QS QV QW QY QZ XC XK XL XS`) and
the special products/partners documented in `PARTNERS.txt` (stores and provisions
`0950/0951/0952`, not-specified `0958/0959/0960`, and confidential/secret
`0975–0979`). Per the canonical decision, `identified_partner_value_eur` sums
**only** individually identified partners and eligible CN8 codes. Source regional
aggregates, world totals, confidential partner codes, unknown partners, and
special residuals are classified and **excluded without allocation**; a missing
detailed row is `NOT_OBSERVED`, never a measured zero. Partner identity is mapped
through the versioned Eurostat-to-ISO tables `PARTNERS_ISO.txt` /
`GEOZONES-PARTNERS_ISO.txt`.

## 7. UN Comtrade exclusion

No UN Comtrade bytes, API result, conversion output, or copied trade fact is
present in the pilot. All trade facts originate from Eurostat Comext. UNSD HS
correspondence tables are used **only** as reviewed classification evidence for
CN→HS12 mapping, not as trade data. UN Comtrade remains prohibited under the MVP
decision; acquisition fails closed if any Comtrade-derived fact is detected.

## 8. Control totals

An independently computable control total was captured on real bytes: the
recorded total import statistical value (`FLOW=1`, all reporters, all partners
including aggregates) for reference month **202512** is
**EUR 1,057,446,220,270** across 2,157,798 rows. Full source-vs-aggregate
reconciliation at reporter/month/flow — excluding aggregate/confidential/special
partners without allocation — is a build-time gate under #59; the aggregate
identified-partner total must reconcile exactly to the sum of eligible source
rows before promotion.

## 9. Source-conformance gate status (§9.2)

| # | Gate | Status |
|---|---|---|
| 1 | Official URL, metadata, bytes, lengths, checksums, extraction time, dictionaries retained | **Met** (§4) |
| 2 | Complete-file discovery reproducible without browser automation or undocumented endpoint | **Met** (§4) |
| 3 | File period, schema, dimension domains, reporter allowlist, uniqueness, integer value constraints pass | Observed on 202512 (§5); enforced per-vintage at build time (#59) |
| 4 | Source totals reconcile to independently acquired official control totals | Control total captured (§8); exact reconciliation is a build-time gate (#59) |
| 5 | Every accepted product's complete CN preimage and rejected touching codes proven from pinned correspondence evidence | Correspondence evidence discovered (§5); proven at build time (#59) |
| 6 | Aggregate/confidential/residual/unknown codes classified and excluded without allocation | Policy fixed (§6); enforced at build time (#59) |
| 7 | Current Commission legal notice covers content under CC BY 4.0; attribution/change indication present | **Met** (§2) |
| 8 | Recorded human rights review approves acquisition, display, alerts, commercial use, retention, output; ambiguity blocks activation | **Met** (§1) |
| 9 | No UN Comtrade bytes/API/conversion/copied fact present | **Met** (§7) |

Gates 1, 2, 7, 8, and 9 are satisfied by this record and its retained evidence
(the #58 scope). Gates 3–6 are per-vintage build-time gates fulfilled by the
Dataset Package build (#59) and re-checked on every acquired vintage; they are
fail-closed and independently block activation.

## 10. Activation blockers

Activation stays blocked until, and is automatically disabled on: a change to the
Comext licence or the Commission legal notice away from CC BY 4.0; a dataset-level
exception contradicting reuse; a file-contract or discovery-path change that
breaks reproducible acquisition; a reporter-allowlist or coverage-policy change
(e.g. EU accession/withdrawal); or a control-total, schema, checksum, mapping,
reconciliation, or smoke-query failure. Any such ambiguity requires fresh written
Eurostat permission before activation resumes.
