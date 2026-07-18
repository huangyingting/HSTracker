# Record: Eurostat Comext monthly momentum Dataset Package — real build & conformance

**Status:** Built — activation-gated (shadow period)
**Built:** 2026-07-19
**Extraction month:** 2026-07 (controls preliminary/final classification)
**Governs:** `recent-trade-momentum-v1` EU-27 pilot (issue #59; epic #49)
**Depends on:** [Source, rights, and extraction conformance](2026-07-18-eurostat-comext-rights-and-extraction-conformance.md) (#58)
**Canonical decision:** [Monthly trade momentum source, coverage, and recipe](2026-07-16-monthly-trade-momentum-source-and-coverage.md)

This record fixes the reproducible real build of the immutable Eurostat Comext
monthly Recent Trade Momentum Dataset Packages, the independent verification of
its aggregation, and the mapping of each #59 acceptance criterion to evidence.
The real build was produced by
[`scripts/release/build-real-eurostat-momentum-package.ts`](../../scripts/release/build-real-eurostat-momentum-package.ts),
which aggregates the detailed monthly Comext files in DuckDB-native SQL and
reuses the validated domain modules for mapping, the momentum recipe, the
Dataset Package manifest, and the promotion gates.

## 1. Inputs pinned for reproducibility

The complete-preimage CN→HS12 mapping is derived entirely from official code
lists and correspondence tables pinned under
[`data/recent-trade-momentum/inputs/`](../../data/recent-trade-momentum/inputs).
These are small, immutable reference artifacts committed as mapping evidence.

| File | SHA-256 |
| --- | --- |
| `cn8-codes-2024.txt` | `6ab5c71d5c6e281a5e74880cec17ae99f6b7564c5c110b82625a18f564dd7436` |
| `cn8-codes-2025.txt` | `d20590f46d231d4bf051c2e2625de132f4ee3afb8ad2ea363a48088dc85dc77c` |
| `cn8-codes-2026.txt` | `1f379ff6f2cc43ba3e92a826a134f65f2c8d12b2f3c85683bf58cb50ceca8c1c` |
| `cn8-to-hs2012-2024.csv` | `752a88f9fffe9c99d7aaa3307af97fed4f2987a3c9fe5325eaef6137c77aeb74` |
| `cn8-to-hs2012-2025.csv` | `861569200b68cb215bec25e9924d5be4feeb2dde7b18596a2025a3e5ad941c25` |
| `cn8-to-hs2012-2026.csv` | `45bff7f8e2145e0f3700ab777f73984d148736c1bb8e60191d26686616112f14` |

`buildEurostatCnToHs12MappingEvidence`
([`src/domain/recent-trade-momentum/eurostat-cn-hs12-evidence.ts`](../../src/domain/recent-trade-momentum/eurostat-cn-hs12-evidence.ts))
turns these into mapping evidence; `buildCnToHs12MappingReport` then derives the
eligible universe. Chapter 98/99 special codes are classified `SPECIAL` and never
mapped.

**Eligible complete-preimage universe:** exactly **3,830** HS2012 products across
the 2024, 2025 and 2026 CN editions (an HS2012 code is eligible iff *every* CN8
code touching it maps single-target in *every* edition year in the window;
20,957 accepted CN8 rows). Locked by
`tests/integration/recent-trade-momentum-eurostat-evidence.test.ts`.

## 2. Source objects

Detailed monthly bulk files were acquired from the approved path (see #58):

```
https://ec.europa.eu/eurostat/api/dissemination/files?file=comext%2FCOMEXT_DATA%2FPRODUCTS%2Ffull_v2_<YYYYMM>.7z
```

Each `.dat` is comma-delimited with an 18-column header
(`REPORTER,PARTNER,TRADE_TYPE,PRODUCT_NC,…,FLOW,…,PERIOD,VALUE_EUR,…`). Per-month
SHA-256 checksums of the extracted `full_<YYYYMM>.dat` files are recorded in
[Appendix A](#appendix-a-source-object-checksums). Each package manifest records
the window's `sourceObjectsSha256` (SHA-256 over the sorted per-file checksum
collection).

**Coverage:** 202404–202604 are Eligible Complete Months (27 EU-27 reporters,
~2.1M import rows each). 202605 is incomplete (partial reporter coverage) and is
**excluded** from every window.

## 3. Eligibility and observation rules (as built)

A source row contributes to a reporting-market month iff **all** hold:

- `FLOW = '1'` (import);
- `REPORTER` ∈ EU-27 allowlist;
- `PRODUCT_NC` is an 8-digit CN leaf (`SIMILAR TO '[0-9]{8}'`) — this drops the
  `XX`-suffixed hierarchical subtotals (e.g. `010121XX`, `01XXXXXX`) that would
  double-count;
- `VALUE_EUR` casts to an integer (empty/nulls dropped);
- `PRODUCT_NC` is an accepted CN8 for that period's CN edition year.

**Partner treatment:** value from non-individual geonomenclature codes
(stores/provisions, high seas, secret, not-specified, regional aggregates) is
excluded from the market total but summed separately as `excludedSpecialValueEur`
for transparency. Every other 2-letter code — ISO countries plus identified
territories (Kosovo `XK`, Ceuta `XC`, Melilla `XL`, Serbia `XS`, Qatar `QA`) — is
individual.

**Preliminary/final:** a reference month is `FINAL_BY_SOURCE_SCHEDULE` once the
extraction reaches October of the following reference year, else `PRELIMINARY`
(§5.1 of the canonical decision). At extraction month 2026-07, all 2024 months are
final and all 2025/2026 months are preliminary; consequently no series reaches
`HIGH` confidence in these vintages, which is correct.

## 4. Three shadow vintages (chained)

Three consecutive monthly vintages were built end-to-end. Each is a 24-month
window ending at its cutoff, chained via `--previous`, with
`--shadow-vintages-passed` incrementing so the public-capability activation gate
stays **closed** throughout the shadow period (activation requires ≥ 3 passing
shadow vintages).

| Cutoff | Window | Package identity | Market-months | Momentum rows (with signal) | Reconciled |
| --- | --- | --- | --- | --- | --- |
| 202602 | 2024-03 … 2026-02 | `…bcccee22…012e8de` | 2,113,805 | 103,410 (49,464) | ✅ |
| 202603 | 2024-04 … 2026-03 | `…c8b376ba…68d335` | 2,113,503 | 103,410 (50,349) | ✅ |
| 202604 | 2024-05 … 2026-04 | `…b13f006e…2a6532` | 2,112,574 | 103,410 (50,742) | ✅ |

Reconciliation (`sourceIdentifiedValueEur == aggregateIdentifiedValueEur`) held
exactly for every vintage:

| Cutoff | Identified market value (EUR) | Excluded special/aggregate (EUR) |
| --- | --- | --- |
| 202602 | 6,421,063,869,056 | 21,027,166,540 |
| 202603 | 6,451,778,541,319 | 21,232,522,160 |
| 202604 | 6,469,604,517,762 | 21,401,595,657 |

Revision reports chain correctly: 202602 has no predecessor (0 changes); 202603
supersedes 202602 (80,174 value changes, 25,071 state changes across all 27
reporters, 3,740 products); 202604 supersedes 202603 (80,603 value changes, 24,517
state changes, 3,743 products). Each artifact is ~134 MiB — well under the 1 GiB
target and 2 GiB hard limit.

## 5. Independent verification

Reconciliation alone is trivially satisfied (both totals derive from the same
`GROUP BY`), so aggregate cells were spot-checked **independently** against raw
`awk` sums over the source `.dat` (bypassing the builder's DuckDB path entirely),
using the 202604 window:

- **DE, 2024-06, HS12 010121** (CN8 `01012100`): artifact cell = `575325`; raw
  `awk` sum over individual partners = `575325` (9 rows). ✅
- **DE, 2024-06, HS12 270900** (CN8 `27090010`+`27090090`): artifact cell =
  `3,947,372,224`, 18 partners, 1 CN8 with trade; raw `awk` sum = `3,947,372,224`,
  18 rows, 1 distinct CN8. ✅

**Poisoning:** passenger motor cars `870323` (reallocated between HS2012 and
HS2022, so at least one touching CN8 is multi-target) is absent from
`product_mapping`, `market_month`, and `momentum` (0 rows) — ambiguous products
produce no signal. All 3,830 eligible products appear in both `product_mapping`
and `momentum`.

## 6. Acceptance criteria → evidence (#59)

1. **Synthetic oracles pass exactly** — all `recent-trade-momentum` integration
   suites are green (`recent-trade-momentum-{package,v1,mapping,dataset-package,serving}`).
2. **Identical source bytes → identical analytical rows; changed vintages → new
   identities + revision reports** — the analytical-row hash
   (`canonicalRecentTradeMomentumAnalyticalRows`) is byte-identical across
   independent rebuilds of the same window
   (`7e35922b…fdb967`) while the three distinct vintages produce three distinct
   package identities and chained revision reports. (The DuckDB *file* is not
   byte-stable; the determinism contract is the canonical analytical rows, per the
   synthetic package test.)
3. **Exact complete mappings per edition; ambiguous products no signal** — 3,830
   products proven eligible across the 2024/2025/2026 editions; `870323` poisoned
   and absent from the artifact.
4. **Artifact ≤ 1 GiB target, blocks above 2 GiB; totals reconcile** — ~134 MiB
   per vintage; source/aggregate totals reconcile exactly.
5. **Three shadow vintages pass before activation** — 202602 → 202603 → 202604 all
   reconcile with the activation gate closed throughout the shadow period.

## 7. Reproduce

```
# 1) Acquire + extract the monthly bulk files to <dat-dir> (see §2 URL, #58).
# 2) Build a single vintage (writes to data/work/, which is gitignored):
npx tsx scripts/release/build-real-eurostat-momentum-package.ts \
  --cutoff 202604 --extraction-month 2026-07 --git-sha <sha> \
  --dat-dir <dat-dir> --out data/work/recent-trade-momentum/202604

# 3) Chain the shadow period (increment --shadow-vintages-passed, chain --previous):
#    202602 (passed 0) -> 202603 (passed 1, previous <202602 pkg>) -> 202604 (passed 2, previous <202603 pkg>)
```

The pure seams are covered without the multi-GB source:
`tests/integration/recent-trade-momentum-eurostat-evidence.test.ts` (mapping
universe) and `tests/integration/recent-trade-momentum-real-builder.test.ts`
(aggregation/exclusion rules and preliminary/final classification).

## Appendix A: source object checksums

SHA-256 of each extracted `full_<YYYYMM>.dat` (202605 present but excluded as an
incomplete month):

```
8093cc9b42a59235d0301ce783902c134f3c5cc011868663ed8e8134bc3506ec  full_202403.dat
496943f966027cceaf7665d3c14f728c7271ae4fcb8265a383738f6711787496  full_202404.dat
9eff22d66db17738f91b0518a9c739818234b024562a0f55b59379160179be81  full_202405.dat
97473c77c01e629a9fae7c5410c171fe2d0bc9b4d3a6eb2e0d6377a275f440e9  full_202406.dat
74cbcc1287d5c8b23428426b2e15ebe50d629c3c0f4a6099636f706053cb3239  full_202407.dat
6f28b17c32c07fa55bebc78533ac87999f66afd6b96e4b42d055a4bb9189f98f  full_202408.dat
10ff76d0c6d262e13bacddeff06ba0bf7eb17a5e9ba597c73fc8035a8d0b99c6  full_202409.dat
4fdb4e15182617d21e91a44de0e259c0590933d1e98087cf5d4fda15820e84d8  full_202410.dat
606776b040ba7e59d9356f102e9e1e7c7c510767c819abefe51d8a6aa9b79c3b  full_202411.dat
a3982e14c24ca5e5de3cdd5f77ed0c06a9e187b15850b844cb96854b0ae348a7  full_202412.dat
39a266a6fe79d9df1451318da6e0f5880c8d2f27a8aef0d8ff78ae091cb84ab9  full_202501.dat
4a3daa6971e9aeddf57450148868880a8a2333dd0d82f29af9d02e75ed872d2b  full_202502.dat
829b0dddd8cb4981c998cba2280a3a3d8a4ea160254b0de06a159b64c7c14362  full_202503.dat
2348fcf9ab88e520bd079d6aa371dc3673f88a278a2735ea83783d8a4db05284  full_202504.dat
4a697e89e25d4045b24b8ddb630258b09707dd30902a79b0c0d6b0fff85625fd  full_202505.dat
a38184f334fcc5affd5312c5a3222444f55aafc59dc2a29b40fa3a43ce8d5197  full_202506.dat
4852842e744b809ce7d90fea0048d2d799c25f1382bcc03fb33f7fe8f519c309  full_202507.dat
af78406557374779aa57ab020d34b40f86f58a76a820f3b49b07561160da1ab1  full_202508.dat
8b299896abe029d1039bc959b1db0742b5f08ea6f1dda5578cda352363d46930  full_202509.dat
a07c6ebbe80d5653169936ac4f7e37c2271fdfa0560dec0f830e7cbffcb01b53  full_202510.dat
59b9880c8f4d9bcb51a28c42cd8fb5ef846697420d8920d39762e0d6a9a22aff  full_202511.dat
03fbd2b94ef0d3f6a0907c75c7118daf06f5d9574cc84d695fa71b4a0b97de6d  full_202512.dat
150066d92833f11551d29963936022e05b9f5947f19bf4b89ac390323f10cf40  full_202601.dat
4251d6e1ed0707913b1fc55352fb767ea2002b4fd4bc2c44bbed236a105835f0  full_202602.dat
cfe55089d4ac00abdf3aa16a5baa03cfd3a19cdc758c7524e6a3b8af1fc597c4  full_202603.dat
c7e3ef15de9c2a8e8f9e1860256368063ac42bceb660b20fa40bbb6943961d66  full_202604.dat
8d8be131854832e9474ed7268f51ed12dee3fbf8699cf078d67323b767f1ebb2  full_202605.dat
```
