# Decision: MVP performance and caching targets

**Ticket:** [Set MVP performance and caching targets](https://github.com/huangyingting/HSTracker/issues/12)  
**Map:** [Chart the public-data HS Tracker MVP](https://github.com/huangyingting/HSTracker/issues/1)  
**Decided:** 2026-07-11

## Decision

This document fixes the numeric service contract deferred by the
[public-web architecture](./2026-07-11-public-web-data-and-deployment-architecture.md).
The public MVP is accepted only when the complete production artifact and
maximum-row product pass these targets on the intended Machine class. A trial
size is not accepted merely because average queries are fast.

| Area | MVP target |
|---|---|
| Core Web Vitals | Field p75: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 |
| Initial transfer | <= 200 KiB critical compressed bytes before LCP, <= 500 KiB total first-party, <= 250 KiB first-party JavaScript |
| Current manifest | Origin p95 <= 100 ms |
| Economy/product search | Origin p95 <= 200 ms uncached, <= 50 ms process hit |
| Candidate analysis | Origin p95 <= 2.0 s uncached, <= 100 ms process hit |
| CSV export | Origin p95 <= 3.0 s complete uncached, <= 250 ms TTFB on an analysis/process hit |
| User-visible analysis | Primary-region p75 <= 2.5 s and p95 <= 4.0 s |
| Target load | 20 concurrent sessions, 4 requests/s for 10 minutes, 10 requests/s for a 30-second burst, and a coordinated 4-key uncached burst each minute |
| Analytical starting configuration | 2 connections, 2 distinct computations, 2 DuckDB threads globally, queue depth 16, queue wait <= 5 s |
| Memory/cache | DuckDB <= 1 GiB, process caches <= 128 MiB, cgroup memory <= 85% |
| Artifact | <= 8 GiB target; > 10 GiB blocks promotion pending a new architecture/cost decision |
| Serving volume | 50 GiB initial; >=25% free after activation and at peak promotion footprint |
| Release refresh | <= 24 h normal, warn at 24 h, page at 48 h, promote or enter `REFRESH_DELAYED` by 7 days |
| Availability | >= 99.5% per UTC month, RTO <= 30 min, RPO 0 for accepted immutable artifacts |
| Cost | <= USD 40/month recurring core infrastructure; architecture review before a forecast above USD 50/month |

These are project-chosen SLOs except where an official source is named. They
are allowed to force a larger Machine. They are not relaxed to make the initial
2-shared-vCPU/2-GiB trial size pass.

## 1. Measurement contract

Performance results are valid only when they name the measurement class, cache
state, artifact, product fixture, Machine class, and sample window.

### Measurement classes

| Class | Boundary |
|---|---|
| Browser field p75 | 75th percentile of real page loads, segmented by mobile and desktop |
| Browser lab | Production build in a real browser under the fixed mobile profile below |
| Origin p95/p99 | Route Handler entry through completion of response generation, including queue wait and serialization but excluding client network transfer |
| HTTP cache hit | Browser/shared cache serves without an origin request |
| Process hit | Origin returns from the byte-bounded LRU or an in-flight coalesced computation without a new DuckDB query |
| Loaded-artifact uncached | Current and previous artifacts are attached read-only, but the semantic key is absent from HTTP/process/in-flight caches |
| Local restart | Machine start through successful smoke analysis with artifacts already verified on the volume |
| Cold hydration | Empty serving volume through download, checksum, atomic rename, attach, and successful smoke analysis |

The service records route duration, queue wait, query duration, serialization
duration, cache state, result bytes, build IDs, and correlation ID separately.
It never reports a cache-hit number as an uncached-query number.

### Representative product fixtures

Every accepted artifact manifest pins four product/query keys selected
deterministically from products with at least one primary-window bilateral row:

1. **Sparse:** the first product after sorting by complete-period
   `bilateral_year` count and then six-digit code.
2. **Median:** the lower middle product in that ordering.
3. **Upper quartile:** the product at
   `floor(0.75 * (benchmarkableCount - 1))`, used for the four-key load burst.
4. **Maximum-row:** the final product in that ordering.

For each product, select the eligible exporter with the most bilateral rows in
the primary score window, breaking ties by numeric BACI code. The exact
selection algorithm and manifest fields are fixed by the
[decision-complete MVP acceptance fixtures](./2026-07-11-decision-complete-mvp-acceptance-fixtures.md).
Sparse, median, and maximum-row feed pipeline and route benchmarks; all four
feed CI/load regressions and coordinated uncached bursts. The maximum-row
fixture must pass every Candidate Market analysis and export gate. Changing
release data may change the pinned keys; a benchmark run may not choose easier
products or exporters ad hoc.

### Production-like hardware and data

Origin gates run on:

- the production standalone container;
- a Fly Volume holding the complete accepted current and previous artifacts;
- the intended primary region;
- the candidate deployment class, beginning with `shared-cpu-2x` and 2 GiB RAM;
- production DuckDB, Node.js, Next.js, artifact schema, and filesystem options.

Developer-laptop results are smoke evidence only. Fly documents that shared
vCPUs receive a baseline CPU quota and can spend a finite burst balance; a short
test can therefore look fast and then throttle. The sustained load phase lasts
at least 10 minutes so it exceeds the documented maximum burst-balance window.
If the shared class misses any target, scale vertically and rerun all gates
before considering replicas.

Each single-route benchmark has 5 untimed warm-up requests and at least 100
timed samples per product/cache class. Report p50, p75, p95, p99, maximum,
errors, and timeouts; the promotion gate uses p95 and p99 below.
Candidate-analysis and CSV samples must execute the exact artifact-selected
exporter/product query for their role. To obtain independent process-cache
misses without substituting another product, each uncached probe supplies a
unique bounded cache-partition key that does not change the DuckDB query.

### Browser lab profile

Before enough field traffic exists, run at least five production-build browser
trials per product and use the median trial. Use Lighthouse's simulated mobile
profile: 150 ms RTT, 1.6 Mbps down, 750 Kbps up, and 4x CPU slowdown. A
scripted Playwright interaction runs separately for the median and maximum-row
products, changes the selected Candidate Market, and opens/closes score detail.

Lighthouse can gate LCP and CLS. INP is a field responsiveness metric, so the
pre-launch lab gate uses the scripted interaction's event-to-next-paint
duration <= 200 ms and a no-long-task-over-200-ms rule; it must not mislabel a
default Lighthouse result as field INP. Field INP becomes a release signal only
after enough first-party, privacy-reviewed samples exist to compute a stable
p75.

## 2. Page and payload budgets

Google's official Core Web Vitals guidance defines "good" at the 75th
percentile, separately for mobile and desktop:

| Metric | Field p75 target |
|---|---:|
| Largest Contentful Paint | <= 2.5 s |
| Interaction to Next Paint | <= 200 ms |
| Cumulative Layout Shift | <= 0.1 |

The byte budgets are HS Tracker choices:

| Payload | Budget |
|---|---:|
| Compressed first-party bytes required before LCP | <= 200 KiB |
| Total compressed first-party initial page transfer | <= 500 KiB |
| Compressed first-party JavaScript on initial route | <= 250 KiB |
| Current manifest JSON | <= 16 KiB uncompressed |
| One economy or product-search response | <= 64 KiB uncompressed |
| Complete Candidate Market JSON | <= 1.5 MiB uncompressed and <= 300 KiB compressed |
| CSV | Existing 5 MiB uncompressed contract limit |

The initial page does not preload a Candidate Market result before the analyst
chooses context. Use system fonts or budget any self-hosted font inside the
first-party limits. Third-party scripts are not exempt from Core Web Vitals,
even if their transfer is reported separately.

## 3. Latency and timeout targets

### Origin

| Operation | p95 | p99 | Timeout/deadline |
|---|---:|---:|---:|
| `GET /` HTML shell | 200 ms | 500 ms | 2 s |
| `GET /api/v1/analyses/current` | 100 ms | 250 ms | 2 s |
| Versioned economy/product search, uncached | 200 ms | 500 ms | 2 s |
| Economy/product-search process hit | 50 ms | 100 ms | 2 s |
| Candidate analysis, loaded artifact and uncached | 2.0 s | 4.0 s | 5 s execution / 12 s route |
| Candidate-analysis process/in-flight hit | 100 ms | 250 ms | 2 s |
| CSV, uncached analysis through complete generation | 3.0 s | 6.0 s | 15 s route |
| CSV with analysis/process hit | 250 ms TTFB | 500 ms TTFB | 15 s route |
| `GET /healthz` | 50 ms | 100 ms | 2 s |

Candidate analysis has a separate 5-second maximum queue wait and 5-second
execution limit, with a 12-second route deadline that retains serialization
headroom. CSV has a 15-second route deadline including any queue wait. A
timeout must interrupt/cancel the DuckDB operation and release its
connection/semaphore slot; abandoning only the
JavaScript promise is a defect. If the selected DuckDB Node API cannot prove
safe cancellation, the implementation must choose a cancellable execution
boundary before launch.

The candidate result is generated before bytes are sent, so an internal failure
cannot leave a successful partial JSON/CSV response. HTTP cache-hit latency is
measured separately at the browser/proxy and is not an origin SLO.

### User-visible analysis

From activating "Analyze markets" with a valid selected exporter/product until
the complete ranked list and first evidence record are interactive:

| Percentile | Primary-region target |
|---|---:|
| p75 | <= 2.5 s |
| p95 | <= 4.0 s |

This milestone waits for the complete, non-paginated Candidate Market JSON; it
does not render a fast partial list while evidence is still downloading. The
300-KiB compressed response cap is tested with both median and maximum-row
products on the fixed browser profile. At 1.6 Mbps, 300 KiB requires about 1.54
seconds of payload transfer before protocol/render overhead, leaving the p75
budget dependent on the median query being substantially faster than the
2-second worst-case origin ceiling. If that end-to-end gate fails, reduce
payload/code or improve the query; do not hide the remaining result behind
pagination.

Changing the selected market or comparison tray after the complete result is
loaded is client-local: next paint <= 100 ms p95 and no network request.
Product-search requests start only after the existing two-normalized-character
rule, use 150 ms debounce, abort superseded browser requests, and never
auto-select a late response.

## 4. Capacity and overload

### Accepted public load

| Dimension | Target |
|---|---:|
| Concurrent browser sessions | 20 |
| Sustained mixed traffic | 4 requests/s for >= 10 minutes |
| Burst | 10 requests/s for 30 seconds |
| Coordinated distinct uncached burst | >= 4 once per minute |
| Simultaneous identical-key requests fixture | 10 |
| Queue rejection at target load | 0 |
| Unretryable application errors at target load | 0 |

The sustained route mix is 10% current manifest, 25% economy/product search,
55% Candidate Market analysis, and 10% CSV. Of analysis requests reaching the
origin, 80% repeat a bounded hot-key set and must be process/in-flight hits;
20% are distinct uncached semantic keys. At 4 requests/s this is 0.44 uncached
analyses/s, below the conservative two-slot throughput of 1 uncached analysis/s
at the 2-second p95 ceiling. During the 10-request/s burst it is 1.1/s for only
30 seconds, which the 16-entry queue must absorb without rejection. Once per
minute, the generator also releases four different uncached keys together,
including the maximum-row product. The cache-hit ratio and burst are assertions,
not assumptions hidden from the load report.

The 30-second burst uses the same 10/25/55/10 route mix and the same 80/20
analysis-key split as sustained traffic: 30 current-manifest, 75 search, 165
analysis (132 hot and 33 distinct), and 30 CSV requests. With ten coordinated
four-key bursts, candidate plans therefore require 337 never-reused analysis
keys: 264 sustained, 40 coordinated, and 33 burst keys.

Warm the bounded hot-key set before timing, bypass browser/shared HTTP caches so
the declared origin route mix actually reaches the process, and verify each
supposed hit from instrumentation. Distinct keys are never warmed or reused
during their uncached sample. Every timed CSV request follows and reuses a
candidate-analysis key from the same simulated session, matching the accepted
workflow; it must not create an extra uncached DuckDB query. The separate
single-route benchmark still measures the explicitly uncached CSV path.

### Coalescing and queue

Identical semantic keys coalesce before consuming an analytical semaphore
slot. Ten concurrent identical requests must execute one analysis and return
ten equivalent responses. A disconnected waiter does not cancel shared work
while another waiter remains.

Distinct computations use a FIFO queue:

| Setting | Starting value |
|---|---:|
| Analytical connections | 2 |
| Global distinct analytical computations | 2 |
| DuckDB `threads` (global worker limit) | 2 |
| Queue depth | 16 |
| Queue wait | <= 5 s |
| Analysis execution | <= 5 s |

One DuckDB database instance attaches the current and compatible previous
artifacts once; two connections share that instance and permit two computations.
DuckDB's `threads` setting is global, not per connection, so pin it once to two
total workers. The application semaphore separately limits two distinct
queries; together these controls prevent more than two DuckDB workers on the
2-vCPU trial. The performance thresholds, not these knob values, are invariant:
a benchmark may justify one computation, another global thread limit, or a
larger Machine, but any change must rerun the load gate.

If the queue is full or a request reaches its queue deadline, return:

```text
503 ANALYSIS_CAPACITY_EXCEEDED
Retry-After: 2
Cache-Control: no-store
```

Never create an unbounded queue, silently drop work, return an empty result, or
hold a request beyond its deadline. Above-target overload may be rejected; a
rejection at target load fails promotion and counts against availability.

### DuckDB memory and spill

On the 2-GiB trial class, explicitly configure:

```text
memory_limit = 1GiB
threads = 2 (global)
temp_directory = <serving-volume>/spill
max_temp_directory_size = 4GiB
```

DuckDB documents defaults of 80% of RAM for `memory_limit` and 90% of available
disk for `max_temp_directory_size`; both are unsafe here because Node, caches,
the OS, and immutable artifacts need headroom. The spill directory is bounded,
separate from immutable files, and emptied only when no query uses it.

Promotion requires:

- peak cgroup `memory.current` <= 85%;
- process RSS <= 75% of the cgroup limit during the sustained load test;
- no OOM, unbounded spill, or filesystem-full error;
- any spill stays inside 4 GiB and the 25% volume-free gate;
- latency targets still pass after shared-CPU burst balance is depleted.

## 5. Process caches

The complete process-owned cache budget is 128 MiB:

| Cache | Hard byte cap | Key |
|---|---:|---|
| Candidate analysis | 96 MiB | `analysisBuildId + exporterCode + productCode` |
| Product/metadata search | 16 MiB | Versioned build + normalized query + locale + limit |
| Effective manifest/status micro-cache | 1 MiB | Current compatible manifest/status |
| Unallocated safety reserve | 15 MiB | Not available to cache entries |

Analysis and search use byte-weighted access-order LRU. Immutable entries have
no time TTL: their exact build key prevents content staleness, and capacity is
the only eviction reason. A valid empty analysis is cacheable. Errors,
timeouts, and overload responses are not.

Route handlers validate that the requested build is active and compatible
before consulting the LRU. Promotion evicts entries for retired
analysis/product-search builds; an old cached process entry must never bypass
the origin's required `410`. Long-lived shared/browser copies remain valid only
because they were already served from their immutable URL.

Entry weight is deterministic UTF-8 serialized response length plus a fixed
1-KiB per-entry accounting overhead. This is an eviction weight, not a claim
that JavaScript heap use equals serialized bytes; RSS/cgroup gates catch native
and object overhead. Cache admission rejects any single entry larger than its
partition rather than exceeding the cap.

The status micro-cache is replaced by the background pointer poll and
deadline-derived effective state. It is not an LRU and never prevents an
effective state transition.

No Redis or cross-replica process cache is introduced. If replicas are added,
their local LRUs are independent; shared HTTP caching remains the cross-replica
layer.

## 6. HTTP caching

Next.js documents Route Handlers as uncached by default, so every policy below
is an explicit response header.

| Route class | Cache-Control | Other requirements |
|---|---|---|
| Hashed `/_next/static/*`, fonts, images | `public, max-age=31536000, immutable` | Content-addressed filename |
| HTML shell | `public, no-cache` | Representation-correct `ETag`; revalidate every use |
| `/api/v1/analyses/current` | `public, max-age={min(60, deadlineSeconds)}, s-maxage={min(300, deadlineSeconds)}, must-revalidate` | Weak semantic `ETag`; no SWR; derive due state before calculating nonnegative TTL |
| Versioned economies, product search, Candidate Market JSON | `public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable` | Weak semantic `ETag` over canonical uncompressed bytes, `Vary: Accept-Encoding` |
| Status-bound CSV | Same immutable policy above | Weak semantic CSV hash validator and `Vary: Accept-Encoding` |
| Matching `HEAD` | Same status/cache/entity headers as `GET`, no body | |
| Conditional `304` | Same cache policy and validator as its successful representation | |
| `/healthz` | `no-store` | |
| Error responses | `no-store` | Never cache `400/404/409/410/429/500/503` |

`deadlineSeconds` is the whole nonnegative seconds until the next deterministic
7-day refresh or 14-day check transition. If the transition is due, derive the
new effective status first and then compute the next deadline. The current
manifest has no `stale-while-revalidate` or `stale-if-error`: either could serve
a freshness claim beyond the exact state deadline. The embedded/cached source
snapshot, not stale HTTP content, supplies outage fallback.

The long immutable policy is safe because the URL/key includes every value
that can change bytes. A cached old analysis remains an exact historical result;
the current manifest points new interactions to the new build.

### Export preflight

Immediately before download, the client explicitly revalidates
`/api/v1/analyses/current` (`cache: "reload"` or equivalent), updates any
warning, and then requests CSV with the compatible
`productSearchBuildId`/`freshnessStatusId`. A passive `fetch` that may reuse the
browser's still-fresh 60-second entry does not meet this contract.

The origin's background pointer poll runs every 55-60 seconds (60 seconds minus
uniform 0-5-second jitter) and atomically replaces the status micro-cache only
after snapshot validation. The
preflight can therefore be at most one poll interval behind the durable pointer,
while ordinary shared-cache clients can observe a pointer change up to five
minutes later. Neither can cross a deterministic status deadline because TTL is
clipped and the origin derives effective state from the cached snapshot.

## 7. Object-storage failure

No public request synchronously depends on object storage:

1. A background poller reads the mutable status pointer and named immutable
   snapshot every 55-60 seconds, so durable-pointer observation lag is never
   more than 60 seconds.
2. The current-manifest route reads the last validated in-memory snapshot and
   derives deadline state using explicit UTC `asOf`.
3. At process start, the deployment manifest's embedded last-known snapshot
   provides immediate fallback while the first poll runs.
4. A failed poll leaves the last snapshot in place, increments a failure metric,
   and allows it to age into `CHECK_OVERDUE` or `REFRESH_DELAYED`.
5. Artifact hydration happens before readiness, never during an analysis
   request.

Readiness remains healthy while a complete accepted artifact and compatible
embedded status snapshot can serve. An unreadable/incompatible artifact is
`503`; a failed refresh or pointer poll alone is degraded freshness, not
analysis unavailability.

## 8. Release lifecycle

| Stage | Target |
|---|---:|
| One source-monitor check | <= 15 minutes |
| Detect release to publish `UPDATE_IN_PROGRESS` | <= 15 minutes after a successful check |
| Normal download, build, validate, benchmark, upload, promote | <= 24 hours after detection |
| Missed normal target | Warn at 24 hours |
| Unpromoted release | Page/escalate at 48 hours |
| Absolute outcome | Promote or publish `REFRESH_DELAYED` by 7 days |
| Local-volume restart to readiness | <= 90 seconds |
| Cold hydration to readiness | <= 15 minutes |
| Logical manifest activation | Atomic; no mixed-pair state |
| Single-Machine deploy interruption | <= 2 minutes |
| Rollback to last accepted pairing | <= 15 minutes |

Refresh work never mutates current files or removes the current pairing before
the incoming artifact/catalog passes all gates. A failed refresh keeps the old
valid analysis available and publishes the failure state immediately; it does
not wait 48 hours to surface a known failure.

Cold hydration includes a full hard-cap artifact download and checksum. The
15-minute target is a measured gate, not an assumption about provider
throughput. Rollback normally uses the resident previous artifact but must also
pass when reconstruction from immutable object storage is necessary.

## 9. Artifact, volume, and image gates

| Resource | Gate |
|---|---:|
| Current DuckDB artifact target | <= 8 GiB |
| Architecture-review threshold | > 10 GiB; promotion blocked |
| DuckDB spill cap | 4 GiB |
| Initial Fly Volume | 50 GiB |
| Free volume at peak promotion footprint and after activation | >= 25% |
| Warn free volume | < 30% |
| Standalone container image | <= 500 MiB compressed |
| Product-search catalog resident bytes | <= 32 MiB |

The volume must hold current, previous, and incoming `.partial` artifacts plus
the 4-GiB spill cap while retaining 25% free:

```text
required_volume =
  (3 * artifact_hard_cap + spill_cap) / (1 - free_fraction)
  = (3 * 10 GiB + 4 GiB) / 0.75
  = 45.34 GiB
```

Round up to 50 GiB so the normal 34-GiB peak footprint retains 32% free and does
not trigger the less-than-30% warning. Before every promotion, recompute the
rule with actual manifest sizes and current free bytes; resize before activation
or refuse promotion. The container contains application code only. It does not
package BACI, Parquet, DuckDB artifacts, or refresh staging data, and the Node
process never loads a full artifact into the JavaScript heap.

An artifact above 8 GiB raises a promotion warning and requires an explicit
size/cost review, but may promote through 10 GiB if every other gate and the
volume rule pass. Above 10 GiB always blocks pending a new decision.

The 32-MiB product-search catalog is the immutable base index and is separate
from the 16-MiB search-response LRU. Both still count toward cgroup/RSS gates.

## 10. Availability and recovery

Availability has two monthly SLIs, and both must meet the target:

1. **Request SLI:** proportion of eligible public `GET`/`HEAD` requests that
   return `2xx`/`304` without timeout. Expected client/input outcomes (`400`,
   `404`, `409`, `410`) are excluded from the denominator; `500`/`503` fail.
2. **Probe SLI:** proportion of one-minute external probe intervals in which
   current-manifest plus one pinned smoke analysis succeed.

Synthetic requests are not mixed into the request SLI, so they cannot dominate a
low-traffic month. Planned deploy interruption counts in the probe SLI and in
any affected real requests.

| Property | Target |
|---|---:|
| Monthly request SLI and monthly probe SLI | Each >= 99.5% |
| Maximum recovery time (RTO) | <= 30 minutes |
| Accepted-artifact recovery point (RPO) | 0 |

`RPO = 0` applies to promoted immutable artifacts/catalogs/status snapshots in
private object storage, not ephemeral logs or cache entries. A stale but exactly
identified accepted release remains available during refresh and counts as
available. An artifact failure covered by a browser/shared immutable cache does
not erase the origin incident from the SLI.

The single Machine is acceptable for this MVP. Add infrastructure by failure
mode:

- **CDN/shared edge cache:** required when origin targets pass but distant-user
  p75/p95 or immutable-response traffic repeatedly misses targets.
- **Vertical Machine scaling:** first remedy for maximum-row latency, memory
  pressure, or CPU throttling at target load.
- **Second Machine plus independently hydrated volume:** required when
  availability misses 99.5% in two of three consecutive months, any recovery
  exceeds 30 minutes because of the single-host design, or the product adopts a
  >=99.9% availability target.

A replica is not a substitute for fixing an inefficient maximum-row query, and
a CDN is not a substitute for origin availability.

## 11. Cost

The low-traffic production deployment has these project budgets:

| Cost | Gate |
|---|---:|
| Recurring compute, 50-GiB serving volume, object storage, egress, and basic monitoring | <= USD 40/month |
| Forecast warning | > USD 40/month |
| Architecture review before enabling configuration | > USD 50/month |
| One annual/refresh pipeline run | <= USD 10 incremental compute/egress |

Domain registration, developer labor, and taxes are reported separately, not
hidden inside the infrastructure figure. Recheck live provider prices before
initial deployment and each annual refresh; the architecture document's price
figures are planning inputs, not a quote.

Do not silently add Redis, a paid CDN/WAF, or a second always-on Machine. If an
availability/security trigger requires spend above USD 50/month, record the
trade-off and update this decision before activation. An unexplained egress
increase is both a cost and bulk-scraping alert.

## 12. Observability and alerts

Every request metric is tagged by route family, status, cache state, active
analysis build, and release, never by raw free-text query. Logs retain the
existing normalized query key and exclude company/licensed evidence.

| Signal | Warn | Page/block |
|---|---|---|
| Route p95/p99 target | Miss for 5 minutes | Miss for 15 minutes; promotion blocks |
| `500`/`503` | >1% over 10 minutes | >5% over 10 minutes |
| Queue wait | p95 >1 s | Rejection at target load or depth 16 |
| Shared-CPU throttle | >5% CPU time for 15 minutes | Causes any target-load latency/error gate to fail |
| DuckDB spill | Any spill for sparse/median fixture or >10% of analyses over 15 minutes | Spill-cap/filesystem error |
| Cgroup memory | >75% for 15 minutes | >=85% or OOM |
| Process RSS | >75% for 15 minutes | >=85% |
| Volume free | <30% | <25% |
| Status pointer poll | 3 consecutive failures | Snapshot reaches a public overdue/delayed transition |
| Known refresh failure | Immediate warning and `REFRESH_DELAYED` | Immediate operator page |
| Refresh duration | >24 hours | >48 hours |
| Monthly error budget | 50% consumed | 80% consumed |
| Monthly cost forecast | >USD 40 | >USD 50 without approved decision |

Low request volume can make short-window percentiles noisy. Synthetic smoke and
benchmark probes continue even with no users, and alert evaluation records the
sample count rather than treating an empty window as success.

## 13. Promotion gates

No artifact/deployment pairing becomes current until:

1. source/schema/checksum/domain fixtures pass;
2. sparse, median, upper-quartile, and maximum-row benchmarks selected by the
   artifact manifest meet all origin p95/p99 gates;
3. at least five browser-lab trials each for median and maximum-row products
   meet LCP/CLS, scripted interaction, response-compression, and byte budgets;
4. the 10-minute target-load and 30-second burst phases, with the explicit
   80/20 hot-key/uncached analysis mix and four-key coordinated bursts, meet
   latency, capacity, memory, spill, and error gates after shared-CPU burst is
   depleted;
5. coalescing and above-capacity retry behavior are correct;
6. all route cache headers match the policy matrix, including deadline
   boundaries;
7. cold hydration and rollback each complete in 15 minutes;
8. actual artifact/volume/image/catalog sizes pass;
9. external smoke, metrics, and alerts identify the candidate build;
10. the recurring monthly cost forecast remains inside the accepted gate.

Failure leaves the deployed pairing manifest untouched. Performance,
availability, cache correctness, and cost are promotion blockers, not
post-launch cleanup.

## 14. Acceptance fixtures handed forward

The exact fixture constitution and artifact-key selection are resolved in
[decision-complete MVP acceptance fixtures](./2026-07-11-decision-complete-mvp-acceptance-fixtures.md).
The implementation pack includes:

1. **Browser budget:** production build, fixed mobile profile, five trials each
   for median and maximum-row products, LCP/CLS thresholds, scripted <=200-ms
   interaction, no >200-ms long task, compressed-result cap, and
   critical/total/JavaScript byte assertions.
2. **Pinned products:** manifest-selected sparse, median, upper-quartile, and
   maximum-row codes reused by pipeline and application benchmarks.
3. **Origin benchmark:** at least 100 timed samples after warm-up for every
   route/cache class, asserting p95, p99, payload, and hard deadlines.
4. **Load script:** exact sessions/rate/route mix, 80/20 analysis-key mix,
   duration/burst, four-key coordinated uncached bursts, maximum-row traffic,
   queue math, and zero target-load rejection.
5. **Coalescing:** ten identical requests produce one DuckDB execution and ten
   equivalent responses; waiter cancellation is isolated.
6. **Queue/timeout:** depth and wait limits, `503`/`Retry-After`, actual DuckDB
   interruption, and released resources.
7. **Memory/spill:** explicit settings, forced spill, cgroup/RSS limits, bounded
   disk use, and no artifact mutation.
8. **LRU:** byte weight, access-order eviction, partition caps, oversized-entry
   rejection, valid-empty caching, and no cached errors.
9. **HTTP cache matrix:** exact headers for every route and `HEAD`, plus no-store
   errors.
10. **Deadline boundaries:** `T-1s`, `T`, and `T+1s` around both refresh/check
    transitions; no stale HTTP state crosses the deadline.
11. **Export preflight:** browser-cache revalidation, 55-60-second poll
    interval, <=60-second origin pointer lag, compatible IDs, and warning update
    before CSV request.
12. **Object-store outage:** startup embedded snapshot, mid-run poll failures,
    current-manifest latency, and correct derived overdue/delayed states.
13. **Lifecycle drills:** local restart, empty-volume hydration, atomic cutover,
    failed refresh continuity, and rollback timing.
14. **Size/volume:** 8/10-GiB gates, 50-GiB provision from the 45.34-GiB formula,
    >=30% free at expected peak, 25% hard floor, image and
    catalog budgets, and promotion refusal.
15. **Availability/cost:** SLI classification, one-minute smoke, RTO/RPO drill,
    monthly error-budget arithmetic, and cost forecast gate.
16. **Observability:** force every warn/page condition in non-production and
    prove it opens and resolves with build/release identity.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Benchmark on a developer laptop | Does not model shared-vCPU quota, production volume, container, or complete artifact |
| Accept average-product latency only | Hides the public worst-product query that promotion must serve |
| More than two computations or more than two global DuckDB workers on the 2-vCPU trial | Oversubscribes the candidate container before measurement proves benefit |
| DuckDB default memory/spill limits | Consumes RAM/disk reserved for Node, cache, artifacts, and recovery headroom |
| Unbounded queue or abandoned timed-out query | Converts overload into memory/CPU exhaustion |
| Redis for MVP | Adds mutable network infrastructure without a replica-sharing need |
| One cache policy for all GETs | Either destroys immutable cache value or hides freshness deadlines |
| SWR/stale-if-error on current manifest | Can preserve an obsolete public freshness claim past its exact deadline |
| Synchronous object-store read in public request | Couples latency/availability to control-plane storage |
| Field-INP gate before enough traffic | Produces an unstable or nonexistent sample; lab interaction is the pre-launch proxy |
| CDN, second replica, or larger Machine before measuring failure mode | Spends money without knowing whether the problem is distance, compute, or availability |
| Relax SLO to preserve the trial Machine | Reverses the purpose of a promotion gate |

## Primary sources

All sources were accessed 2026-07-11.

- Google/web.dev, [Web Vitals](https://web.dev/articles/vitals),
  [LCP](https://web.dev/articles/lcp),
  [INP](https://web.dev/articles/inp), and
  [CLS](https://web.dev/articles/cls)
- Chrome for Developers,
  [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring/)
- GoogleChrome/lighthouse,
  [Throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)
- IETF, [RFC 9111: HTTP Caching](https://httpwg.org/specs/rfc9111.html)
- IETF, [RFC 5861: HTTP Cache-Control Extensions for Stale
  Content](https://datatracker.ietf.org/doc/html/rfc5861)
- IETF, [RFC 8246: Immutable HTTP
  Responses](https://datatracker.ietf.org/doc/html/rfc8246)
- Next.js, [Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
  and [Route
  Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- DuckDB, [Concurrency](https://duckdb.org/docs/current/connect/concurrency)
  and [Configuration
  overview](https://duckdb.org/docs/current/configuration/overview)
- Fly.io, [Machines overview](https://fly.io/docs/machines/overview/),
  [CPU performance](https://fly.io/docs/machines/cpu-performance/),
  [Volumes](https://fly.io/docs/volumes/overview/),
  [Health checks](https://fly.io/docs/reference/health-checks/),
  [Machine restart
  policy](https://fly.io/docs/machines/guides-examples/machine-restart-policy/),
  and [Resource pricing](https://fly.io/docs/about/pricing/)
- HSTracker, [Public-web data and deployment
  architecture](./2026-07-11-public-web-data-and-deployment-architecture.md)
- HSTracker, [Trade-data freshness and provisional-year
  presentation](./2026-07-11-trade-data-freshness-and-provisional-presentation.md)
- HSTracker, [Result export
  contract](./2026-07-11-result-export-contract.md)
