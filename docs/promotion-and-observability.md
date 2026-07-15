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
- Fly Machine ID, `shared-cpu-2x` class, and region.

Before sending measurement traffic, each runner independently reads
`/healthz` and `/api/v1/analyses/current`. The health response attests the
application and Machine fields through `X-HS-Tracker-*` headers; the current
manifest attests the release, analysis, search, and artifact fields. A
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
npm run --silent promotion:browser-lab -- --plan <browser-plan.json>
npm run --silent promotion:origin-benchmark -- --plan <origin-plan.json>
npm run --silent promotion:mixed-load -- --plan <load-plan.json>
```

The browser plan must name median and maximum-row journeys with at least five
trials each. Chromium applies the fixed 390 x 844 mobile profile, 150 ms RTT,
1.6 Mbps down, 750 Kbps up, and 4x CPU throttle. Each journey selects context,
loads the complete Candidate Market list, changes the selected market, and
opens and closes the mobile Score details disclosure. Failed trials remain in
the report and are never retried or discarded. The measured
analyze-to-complete-list duration must meet p75 <= 2.5 seconds and p95 <= 4
seconds.

Each uncached origin benchmark entry supplies 105 never-reused semantic
requests: five warmups followed by 100 timed samples. Uncached Candidate-
analysis, Trade Trend, and CSV samples may not share analysis semantic keys.
Cache-hit entries reuse their one declared request after five warmups. The
origin report verifies the deployment-owned `X-HS-Tracker-Cache-State`
header: every uncached request must report `miss`, and cache-hit warmups
after the first request plus every timed cache-hit sample must report `hit`.
The 51 route/role cases cover all four artifact-attested representative
roles for each product operation -- including Trade Trend's own analysis
and CSV operations, measured and gated the same way as Candidate Market's --
plus the three singleton routes.

Every executed Candidate-analysis and CSV sample retains the artifact-attested
exporter/product pair for its role. Uncached samples vary only the
`X-HS-Tracker-Cache-Partition` value, which must equal the sample's unique
semantic key; the bounded runtime includes that partition in its process-cache
key without changing the query sent to DuckDB. This provides real misses
without substituting an easier, caller-selected product. Trade Trend's own
operations are measured and accepted/blocked by the same origin gate and
thresholds; binding their samples to the artifact-attested importer/product
pair the way Candidate Market's are is tracked for #48, alongside the actual
provider execution against a deployed candidate.

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
  --lifecycle <lifecycle.json> \
  > reports/promotion/<build>.performance.json
```

The combined command preserves all raw reports and evaluates the fixed
thresholds. It does not deploy, promote, or roll back a release.

The canonical ten-gate promotion report is produced separately:

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
or non-minute intervals are rejected.

Alert arithmetic and thresholds are implemented in
`src/operations/service-levels.ts`. The dashboard exposes route latency,
`500`/`503` rate, queue wait/depth, cgroup and RSS memory, process caches,
source polling/freshness, spill, volume headroom, and CPU throttling. Keep the
existing zero-cost basic-monitoring assumption unless a paid notification
transport is approved in the cost forecast.
