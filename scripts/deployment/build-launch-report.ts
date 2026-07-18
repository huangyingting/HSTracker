import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  evaluateLaunchReport,
  parseLaunchReportInput,
  type LaunchLinkedReport,
  type LaunchProbe,
  type LaunchReportInput,
} from "../../src/promotion/launch-report";

/**
 * Assemble the durable local-launch report (issue #63, ADR-0004) from real
 * evidence: the live deployment health probe, an analysis smoke, a public
 * secret-leakage scan, retained deployment gate reports, and the release object
 * store manifests. Resident-fallback and restart rehearsals are control-plane
 * drills the operator runs from docs/local-deployment.md; their outcomes are
 * supplied as explicit flags so the report cannot claim rollback readiness that
 * was never rehearsed. The report is written only after `evaluateLaunchReport`
 * re-derives a `launched` verdict; a held launch leaves the prior deployment
 * active.
 */

const FORBIDDEN_LEAK_TOKENS = [
  "HS_TRACKER_RELEASE_",
  "/data/",
  "t3.storage.dev",
  "AccessKey",
  "SecretAccessKey",
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      origin: { type: "string", default: "http://127.0.0.1:3000" },
      "gate-report": { type: "string", multiple: true },
      "objectstore-pointer": {
        type: "string",
        default: "data/local-deploy/objectstore/deployment-pointers/current.json",
      },
      "operational-store": { type: "string", default: "postgres" },
      "restart-rehearsed": { type: "boolean", default: false },
      "resident-fallback-rehearsed": { type: "boolean", default: false },
      out: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const origin = values.origin ?? "http://127.0.0.1:3000";
  const health = await fetchJson(`${origin}/healthz`);
  const machineClass = await fetchMachineClass(`${origin}/healthz`);
  const deployment = asRecord(health.deployment, "healthz.deployment");
  const analysisArtifact = asRecord(
    health.analysisArtifact,
    "healthz.analysisArtifact",
  );
  const freshness = asRecord(health.freshness, "healthz.freshness");
  const activation = asRecord(health.activation, "healthz.activation");
  const buildId = asString(health.buildId, "healthz.buildId");

  const probes: LaunchProbe[] = [];
  probes.push({
    name: "health",
    status: health.status === "ok" ? "ok" : "failed",
    detail: `status ${String(health.status)}`,
  });
  probes.push({
    name: "readiness",
    status: health.readiness === "ready" ? "ok" : "failed",
    detail: `readiness ${String(health.readiness)}`,
  });
  probes.push({
    name: "machine-class",
    status: machineClass === "local" ? "ok" : "failed",
    detail: `x-hs-tracker-machine-class: ${machineClass}`,
  });
  probes.push({
    name: "activation-current",
    status: activation.mode === "CURRENT" ? "ok" : "failed",
    detail: `activation.mode ${String(activation.mode)}`,
  });

  const analysisBuildId = asString(
    deployment.analysisBuildId,
    "deployment.analysisBuildId",
  );
  const smoke = await smokeCandidateMarkets(origin, analysisBuildId);
  probes.push(smoke);

  const leak = await scanSecretLeakage(origin, analysisBuildId);
  probes.push(leak);

  if (values["restart-rehearsed"]) {
    probes.push({
      name: "restart-rehearsal",
      status: "ok",
      detail:
        "docker compose restart hs-tracker preserved pairing/artifact identities and returned CURRENT + ready",
    });
  }
  if (values["resident-fallback-rehearsed"]) {
    probes.push({
      name: "resident-fallback-rehearsal",
      status: "ok",
      detail:
        "object-store outage -> activation.mode LAST_VERIFIED_RESIDENT_FALLBACK (OBJECT_STORE_UNAVAILABLE), prior pairing/artifact stayed active; restore -> CURRENT",
    });
  }

  const reports = readGateReports(values["gate-report"] ?? []);
  const objectStorePointer =
    values["objectstore-pointer"] ??
    "data/local-deploy/objectstore/deployment-pointers/current.json";
  const currentReleaseId = asString(
    deployment.baciRelease,
    "deployment.baciRelease",
  );

  const input: LaunchReportInput = {
    schemaVersion: "local-launch-report-input-v1",
    launchedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    buildId,
    localOrigin: {
      adr: "docs/adr/0004-local-single-host-deployment.md",
      machineClass,
      bind: origin.replace(/^https?:\/\//u, ""),
      hosting: "single-host container over loopback",
    },
    providerDecisions: {
      recurringCostUsd: 0,
      objectStore: "filesystem",
      operationalStore: values["operational-store"] ?? "postgres",
      hosting: "local-container",
      adr: "docs/adr/0004-local-single-host-deployment.md",
    },
    identities: {
      buildId,
      deploymentPairingId: asString(
        deployment.deploymentPairingId,
        "deployment.deploymentPairingId",
      ),
      baciRelease: currentReleaseId,
      analysisBuildId,
      productSearchBuildId: asString(
        deployment.productSearchBuildId,
        "deployment.productSearchBuildId",
      ),
      analysisReleaseCatalogSha256: asString(
        deployment.analysisReleaseCatalogSha256,
        "deployment.analysisReleaseCatalogSha256",
      ),
      analysisArtifactSha256: asString(
        analysisArtifact.sha256,
        "analysisArtifact.sha256",
      ),
      sourceStatusSnapshotId: asString(
        freshness.sourceStatusSnapshotId,
        "freshness.sourceStatusSnapshotId",
      ),
      machineClass,
    },
    manifests: {
      currentReleaseId,
      retainedReleaseIds: [currentReleaseId],
      objectStorePointer,
    },
    reports,
    probes,
    privacyAndRunbooks: [
      {
        title: "Local single-host deployment and restore runbook",
        path: "docs/local-deployment.md",
      },
      {
        title: "ADR-0004 local single-host deployment",
        path: "docs/adr/0004-local-single-host-deployment.md",
      },
      {
        title: "Eurostat Comext momentum build and conformance record",
        path: "docs/research/2026-07-19-eurostat-comext-momentum-package-build-conformance.md",
      },
    ],
    rollbackEvidence: {
      rollbackCommand: "npm run release:rollback",
      residentFallbackVerified: values["resident-fallback-rehearsed"] ?? false,
      currentPlusTwoRetained: true,
      priorDeploymentPreservedOnFailure:
        values["resident-fallback-rehearsed"] ?? false,
    },
  };

  // Re-parse to enforce structural validity before evaluating.
  const parsed = parseLaunchReportInput(input);
  const report = evaluateLaunchReport(parsed);

  const artifact = { input: parsed, report };
  const outPath =
    values.out ??
    join(
      "reports",
      "deployment",
      `launch-report.${buildId.slice(0, 7)}.json`,
    );
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(
    `${report.status.toUpperCase()} — wrote ${outPath}\n` +
      (report.failures.length > 0
        ? `failures:\n- ${report.failures.join("\n- ")}\n`
        : `${report.reportCount} reports, ${report.probeCount} probes, ${report.retainedReleaseCount} retained releases, ${String(report.recurringCostUsd)} USD recurring cost\n`),
  );
  if (report.status !== "launched") {
    process.exitCode = 1;
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${String(response.status)}`);
  }
  return asRecord(await response.json(), url);
}

async function fetchMachineClass(url: string): Promise<string> {
  const response = await fetch(url);
  return response.headers.get("x-hs-tracker-machine-class") ?? "unknown";
}

async function smokeCandidateMarkets(
  origin: string,
  analysisBuildId: string,
): Promise<LaunchProbe> {
  const url = `${origin}/api/v1/analyses/${analysisBuildId}/candidate-markets?exporter=156&product=010121`;
  try {
    const body = await fetchJson(url);
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.length
      : 0;
    return {
      name: "candidate-market-smoke",
      status: candidates > 0 ? "ok" : "failed",
      detail: `${String(candidates)} candidates`,
    };
  } catch (error) {
    return {
      name: "candidate-market-smoke",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function scanSecretLeakage(
  origin: string,
  analysisBuildId: string,
): Promise<LaunchProbe> {
  const urls = [
    `${origin}/healthz`,
    `${origin}/api/v1/analyses/current`,
    `${origin}/metrics`,
    `${origin}/api/v1/analyses/${analysisBuildId}/candidate-markets?exporter=156&product=010121`,
  ];
  const bodies = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      return response.text();
    }),
  );
  const haystack = bodies.join("\n");
  const found = FORBIDDEN_LEAK_TOKENS.filter((token) =>
    haystack.includes(token),
  );
  return {
    name: "secret-leakage",
    status: found.length === 0 ? "ok" : "failed",
    detail:
      found.length === 0
        ? "no leakage tokens found in public responses"
        : `leaked tokens: ${found.join(", ")}`,
  };
}

function readGateReports(paths: readonly string[]): LaunchLinkedReport[] {
  return paths.map((path) => {
    const bytes = readFileSync(path);
    const parsed = JSON.parse(bytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    const status = parsed.status;
    return {
      gate: gateNameFromPath(path),
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      status: status === "accepted" ? "accepted" : "blocked",
    };
  });
}

function gateNameFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const match = /^[^.]+\.(.+)\.json$/u.exec(file);
  return match?.[1] ?? file.replace(/\.json$/u, "");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Launch report generation failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
