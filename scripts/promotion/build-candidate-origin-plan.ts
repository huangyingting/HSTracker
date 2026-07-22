import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import { parseOriginBenchmarkPlan } from "../../src/promotion/http-performance-runner";
import {
  REQUIRED_PRODUCT_ROLES,
  type OriginBenchmarkCapabilities,
  type PerformanceProductRole,
} from "../../src/promotion/performance-gates";

const CACHE_PARTITION_HEADER = "X-HS-Tracker-Cache-Partition";
const WARMUP = 5;
const TIMED = 100;
const SAMPLES = WARMUP + TIMED;

type RequestCase = {
  method: "GET";
  path: string;
  headers?: Record<string, string>;
};

type Sample = {
  semanticKey: string;
  request: RequestCase;
};

type Benchmark = {
  operation: string;
  productRole?: PerformanceProductRole;
  request: RequestCase;
  sampleRequests?: Sample[];
};

type CandidateOriginConfig = {
  origin: string;
  buildId: string;
  machineId: string;
  machineClass: string;
  region: string;
  marketByRole: ReadonlyMap<PerformanceProductRole, string>;
  recentTradeMomentumReporter: string | null;
};

type AnnualBenchmark = {
  role: PerformanceProductRole;
  productCode: string;
  exporterCode: string;
};

type TradeExplorerBenchmark = {
  role: PerformanceProductRole;
  shape: "finalized-trend-v1";
  measures: readonly ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"];
  exportEconomyCode: string;
  importEconomyCode: string;
  hsProductCode: string;
};

type CandidateManifest = {
  baciRelease: string;
  analysisBuildId: string;
  productSearchBuildId: string;
  artifactSha256: string;
  freshnessStatusId: string;
  capabilities: OriginBenchmarkCapabilities;
  annualBenchmarks: ReadonlyMap<PerformanceProductRole, AnnualBenchmark>;
  tradeExplorerBenchmarks: ReadonlyMap<
    PerformanceProductRole,
    TradeExplorerBenchmark
  >;
};

function get(path: string, headers?: Record<string, string>): RequestCase {
  return headers ? { method: "GET", path, headers } : { method: "GET", path };
}

function route(pathname: string, parameters: Record<string, string>): string {
  return `${pathname}?${new URLSearchParams(parameters).toString()}`;
}

function partitionSamples(
  operation: string,
  role: PerformanceProductRole,
  path: string,
): Sample[] {
  return Array.from({ length: SAMPLES }, (_unused, index) => {
    const semanticKey = `${operation}:${role}:${index}`;
    return {
      semanticKey,
      request: get(path, { [CACHE_PARTITION_HEADER]: semanticKey }),
    };
  });
}

function searchSamples(
  operation: string,
  role: PerformanceProductRole,
  build: (term: string) => string,
): Sample[] {
  return Array.from({ length: SAMPLES }, (_unused, index) => {
    const semanticKey = `${operation}:${role}:${index}`;
    return {
      semanticKey,
      request: get(build(semanticKey)),
    };
  });
}

function buildPlan(
  config: CandidateOriginConfig,
  manifest: CandidateManifest,
): unknown {
  assertConfigurationMatchesManifest(config, manifest);
  const requests: Benchmark[] = [
    { operation: "html-shell", request: get("/") },
    { operation: "current-manifest", request: get("/api/v1/analyses/current") },
    { operation: "health", request: get("/healthz") },
  ];

  for (const role of REQUIRED_PRODUCT_ROLES) {
    const annual = requiredRole(manifest.annualBenchmarks, role, "annual");
    const explorer = requiredRole(
      manifest.tradeExplorerBenchmarks,
      role,
      "Trade Explorer",
    );
    const market = requiredRole(config.marketByRole, role, "market");
    const analysisRoot = `/api/v1/analyses/${manifest.analysisBuildId}`;
    const candidate = route(`${analysisRoot}/candidate-markets`, {
      exporter: annual.exporterCode,
      product: annual.productCode,
    });
    const marketAnalysis = route(`${analysisRoot}/market-analysis`, {
      exporter: annual.exporterCode,
      product: annual.productCode,
      market,
    });
    const candidateCsv = route(`${analysisRoot}/candidate-markets.csv`, {
      exporter: annual.exporterCode,
      product: annual.productCode,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshnessStatusId,
      schema: "candidate-markets-csv-v1",
    });
    const tradeTrend = route(`${analysisRoot}/trade-trends`, {
      importer: market,
      product: annual.productCode,
    });
    const tradeTrendCsv = route(`${analysisRoot}/trade-trends.csv`, {
      importer: market,
      product: annual.productCode,
      productSearchBuildId: manifest.productSearchBuildId,
      freshnessStatusId: manifest.freshnessStatusId,
      schema: "trade-trends-csv-v1",
    });
    const supplierCompetition = route(
      `${analysisRoot}/supplier-competitions`,
      {
        importer: market,
        product: annual.productCode,
      },
    );
    const supplierCompetitionCsv = route(
      `${analysisRoot}/supplier-competitions.csv`,
      {
        importer: market,
        product: annual.productCode,
        productSearchBuildId: manifest.productSearchBuildId,
        freshnessStatusId: manifest.freshnessStatusId,
        schema: "supplier-competitions-csv-v1",
      },
    );
    const tradeExplorer = route(`${analysisRoot}/trade-explorer`, {
      shape: explorer.shape,
      measures: explorer.measures.join(","),
      exportEconomy: explorer.exportEconomyCode,
      importEconomy: explorer.importEconomyCode,
      hsProduct: explorer.hsProductCode,
    });
    const tradeExplorerCsv = route(`${analysisRoot}/trade-explorer.csv`, {
      shape: explorer.shape,
      measures: explorer.measures.join(","),
      exportEconomy: explorer.exportEconomyCode,
      importEconomy: explorer.importEconomyCode,
      hsProduct: explorer.hsProductCode,
      freshnessStatusId: manifest.freshnessStatusId,
      schema: "trade-explorers-csv-v1",
    });
    const economyPath = (term: string) =>
      route(`${analysisRoot}/economies`, { q: term });
    const productPath = (term: string) =>
      route(
        `/api/v1/product-catalogs/${manifest.productSearchBuildId}/products`,
        { q: term, locale: "en", limit: "20" },
      );

    requests.push(
      {
        operation: "economy-search-uncached",
        productRole: role,
        request: get(economyPath(`economy-base-${role}`)),
        sampleRequests: searchSamples(
          "economy-search-uncached",
          role,
          economyPath,
        ),
      },
      {
        operation: "economy-search-process-hit",
        productRole: role,
        request: get(economyPath(`economy-hit-${role}`)),
      },
      {
        operation: "product-search-uncached",
        productRole: role,
        request: get(productPath(`product-base-${role}`)),
        sampleRequests: searchSamples(
          "product-search-uncached",
          role,
          productPath,
        ),
      },
      {
        operation: "product-search-process-hit",
        productRole: role,
        request: get(productPath(`product-hit-${role}`)),
      },
      partitionedBenchmark("candidate-analysis-uncached", role, candidate),
      {
        operation: "candidate-analysis-process-hit",
        productRole: role,
        request: get(candidate),
      },
      partitionedBenchmark(
        "market-analysis-uncached",
        role,
        marketAnalysis,
      ),
      {
        operation: "market-analysis-process-hit",
        productRole: role,
        request: get(marketAnalysis),
      },
      partitionedBenchmark("csv-uncached", role, candidateCsv),
      {
        operation: "csv-analysis-hit",
        productRole: role,
        request: get(candidateCsv),
      },
      partitionedBenchmark(
        "trade-trend-analysis-uncached",
        role,
        tradeTrend,
      ),
      {
        operation: "trade-trend-analysis-process-hit",
        productRole: role,
        request: get(tradeTrend),
      },
      partitionedBenchmark(
        "trade-trend-csv-uncached",
        role,
        tradeTrendCsv,
      ),
      {
        operation: "trade-trend-csv-analysis-hit",
        productRole: role,
        request: get(tradeTrendCsv),
      },
      partitionedBenchmark(
        "supplier-competition-analysis-uncached",
        role,
        supplierCompetition,
      ),
      {
        operation: "supplier-competition-analysis-process-hit",
        productRole: role,
        request: get(supplierCompetition),
      },
      partitionedBenchmark(
        "supplier-competition-csv-uncached",
        role,
        supplierCompetitionCsv,
      ),
      {
        operation: "supplier-competition-csv-analysis-hit",
        productRole: role,
        request: get(supplierCompetitionCsv),
      },
    );

    if (manifest.capabilities.recentTradeMomentum) {
      const recentTradeMomentum = route(
        `${analysisRoot}/recent-trade-momentum`,
        {
          reporter: config.recentTradeMomentumReporter!,
          product: annual.productCode,
        },
      );
      requests.push(
        partitionedBenchmark(
          "recent-trade-momentum-uncached",
          role,
          recentTradeMomentum,
        ),
      );
    }
    if (manifest.capabilities.opportunityDiscovery) {
      const opportunities = route(`${analysisRoot}/opportunities`, {
        exporter: annual.exporterCode,
        limit: "50",
      });
      requests.push(
        partitionedBenchmark(
          "opportunity-feed-uncached",
          role,
          opportunities,
        ),
      );
    }

    requests.push(
      partitionedBenchmark(
        "trade-explorer-analysis-uncached",
        role,
        tradeExplorer,
      ),
      {
        operation: "trade-explorer-analysis-process-hit",
        productRole: role,
        request: get(tradeExplorer),
      },
      partitionedBenchmark(
        "trade-explorer-csv-uncached",
        role,
        tradeExplorerCsv,
      ),
      {
        operation: "trade-explorer-csv-analysis-hit",
        productRole: role,
        request: get(tradeExplorerCsv),
      },
    );
  }

  return {
    schemaVersion: "origin-benchmark-plan-v2",
    measurementClass: "candidate",
    identity: {
      fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
      buildId: config.buildId,
      baciRelease: manifest.baciRelease,
      analysisBuildId: manifest.analysisBuildId,
      productSearchBuildId: manifest.productSearchBuildId,
      artifactSha256: manifest.artifactSha256,
      machineId: config.machineId,
      machineClass: config.machineClass,
      region: config.region,
    },
    capabilities: manifest.capabilities,
    origin: config.origin,
    healthCheck: { method: "GET", path: "/healthz" },
    warmupSamples: WARMUP,
    timedSamples: TIMED,
    requests,
  };
}

function partitionedBenchmark(
  operation: string,
  role: PerformanceProductRole,
  path: string,
): Benchmark {
  return {
    operation,
    productRole: role,
    request: get(path),
    sampleRequests: partitionSamples(operation, role, path),
  };
}

function assertConfigurationMatchesManifest(
  config: CandidateOriginConfig,
  manifest: CandidateManifest,
): void {
  if (
    manifest.capabilities.recentTradeMomentum !==
    (config.recentTradeMomentumReporter !== null)
  ) {
    throw new Error(
      "recentTradeMomentumReporter must be present exactly when the current manifest declares Recent Trade Momentum.",
    );
  }
}

function requiredRole<T>(
  values: ReadonlyMap<PerformanceProductRole, T>,
  role: PerformanceProductRole,
  label: string,
): T {
  const value = values.get(role);
  if (value === undefined) {
    throw new Error(`Missing ${label} value for ${role}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      manifest: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const configPath = requiredOption(values.config, "--config");
  const manifestPath = requiredOption(values.manifest, "--manifest");
  const out = resolve(
    values.out ?? "reports/promotion/candidate/origin-plan.json",
  );
  const [configValue, manifestValue] = await Promise.all([
    readJson(configPath),
    readJson(manifestPath),
  ]);
  const plan = buildPlan(
    parseCandidateOriginConfig(configValue),
    parseCandidateManifest(manifestValue),
  );
  parseOriginBenchmarkPlan(plan);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`wrote ${out}\n`);
}

function parseCandidateOriginConfig(value: unknown): CandidateOriginConfig {
  const config = record(value, "candidate origin config");
  if (config.schemaVersion !== "candidate-origin-plan-config-v1") {
    throw new Error(
      "candidate origin config schemaVersion must be candidate-origin-plan-config-v1.",
    );
  }
  const deployment = record(config.deployment, "candidate deployment");
  const marketByRoleValue = record(
    config.marketByRole,
    "candidate marketByRole",
  );
  const marketByRole = new Map<PerformanceProductRole, string>();
  for (const role of REQUIRED_PRODUCT_ROLES) {
    marketByRole.set(
      role,
      economyCode(marketByRoleValue[role], `candidate marketByRole.${role}`),
    );
  }
  if (Object.keys(marketByRoleValue).length !== REQUIRED_PRODUCT_ROLES.length) {
    throw new Error(
      "candidate marketByRole must contain exactly the four representative roles.",
    );
  }
  const reporter = config.recentTradeMomentumReporter;
  if (
    reporter !== null &&
    (typeof reporter !== "string" || !/^[A-Z]{2}$/u.test(reporter))
  ) {
    throw new Error(
      "candidate recentTradeMomentumReporter must be null or an uppercase ISO alpha-2 code.",
    );
  }
  const region = nonemptyString(deployment.region, "candidate region");
  if (!/^[a-z]{3}$/u.test(region)) {
    throw new Error("candidate region must be a three-letter provider region.");
  }
  return {
    origin: httpsOrigin(config.origin),
    buildId: nonemptyString(deployment.buildId, "candidate build ID"),
    machineId: nonemptyString(deployment.machineId, "candidate Machine ID"),
    machineClass: nonemptyString(
      deployment.machineClass,
      "candidate Machine class",
    ),
    region,
    marketByRole,
    recentTradeMomentumReporter: reporter,
  };
}

function parseCandidateManifest(value: unknown): CandidateManifest {
  const manifest = record(value, "current manifest");
  if (manifest.schemaVersion !== "current-analysis-manifest-v1") {
    throw new Error(
      "current manifest schemaVersion must be current-analysis-manifest-v1.",
    );
  }
  const source = record(manifest.source, "current manifest source");
  const artifact = record(source.artifact, "current manifest source artifact");
  const freshness = record(manifest.freshness, "current manifest freshness");
  const recommendation = record(
    manifest.recommendation,
    "current manifest recommendation",
  );
  return {
    baciRelease: baciRelease(source.baciRelease),
    analysisBuildId: nonemptyString(
      manifest.analysisBuildId,
      "current manifest analysis build ID",
    ),
    productSearchBuildId: nonemptyString(
      manifest.productSearchBuildId,
      "current manifest product-search build ID",
    ),
    artifactSha256: sha256(
      artifact.sha256,
      "current manifest artifact SHA-256",
    ),
    freshnessStatusId: nonemptyString(
      freshness.freshnessStatusId,
      "current manifest freshness status ID",
    ),
    capabilities: {
      recentTradeMomentum: optionalRecommendation(
        recommendation.recentTradeMomentum,
        "Recent Trade Momentum",
      ),
      opportunityDiscovery: optionalRecommendation(
        recommendation.opportunityDiscovery,
        "Opportunity Discovery",
      ),
    },
    annualBenchmarks: parseAnnualBenchmarks(manifest.benchmarkQueries),
    tradeExplorerBenchmarks: parseTradeExplorerBenchmarks(
      manifest.tradeExplorerBenchmarkQueries,
    ),
  };
}

function parseAnnualBenchmarks(
  value: unknown,
): ReadonlyMap<PerformanceProductRole, AnnualBenchmark> {
  const entries = representativeEntries(value, "annual benchmark");
  const result = new Map<PerformanceProductRole, AnnualBenchmark>();
  for (const [index, entry] of entries.entries()) {
    const role = productRole(entry.role, `annual benchmark ${index + 1} role`);
    if (result.has(role)) {
      throw new Error(`Duplicate annual benchmark role ${role}.`);
    }
    result.set(role, {
      role,
      productCode: productCode(
        entry.productCode,
        `annual benchmark ${index + 1} product code`,
      ),
      exporterCode: economyCode(
        entry.exporterCode,
        `annual benchmark ${index + 1} exporter code`,
      ),
    });
  }
  assertAllRoles(result, "annual benchmark");
  return result;
}

function parseTradeExplorerBenchmarks(
  value: unknown,
): ReadonlyMap<PerformanceProductRole, TradeExplorerBenchmark> {
  const entries = representativeEntries(value, "Trade Explorer benchmark");
  const result = new Map<PerformanceProductRole, TradeExplorerBenchmark>();
  for (const [index, entry] of entries.entries()) {
    const label = `Trade Explorer benchmark ${index + 1}`;
    const role = productRole(entry.role, `${label} role`);
    if (
      result.has(role) ||
      entry.shape !== "finalized-trend-v1" ||
      !Array.isArray(entry.measures) ||
      entry.measures.length !== 2 ||
      entry.measures[0] !== "TRADE_VALUE_USD" ||
      entry.measures[1] !== "RECORDED_FLOW_COUNT"
    ) {
      throw new Error(`${label} is malformed or duplicated.`);
    }
    result.set(role, {
      role,
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode: economyCode(
        entry.exportEconomyCode,
        `${label} export economy code`,
      ),
      importEconomyCode: economyCode(
        entry.importEconomyCode,
        `${label} import economy code`,
      ),
      hsProductCode: productCode(
        entry.hsProductCode,
        `${label} HS product code`,
      ),
    });
  }
  assertAllRoles(result, "Trade Explorer benchmark");
  return result;
}

function representativeEntries(
  value: unknown,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== REQUIRED_PRODUCT_ROLES.length) {
    throw new Error(`${label}s must contain exactly four representative roles.`);
  }
  return value.map((entry, index) =>
    record(entry, `${label} ${index + 1}`),
  );
}

function assertAllRoles(
  values: ReadonlyMap<PerformanceProductRole, unknown>,
  label: string,
): void {
  for (const role of REQUIRED_PRODUCT_ROLES) {
    if (!values.has(role)) {
      throw new Error(`Missing ${label} role ${role}.`);
    }
  }
}

function productRole(
  value: unknown,
  label: string,
): PerformanceProductRole {
  if (
    typeof value === "string" &&
    (REQUIRED_PRODUCT_ROLES as readonly string[]).includes(value)
  ) {
    return value as PerformanceProductRole;
  }
  throw new Error(`${label} is not a supported representative role.`);
}

function optionalRecommendation(value: unknown, label: string): boolean {
  if (value === null) {
    return false;
  }
  record(value, `current manifest ${label} recommendation`);
  return true;
}

function httpsOrigin(value: unknown): string {
  const raw = nonemptyString(value, "candidate origin");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("candidate origin must be an absolute URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "candidate origin must be a credential-free HTTPS origin without a path, query, or fragment.",
    );
  }
  return parsed.origin;
}

function baciRelease(value: unknown): string {
  if (typeof value !== "string" || !/^V\d{6}$/u.test(value)) {
    throw new Error("current manifest BACI Release must use VYYYYMM.");
  }
  return value;
}

function economyCode(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{1,3}$/u.test(value)) {
    throw new Error(`${label} must be a numeric economy code.`);
  }
  return value;
}

function productCode(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{6}$/u.test(value)) {
    throw new Error(`${label} must be a six-digit HS product code.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredOption(value: string | undefined, option: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${option} is required.`);
  }
  return resolve(value);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read JSON from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
