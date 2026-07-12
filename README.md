# HS Tracker

HS Tracker helps export-oriented businesses interpret public international
merchandise-trade data and identify Candidate Markets for deeper investigation.
It is a discovery aid, not a recommendation or a prediction of commercial
success.

## Local development

The runtime is pinned to Node.js 24.17.0 and npm 11.13.0.

```bash
npm ci
npm run dev
```

The public application is available at `http://localhost:3000`; health is
available at `/healthz`. Set `APP_BUILD_ID` to expose a deployment-safe build
identity in the health response. Local builds report `development` by default.
Development and end-to-end tests use the deterministic fixture runtime.

## Production runtime

Production startup loads one verified release pairing from private
S3-compatible storage into a persistent local volume:

```bash
HS_TRACKER_RUNTIME_MODE=release
HS_TRACKER_RELEASE_VOLUME_PATH=/var/lib/hs-tracker/releases
HS_TRACKER_RELEASE_S3_BUCKET=hs-tracker-releases
HS_TRACKER_RELEASE_S3_REGION=us-east-1
HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID=...
HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY=...
```

Use `HS_TRACKER_RELEASE_S3_ENDPOINT` and
`HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE=true` for a path-style compatible
endpoint. The AWS SDK default credential provider chain is used when the
read-only key pair is omitted.

The Node instrumentation hook blocks readiness until the active deployment,
current and previous analysis artifacts, product catalog, and startup smoke
queries have all been verified. Invalid configuration, incompatible manifests,
or corrupt bytes fail startup. Once ready, public requests use only resident
read-only adapters and never depend on object storage. A separate 55-60-second
background poll validates immutable Source Freshness Status snapshots; startup
uses the deployment's embedded fallback if that poll is unavailable. After one
successful smoke-tested startup, a verified local activation record allows the
same resident pairing to restart during an object-storage outage.

`/api/v1/analyses/current` reports the active analysis and search identities.
`/healthz` additionally reports the deployment pairing, artifact identities,
readiness, and Source Freshness Status without exposing credentials or volume
paths. See [release publication](docs/release-publication.md) for the complete
storage and hydration contract.

## Required checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

End-to-end tests build and start the standalone production server.

## BACI release staging

Keep the raw archive and generated Parquet outside the repository. The committed
descriptor and annual coverage approval drive the fail-closed staging command:

```bash
npm run stage:baci -- \
  --descriptor data/releases/V202601.source.json \
  --approval data/releases/V202601.coverage-approval.json \
  --workspace /tmp/hs-tracker-baci/V202601-work \
  --report reports/releases/V202601.source-report.json
```

The download resumes from workspace download storage. Pass
`--archive /path/to/BACI_HS12_V202601.zip` to validate an existing local copy.
Accepted runs atomically publish year-partitioned Parquet under the workspace;
coverage drift retains a report but publishes no staging.

## Release publication

Accepted analysis and product-search candidates are uploaded to private,
immutable S3-compatible storage and activated as one exact pairing. See
[release publication](docs/release-publication.md) for candidate layout,
credential scopes, promotion, production startup, rollback, and the local
MinIO integration test. See
[production deployment and restore](docs/production-deployment.md) for the
container, Fly Machine, cost, smoke, and recovery contract.
