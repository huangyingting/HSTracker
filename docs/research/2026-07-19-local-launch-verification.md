# Local launch verification (issue #63)

Durable record of the local single-host launch verification for the
opportunity-discovery and monitoring product (ADR-0004). The machine-verified
verdict lives in `reports/deployment/launch-report.3688257.json` and is
re-derived on every run by `tests/integration/launch-report.test.ts`; this note
records the live drills and probes that back that report's evidence so its
flags are traceable rather than asserted.

- **Build:** `36882575baca659a9930ff736d4d5c9910957d0f` (origin/main).
- **Deployment:** `docker-compose.local.yml`, loopback `127.0.0.1:3000`,
  machine class `local`, activation `CURRENT`.
- **Active identities:** deployment pairing
  `deployment-pairing-v1-524ecfbc74effe30`, BACI release `V202601`, analysis
  build `analysis-build-v1-949d1ac27ade40d4`, product-search build
  `product-search-v1-aa1f4027019c194b`, analysis artifact SHA-256
  `ca688ed1…`, catalog SHA-256 `fc8322c4…`, source-status snapshot
  `source-status-v1-b5ea309f2eef076f`, freshness `LATEST_KNOWN` (not degraded).

## Live probes

| Probe | Result |
|---|---|
| `GET /healthz` | `status ok`, `readiness ready`, build `3688257`, `activation.mode CURRENT` |
| Machine class header | `x-hs-tracker-machine-class: local` |
| Candidate-market smoke (`exporter=156&product=010121`) | 182 candidates (nonempty complete cohort) |
| Secret/path leakage scan over `/healthz`, `/api/v1/analyses/current`, `/metrics`, candidate-markets | none of `HS_TRACKER_RELEASE_`, `/data/`, `t3.storage.dev`, `AccessKey`, `SecretAccessKey` present |

## Control-plane drills (docs/local-deployment.md)

- **Restart rehearsal** — `docker compose -f docker-compose.local.yml restart
  hs-tracker` returned `readiness ready`, `activation.mode CURRENT`, and the
  identical deployment pairing and artifact SHA-256 as before the restart.
- **Resident fallback rehearsal** — renamed `data/local-deploy/objectstore`
  (empty mount = unreadable current mapping) and restarted. The process
  reactivated the last verified resident deployment rather than failing closed:
  `activation.mode LAST_VERIFIED_RESIDENT_FALLBACK`,
  `fallbackReason OBJECT_STORE_UNAVAILABLE`, with the pre-outage pairing and
  artifact identities intact and the service still `ready`. Restoring the
  directory and restarting returned `activation.mode CURRENT` and the 182-market
  smoke. This is the "failure leaves the prior deployment active" invariant
  observed live.

## Operational-store drills (locally-managed PostgreSQL, container `hs-tracker-local-postgres-1`)

Run against the compose PostgreSQL with `HSTRACKER_TEST_PG_URL` pointing at the
container, each in an isolated `ops_*` schema so live data is untouched.

- **Concurrent-evaluator drill** — `operational-store-postgres.test.ts` (3
  tests) passed: every watch claimed exactly once across concurrent evaluators,
  duplicate `(watch, dedupeKey)` recorded once, one delivery idempotency row
  reused under concurrent retries.
- **One-way migration** — `operational-store-migration.test.ts` (3 tests)
  passed: dry-run, migrate-every-record-then-seal, and refuse-dual-write.
- **Backup/restore** — `operational-store-postgres-backup.test.ts` passed: an
  account and watch survived a `pg_dump` backup → schema loss → `pg_restore`,
  and the pre-backup evaluation lease was stripped (the restored watch was
  immediately claimable again).

## Reproduce

```bash
export ORIGIN="http://127.0.0.1:3000"
npm run deployment:launch-report -- \
  --origin "$ORIGIN" \
  --gate-report reports/deployment/ee7313f.local-single-host-gates.json \
  --gate-report reports/deployment/8f34ce4.local-single-host-gates.json \
  --restart-rehearsed \
  --resident-fallback-rehearsed
```

The generator probes the live deployment, links the retained accepted
local-single-host gate reports (image 149 MB < 500 MB, artifact ~1 GB, catalog,
volume headroom, recurring cost USD 0/mo), and writes the artifact only after
`evaluateLaunchReport` re-derives a `launched` verdict. A held launch writes a
`held` report and exits non-zero, leaving the prior deployment active.
