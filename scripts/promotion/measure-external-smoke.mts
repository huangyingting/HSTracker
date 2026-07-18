import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  evaluateProbeSli,
  evaluateRequestSli,
  MONTHLY_SLI_TARGET_FRACTION,
  type ProbeInterval,
  type RequestOutcomeSample,
  type RouteObservationIdentity,
} from "../../src/operations/service-levels.ts";

// -- Real deployment identity (issue #30 candidate, build ee7313f) -----------
const ORIGIN = "http://127.0.0.1:3300";
const ANALYSIS_BUILD_ID = "analysis-build-v1-949d1ac27ade40d4";
const PRODUCT_SEARCH_BUILD_ID = "product-search-v1-aa1f4027019c194b";
const BACI_RELEASE = "V202601";
const FIXTURE_MANIFEST_SHA256 =
  "4aa07db3e71132e85849c79b7098da76b7d93033130f64ada84b8f6cf9135ab0";
const SMOKE_ANALYSIS_KEY =
  "candidate-market:analysis-build-v1-949d1ac27ade40d4:exporter=156;product=392690";

const CANDIDATE_MARKET_PATH = `/api/v1/analyses/${ANALYSIS_BUILD_ID}/candidate-markets?exporter=156&product=392690`;
const CURRENT_ANALYSIS_PATH = "/api/v1/analyses/current";
const PRODUCT_SEARCH_PATH = `/api/v1/product-catalogs/${PRODUCT_SEARCH_BUILD_ID}/products?q=coffee&locale=en&limit=10`;
const TRADE_EXPLORER_PATH = `/api/v1/analyses/${ANALYSIS_BUILD_ID}/trade-explorer?shape=finalized-trend-v1&measures=TRADE_VALUE_USD,RECORDED_FLOW_COUNT&exportEconomy=894&importEconomy=858&hsProduct=240120`;

function secondTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function minuteTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/:\d{2}\.\d{3}Z$/u, ":00Z");
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FetchOutcome = { timedOut: boolean; status: number | null };

async function publicGet(
  path: string,
  { probe = false, timeoutMs = 8000 }: { probe?: boolean; timeoutMs?: number } = {},
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Accept-Encoding": "gzip, br" };
  if (probe) headers["X-HS-Tracker-Probe"] = "external-v1";
  try {
    const response = await fetch(ORIGIN + path, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return { timedOut: false, status: response.status };
  } catch {
    return { timedOut: true, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];

  // ---------------------------------------------------------------------------
  // 1) external-smoke: real public GET requests to every public route family.
  // ---------------------------------------------------------------------------
  const smokeRoutes: { name: string; path: string }[] = [
    { name: "health", path: "/healthz" },
    { name: "ui", path: "/" },
    { name: "current-analysis", path: CURRENT_ANALYSIS_PATH },
    { name: "product-search", path: PRODUCT_SEARCH_PATH },
    { name: "candidate-market", path: CANDIDATE_MARKET_PATH },
    { name: "trade-explorer", path: TRADE_EXPLORER_PATH },
  ];
  const smokeResults: {
    name: string;
    path: string;
    status: number | null;
    timedOut: boolean;
    ok: boolean;
  }[] = [];
  for (const route of smokeRoutes) {
    const outcome = await publicGet(route.path);
    const ok =
      !outcome.timedOut &&
      outcome.status !== null &&
      outcome.status >= 200 &&
      outcome.status < 300;
    smokeResults.push({ ...route, ...outcome, ok });
    if (!ok) {
      failures.push(
        `external-smoke: ${route.name} returned ${
          outcome.timedOut ? "timeout" : String(outcome.status)
        }`,
      );
    }
  }
  const externalSmokeOk = smokeResults.every((r) => r.ok);

  // ---------------------------------------------------------------------------
  // 2) request-sli: real public (non-synthetic) traffic per route identity.
  //    current-analysis is must-revalidate (bypass); candidate-market is
  //    immutable, so after a warm-up every subsequent response is a cache hit.
  // ---------------------------------------------------------------------------
  const REQUESTS_PER_IDENTITY = 24;
  const requestSliGroups: {
    identity: RouteObservationIdentity;
    path: string;
    warm: boolean;
  }[] = [
    {
      identity: {
        routeFamily: "current-analysis",
        cacheState: "bypass",
        analysisBuildId: ANALYSIS_BUILD_ID,
        baciRelease: BACI_RELEASE,
      },
      path: CURRENT_ANALYSIS_PATH,
      warm: false,
    },
    {
      identity: {
        routeFamily: "candidate-market",
        cacheState: "hit",
        analysisBuildId: ANALYSIS_BUILD_ID,
        baciRelease: BACI_RELEASE,
      },
      path: CANDIDATE_MARKET_PATH,
      warm: true,
    },
  ];

  const requestSliReports: unknown[] = [];
  for (const group of requestSliGroups) {
    if (group.warm) await publicGet(group.path); // ensure cache is populated
    const samples: RequestOutcomeSample[] = [];
    for (let i = 0; i < REQUESTS_PER_IDENTITY; i += 1) {
      const outcome = await publicGet(group.path);
      samples.push({
        ...group.identity,
        method: "GET",
        synthetic: false,
        timedOut: outcome.timedOut,
        status: outcome.status,
      });
    }
    const result = evaluateRequestSli(group.identity, samples);
    requestSliReports.push(result);
    if (!result.measurable) {
      failures.push(
        `request-sli: ${group.identity.routeFamily}/${group.identity.cacheState} not measurable`,
      );
    } else if ((result.successFraction ?? 0) < MONTHLY_SLI_TARGET_FRACTION) {
      failures.push(
        `request-sli: ${group.identity.routeFamily}/${group.identity.cacheState} successFraction ${String(
          result.successFraction,
        )} < ${MONTHLY_SLI_TARGET_FRACTION}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3) probe-sli: identity-bound current-manifest + pinned-analysis probes over
  //    an aligned multi-minute window (one probe pair per UTC minute).
  // ---------------------------------------------------------------------------
  const PROBE_INTERVALS = 3;
  const probeIdentity = {
    analysisBuildId: ANALYSIS_BUILD_ID,
    baciRelease: BACI_RELEASE,
    fixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
    smokeAnalysisKey: SMOKE_ANALYSIS_KEY,
  };
  const now = Date.now();
  const windowStartMs = Math.ceil(now / 60_000) * 60_000;
  const windowEndMs = windowStartMs + PROBE_INTERVALS * 60_000;
  const probeWindow = {
    startedAt: minuteTimestamp(windowStartMs),
    endedAt: minuteTimestamp(windowEndMs),
  };
  process.stderr.write(
    `probe-sli window ${probeWindow.startedAt} .. ${probeWindow.endedAt} (${PROBE_INTERVALS} minutes)\n`,
  );

  const outcomeOf = (r: FetchOutcome) =>
    r.timedOut ? "timeout" : r.status === 200 || r.status === 304 ? "success" : "failure";

  const probeIntervals: ProbeInterval[] = [];
  for (let i = 0; i < PROBE_INTERVALS; i += 1) {
    const intervalStartMs = windowStartMs + i * 60_000;
    const waitMs = intervalStartMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    const manifest = await publicGet(CURRENT_ANALYSIS_PATH, { probe: true });
    const smoke = await publicGet(CANDIDATE_MARKET_PATH, { probe: true });
    probeIntervals.push({
      ...probeIdentity,
      intervalStartedAt: minuteTimestamp(intervalStartMs),
      manifestOutcome: outcomeOf(manifest) as ProbeInterval["manifestOutcome"],
      smokeAnalysisOutcome: outcomeOf(smoke) as ProbeInterval["smokeAnalysisOutcome"],
    });
    process.stderr.write(
      `  interval ${i} @ ${minuteTimestamp(intervalStartMs)}: manifest=${outcomeOf(
        manifest,
      )} smoke=${outcomeOf(smoke)}\n`,
    );
  }
  const probeResult = evaluateProbeSli(probeIdentity, probeIntervals, probeWindow);
  if (!probeResult.measurable) {
    failures.push("probe-sli: not measurable");
  } else if ((probeResult.successFraction ?? 0) < MONTHLY_SLI_TARGET_FRACTION) {
    failures.push(
      `probe-sli: successFraction ${String(probeResult.successFraction)} < ${MONTHLY_SLI_TARGET_FRACTION}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Assemble the retained smoke report.
  // ---------------------------------------------------------------------------
  const measuredAtMs = Date.now();
  const report = {
    schemaVersion: "external-smoke-report-v1",
    measurementClass: "candidate",
    origin: ORIGIN,
    identity: {
      analysisBuildId: ANALYSIS_BUILD_ID,
      productSearchBuildId: PRODUCT_SEARCH_BUILD_ID,
      baciRelease: BACI_RELEASE,
      fixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
    },
    window: probeWindow,
    measuredAt: secondTimestamp(measuredAtMs),
    externalSmoke: { ok: externalSmokeOk, routes: smokeResults },
    requestSli: {
      target: MONTHLY_SLI_TARGET_FRACTION,
      requestsPerIdentity: REQUESTS_PER_IDENTITY,
      groups: requestSliReports,
    },
    probeSli: {
      target: MONTHLY_SLI_TARGET_FRACTION,
      window: probeWindow,
      intervals: probeIntervals,
      result: probeResult,
    },
    failures,
  };
  const reportPath = "reports/promotion/candidate/evidence/external-smoke-report.json";
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  if (failures.length > 0) {
    process.stderr.write(`\nFAILURES:\n${failures.map((f) => "  - " + f).join("\n")}\n`);
    process.exit(1);
  }
  process.stderr.write("\nAll external-smoke/observability measurements passed.\n");
  process.stderr.write(`report: ${reportPath}\n`);
  // Emit sha256 of both retained logs for the checks.json builder.
  const sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  process.stdout.write(
    JSON.stringify({
      reportPath,
      reportSha256: sha(reportPath),
      testsPath: "reports/promotion/candidate/evidence/observability-alert-tests.json",
      testsSha256: sha("reports/promotion/candidate/evidence/observability-alert-tests.json"),
      window: probeWindow,
      measuredAt: secondTimestamp(measuredAtMs),
      requestSli: requestSliReports,
      probeSli: probeResult,
      smokeOk: externalSmokeOk,
    }) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exit(1);
});
