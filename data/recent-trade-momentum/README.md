# Recent Trade Momentum — pinned mapping inputs

Small, immutable reference artifacts used to derive the complete-preimage
CN→HS2012 mapping for the `recent-trade-momentum-v1` EU-27 pilot. They are the
only inputs to `buildEurostatCnToHs12MappingEvidence`
(`src/domain/recent-trade-momentum/eurostat-cn-hs12-evidence.ts`) and are pinned
here so the eligible product universe (3,830 products) is reproducible without
network access.

## Files

| File | Content |
| --- | --- |
| `inputs/cn8-codes-<year>.txt` | Active 8-digit CN (Combined Nomenclature) leaf codes for that annual CN edition. |
| `inputs/cn8-to-hs2012-<year>.csv` | Correspondence from each active CN8 code to its HS2012 (6-digit) target(s), used to detect splits/merges. |

Editions covered: **2024, 2025, 2026** (the CN editions spanning the 24-month
momentum windows).

## Provenance & regeneration

Derived from the official Eurostat Combined Nomenclature annual editions and the
CN↔HS2012 correspondence tables. Content-addressed SHA-256 checksums and the full
build/verification record are in
[`docs/research/2026-07-19-eurostat-comext-momentum-package-build-conformance.md`](../../docs/research/2026-07-19-eurostat-comext-momentum-package-build-conformance.md).

**Keep these files pristine** — the eligible universe (3,830) is locked by
`tests/integration/recent-trade-momentum-eurostat-evidence.test.ts`; edits change
the mapping evidence and must be justified against the canonical decision
([`2026-07-16-monthly-trade-momentum-source-and-coverage.md`](../../docs/research/2026-07-16-monthly-trade-momentum-source-and-coverage.md)).
