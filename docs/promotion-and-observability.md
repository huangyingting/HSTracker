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
mismatch stops the run before its first trial. Measurement requests carry
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
the report and are never retried or discarded.

Each uncached origin benchmark entry supplies 105 never-reused semantic
requests: five warmups followed by 100 timed samples. Candidate-analysis and
CSV uncached samples may not share analysis semantic keys. Cache-hit entries
reuse their one declared request after five warmups. The origin report verifies
the deployment-owned `X-HS-Tracker-Cache-State` header: every uncached request
must report `miss`, and cache-hit warmups after the first request plus every
timed cache-hit sample must report `hit`.

The candidate load plan is exact:

| Property | Value |
|---|---:|
| Sessions | 20 |
| Sustained rate | 4 requests/second |
| Sustained duration | 600 seconds |
| Route mix | 10% current / 25% search / 55% analysis / 10% CSV |
| Analysis mix | 80% primed hot keys / 20% never-reused keys |
| Burst | 10 requests/second for 30 seconds |
| Coordinated work | Four simultaneous uncached keys at least every 60 seconds |

With a 60-second coordinated interval, the plan needs at least 304 distinct
analysis keys: 264 for the sustained 20% uncached share and 40 for coordinated
bursts. Reserve the declared maximum-row key for the first coordinated burst.
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
    "restartToReadyMs": 0,
    "coldHydrationToReadyMs": 0,
    "rollbackToReadyMs": 0,
    "deployInterruptionMs": 0,
    "recoveryTimeMs": 0,
    "acceptedArtifactLossCount": 0
  }
}
```

Use measured durations; zeros above only illustrate the JSON shape. Run all
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
report carrying the declared schema version, status, measurement class, and
measured build/release/artifact/Machine identity. Accepted evidence must carry
`measurementClass: "candidate"`; a local-smoke report cannot be relabeled.

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
