# Production deployment and restore

The production baseline is one always-on `shared-cpu-2x` Fly Machine with
2 GiB RAM, one encrypted 50-GiB Fly Volume, and a private Tigris bucket. The
configured candidate URL is:

```text
https://huangyingting-hs-tracker.fly.dev
```

The URL is evidence only after the deployment and smoke steps below pass.
`fly.toml` keeps provider configuration outside domain modules, terminates TLS
at Fly Proxy, routes only after `/healthz` succeeds, and restarts the Machine
only when the process exits unsuccessfully. A failed health check removes the
Machine from routing but does not restart it.

## Environment and secrets contract

The image sets `APP_BUILD_ID` from the required Docker build argument. The
non-sensitive runtime configuration is in `fly.toml`. Import only these
runtime secrets:

| Secret | Purpose |
|---|---|
| `HS_TRACKER_RELEASE_S3_BUCKET` | Private release bucket |
| `HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID` | Bucket-scoped read-only key |
| `HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY` | Read-only key secret |
| `HS_TRACKER_RELEASE_READ_SESSION_TOKEN` | Optional temporary token |

Create a Tigris access key with the bucket's `ReadOnly` role. Do not give the
Machine promotion credentials, generic editor credentials, or any
`HS_TRACKER_RELEASE_WRITE_*` secret. Runtime startup rejects write-scoped
release credentials. If `fly storage create` added generic `AWS_*` editor
secrets to the app, replace them with the scoped read-only secrets above and
remove the generic secrets before deployment.

Promotion runs outside the public Machine with the separate write-scoped
contract documented in [Release publication](./release-publication.md).
Verify the runtime key can read the active pointer and is denied when attempting
`PutObject` before importing it into Fly.

## Build and local package gate

Use the pinned Node 24.17.0 glibc image and an immutable application build ID:

```bash
export APP=huangyingting-hs-tracker
export BUILD_ID="$(git rev-parse HEAD)"
export IMAGE="hs-tracker:${BUILD_ID}"

docker build \
  --build-arg "APP_BUILD_ID=${BUILD_ID}" \
  --tag "${IMAGE}" \
  .

npm test -- \
  tests/integration/production-container.test.ts \
  tests/integration/production-deployment-config.test.ts
```

The container check starts the standalone server, verifies PID 1 runs as UID
1000 on glibc, loads the native DuckDB binding, rejects embedded BACI/DuckDB/
Parquet data, measures the compressed image, and evaluates the retained
V202601 artifact, catalog, volume, and cost gates.

For a separately tagged image, run the same package gate directly. Replace the
two free-space values with observed Fly values for deployment evidence:

```bash
npm run deployment:check -- \
  --image "${IMAGE}" \
  --artifact-report reports/releases/V202601.artifact-build-report.json \
  --catalog-report reports/releases/V202601.product-catalog-build-report.json \
  --cost-forecast deployment/cost-forecast.json \
  --volume-capacity-bytes 53687091200 \
  --volume-free-at-peak-bytes 46383198208 \
  --volume-free-after-activation-bytes 51675987024 \
  --volume-observation-class projected \
  --evaluated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

`deployment/cost-forecast.json` was checked against live provider pricing on
2026-07-12. Its Singapore baseline is USD 25.14/month, below the USD 40 target.
Refresh every provider price and assumption before initial deployment and each
annual release.

## First candidate deployment

Install `flyctl`, authenticate, and ensure the accepted immutable V202601
pairing is already present in the private bucket. Then create exactly one
encrypted volume and one Machine:

```bash
fly apps create "${APP}"
fly volumes create hs_tracker_releases \
  --app "${APP}" \
  --region sin \
  --size 50 \
  --snapshot-retention 5 \
  --yes

printf '%s\n' \
  "HS_TRACKER_RELEASE_S3_BUCKET=${HS_TRACKER_RELEASE_S3_BUCKET}" \
  "HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID=${HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID}" \
  "HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY=${HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY}" \
  | fly secrets import --app "${APP}" --stage

fly deploy \
  --app "${APP}" \
  --ha=false \
  --build-arg "APP_BUILD_ID=${BUILD_ID}"
fly scale count 1 --app "${APP}" --yes
```

Import `HS_TRACKER_RELEASE_READ_SESSION_TOKEN` in the same stream only when the
read key is temporary. `--ha=false` is required because Fly otherwise creates
spare Machines by default. Cold hydration may keep the service check unhealthy
while bytes are verified; the deployment has a 20-minute wait timeout. Do not
bypass health checks.

## Health and smoke

```bash
export ORIGIN="https://${APP}.fly.dev"

curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
curl --fail --silent --show-error \
  "${ORIGIN}/api/v1/analyses/current" | jq .
curl --fail --silent --show-error \
  "${ORIGIN}/api/v1/analyses/$(curl --fail --silent "${ORIGIN}/api/v1/analyses/current" | jq -r .analysisBuildId)/candidate-markets?exporter=156&product=010121" \
  | jq '.candidates | length'
```

Health must report `status: "ok"`, `readiness: "ready"`, the deployed
`APP_BUILD_ID`, and the exact deployment, analysis, catalog, artifact, and
Source Freshness Status identities. The analysis smoke must return a nonempty
complete cohort. Also verify HTTP redirects to HTTPS, `HEAD /healthz` has no
body, and public responses contain none of:

```text
HS_TRACKER_RELEASE_
/data/
t3.storage.dev
AccessKey
SecretAccessKey
```

Application operational events are one-line JSON records with `timestamp`,
`level`, and `event`. Inspect them with `fly logs --app "$APP"`; never paste
secret values into a log search.

## Restart rehearsal

Record the health identity before and after a normal restart:

```bash
fly machine list --app "${APP}"
fly machine restart --app "${APP}"
curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
```

The restarted process must fully reverify resident bytes, become ready, and
report the same deployment pairing and artifact identities. Record elapsed
time, Machine ID, image digest, health JSON, and logs.

## Cold restore

The Fly Volume is a reconstructible serving cache, not the durable source of
truth. If the volume or host is lost:

1. Record the failed Machine and volume IDs, active image digest, and incident
   start time.
2. Destroy the failed Machine only after confirming the accepted pairing is
   readable from private object storage.
3. Create a new encrypted 50-GiB `hs_tracker_releases` volume in `sin`.
4. Deploy the exact prior image digest with one Machine and the same read-only
   secrets.
5. Wait for hydration, checksum/schema verification, maximum-row smoke, and
   `/healthz` readiness.
6. Confirm the restored deployment pairing, artifact SHA-256, product catalog,
   and Source Freshness Status match the pre-incident identities.
7. Retain timings and logs. Recovery must finish within 30 minutes; cold
   hydration itself must finish within 15 minutes.

Never restore release truth from a volume snapshot alone. Object storage holds
the immutable accepted objects and has RPO 0; a snapshot is only an optional
cache-recovery aid.

## Rollback rehearsal

Rollback is a control-plane operation and therefore runs outside the public
Machine with write-scoped credentials:

```bash
npm run release:rollback -- \
  --activated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fly machine restart --app "${APP}"
curl --fail --silent --show-error "${ORIGIN}/healthz" | jq .
```

The new immutable rollback deployment must name the previous accepted pairing,
retain the displaced pairing as its reversible previous target, and publish
`REFRESH_DELAYED`. The restarted Machine must hydrate or reuse only verified
bytes and become ready within 15 minutes. Run the pinned analysis smoke, then
repeat the rollback command to rehearse reversal. Retain both deployment
identities, status snapshots, timings, health responses, and logs.

## Capacity observations

At peak hydration/promotion footprint and again after activation, capture:

```bash
fly ssh console --app "${APP}" \
  --command "df -B1 --output=size,avail /data"
```

Feed the two observed `avail` values to `npm run deployment:check` with
`--volume-observation-class observed`. The check blocks below 25% free, warns
below 30%, blocks artifacts above 10 GiB, and blocks compressed images above
500 MiB or resident catalogs above 32 MiB.
