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

## Promote and roll back

```bash
npm run release:promote -- \
  --analysis-directory /path/to/accepted-analysis \
  --product-catalog-directory /path/to/accepted-product-catalog \
  --activated-at 2026-07-12T02:00:00Z
```

The timestamp must be UTC without fractional seconds. The command prints the
activated deployment identity as JSON. A failed upload, read-back, pairing
check, or conditional pointer write leaves the active deployment unchanged.
Low-level promotion never treats activation as a source check: it preserves the
current check time or, before the first status exists, uses the accepted
artifact build time.

After at least two pairings have been activated, swap current and previous
atomically:

```bash
npm run release:rollback -- \
  --activated-at 2026-07-12T04:00:00Z
```

Rollback is reversible because it retains the displaced pairing as previous.
It publishes a new immutable deployment manifest that reuses the target
artifacts while embedding the rollback's `REFRESH_DELAYED` fallback. The
operational rollback command publishes the identical status through the status
pointer. The deployment pointer and manifest therefore agree before a process
starts, and retrying status reconciliation cannot toggle back to the displaced
deployment pairing.

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
variables listed above. Leave the optional endpoint and path-style secrets
undefined for standard S3; the workflow exports them only when nonempty. The
pointer retains references to prior immutable snapshots across served BACI
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
  --activated-at 2027-03-03T01:00:00Z
```

Pass `--archive` to use an already downloaded BACI ZIP. The command runs source
staging, builds both accepted candidates, verifies the requested BACI Release
before any activation, promotes one exact pairing, and then publishes the
completed status. Any build or promotion failure keeps the prior pairing active
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
volume so current, previous, temporary, and query-spill files fit while
retaining operational headroom.

The Node instrumentation hook invokes the verified runtime loader before the
process becomes ready. Startup:

1. reads and validates the active deployment pointer and pairing;
2. hydrates the pairing's analysis release catalog, current and compatible
   previous DuckDB artifacts, and production product catalog;
3. verifies every local byte count, SHA-256, schema, and cross-artifact
   identity;
4. opens both DuckDB artifacts read-only and loads the economy and product
   search adapters; and
5. loads the deployment manifest's validated Source Freshness Status fallback;
   and
6. runs the manifest-selected maximum-row analysis, product, and economy smoke
   query before installing the runtime.

`ReleaseHydrator.hydrateCurrent()` streams a missing pairing into a
process-specific `.partial` directory, fsyncs files and directories, and
atomically renames the complete directory into the serving volume. A resident
pairing is fully reverified before reuse. Failed hydration removes partial
state and never installs a runtime. Only after all startup smoke checks pass
does the runtime atomically replace `active-deployment.json` in the volume and
prune inactive pairing directories. If object storage becomes unavailable
while resolving the current deployment later, this record selects and fully
reverifies the last smoke-tested resident pairing; an empty or corrupt volume
still fails closed.

After readiness, route handlers use the installed in-process adapters. No
analysis, product-search, economy, export, current, or health request reads
object storage. Requests naming a non-active analysis or product-search build
receive `410`. A separate background poll reads and validates the status pointer
and immutable snapshot every 55-60 seconds. Each read has a 30-second deadline
so a hung request cannot extend that cadence. Poll failures retain the last
validated snapshot, which continues to age through the exact 7- and 14-day UTC
deadlines.

The current route reports the exact active analysis/search identities and
source windows. Health additionally reports the deployment pairing, current
and previous artifact SHA-256 identities, readiness, and Source Freshness
Status; it never reports credentials, bucket URLs, or local paths. Until the
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
