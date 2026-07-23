# Release publication

Accepted analysis and product-search artifacts are published as one exact,
immutable deployment pairing. Promotion verifies every uploaded object by
reading and hashing it before atomically replacing the current pointer.

## Candidate directories

`npm run release:promote` accepts two directories:

| Analysis directory | Product-catalog directory |
|---|---|
| `candidate-market.duckdb` | `product-catalog.json` |
| `artifact-manifest.json` | `catalog-manifest.json` |
| `artifact-build-report.json` | `catalog-build-report.json` |

Both reports must be accepted, each manifest must match its report byte for
byte, and every artifact must match its manifest. The analysis and product
catalog must name the same BACI Release, source archive SHA-256, and HS12
revision.

Activation also requires a canonical `production-promotion-input-v1` whose eleven
gate-specific retained reports evaluate to `accepted`. The accepted promotion
identity must name the same BACI Release, analysis artifact SHA-256, and
product-search build ID as these candidate directories. This check runs before
the command creates an object-store client or publishes any immutable object.

## Object storage

Configure the S3-compatible private bucket through the environment:

| Variable | Required | Purpose |
|---|---|---|
| `HS_TRACKER_RELEASE_S3_BUCKET` | Yes | Private release bucket |
| `HS_TRACKER_RELEASE_S3_REGION` | Yes | S3 signing region |
| `HS_TRACKER_RELEASE_S3_ENDPOINT` | No | Custom S3-compatible endpoint |
| `HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE` | No | `true` for path-style endpoints; otherwise `false` |

Promotion uses the write-scoped credential variables:

- `HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID`
- `HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY`
- `HS_TRACKER_RELEASE_WRITE_SESSION_TOKEN` (optional)

Runtime hydration uses the distinct read-only variables:

- `HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID`
- `HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY`
- `HS_TRACKER_RELEASE_READ_SESSION_TOKEN` (optional)

Set an access-key ID and secret together. If a scoped pair is omitted, the AWS
SDK default credential provider chain supplies the process identity. Deploy the
runtime and promotion commands with different identities: runtime needs only
`s3:GetObject`, while promotion needs `s3:GetObject` and `s3:PutObject`. Never
pass credentials as command-line arguments.

Published objects use these key families:

```text
releases/{baciRelease}/{artifactSha256}/...
product-search-catalogs/{productSearchBuildId}/{catalogSha256}/...
analysis-release-catalogs/{catalogSha256}.json
deployment-pairings/{deploymentPairingId}.json
deployment-pointers/current.json
source-status/{sourceStatusSnapshotId}.json
source-status-pointers/current.json
```

Only the deployment and source-status `current.json` pointers are mutable. S3
conditional writes make each pointer activation compare-and-swap. Release
objects and Source Freshness Status snapshots are immutable and
content-addressed. All
immutable writes require the key not to exist and permit only
identity-equivalent retries. Public deployment metadata contains object keys
and content identities, never bucket URLs or credentials.

## Deployment retention window

The active deployment pointer names `current` plus a `history` array holding
up to two preceding compatible complete deployment pairings (see
`DEPLOYMENT_RETENTION_WINDOW_SIZE`/`DEPLOYMENT_RETENTION_HISTORY_LIMIT` in
`src/release/release-manifest.ts`). Each pairing already binds one complete
generation -- its own analysis artifact, analysis release catalog, product
catalog, Recommended Dataset Mapping, and Source Freshness Status fallback --
so retention never mixes recipe, data, or catalog generations across pairings.
Legacy pointers persisted before this window existed carried a single
nullable `previous` reference instead of `history`; parsing normalizes that
shape rather than failing closed, so a current-only legacy activation stays
valid and its history simply grows on later promotions.

Each `DeploymentPairingManifest` also declares its own
`residentFootprintBytes`: the deterministic sum of the objects it references
directly -- analysis artifact, artifact manifest, analysis release catalog,
product catalog, catalog manifest, and Recommended Dataset Mapping manifest
bytes -- excluding the pairing manifest's own bytes to avoid self-reference.
Before activation, promotion resolves the nested Dataset Package manifest and
Release Revision evidence as well, deduplicates every content-addressed object
across the window it is about to commit, and adds one configured DuckDB spill
reserve per pairing plus a safety-reserve fraction of the declared baseline
serving-volume policy (`RUNTIME_RESOURCE_POLICY.deploymentRetention` in
`src/runtime-resource-policy.ts`). A window that cannot fit this declared
policy fails closed with `RETENTION_HEADROOM_EXCEEDED` before any pointer
write, leaving the active deployment unchanged. The runtime repeats the exact
same calculation against verified resident metadata and actual serving-volume
capacity (via an injectable
`FilesystemCapacityProbe`, production `statfsFilesystemCapacityProbe` by
default) before committing resident activation, so a volume that is
genuinely out of headroom also fails closed without touching the resident
activation record (see `src/deployment/deployment-retention-footprint.ts`).

## Promote and roll back

```bash
npm run release:promote -- \
  --analysis-directory /path/to/accepted-analysis \
  --product-catalog-directory /path/to/accepted-product-catalog \
  --promotion-input /path/to/production-promotion-input.json \
  --activated-at 2026-07-12T02:00:00Z
```

The timestamp must be UTC without fractional seconds. The command prints the
activated deployment identity as JSON. Missing, blocked, mismatched, or
unverifiable promotion evidence prevents object-store access. A failed upload,
read-back, pairing check, or conditional pointer write leaves the active
deployment unchanged.
Low-level promotion never treats activation as a source check: it preserves the
current check time or, before the first status exists, uses the accepted
artifact build time.

After at least two pairings have been activated, swap current and previous
atomically:

```bash
npm run release:rollback -- \
  --activated-at 2026-07-12T04:00:00Z
```

Rollback promotes the immediate predecessor (`history[0]`) and keeps the
displaced current as the new immediate predecessor, so rolling back again
swaps current and `history[0]` once more without duplicating or losing an
entry; the retention window's older entries shift down and trim beyond the
window exactly as promotion does. It publishes a new immutable deployment
manifest that reuses the target artifacts while embedding the rollback's
`REFRESH_DELAYED` fallback. The
operational rollback command publishes the identical status through the status
pointer. The deployment pointer and manifest therefore agree before a process
starts, and retrying status reconciliation cannot toggle back to the displaced
deployment pairing. Both promotion and rollback deduplicate an already-retained
target by content-addressed key, so anomalous or repeated history never lists
the same pairing twice.

## Source monitoring and refresh

`.github/workflows/source-freshness.yml` checks CEPII daily in January and
February and every Monday from March through December. A manual check uses the
same entry point:

```bash
npm run source:monitor
```

Every successful check publishes an immutable status snapshot before replacing
`source-status-pointers/current.json`. A failed check leaves the accepted
snapshot and deployment untouched. Checks update the latest-known BACI Release
and check time without clearing an active refresh failure or rollback; only a
completed BACI Release refresh clears that operational state. If the status
pointer still describes another served BACI Release, the active deployment's
embedded fallback supplies the operational state. The monitor derives each
publication from the status and deployment read inside the same compare-and-swap
attempt, so a concurrent status change wins instead of being overwritten; typed
pointer conflicts retry against that winning status. Successful checks are
timestamped when the CEPII request completes rather than when it starts. The
workflow's `source-monitor` environment must provide the write-scoped S3
variables listed above. Leave optional endpoint, path-style, and session-token
secrets undefined when unused; the workflow exports them only when nonempty.
The pointer retains references to prior immutable snapshots across served BACI
Releases so supported export identities remain reproducible after restart or
rollback.

When a newer BACI Release is detected, use `npm run release:refresh` rather than
the low-level promotion command:

```bash
npm run release:refresh -- \
  --baci-release V202701 \
  --descriptor data/releases/V202701.source.json \
  --approval data/releases/V202701.coverage-approval.json \
  --staging-workspace /tmp/hs-tracker/V202701/staging \
  --staging-report reports/releases/V202701.source-report.json \
  --analysis-workspace /tmp/hs-tracker/V202701/analysis \
  --analysis-report reports/releases/V202701.analysis-report.json \
  --catalog-workspace /tmp/hs-tracker/V202701/catalog \
  --catalog-report reports/releases/V202701.catalog-report.json \
  --translations /path/to/accepted-translations.json \
  --aliases /path/to/accepted-aliases.json \
  --traditional-to-simplified /path/to/conversion-data.json \
  --review-manifest /path/to/catalog-review.json \
  --pipeline-git-sha "$(git rev-parse HEAD)" \
  --built-at 2027-03-03T00:00:00Z \
  --promotion-input reports/promotion/V202701.input.json \
  --activated-at 2027-03-03T01:00:00Z
```

Pass `--archive` to use an already downloaded BACI ZIP. The command runs source
staging, builds both accepted candidates, verifies the requested BACI Release
and the accepted promotion identity before any activation, promotes one exact
pairing, and then publishes the completed status. Generate the promotion input
from a candidate built with the same pinned sources, pipeline SHA, and
`--built-at`; the rebuilt artifact SHA-256 and product-search build ID must
match. Any build, authorization, or promotion failure keeps the prior pairing active
and immediately publishes `REFRESH_DELAYED`; private diagnostics go only to the
operator stream. Deployment-pointer activation is the commit point: a
post-commit status-pointer failure is retried as status reconciliation without
rebuilding or activating again. An already-running process continues serving
its one loaded pairing; process replacement/cutover is owned by deployment
orchestration rather than an in-process artifact hot swap.

## Runtime hydration

Run the production Next.js process with:

| Variable | Required | Purpose |
|---|---|---|
| `HS_TRACKER_RUNTIME_MODE=release` | Yes | Select verified release adapters |
| `HS_TRACKER_RELEASE_VOLUME_PATH` | Yes | Persistent local serving volume |
| S3 variables above | Yes | Read the active immutable pairing |

Use an absolute volume path. The baseline deployment provisions a 50-GiB
volume so current, its two retained predecessors, temporary, and query-spill
files fit while retaining operational headroom (see "Deployment retention
window" above for the exact declared headroom calculation).

The Node instrumentation hook invokes the verified runtime loader before the
process becomes ready. Startup:

1. reads and validates the active deployment pointer and every pairing in its
   retention window (current plus up to two retained predecessors);
2. hydrates each pairing's own analysis release catalog, current and
   compatible previous DuckDB artifacts, and production product catalog into
   its own resident directory, reusing another pairing's already-verified,
   content-addressed files by hardlink instead of re-downloading them;
3. verifies every local byte count, SHA-256, schema, and cross-artifact
   identity for every retained pairing;
4. opens each retained pairing's own DuckDB instance read-only and loads its
   own economy and product search adapters -- current keeps its DuckDB spill
   directory at the volume root, while each retained predecessor spills into
   its own resident directory instead;
5. loads each pairing's own validated Source Freshness Status fallback; and
6. runs the manifest-selected maximum-row analysis, product, and economy smoke
   query for every retained pairing, not only current, before installing the
   runtime.

Before committing resident activation, startup also evaluates the retention
headroom gate against the actual serving volume (see "Deployment retention
window" above); a volume without enough headroom fails closed before any
pointer or resident-activation write, leaving the prior active deployment
untouched.

`ReleaseHydrator.hydrateCurrent()` streams a missing pairing into a
process-specific `.partial` directory, fsyncs files and directories, and
atomically renames the complete directory into the serving volume. A resident
pairing is fully reverified before reuse. Failed hydration removes partial
state and never installs a runtime. Only after all startup smoke checks pass
for every retained pairing does the runtime atomically replace
`active-deployment.json` -- which records the exact retained current/history
order -- in the volume and prune pairing directories outside that window; this
commit runs only for an authoritative current startup (see "Resident fallback
activation" below), never for a fallback one.

### Resident fallback activation

Startup exposes one explicit, machine-readable **Deployment Activation Mode**
(see CONTEXT.md): `CURRENT` when it hydrated and verified the live active
deployment pointer's own candidate, or `LAST_VERIFIED_RESIDENT_FALLBACK` when
that candidate could not be retrieved or validated -- object storage
unavailable, or the pointer, deployment manifest, analysis release catalog,
Recommended Dataset Mapping, or Dataset Package failing identity, schema, or
semantic validation. `ReleaseHydrator` classifies every such failure through
one typed `RemoteCandidateActivationError` (`OBJECT_STORE_UNAVAILABLE` or
`CURRENT_DEPLOYMENT_INVALID`) at the hydration seam rather than an ad hoc
catch, so a broken newly pointed mapping cannot take down a known-good
resident deployment while genuinely unrelated errors -- and any corruption
found while independently reverifying the resident activation itself -- still
fail closed before readiness.

A verified fallback reactivates the *entire* last durably committed resident
activation record -- current plus its retained history, from one atomic
record -- and never mixes remote current with resident mapping, package,
catalog, or history. It never overwrites, prunes, or recommits that record,
and never serves an immutable sibling directory a failed remote candidate may
have left on disk; only the next authoritative current startup prunes such a
leftover. There is no fallback when no durable resident activation record
exists yet (a genuine cold start): startup fails closed and reports the exact
underlying reason instead of a vague summary. Because startup never re-reads
object storage after reaching readiness, object-store recovery never
hot-swaps a running process -- serving the fixed mapping requires a new,
controlled restart, which may then commit it as current.

Health, the current manifest's derived Source Freshness Status, structured
logs, and `/metrics` all expose this same bounded mode (plus a bounded
fallback-reason category, never a raw error message). The Source Freshness
Status keeps the same `freshnessStatusId` because Deployment Activation Mode
is orthogonal serving provenance; it does not reuse `rollbackActive` or infer
fallback from a caught exception. See "Runtime monitoring" in
[`promotion-and-observability.md`](promotion-and-observability.md) for the
exact fields.

After readiness, route handlers use the installed in-process adapters. No
analysis, product-search, economy, export, current, or health request reads
object storage -- including a request pinned to a retained predecessor, which
resolves and binds that predecessor's own manifests, catalog, and freshness
entirely from resident state. Requests naming a build outside the retention
window receive a typed retired outcome (`410` for JSON/CSV routes) with no
object-store access and no partial activation. A separate background poll reads and validates the status pointer
and immutable snapshot every 55-60 seconds. Each read has a 30-second deadline
so a hung request cannot extend that cadence. Poll failures retain the last
validated snapshot, which continues to age through the exact 7- and 14-day UTC
deadlines.

The current route reports the exact active analysis/search identities and
source windows. Health additionally reports the deployment pairing, current
and previous artifact SHA-256 identities, readiness, Source Freshness Status,
and the Deployment Activation Mode described above; it never reports
credentials, bucket URLs, or local paths. Readiness is `ready` in verified
fallback -- the served resident deployment is fully verified and smoke-tested,
so an external availability probe against `/healthz` and
`/api/v1/analyses/current` still counts it as available, while the distinct
activation field, not the analytical payload, identifies the degraded
control-plane state (see "Runtime monitoring" in
[`promotion-and-observability.md`](promotion-and-observability.md)). Until the
source monitor publishes status snapshots, the deployment pairing's embedded
bootstrap status is content-addressed from the accepted build and activation
fields. Its source-check age is anchored to the artifact build instant, so a
redeploy cannot reset it. Rollback embeds an explicit delayed fallback. Health
reports poll failures and warn/page state while readiness remains healthy as
long as the accepted artifact is available.

## Local S3-compatible integration

Docker is required for the S3 adapter suite. The test starts a MinIO release
pinned by image digest, creates an isolated bucket, exercises streaming uploads,
checksum enforcement, conditional pointer writes, credential separation, and
the promotion/rollback commands, then removes the container:

```bash
npm test -- tests/integration/s3-release-object-store.test.ts
```
