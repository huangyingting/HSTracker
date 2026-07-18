import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

// Builds the full candidate-class origin-benchmark plan for issue #30 against
// the local HTTPS-fronted deployment (ADR-0004). Emits every required
// operation/product-role benchmark with genuine, never-reused uncached sample
// requests so runOriginBenchmark measures real misses (unique cache partitions
// or unique search terms) and real process-cache hits. It fabricates no
// measurements: it only declares the requests the runner will actually issue.

const CACHE_PARTITION_HEADER = "X-HS-Tracker-Cache-Partition";
const WARMUP = 5;
const TIMED = 100;
const SAMPLES = WARMUP + TIMED;

const A = "acceptance-fixtures-v1";
const PSB = "acceptance-product-search-v3";
const FS =
  "freshness%3Asource-status%3Aacceptance-fixtures-v1%3ALATEST_KNOWN%3A2026-03-01T00%253A00%253A00Z%3A675521e5974a24440fe9e87ba9af36f3cd41d5631d3e391692435c23dfc44e07";

const IDENTITY = {
  fixtureManifestSha256:
    "4aa07db3e71132e85849c79b7098da76b7d93033130f64ada84b8f6cf9135ab0",
  buildId: "issue-30-candidate",
  baciRelease: "V202601",
  analysisBuildId: A,
  productSearchBuildId: PSB,
  artifactSha256:
    "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
  machineId: "local",
  machineClass: "local",
  region: "loc",
} as const;

type RequestCase = {
  method: "GET";
  path: string;
  headers?: Record<string, string>;
};
type Sample = { semanticKey: string; request: RequestCase };
type Benchmark = {
  operation: string;
  productRole?: string;
  request: RequestCase;
  sampleRequests?: Sample[];
};

const ROLES = ["sparse", "median", "upper-quartile", "maximum-row"] as const;

const CANDIDATE = `/api/v1/analyses/${A}/candidate-markets?exporter=156&product=010121`;
const CSV = `/api/v1/analyses/${A}/candidate-markets.csv?exporter=156&product=010121&productSearchBuildId=${PSB}&freshnessStatusId=${FS}&schema=candidate-markets-csv-v1`;
const TREND = `/api/v1/analyses/${A}/trade-trends?importer=528&product=010121`;
const TREND_CSV = `/api/v1/analyses/${A}/trade-trends.csv?importer=528&product=010121&productSearchBuildId=${PSB}&freshnessStatusId=${FS}&schema=trade-trends-csv-v1`;
const SUPPLIER = `/api/v1/analyses/${A}/supplier-competitions?importer=124&product=010121`;
const SUPPLIER_CSV = `/api/v1/analyses/${A}/supplier-competitions.csv?importer=124&product=010121&productSearchBuildId=${PSB}&freshnessStatusId=${FS}&schema=supplier-competitions-csv-v1`;
const MOMENTUM = `/api/v1/analyses/${A}/recent-trade-momentum?reporter=NL&product=010121`;
const OPPORTUNITY = `/api/v1/analyses/${A}/opportunities?exporter=156`;
const EXPLORER = `/api/v1/analyses/${A}/trade-explorer?shape=finalized-trend-v1&measures=TRADE_VALUE_USD,RECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct=010121`;
const EXPLORER_CSV = `/api/v1/analyses/${A}/trade-explorer.csv?shape=finalized-trend-v1&measures=TRADE_VALUE_USD,RECORDED_FLOW_COUNT&exportEconomy=156&importEconomy=276&hsProduct=010121&freshnessStatusId=${FS}&schema=trade-explorers-csv-v1`;

function get(path: string, headers?: Record<string, string>): RequestCase {
  return headers ? { method: "GET", path, headers } : { method: "GET", path };
}

// Uncached op keyed by a unique per-sample cache partition (genuine miss each
// time because the process cache keys on the partition without changing the
// query sent to DuckDB).
function partitionSamples(op: string, role: string, path: string): Sample[] {
  return Array.from({ length: SAMPLES }, (_unused, index) => {
    const semanticKey = `${op}:${role}:${index}`;
    return {
      semanticKey,
      request: get(path, { [CACHE_PARTITION_HEADER]: semanticKey }),
    };
  });
}

// Uncached search op keyed by a unique search term per sample (genuine miss).
function searchSamples(
  op: string,
  role: string,
  build: (term: string) => string,
): Sample[] {
  return Array.from({ length: SAMPLES }, (_unused, index) => {
    const semanticKey = `${op}:${role}:${index}`;
    return { semanticKey, request: get(build(semanticKey)) };
  });
}

function economyPath(term: string): string {
  return `/api/v1/analyses/${A}/economies?q=${encodeURIComponent(term)}`;
}
function productPath(term: string): string {
  return `/api/v1/product-catalogs/${PSB}/products?q=${encodeURIComponent(term)}&locale=en&limit=20`;
}

function build(): unknown {
  const requests: Benchmark[] = [
    { operation: "html-shell", request: get("/") },
    { operation: "current-manifest", request: get("/api/v1/analyses/current") },
    { operation: "health", request: get("/healthz") },
  ];

  for (const role of ROLES) {
    // economy search
    requests.push({
      operation: "economy-search-uncached",
      productRole: role,
      request: get(economyPath(`economy-base-${role}`)),
      sampleRequests: searchSamples("economy-search-uncached", role, economyPath),
    });
    requests.push({
      operation: "economy-search-process-hit",
      productRole: role,
      request: get(economyPath(`economy-hit-${role}`)),
    });
    // product search
    requests.push({
      operation: "product-search-uncached",
      productRole: role,
      request: get(productPath(`product-base-${role}`)),
      sampleRequests: searchSamples("product-search-uncached", role, productPath),
    });
    requests.push({
      operation: "product-search-process-hit",
      productRole: role,
      request: get(productPath(`product-hit-${role}`)),
    });
    // candidate analysis
    requests.push({
      operation: "candidate-analysis-uncached",
      productRole: role,
      request: get(CANDIDATE),
      sampleRequests: partitionSamples("candidate-analysis-uncached", role, CANDIDATE),
    });
    requests.push({
      operation: "candidate-analysis-process-hit",
      productRole: role,
      request: get(CANDIDATE),
    });
    // candidate CSV
    requests.push({
      operation: "csv-uncached",
      productRole: role,
      request: get(CSV),
      sampleRequests: partitionSamples("csv-uncached", role, CSV),
    });
    requests.push({
      operation: "csv-analysis-hit",
      productRole: role,
      request: get(CSV),
    });
    // trade trends
    requests.push({
      operation: "trade-trend-analysis-uncached",
      productRole: role,
      request: get(TREND),
      sampleRequests: partitionSamples("trade-trend-analysis-uncached", role, TREND),
    });
    requests.push({
      operation: "trade-trend-analysis-process-hit",
      productRole: role,
      request: get(TREND),
    });
    requests.push({
      operation: "trade-trend-csv-uncached",
      productRole: role,
      request: get(TREND_CSV),
      sampleRequests: partitionSamples("trade-trend-csv-uncached", role, TREND_CSV),
    });
    requests.push({
      operation: "trade-trend-csv-analysis-hit",
      productRole: role,
      request: get(TREND_CSV),
    });
    // supplier competitions
    requests.push({
      operation: "supplier-competition-analysis-uncached",
      productRole: role,
      request: get(SUPPLIER),
      sampleRequests: partitionSamples("supplier-competition-analysis-uncached", role, SUPPLIER),
    });
    requests.push({
      operation: "supplier-competition-analysis-process-hit",
      productRole: role,
      request: get(SUPPLIER),
    });
    requests.push({
      operation: "supplier-competition-csv-uncached",
      productRole: role,
      request: get(SUPPLIER_CSV),
      sampleRequests: partitionSamples("supplier-competition-csv-uncached", role, SUPPLIER_CSV),
    });
    requests.push({
      operation: "supplier-competition-csv-analysis-hit",
      productRole: role,
      request: get(SUPPLIER_CSV),
    });
    // recent trade momentum (uncached only)
    requests.push({
      operation: "recent-trade-momentum-uncached",
      productRole: role,
      request: get(MOMENTUM),
      sampleRequests: partitionSamples("recent-trade-momentum-uncached", role, MOMENTUM),
    });
    // opportunity feed (uncached only)
    requests.push({
      operation: "opportunity-feed-uncached",
      productRole: role,
      request: get(OPPORTUNITY),
      sampleRequests: partitionSamples("opportunity-feed-uncached", role, OPPORTUNITY),
    });
    // trade explorer analysis
    requests.push({
      operation: "trade-explorer-analysis-uncached",
      productRole: role,
      request: get(EXPLORER),
      sampleRequests: partitionSamples("trade-explorer-analysis-uncached", role, EXPLORER),
    });
    requests.push({
      operation: "trade-explorer-analysis-process-hit",
      productRole: role,
      request: get(EXPLORER),
    });
    // trade explorer CSV
    requests.push({
      operation: "trade-explorer-csv-uncached",
      productRole: role,
      request: get(EXPLORER_CSV),
      sampleRequests: partitionSamples("trade-explorer-csv-uncached", role, EXPLORER_CSV),
    });
    requests.push({
      operation: "trade-explorer-csv-analysis-hit",
      productRole: role,
      request: get(EXPLORER_CSV),
    });
  }

  return {
    schemaVersion: "origin-benchmark-plan-v1",
    measurementClass: "candidate",
    identity: IDENTITY,
    origin: process.env.CANDIDATE_ORIGIN ?? "https://127.0.0.1:3443",
    healthCheck: { method: "GET", path: "/healthz" },
    warmupSamples: WARMUP,
    timedSamples: TIMED,
    requests,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const out = resolve(
    values.out ?? "reports/promotion/candidate/origin-plan.json",
  );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(build(), null, 2)}\n`);
  process.stdout.write(`wrote ${out}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
