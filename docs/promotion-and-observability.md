# Promotion and observability

Issue #30 promotion is fail-closed. Local smoke evidence can exercise the
tooling, but it cannot be relabeled or accepted as candidate evidence.

## Candidate identity

Every browser, origin, and load plan carries the same identity:

- acceptance-fixture content SHA-256;
- application build ID;
- BACI Release;
- analysis and product-search build IDs;
- analysis artifact SHA-256; and
- Machine ID, accepted Machine class, and region.

Before sending measurement traffic, each runner independently reads
`/healthz` and `/api/v1/analyses/current`. The health response attests the
application and Machine fields through `X-HS-Tracker-*` headers; the current
manifest attests the release, analysis, search, artifact, and optional-package
capability fields. A
manifest-selected sparse, median, upper-quartile, and maximum-row benchmark
query is also included in this attestation; plans cannot assign those roles
to different exporter/product pairs. A mismatch stops the run before its first
trial. Measurement requests carry
`X-HS-Tracker-Probe: external-v1`, so they cannot inflate the request SLI.

Plans and retained reports must not contain provider tokens or storage
credentials.

## Performance evidence

The individual runners are:

```bash
node_modules/.bin/tsx scripts/promotion/build-candidate-origin-plan.ts \
  --config <candidate-origin-config.json> \
  --manifest <current-manifest.json> \
  --out <origin-plan.json>
npm run --silent promotion:browser-lab -- --plan <browser-plan.json>
npm run --silent promotion:origin-benchmark -- --plan <origin-plan.json>
npm run --silent promotion:mixed-load -- --plan <load-plan.json>
npm run --silent promotion:measure-http-cache-and-deadlines -- \
  --origin-plan <origin-plan.json>
```

The origin-plan config supplies the HTTPS origin, build/Machine identity, one
real Candidate Market code for each representative role, and either an ISO
alpha-2 Recent Momentum reporter or `null`. The current manifest supplies every
release identity, artifact-attested annual and Trade Explorer query, freshness
status, and optional capability declaration. The builder rejects disagreement
between those inputs and validates the complete plan before writing it.

The browser plan must name median and maximum-row journeys with at least five
trials each. Chromium applies the fixed 390 x 844 mobile profile, 150 ms RTT,
1.6 Mbps down, 750 Kbps up, and 4x CPU throttle. Each journey selects context,
loads the complete Candidate Market list, opens one complete Market Analysis,
and opens and closes the mobile Score details disclosure. Failed trials remain
in the report and are never retried or discarded. Both the measured
analyze-to-complete-list and Market-Analysis-to-complete durations must meet
p75 <= 2.5 seconds and p95 <= 4 seconds.

Each uncached origin benchmark entry supplies 105 never-reused semantic
requests: five warmups followed by 100 timed samples. Uncached Candidate-
analysis, Trade Trend, Supplier Competition, and CSV samples may not share
analysis semantic keys. Cache-hit entries reuse their one declared request
after five warmups. The origin report verifies the deployment-owned
`X-HS-Tracker-Cache-State` header: every uncached request must report
`miss`, and cache-hit warmups after the first request plus every timed
cache-hit sample must report `hit`. The 91 required route/role cases cover all
four artifact-attested representative roles for every core product operation,
including Trade Trend, Supplier Competition, Trade Explorer analysis/CSV, and
Market Analysis hit/miss, plus the three singleton routes. Four Recent Trade
Momentum cases and four Opportunity feed cases are added only when the deployed
current manifest declares those optional capabilities, producing 95 or 99
cases. Plan capability declarations are attested before traffic, so optional
routes can be neither fabricated nor silently omitted.

Every executed Candidate Market, Market Analysis, or Trade Explorer analysis
and CSV sample retains the artifact-attested exporter/product pair for its
role. Market Analysis additionally requires the exact immutable route and only
the `exporter`, `product`, and numeric `market` query parameters. Trade Explorer
binds the same identity through its `exportEconomy` and `hsProduct` parameters.
Opportunity feed samples bind the representative role's artifact-attested
exporter and must meet p95 <= 500 ms, p99 <= 1 s, 2 s route deadline, and
<= 256 KiB serialized page size. Uncached analysis samples vary only the
`X-HS-Tracker-Cache-Partition` value, which must equal the sample's unique
semantic key; the bounded runtime includes that partition in its process-cache
key without changing the query sent to DuckDB. This provides real misses
without substituting an easier, caller-selected product.

The HTTP cache drill derives its immutable Candidate Market and Market Analysis
paths from the same retained origin plan. It requires a successful GET with the
immutable cache policy and ETag, a 304 conditional GET, and a bodyless HEAD with
the same ETag and cache policy. Both the drill evidence and its source plan are
SHA-256-bound into the generated gate check set.

The candidate load plan is exact:

| Property | Value |
|---|---:|
| Sessions | 20 |
| Sustained rate | 4 requests/second |
| Sustained duration | 600 seconds |
| Route mix | 10% current / 25% search / 55% analysis / 10% CSV |
| Analysis mix | 80% primed hot keys / 20% never-reused keys |
| Burst | 10 requests/second for 30 seconds, with the same route and analysis mixes |
| Coordinated work | Four simultaneous uncached keys at least every 60 seconds |

With a 60-second coordinated interval, the plan needs at least 337 distinct
analysis keys: 264 for the sustained 20% uncached share, 40 for coordinated
bursts, and 33 for the burst's 20% uncached analysis share. The 300-request
burst contains exactly 30 current-manifest, 75 search, 165 analysis, and 30 CSV
requests; its analysis requests contain 132 hot and 33 distinct keys. Reserve
the declared maximum-row key for the first coordinated burst.
Every CSV request reuses its session's most recent analysis key and must report
a process-cache hit. Analysis keys are URI-component values substituted into
the one `{analysisKey}` placeholder in both analysis and CSV route templates;
for the production routes, use that placeholder for the product code and pin
the exporter and immutable build IDs in the surrounding template. Plans cannot
override the probe cache-state header or its expected `hit`/`miss` values.

The load CLI samples identity-labelled `/metrics` throughout both phases. It
derives peak cgroup memory, process RSS, spill bytes, minimum volume headroom,
and cgroup CPU throttling from those samples. Candidate plans are forbidden
from declaring these values themselves.

## Lifecycle evidence and combined gate

Retain a `trade-explorer-measurement-v1` file from the same candidate and
identity. Its `queries` array must contain exactly one `sparse`, `median`,
`upper-quartile`, and `maximum-row` query. Each entry records DuckDB scan
rows, result rows and bytes, exported bytes, peak memory and spill bytes,
queue wait, execution time, cancellation release latency, and proof that
cancellation did not poison cache or queue capacity
and a successful request immediately after cancellation. Promotion blocks any
entry above 250 scan rows, 250 result rows, 1 MiB result or export bytes,
1 GiB memory, 4 GiB spill, 5 seconds queue wait, execution, or cancellation
release.
Execution time must be positive. Other zeros are valid only when the measured
value was actually zero; all cancellation health booleans must be true.
Each entry's `benchmarkQuery` and `resultRows` must also match the same role's
query and grouped-row count from the origin runner's runtime identity
attestation; a role label alone cannot bind resource evidence to an artifact.

```json
{
  "schemaVersion": "trade-explorer-measurement-v1",
  "measurementClass": "candidate",
  "measuredAt": "2026-07-12T16:00:00Z",
  "identity": { "...": "same identity as every plan" },
  "queries": [
    {
      "productRole": "sparse",
      "benchmarkQuery": {
        "shape": "finalized-trend-v1",
        "measures": ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
        "exportEconomyCode": "156",
        "importEconomyCode": "276",
        "hsProductCode": "010121"
      },
      "scanRows": 12,
      "resultRows": 5,
      "resultBytes": 4096,
      "exportBytes": 8192,
      "peakMemoryBytes": 67108864,
      "peakSpillBytes": 0,
      "queueWaitMs": 3,
      "executionMs": 25,
      "cancellationReleaseMs": 12,
      "cancellationReleased": true,
      "cacheUnpoisoned": true,
      "queueUnpoisoned": true,
      "subsequentRequestSucceeded": true
    }
  ]
}
```

Retain a versioned lifecycle file from the same candidate and identity:

```json
{
  "schemaVersion": "lifecycle-measurement-v1",
  "measurementClass": "candidate",
  "measuredAt": "2026-07-12T16:00:00Z",
  "identity": {
    "fixtureManifestSha256": "<sha256>",
    "buildId": "<build>",
    "baciRelease": "V202601",
    "analysisBuildId": "<analysis-build>",
    "productSearchBuildId": "<search-build>",
    "artifactSha256": "<sha256>",
    "machineId": "<machine>",
    "machineClass": "shared-cpu-2x",
    "region": "sin"
  },
  "measurements": {
    "restartToReadyMs": 42000,
    "coldHydrationToReadyMs": 480000,
    "rollbackToReadyMs": 360000,
    "deployInterruptionMs": 12000,
    "recoveryTimeMs": 900000,
    "acceptedArtifactLossCount": 0
  }
}
```

Candidate durations must be measured positive values; zero placeholders are
rejected. Run all
performance surfaces and emit one identity-bound gate report with:

```bash
npm run --silent promotion:performance -- \
  --browser-plan <browser-plan.json> \
  --origin-plan <origin-plan.json> \
  --load-plan <load-plan.json> \
  --trade-explorer <trade-explorer.json> \
  --lifecycle <lifecycle.json> \
  > reports/promotion/<build>.performance.json
```

The combined command preserves all raw reports and evaluates the fixed
thresholds. It does not deploy, promote, or roll back a release.

The canonical eleven-gate promotion report is produced separately. Its
Market Analysis launch gate binds the product contract, analyst-needs matrix,
accessibility locale/theme/viewport matrix, annual-invariance success and
failure states, durable copy/reload/open/back/forward journeys, canonical links
and CSV exports, exact performance reports, current/retained/retired replay,
startup smoke, and rollback proof. The launch verifier independently rejects a
Market Analysis result at or above 1 MiB, even when an upstream check set claims
acceptance.

Rollback changes the immutable release pairing, not the application image. The
drill therefore proves the prior analysis/search pairing after restart and
re-runs the complete `market-analysis-v1` API against that pairing. The launch
record binds that drill to the same build's complete durable-workspace browser
suite and product-contract version. Application-image rollback remains a host
deployment operation rather than a release-publication operation.

```bash
npm run --silent promotion:check -- \
  --input <promotion-input.json> \
  > reports/promotion/<build>.promotion.json
```

Every gate descriptor must have retained local evidence, the same identity,
and complete attempt history. Verify evidence hashes before relying on a
report. A failed attempt remains blocking until a same-build resolution is
retained. The file named by each gate's `reportSha256` must itself be a JSON
gate-specific `<gate>-report-v1` report carrying the gate ID, status,
measurement class, measured build/release/artifact/Machine identity, and every
required named check for that gate. The report status is derived from those
checks. Accepted evidence must carry `measurementClass: "candidate"`; a
generic envelope or local-smoke report cannot be relabeled.

Activation consumes the same accepted input before object-store access:

```bash
npm run release:promote -- \
  --analysis-directory <accepted-analysis> \
  --product-catalog-directory <accepted-product-catalog> \
  --promotion-input <promotion-input.json> \
  --activated-at 2026-07-12T02:00:00Z
```

The accepted promotion identity must match the candidate BACI Release,
artifact SHA-256, and product-search build ID.

## Runtime monitoring

Fly scrapes `/metrics` on port 3000. Import
`deployment/grafana-dashboard.json` into the Fly Prometheus-compatible
Grafana datasource. The dashboard is UTC and defaults to the current calendar
month. Build and BACI Release variables isolate immutable deployments.

The request SLI counts real public `GET`/`HEAD` `2xx` and `304` responses as
success, excludes expected `400`, `404`, `409`, and `410` outcomes, counts
timeouts and other statuses as failures, and excludes synthetic probes. The
probe SLI requires one identity-bound current-manifest plus pinned-analysis
result for every exact UTC minute in its declared window; missing, duplicate,
or non-minute intervals are rejected. Verified resident fallback (see
"Resident fallback activation" in
[`release-publication.md`](release-publication.md#resident-fallback-activation))
serves the exact same identity-bound current-manifest and pinned-analysis
result as an authoritative current startup -- readiness stays `ready` and the
served analysis/search/artifact identities are the last verified ones -- so
both SLIs count it exactly like any other truthful, successful response under
this same contract with no code change. Nothing in either SLI's arithmetic is
activation-mode-aware; degraded control-plane state is identified separately
by the `hs_tracker_deployment_activation_mode` and
`hs_tracker_deployment_activation_fallback_reason` gauges below, never by
excluding or discounting successful fallback responses.

Alert arithmetic and thresholds are implemented in
`src/operations/service-levels.ts`. The dashboard exposes route latency,
`500`/`503` rate, queue wait/depth, cgroup and RSS memory, process caches,
source polling/freshness, spill, volume headroom, and CPU throttling. Keep the
existing zero-cost basic-monitoring assumption unless a paid notification
transport is approved in the cost forecast.

`hs_tracker_deployment_activation_mode{mode="current"|"last_verified_resident_fallback"}`
is a startup-fixed gauge (never recomputed while the process runs) reporting
exactly one label value as `1`. When it reports
`last_verified_resident_fallback`,
`hs_tracker_deployment_activation_fallback_reason{reason=...}` names the
bounded category (`object_store_unavailable` or
`current_deployment_invalid`) the same way, and `/healthz`'s `activation`
field and the one `application-runtime-ready` structured log (`warn` level in
fallback, `info` otherwise) report the identical mode/reason. None of these
ever carry a raw error message or any other unbounded value as a label.
