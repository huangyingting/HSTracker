---
status: accepted
---

# Local single-host deployment

HS Tracker's accepted production target is a **local single-host deployment**:
the complete application runs as one production container on the operator's own
machine, reachable over loopback HTTP, rather than on a hosted Fly.io Machine
behind a public URL. This decision selects the active deployment profile; it
does not change any analytical, release, or operational behaviour.

## The local baseline

The application still runs the same standalone glibc image, the same
`release` runtime mode, the same verified release loader, source-freshness
poller, promotion, and rollback. Only the **provider bindings** change, and they
stay outside the domain modules exactly as before:

| Hosted concept (Slices 15-17) | Local single-host binding |
|---|---|
| Fly.io Machine (`shared-cpu-2x`) | The operator's host; its class is recorded in deployment evidence as the "local" Machine class. |
| Public URL behind Fly Proxy TLS | Loopback origin `http://127.0.0.1:<port>`; no proxy, no TLS termination. |
| Fly Volume mounted at `/data` | A persistent local Docker volume mounted at `/data` as the reconstructible release cache. |
| Private object storage (Tigris/S3) | A local **filesystem release object store**: a host directory that holds the immutable release objects and the active-deployment pointer. |
| Bucket-scoped read-only S3 credentials | The runtime reads the local store through a read-only reader adapter with no write methods; write access is a separate promotion process. No S3 credentials exist. |
| Hosted, independently managed PostgreSQL | Locally managed PostgreSQL for the operational data plane; SQLite lightweight mode is unchanged. |
| Recurring hosted cost (~USD/month) | Self-hosted: no recurring provider cost. The cost gate is retained and records the local, zero-provider-cost forecast. |
| `Fly-Client-IP` rate-limit header | On loopback the client IP is the connecting socket. The local port MUST NOT be exposed to an untrusted network through any ingress that can pass a client-supplied rate-limit header. |

The filesystem release object store is a first-class provider adapter alongside
the S3 adapter: it implements the identical `ReleaseObjectReader` /
`ReleaseObjectStore` contract, so the verified release loader, hydration,
source-status polling, promotion, and rollback run byte-for-byte the same code
against a local directory as against S3.

## What this overrides

- **Slices 15-17 and Slice for opportunity-discovery launch** — wherever the
  canonical MVP specification says "Fly.io", "Machine class", "public URL", or
  "publicly reachable", read the local single-host binding above. The
  acceptance intent (a candidate deployment runs the complete application, is
  reachable, is smoke-tested with no secret/path leakage, and has retained
  restart/hydration/rollback and gate evidence) is unchanged.
- **Slice 17 "Do not accept a local or synthetic proxy for public launch"** —
  the product owner has chosen local operation as the target, so the launch is
  verified against the local deployment. This is a real production container
  serving real release data, not a synthetic proxy of one.
- **ADR-0003 "hosted deployment uses independently managed PostgreSQL"** — the
  operational plane runs on locally managed PostgreSQL. The dual-adapter
  behavioural contract (SQLite ⇔ PostgreSQL) and the one-way migration are
  unchanged.

## What is retained

`fly.toml`, the S3 release object store, `docs/production-deployment.md`, and the
`production-deployment-config.test.ts` Fly-topology check remain in the tree as
a documented **hosted profile** that can be re-selected without code change.
Selecting the local profile does not delete the hosted one; it changes which
provider bindings and runbook the operator uses.

## Consequences

- Local operation is exercised by the same test-first discipline: container
  integration proves native binary presence and local startup; the local
  package gates (image/artifact/catalog/free-space/cost) run unchanged; the
  performance, recovery, and lifecycle drills run against the local origin and
  record the local Machine class; the launch journeys run against the loopback
  origin.
- Because provider details stay outside domain modules, re-selecting the hosted
  profile later requires only environment/runbook changes, never a domain
  change.
