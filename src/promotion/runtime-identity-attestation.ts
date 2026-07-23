import { createHash } from "node:crypto";

import type {
  AnalysisArtifactBenchmarkQuery,
  TradeExplorerArtifactBenchmarkQuery,
} from "../evidence/analysis-artifact-manifest";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "./acceptance-fixture";
import {
  REQUIRED_PRODUCT_ROLES,
  type OriginBenchmarkCapabilities,
  type PerformanceMeasurementIdentity,
  type PerformanceProductRole,
} from "./performance-gates";

const PROBE_HEADERS = {
  Accept: "application/json",
  "Cache-Control": "no-cache",
  "X-HS-Tracker-Probe": "external-v1",
} as const;

export type RuntimeIdentityAttestation = {
  readonly schemaVersion: "runtime-identity-attestation-v1";
  readonly origin: string;
  readonly identity: PerformanceMeasurementIdentity;
  readonly capabilities: OriginBenchmarkCapabilities;
  readonly benchmarkQueries: readonly AnalysisArtifactBenchmarkQuery[];
  readonly tradeExplorerBenchmarkQueries: readonly TradeExplorerArtifactBenchmarkQuery[];
  readonly health: {
    readonly path: "/healthz";
    readonly bodySha256: string;
  };
  readonly currentManifest: {
    readonly path: "/api/v1/analyses/current";
    readonly etag: string;
    readonly bodySha256: string;
    readonly schemaVersion: "current-analysis-manifest-v1";
  };
};

export type RuntimeIdentityAttestor = (
  origin: string,
  expected: PerformanceMeasurementIdentity,
) => Promise<RuntimeIdentityAttestation>;

export class RuntimeIdentityAttestationError extends Error {
  readonly code = "RUNTIME_IDENTITY_ATTESTATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeIdentityAttestationError";
  }
}

export async function attestRuntimeIdentity(
  origin: string,
  expected: PerformanceMeasurementIdentity,
  fetchImplementation: typeof fetch = fetch,
): Promise<RuntimeIdentityAttestation> {
  if (
    expected.fixtureManifestSha256 !== ACCEPTANCE_FIXTURE_CONTENT_SHA256
  ) {
    throw new RuntimeIdentityAttestationError(
      "The measurement plan fixture digest does not match the canonical acceptance fixture.",
    );
  }

  const [health, currentManifest] = await Promise.all([
    fetchIdentityDocument(
      fetchImplementation,
      new URL("/healthz", origin),
      "health",
    ),
    fetchIdentityDocument(
      fetchImplementation,
      new URL("/api/v1/analyses/current", origin),
      "current manifest",
    ),
  ]);
  const healthBody = object(parseJson(health.body, "health"), "health");
  const manifestBody = object(
    parseJson(currentManifest.body, "current manifest"),
    "current manifest",
  );
  if (manifestBody.schemaVersion !== "current-analysis-manifest-v1") {
    throw new RuntimeIdentityAttestationError(
      "The candidate current manifest has an incompatible schema version.",
    );
  }
  const source = object(manifestBody.source, "current manifest source");
  const recommendation = object(
    manifestBody.recommendation,
    "current manifest recommendation",
  );
  const capabilities = {
    recentTradeMomentum: optionalRecommendationAvailable(
      recommendation.recentTradeMomentum,
      "Recent Trade Momentum",
    ),
    opportunityDiscovery: optionalRecommendationAvailable(
      recommendation.opportunityDiscovery,
      "Opportunity Discovery",
    ),
  };
  const benchmarkQueries = parseBenchmarkQueries(
    manifestBody.benchmarkQueries,
  );
  const tradeExplorerBenchmarkQueries = parseTradeExplorerBenchmarkQueries(
    manifestBody.tradeExplorerBenchmarkQueries,
  );
  const artifact = object(
    source.artifact,
    "current manifest source artifact",
  );
  const observed: PerformanceMeasurementIdentity = {
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    buildId: stringValue(healthBody.buildId, "health build ID"),
    baciRelease: stringValue(
      source.baciRelease,
      "current manifest BACI Release",
    ),
    analysisBuildId: stringValue(
      manifestBody.analysisBuildId,
      "current manifest analysis build ID",
    ),
    productSearchBuildId: stringValue(
      manifestBody.productSearchBuildId,
      "current manifest product-search build ID",
    ),
    artifactSha256: stringValue(
      artifact.sha256,
      "current manifest artifact SHA-256",
    ),
    machineId: requiredHeader(
      health.response,
      "x-hs-tracker-machine-id",
    ),
    machineClass: requiredHeader(
      health.response,
      "x-hs-tracker-machine-class",
    ),
    region: requiredHeader(health.response, "x-hs-tracker-region"),
  };

  for (const field of Object.keys(expected) as Array<
    keyof PerformanceMeasurementIdentity
  >) {
    if (observed[field] !== expected[field]) {
      throw new RuntimeIdentityAttestationError(
        `Candidate ${field} does not match the measurement plan.`,
      );
    }
  }
  const healthHeaderBuildId = requiredHeader(
    health.response,
    "x-hs-tracker-build-id",
  );
  if (healthHeaderBuildId !== observed.buildId) {
    throw new RuntimeIdentityAttestationError(
      "Candidate health build identity disagrees between its header and body.",
    );
  }

  return {
    schemaVersion: "runtime-identity-attestation-v1",
    origin,
    identity: observed,
    capabilities,
    benchmarkQueries,
    tradeExplorerBenchmarkQueries,
    health: {
      path: "/healthz",
      bodySha256: sha256(health.body),
    },
    currentManifest: {
      path: "/api/v1/analyses/current",
      etag: requiredHeader(currentManifest.response, "etag"),
      bodySha256: sha256(currentManifest.body),
      schemaVersion: "current-analysis-manifest-v1",
    },
  };
}

function optionalRecommendationAvailable(
  value: unknown,
  label: string,
): boolean {
  if (value === null) {
    return false;
  }
  object(value, `current manifest ${label} recommendation`);
  return true;
}

function parseBenchmarkQueries(
  value: unknown,
): AnalysisArtifactBenchmarkQuery[] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new RuntimeIdentityAttestationError(
      "Candidate benchmark queries must contain the four representative roles.",
    );
  }

  const roles = new Set<string>();
  const parsed = value.map((entry, index) => {
    const query = object(entry, `benchmark query ${index}`);
    const role = stringValue(query.role, `benchmark query ${index} role`);
    if (!isPerformanceProductRole(role)) {
      throw new RuntimeIdentityAttestationError(
        `Candidate benchmark query ${index} has an invalid role.`,
      );
    }
    const productCode = stringValue(
      query.productCode,
      `benchmark query ${index} product code`,
    );
    const exporterCode = stringValue(
      query.exporterCode,
      `benchmark query ${index} exporter code`,
    );
    const candidateCount = query.candidateCount;
    if (
      !/^\d{6}$/u.test(productCode) ||
      !/^\d{1,3}$/u.test(exporterCode) ||
      !Number.isInteger(candidateCount) ||
      (candidateCount as number) < 0 ||
      roles.has(role)
    ) {
      throw new RuntimeIdentityAttestationError(
        `Candidate benchmark query ${index} is malformed or duplicated.`,
      );
    }
    roles.add(role);
    return {
      role,
      productCode,
      exporterCode,
      candidateCount: candidateCount as number,
    };
  });
  return parsed;
}

function parseTradeExplorerBenchmarkQueries(
  value: unknown,
): TradeExplorerArtifactBenchmarkQuery[] {
  if (!Array.isArray(value) || (value.length !== 0 && value.length !== 4)) {
    throw new RuntimeIdentityAttestationError(
      "Candidate Trade Explorer benchmark queries must be empty or contain the four representative roles.",
    );
  }
  const roles = new Set<string>();
  return value.map((entry, index) => {
    const query = object(entry, `Trade Explorer benchmark query ${index}`);
    const role = stringValue(
      query.role,
      `Trade Explorer benchmark query ${index} role`,
    );
    const exportEconomyCode = stringValue(
      query.exportEconomyCode,
      `Trade Explorer benchmark query ${index} export economy code`,
    );
    const importEconomyCode = stringValue(
      query.importEconomyCode,
      `Trade Explorer benchmark query ${index} import economy code`,
    );
    const hsProductCode = stringValue(
      query.hsProductCode,
      `Trade Explorer benchmark query ${index} HS product code`,
    );
    const groupedRowCount = query.groupedRowCount;
    const measures = query.measures;
    if (
      !isPerformanceProductRole(role) ||
      roles.has(role) ||
      query.shape !== "finalized-trend-v1" ||
      !Array.isArray(measures) ||
      measures.length !== 2 ||
      measures[0] !== "TRADE_VALUE_USD" ||
      measures[1] !== "RECORDED_FLOW_COUNT" ||
      !/^\d{1,3}$/u.test(exportEconomyCode) ||
      !/^\d{1,3}$/u.test(importEconomyCode) ||
      !/^\d{6}$/u.test(hsProductCode) ||
      !Number.isInteger(groupedRowCount) ||
      (groupedRowCount as number) < 0
    ) {
      throw new RuntimeIdentityAttestationError(
        `Candidate Trade Explorer benchmark query ${index} is malformed or duplicated.`,
      );
    }

    roles.add(role);
    return {
      role,
      shape: "finalized-trend-v1",
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      exportEconomyCode,
      importEconomyCode,
      hsProductCode,
      groupedRowCount: groupedRowCount as number,
    };
  });
}

function isPerformanceProductRole(
  value: string,
): value is PerformanceProductRole {
  return (REQUIRED_PRODUCT_ROLES as readonly string[]).includes(value);
}

async function fetchIdentityDocument(
  fetchImplementation: typeof fetch,
  url: URL,
  label: string,
): Promise<{ response: Response; body: string }> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      headers: PROBE_HEADERS,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new RuntimeIdentityAttestationError(
      `Could not retrieve candidate ${label}${detail}.`,
    );
  }
  if (response.status !== 200) {
    throw new RuntimeIdentityAttestationError(
      `Candidate ${label} returned HTTP ${response.status}; expected 200.`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RuntimeIdentityAttestationError(
      `Candidate ${label} did not return JSON.`,
    );
  }
  return { response, body: await response.text() };
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new RuntimeIdentityAttestationError(
      `Candidate ${label} returned malformed JSON.`,
    );
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeIdentityAttestationError(
      `Candidate ${label} must be a JSON object.`,
    );
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeIdentityAttestationError(
      `Candidate ${label} must be a nonempty string.`,
    );
  }
  return value;
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name)?.trim();
  if (value === undefined || value.length === 0) {
    throw new RuntimeIdentityAttestationError(
      `Candidate response is missing the ${name} identity header.`,
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
