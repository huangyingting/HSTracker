# Local single-host deployment and restore

This runbook operates the complete application as a **local single-host
deployment** per [ADR-0004](adr/0004-local-single-host-deployment.md): one
production container on the operator's own machine, reachable only over
loopback. The hosted Fly.io profile in
[`production-deployment.md`](production-deployment.md) remains a re-selectable
alternative and is not required to run the service.

The local profile binds the hosted building blocks to local equivalents:

| Hosted building block | Local equivalent |
|---|---|
| Fly Machine | One production container (`docker-compose.local.yml`) |
| Public `*.fly.dev` URL + Fly Proxy TLS | Loopback origin `http://127.0.0.1:3000`, no proxy |
| Private Tigris (S3) bucket | Filesystem release object store (a local directory) |
| Encrypted 50-GiB Fly Volume | Named Docker volume (`hs_tracker_releases`) |
| Hosted PostgreSQL for the operational plane | Local PostgreSQL container, or a local SQLite file |
| Metered provider spend | Zero provider cost (self-hosted) |

The release path itself is provider-agnostic: the runtime reads through
`ReleaseObjectReader` and promotion writes through `ReleaseObjectStore`, so the
same immutable promote / hydrate / rollback flow runs locally with no external
service.

## Loopback-only warning

Publish the application port on `127.0.0.1` only, exactly as
`docker-compose.local.yml` does. **Do not** publish it on `0.0.0.0` or behind
any ingress. Anonymous analysis rate limits key off the connecting socket's
client IP; on loopback that is trustworthy, but an ingress that forwards a
client-supplied IP or rate-limit header would let a caller spoof the limit.
There is no TLS termination in this profile because nothing is exposed off-host.

## Environment and secrets contract

The image sets `APP_BUILD_ID` from the required Docker build argument. The local
runtime configuration is entirely non-sensitive environment variables — there
are **no release secrets** to import, because the private bucket is a local
directory rather than an S3 service.

| Variable | Purpose |
|---|---|
| `HS_TRACKER_RUNTIME_MODE=release` | Serve the promoted release (not the fixture) |
| `HS_TRACKER_RELEASE_OBJECT_STORE=filesystem` | Select the filesystem release object store |
| `HS_TRACKER_RELEASE_FILESYSTEM_PATH` | Absolute path to the private release bucket directory |
| `HS_TRACKER_RELEASE_VOLUME_PATH=/data/releases` | Serving volume (reconstructible cache) |
| `HS_TRACKER_MACHINE_CLASS=local` | Reported in `X-HS-Tracker-Machine-Class` |
| `HS_TRACKER_OPERATIONAL_DRIVER=postgres\|sqlite` | Operational data plane driver |
| `HS_TRACKER_OPERATIONAL_PG_URL` | PostgreSQL DSN when the driver is `postgres` |
| `HS_TRACKER_OPERATIONAL_SQLITE_PATH` | SQLite file path when the driver is `sqlite` |

Filesystem mode needs no credentials, and runtime startup still rejects any
write-scoped `HS_TRACKER_RELEASE_WRITE_*` S3 credential it finds. The runtime
mounts the object-store directory **read-only**; only the promotion / rollback
control-plane commands below are given write access to it.

## Build and local package gate

Use the pinned Node 24.17.0 glibc image and an immutable application build ID:

```bash
export BUILD_ID="$(git rev-parse HEAD)"
export IMAGE="hs-tracker:${BUILD_ID}"
export HS_TRACKER_IMAGE="${IMAGE}"

docker build --build-arg "APP_BUILD_ID=${BUILD_ID}" --tag "${IMAGE}" .

npm test -- \
  tests/integration/production-container.test.ts \
  tests/integration/local-deployment-config.test.ts \
  tests/integration/local-release-deployment.test.ts
```

`local-release-deployment.test.ts` boots this image in release mode over
loopback against a filesystem object store, smoke-tests
`/healthz`, `/api/v1/analyses/current`, and `/metrics`, asserts the process runs
as non-root UID 1000, and verifies the serving volume re-hydrates after a
restart. `local-deployment-config.test.ts` validates the compose topology.

Evaluate the package gates with the local, zero-provider-cost forecast:

```bash
npm run deployment:check -- \
  --image "${IMAGE}" \
  --artifact-report reports/releases/V202601.artifact-build-report.json \
  --catalog-report reports/releases/V202601.product-catalog-build-report.json \
  --cost-forecast deployment/cost-forecast.local.json \
  --volume-capacity-bytes 53687091200 \
  --volume-free-at-peak-bytes 46383198208 \
  --volume-free-after-activation-bytes 51675987024 \
  --volume-observation-class projected \
  --evaluated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Retained evidence for the reviewed image lives at
[`reports/deployment/8f34ce4.local-single-host-gates.json`](../reports/deployment/8f34ce4.local-single-host-gates.json):
image, artifact, catalog, and volume gates accepted, and the cost gate accepted
at **USD 0/month**. `deployment/cost-forecast.local.json` reserves a 50-GiB
release volume on the host disk; confirm the host has at least that much free
(`df -B1 .`) before deploying. Volume observations are projected for the
V202601 artifact and are recomputed if the artifact changes.

## Promote an accepted release into the local object store

Promotion is a control-plane operation: point it at the **writable** object
store directory (not the read-only runtime mount) and give it an accepted
promotion input. The eleven gates include the Market Analysis launch evidence
bound to the exact build and active deployment. The release publication
mechanics are in [`release-publication.md`](release-publication.md).

```bash
export HS_TRACKER_RELEASE_OBJECT_STORE=filesystem
export HS_TRACKER_RELEASE_FILESYSTEM_PATH="$(pwd)/data/local-deploy/objectstore"
mkdir -p "${HS_TRACKER_RELEASE_FILESYSTEM_PATH}"

npm run release:promote -- \
  --promotion-input <accepted-promotion-input.json> \
  --analysis-directory <analysis-artifact-dir> \
  --product-catalog-directory <catalog-dir> \
  --activated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The immutable accepted objects and the current pointer now live under
`data/local-deploy/objectstore`. This directory is the **durable source of
truth** (RPO 0); the serving volume is only a cache.

## Start

```bash
export APP_BUILD_ID="$(git rev-parse HEAD)"
export HS_TRACKER_IMAGE="hs-tracker:${APP_BUILD_ID}"
docker compose -f docker-compose.local.yml up --build --detach
```

Compose bind-mounts `./data/local-deploy/objectstore` read-only at
`/objectstore`, hydrates the named `hs_tracker_releases` volume at `/data` on
startup, and waits for the local PostgreSQL service to be healthy first. Cold
hydration may keep the health check unhealthy while bytes are verified; do not
bypass the health check.

## Health and smoke

```bash
export ORIGIN="http://127.0.0.1:3000"

curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
curl --fail --silent --show-error "${ORIGIN}/api/v1/analyses/current" | jq .
curl --fail --silent --show-error \
  "${ORIGIN}/api/v1/analyses/$(curl --fail --silent "${ORIGIN}/api/v1/analyses/current" | jq -r .analysisBuildId)/candidate-markets?exporter=156&product=010121" \
  | jq '.candidates | length'
```

Health must report `status: "ok"`, `readiness: "ready"`, the deployed
`APP_BUILD_ID`, the exact deployment/analysis/catalog/artifact/Source Freshness
Status identities, and `activation.mode: "CURRENT"` for a normal deployment.
The analysis smoke must return a nonempty complete cohort. Confirm public
responses contain none of:

```text
HS_TRACKER_RELEASE_
/data/
t3.storage.dev
AccessKey
SecretAccessKey
```

Application events are one-line JSON records with `timestamp`, `level`, and
`event`. Inspect them with `docker compose -f docker-compose.local.yml logs`.

## Restart rehearsal

```bash
docker compose -f docker-compose.local.yml restart hs-tracker
curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
```

The restarted process must reverify resident bytes, become ready, and report
the same deployment pairing and artifact identities. This is the exact path the
`local-release-deployment.test.ts` re-hydration case exercises.

## Resident fallback rehearsal

Simulate a control-plane outage (object store unreadable or the current mapping
invalid) while the volume and host stay intact — for example, temporarily
rename `data/local-deploy/objectstore` — then restart:

```bash
docker compose -f docker-compose.local.yml restart hs-tracker
curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
```

The restart must reactivate the last verified resident deployment rather than
fail closed: confirm `activation.mode` is `LAST_VERIFIED_RESIDENT_FALLBACK`,
`activation.fallbackReason` names the bounded category, and the pairing/artifact
identities match the pre-outage deployment. Restore the object-store directory,
restart once more, and confirm the service returns to `activation.mode: CURRENT`
with the fallback pairing now the immediate retained predecessor.

## Cold restore

The `hs_tracker_releases` volume is a reconstructible serving cache, not the
durable source of truth. If it is lost:

1. Confirm the accepted pairing is readable from `data/local-deploy/objectstore`.
2. Recreate the volume: `docker volume rm hs_tracker_releases` then
   `docker compose -f docker-compose.local.yml up --detach`.
3. Wait for hydration, checksum/schema verification, maximum-row smoke, and
   `/healthz` readiness.
4. Confirm the restored deployment pairing, artifact SHA-256, catalog, and
   Source Freshness Status match the pre-incident identities.

Never restore release truth from the serving volume alone. Back up
`data/local-deploy/objectstore` (immutable release truth, RPO 0) and the
operational store; the serving volume never needs backing up.

## Rollback rehearsal

Rollback restores both immutable release truth and the exact prior application
image. Record and retain the current and prior image digests/build IDs before
the drill, and ensure both images are available locally before stopping the
application. The service remains stopped between pointer rollback and image
replacement so no mixed image/release state is served:

```bash
export HS_TRACKER_RELEASE_OBJECT_STORE=filesystem
export HS_TRACKER_RELEASE_FILESYSTEM_PATH="$(pwd)/data/local-deploy/objectstore"
export PRIOR_IMAGE="sha256:<prior immutable image digest>"
export PRIOR_BUILD_ID="<prior APP_BUILD_ID>"
export CANDIDATE_IMAGE="sha256:<candidate immutable image digest>"
export CANDIDATE_BUILD_ID="<candidate APP_BUILD_ID>"

docker image inspect "${PRIOR_IMAGE}" "${CANDIDATE_IMAGE}" >/dev/null
docker compose -f docker-compose.local.yml stop hs-tracker
npm run release:rollback -- --activated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HS_TRACKER_IMAGE="${PRIOR_IMAGE}" \
  docker compose -f docker-compose.local.yml up --detach --no-build --force-recreate hs-tracker
curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
```

The new immutable rollback deployment names the previous accepted pairing, keeps
the displaced pairing as the new immediate predecessor within the Deployment
Retention Window (reversible), and publishes `REFRESH_DELAYED`. Verify health
reports `PRIOR_BUILD_ID`, the prior deployment pairing, analysis/search builds,
artifact, Source Freshness Status, and `activation.mode: CURRENT`, then run the
accepted `market-analysis-v1` product smoke. Rehearse reversal by stopping the
application again, repeating `release:rollback`, recreating it with
`HS_TRACKER_IMAGE="${CANDIDATE_IMAGE}"`, and verifying `CANDIDATE_BUILD_ID` plus
the candidate identities and product smoke. Retain both image/deployment
identities, timings, health responses, and logs.

## Backup

- **Release truth:** copy `data/local-deploy/objectstore` (immutable accepted
  objects plus the current pointer). This is the only backup required for
  release recovery.
- **Operational store:** for PostgreSQL, `pg_dump` the `hstracker` database from
  the `postgres` service; for SQLite, copy the `HS_TRACKER_OPERATIONAL_SQLITE_PATH`
  file. Accounts, ledgers, and outbox rows live here. Both drivers strip ephemeral
  leases/sessions from the copy so a restore is clean and unleased — the
  PostgreSQL `backupPostgresSchema`/`restorePostgresSchema` helpers
  (`src/operations/store/postgres-backup.ts`) wrap `pg_dump`/`pg_restore` and are
  exercised by `tests/integration/operational-store-postgres-backup.test.ts`
  against a locally-managed database.
- **Serving volume:** no backup needed; it is rebuilt from the object store on
  the next startup.
