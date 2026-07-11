# Decision: Trade-data freshness and provisional-year presentation

**Ticket:** [Define trade-data freshness and provisional-year presentation](https://github.com/huangyingting/HSTracker/issues/9)
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)
**Decided:** 2026-07-11

## Decision

The workspace and every export must distinguish five facts that are often
collapsed into an ambiguous "updated" label:

1. the immutable BACI release being analyzed;
2. the date CEPII updated that source release;
3. the years contained in it;
4. the rolling finalized window used by `cms-v1`; and
5. the operational status of checking for and publishing a newer release.

For the initial build, the compact presentation is:

```text
BACI HS 2012 - V202601
Source updated 22 Jan 2026 - score uses finalized 2019-2023
2024 is shown separately as provisional and is excluded from score and rank
```

Never describe `V202601` as "2026 data." The release was updated in 2026 but
contains annual evidence through provisional 2024.

| Area | MVP decision |
|---|---|
| Score window | Five latest Finalized Years in the selected BACI Release |
| Initial score window | 2019-2023 in `V202601` |
| Initial provisional evidence | 2024, visibly separate and never scored |
| Source identity | BACI version, HS revision, source-update date, checksum-backed analysis build |
| Workspace placement | Persistent compact data-scope strip plus expandable source details |
| Operational freshness | Latest-known, update-in-progress, refresh-delayed, or check-overdue |
| Failure behavior | Continue serving the last accepted immutable release with a persistent warning |
| Historical revision | Compare current and previous artifacts under the same current window and `cms-v1` implementation |
| Export | Carry immutable scope facts, separated provisional fields, revision evidence, and an immutable freshness-status snapshot |

## Vocabulary and separate clocks

### BACI Release

A BACI Release is one indivisible CEPII version such as `V202601`. All years in
one analysis come from that release. Historical years may be revised in a later
release, so "Finalized Year" means eligible for scoring in one release, not
forever immutable.

### Source update date

This is CEPII's absolute date for the pinned source bytes. Display
`22 Jan 2026` in localized UI copy and `2026-01-22` in machine-readable output.
Do not replace it with a relative-only phrase such as "updated six months ago."

### Artifact and deployment dates

The artifact build date and deployment activation date describe HS Tracker's
processing, not source recency. They belong in expanded provenance and
diagnostics, never in place of the CEPII source-update date.

### Source check date

The latest successful source check answers whether HS Tracker has recently
looked for a newer BACI release. It is operational state and can change without
changing any analysis bytes.

## Rolling finalized-window rule

`cms-v1` keeps one stable formula while its explicit calendar window advances
with accepted annual BACI releases.

Given a release whose newest ingested year is `Y`:

```text
provisional_year = Y
finalized_cutoff = Y - 1
primary_window   = finalized_cutoff - 4 .. finalized_cutoff
short_window     = finalized_cutoff - 2 .. finalized_cutoff
long_window      = finalized_cutoff - 9 .. finalized_cutoff
```

For `V202601`, `Y = 2024`, so:

```text
primary_window = 2019..2023
short_window   = 2021..2023
long_window    = 2014..2023
provisional    = 2024
```

Rules:

1. The pipeline must find the expected contiguous year members before
   promotion. It may not silently shorten or shift the windows.
2. The five-year primary window controls eligibility, score, rank, and Data
   Confidence.
3. The three- and ten-year windows remain internal stability evidence.
4. The newest year never enters score, rank, component normalization, stability,
   or Data Confidence.
5. A normal annual window roll changes `analysisBuildId`, source scope, and
   displayed years, but not the `cms-v1` formula version.
6. A change to weights, formulas, thresholds, normalization, or this rolling
   window rule requires a new score version.

The current response and URL-resolved analysis always carry the exact window.
There is no public score-window selector.

## Workspace information hierarchy

### Persistent data-scope strip

Place a compact strip in the main reading path between the search context and
ranked results. It remains visible while the analyst selects markets:

```text
BACI HS 2012 - V202601 - source updated 22 Jan 2026
Score window 2019-2023 - provisional context 2024
[Latest known release] [Source details]
```

The status uses text and an icon, not color alone. The source-details control
opens an in-page disclosure or dialog; it does not navigate away and lose the
current query.

All explanatory copy and status wording is localized in the supported English
and Simplified Chinese interface locales. Source versions, HS identity, ISO
machine dates, and build identifiers are not translated or rewritten.

### Source details

Expanded details show:

- full CEPII/BACI attribution and documentation link;
- BACI release and source-update date;
- HS revision and ingested year range;
- finalized cutoff and exact 3-, 5-, and 10-year windows;
- provisional year and why it is excluded;
- analysis build, artifact checksum, score version, and build date;
- latest successful source-check date and freshness state;
- previous release used for revision comparison, when available; and
- the rule that releases are never mixed in one score.

Long hashes may be abbreviated visually with a copy-full-value action.

### Ranking and evidence

The ranking cards and score explanation use finalized-window labels:

- `Mean annual imports, 2019-2023`;
- `Nominal growth, 2019-2023`;
- `Recorded foothold, 2019-2023`; and
- `Finalized coverage: 5/5 years`.

Do not put `Latest observation 2024` next to the score. That placement implies
that 2024 helped produce the score.

The selected-market evidence panel contains a visually separate section:

```text
2024 provisional snapshot
Supporting evidence only - excluded from score, rank, and Data Confidence.
BACI's newest year may be incomplete and materially revised.
```

The snapshot may show only transparent same-year evidence:

- recorded world-import value in current USD;
- selected export economy's recorded bilateral value and share, when
  calculable; and
- observation and quantity coverage.

It must not show a provisional Candidate Market Score, rank, growth component,
year-over-year direction badge, or "improving/declining" conclusion.

If no positive row is recorded for that provisional market/product, show:

```text
No recorded positive flow in the 2024 provisional data
```

Do not show zero, "no trade," or "data unavailable" unless the source state
actually establishes that stronger claim.

The comparison view follows the same separation. Finalized score evidence and
provisional snapshot columns cannot share an unlabeled period.

## Operational freshness state

### Monitoring cadence and targets

An automated source monitor checks CEPII:

- daily from 1 January through the end of February; and
- at least weekly from March through December.

The public status becomes `CHECK_OVERDUE` when no source check has succeeded for
14 calendar days. A newly detected release should be validated and promoted
within 24 hours normally. Warn at 24 hours, page/escalate at 48 hours, and
promote or expose `REFRESH_DELAYED` within seven calendar days.

The monitor writes immutable public status snapshots plus one mutable pointer in
private object storage. Runtime credentials remain read-only. The current
manifest combines the deployed build identities with the latest status snapshot.

A snapshot contains at least:

```text
source_status_snapshot_id
freshness_status_id
checked_at
check_overdue_at
served_baci_release
latest_known_baci_release
newer_release_detected_at
refresh_due_at
state
```

It contains no stack trace, private URL, credential, or raw pipeline error.
`freshness_status_id` digests the effective public fields.

Immutable status snapshots are retained with the release metadata. They are
small and must remain resolvable for any export URL the origin still supports.

The runtime evaluates state with an explicit UTC `asOf` instant. This permits
state to age safely even when the monitor is the component that stopped:

```text
check_overdue_at = checked_at + 14 days
refresh_due_at   = newer_release_detected_at + 7 days

if refresh failed or explicit rollback is active:
  REFRESH_DELAYED
else if newer release is known and asOf >= refresh_due_at:
  REFRESH_DELAYED
else if newer release is known:
  UPDATE_IN_PROGRESS
else if asOf >= check_overdue_at:
  CHECK_OVERDUE
else:
  LATEST_KNOWN
```

At a deadline, the runtime derives a new immutable effective snapshot whose
`effective_at` is that fixed deadline; it does not insert the request time. The
derived ID is therefore stable after transition and reproducible from the
retained monitor snapshot. The deployed manifest carries a last-known snapshot
as a startup fallback, so status can still age to overdue when the pointer
cannot be fetched.

The effective ID is a structured content address that includes the immutable
`source_status_snapshot_id`, effective state, effective timestamp, and a digest.
Given the ID, the runtime can load the retained source snapshot, reproduce the
deadline transition, and verify the digest after a restart. It does not depend
on an in-memory mapping or a runtime write.

Runtime object-storage reads occur in a background poll every 55-60 seconds
(60 seconds minus 0-5 seconds of jitter), not in the current-manifest request.
The request serves the last validated in-memory or deployment-manifest snapshot
and derives effective state.
Its browser/shared cache TTL is at most 60/300 seconds and is clipped to the
next state deadline, with no stale-content extension. The exact latency and
failure contract is in
[MVP performance and caching targets](./2026-07-11-mvp-performance-and-caching-targets.md).

### State machine

| Internal state | Public wording | Trigger |
|---|---|---|
| `LATEST_KNOWN` | `Latest known BACI release` | Recent successful check and no newer release detected |
| `UPDATE_IN_PROGRESS` | `New BACI release is being validated` | Newer release detected, no refresh failure, and `asOf < refresh_due_at` |
| `REFRESH_DELAYED` | `Data refresh delayed - showing the last validated release` | Validation/promotion failed, explicit rollback is active, or `asOf >= refresh_due_at` |
| `CHECK_OVERDUE` | `Source freshness check overdue - showing the last validated release` | No newer release is known, `asOf >= check_overdue_at`, and no stronger state applies |

`LATEST_KNOWN` does not mean real-time, current-calendar-year, or unrevisable. The
absolute source date and data-through year remain visible beside it.

Status precedence is:

```text
REFRESH_DELAYED > UPDATE_IN_PROGRESS > CHECK_OVERDUE > LATEST_KNOWN
```

If no accepted artifact can be served, the application returns its defined
`503` state instead of presenting a freshness badge over missing results.

### Refresh failure

A failed refresh never partially updates the active release:

1. Keep serving the last accepted deployment manifest and complete artifact.
2. Publish `REFRESH_DELAYED` and alert operators with private diagnostics.
3. Show a persistent workspace warning, not a transient toast.
4. Keep analysis and export available because the exact historical source scope
   remains valid and visible.
5. Retry or explicitly roll back/publish through the normal atomic promotion
   path.

Readiness remains healthy while a valid accepted artifact is served; health
reports freshness as degraded. An unreadable or incompatible active artifact is
an availability failure, not merely stale data.

## Release revisions

BACI may revise values and quantities for earlier years. The workspace calls
these **release revisions**, not historical growth or trend.

For revision comparison:

1. Use the current and immediately previous accepted BACI artifacts.
2. Run the same current `cms-v1` implementation on both.
3. Use the current release's exact five-year finalized window for both
   recomputations. This isolates source-version changes from a calendar-window
   change.
4. Never combine rows from the two releases in one score.
5. Compare only compatible HS12 product and economy identities.
6. Require both artifacts to contain every year in the current window. A
   skipped or abandoned annual release can make the previous accepted artifact
   too old; classify that case as `NOT_COMPARED` rather than shortening the
   window or failing the current analysis.

The current release may treat the cutoff year as finalized even though the
previous release marked that same year provisional. Using it in the internal
previous-artifact recomputation is intentional: it measures how the source
changed before and after finalization. It does not retroactively publish the old
provisional score.

Current candidates receive one revision state:

| State | Presentation |
|---|---|
| `NOT_COMPARED` | `No compatible prior release comparison` |
| `BELOW_THRESHOLD` | No badge; detail says no material revision flag |
| `MATERIAL_CHANGE` | `Changed materially since {previous release}` plus old/new score and rank-percentile deltas |
| `NEWLY_ELIGIBLE` | `Newly eligible in this release` |

Candidates present only in the previous cohort appear in the source-details
release summary as `NO_LONGER_ELIGIBLE`; they are not inserted into the current
ranking.

`MATERIAL_CHANGE` keeps the existing `cms-v1` threshold: absolute score change
of at least 10 points or rank-percentile change of at least 15 points. The badge
explains evidence and never changes the current score, rank, or confidence.

## Export requirements

The result-export ticket owns the exact CSV shape, column order, quoting, and
human-versus-machine packaging. It must preserve these freshness semantics.

Every exported record or machine-readable metadata record carries:

```text
baci_release
source_update_date
hs_revision
ingested_year_start
ingested_year_end
finalized_cutoff_year
score_window_start
score_window_end
provisional_year
score_version
analysis_build_id
product_search_build_id
artifact_sha256
source_attribution
```

Requirements:

- ISO dates and explicit integer years are used in machine fields.
- Provisional values have separate, year-bearing fields and an explicit
  provisional status. They never populate finalized score fields.
- Missing provisional rows preserve `NO_RECORDED_POSITIVE_FLOW`, not numeric
  zero.
- Revision fields identify the comparison release, state, old/new score where
  applicable, rank-percentile delta, and threshold flag.
- The export does not use a request-time `generatedAt` as a proxy for data
  freshness.

To communicate transient operational state without mutating bytes at an
immutable analysis URL, the export also binds one immutable
`freshness_status_id` and includes its public state, check date, served release,
and latest known release. The export URL/cache identity includes that status ID:

```text
analysis_build_id
  + exporter_code
  + product_code
  + product_search_build_id
  + freshness_status_id
  + export_schema_version
```

A changed accepted product translation, source check, or refresh state creates
a new export identity; it never changes an already cached file. The product-
search build affects exported labels only and does not enter analysis identity.
The exact transport is defined by the
[result export contract](./2026-07-11-result-export-contract.md).

Immediately before download, the client refreshes the short-lived current
manifest. It uses the latest effective status ID compatible with the active
analysis build and the compatible product-search build, then updates any warning
before requesting the immutable export. This preflight explicitly revalidates
instead of passively reusing a still-fresh browser entry.

The reusable attribution remains:

```text
Source: CEPII BACI, HS 2012, V202601 (updated 2026-01-22),
Etalab Open Licence 2.0.
```

## Required copy rules

Use:

- `BACI release V202601, source updated 22 Jan 2026`;
- `data through provisional 2024`;
- `score uses finalized 2019-2023`;
- `supporting evidence only - excluded from score and rank`;
- `changed between BACI releases`; and
- `last validated release`.

Avoid:

- `live data`, `real-time`, or `2026 trade data`;
- unqualified `current`, `fresh`, `final`, or `latest`;
- `2024 score`, `2024 trend`, or `updated score` for provisional evidence;
- `no trade` when BACI has no positive row;
- `historical growth` for a release revision; and
- error details that expose infrastructure.

## Acceptance fixtures handed forward

Acceptance must cover:

- the initial `V202601` dates and 2019-2023/2024 split;
- a later release rolling all 3-, 5-, and 10-year windows by one year without
  changing `cms-v1`;
- a provisional row present and absent;
- proof that provisional values cannot change score, rank, or Data Confidence;
- every operational freshness state and its precedence;
- exact transitions immediately before and at the 7- and 14-day UTC deadlines
  using an injected `asOf` instant;
- a failed refresh continuing to serve one complete accepted release;
- source-status unavailability aging into `CHECK_OVERDUE`;
- material, below-threshold, newly eligible, no-longer-eligible, and
  not-comparable revision states;
- same-window current/previous recomputation;
- a skipped release producing `NOT_COMPARED` instead of a shortened window;
- UI absolute dates and export ISO dates;
- an export identity changing when `freshness_status_id` or the bound
  `productSearchBuildId` changes while `analysisBuildId` remains unchanged; and
- no mixed-release rows in analysis or export.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Show only "updated recently" | Hides the source version, data-through year, and score cutoff |
| Treat release month as data year | `V202601` contains evidence only through 2024 |
| Keep `cms-v1` fixed to 2019-2023 forever | Annual refresh would stop improving score recency |
| Put provisional 2024 beside the score without separation | Implies it affected rank and confidence |
| Calculate a provisional score or year-over-year signal | Incomplete newest-year data can be materially revised |
| Remove export during a delayed refresh | The last accepted release remains valid historical evidence when precisely identified |
| Mutate old exports with the newest operational status | Breaks immutable URL and cache semantics |
| Compare each release's different published score window as "revision impact" | Conflates calendar-window movement with source revisions |
| Fail readiness only because a newer release is delayed | Restarts cannot repair source/pipeline freshness while a valid artifact is serving |

## Primary sources

All sources were accessed 2026-07-11.

- CEPII,
  [BACI documentation and FAQ](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html).
- CEPII,
  [January 2026 BACI release notes](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/release_notes_202601.pdf).
- Project,
  [MVP trade dataset and HS nomenclature](./2026-07-11-mvp-trade-dataset-and-hs-nomenclature.md).
- Project,
  [Candidate Market Score and data confidence](./2026-07-11-candidate-market-score-and-confidence.md).
- Project,
  [public-web data and deployment architecture](./2026-07-11-public-web-data-and-deployment-architecture.md).
