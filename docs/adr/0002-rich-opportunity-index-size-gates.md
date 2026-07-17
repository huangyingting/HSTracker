---
status: accepted
---

# Persist the rich Opportunity Index and raise its size gates

The Opportunity Index that serves `opportunity-discovery-v1` persists the full
Market Investigation feed grain — every column the feed and candidate detail
return — rather than a compact scoring projection that the runtime would
renormalize per request. Serving is therefore a byte-exact pure index read: a
page or detail response is the stored rows, in stored order, with no
per-request recomputation, ranking, or reshaping. This trades disk for latency
and removes a whole class of serve-time correctness drift between the build and
the runtime.

Persisting the full grain makes the index larger than a compact projection
would be, so the build size gates are raised from their original compact-index
values of 4 / 8 / 10 GiB to:

- **Index size target — 12 GiB.** Exceeding it is a review-required signal on
  the build report (`indexSizeReviewRequired`), never a silent cohort-row drop.
- **Combined size target — 14 GiB** for the analysis artifact plus this index.
  Also review-required, not blocking.
- **Combined hard limit — 18 GiB.** A combined package above this blocks
  promotion; it is the only size gate that fails closed.

The accepted full-cohort build (BACI `V202601`, all 227 eligible exporters,
224,034,026 rows) is ≈2.2 GiB — comfortably inside the 12 GiB target — so the
raised gates leave generous headroom for future BACI releases and added feed
columns while still catching an unbounded index before it reaches the Machine's
analytical volume. The gates live in `scripts/release/opportunity-index.ts` and
are mirrored in the header of `data/schemas/opportunity-index-v1.sql`.

This decision supersedes the compact-index sizing assumption for the
opportunity recipe only; the analytical/operational plane separation in
ADR-0001 is unchanged — the index remains an immutable, content-addressed,
read-only DuckDB Dataset Package object.
