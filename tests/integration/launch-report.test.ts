import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateLaunchReport,
  LaunchReportInputError,
  parseLaunchReportInput,
  type LaunchReportInput,
} from "../../src/promotion/launch-report";

const BUILD_ID = "36882575baca659a9930ff736d4d5c9910957d0f";
const SHA_A =
  "fc8322c4e04efd6935d5b6ee9833df4b1504d515eee5ff9c805bba3445274d42";
const SHA_B =
  "ca688ed1ac89b3f2da1aab606179c659cffcfdc6a590ea91e9f62259163f8b76";

function validInput(): LaunchReportInput {
  return {
    schemaVersion: "local-launch-report-input-v1",
    launchedAt: "2026-07-19T00:00:00Z",
    buildId: BUILD_ID,
    localOrigin: {
      adr: "docs/adr/0004-local-single-host-deployment.md",
      machineClass: "local",
      bind: "127.0.0.1:3000",
      hosting: "single-host container over loopback",
    },
    providerDecisions: {
      recurringCostUsd: 0,
      objectStore: "filesystem",
      operationalStore: "postgres",
      hosting: "local-container",
      adr: "docs/adr/0004-local-single-host-deployment.md",
    },
    identities: {
      buildId: BUILD_ID,
      deploymentPairingId: "deployment-pairing-v1-524ecfbc74effe30",
      baciRelease: "V202601",
      analysisBuildId: "analysis-build-v1-949d1ac27ade40d4",
      productSearchBuildId: "product-search-v1-aa1f4027019c194b",
      analysisReleaseCatalogSha256: SHA_A,
      analysisArtifactSha256: SHA_B,
      sourceStatusSnapshotId: "source-status-v1-b5ea309f2eef076f",
      machineClass: "local",
    },
    manifests: {
      currentReleaseId: "release-3",
      retainedReleaseIds: ["release-3", "release-2", "release-1"],
      objectStorePointer: "data/local-deploy/objectstore/releases/current",
    },
    reports: [
      {
        gate: "local-single-host-gates",
        path: "reports/deployment/ee7313f.local-single-host-gates.json",
        sha256: SHA_A,
        status: "accepted",
      },
    ],
    probes: [
      { name: "health", status: "ok", detail: "status ok" },
      { name: "readiness", status: "ok", detail: "ready" },
      {
        name: "candidate-market-smoke",
        status: "ok",
        detail: "182 candidates",
      },
      {
        name: "secret-leakage",
        status: "ok",
        detail: "no leakage tokens found",
      },
      { name: "machine-class", status: "ok", detail: "local" },
    ],
    privacyAndRunbooks: [
      { title: "Local single-host deployment and restore", path: "docs/local-deployment.md" },
    ],
    rollbackEvidence: {
      rollbackCommand: "npm run release:rollback",
      residentFallbackVerified: true,
      currentPlusTwoRetained: true,
      priorDeploymentPreservedOnFailure: true,
    },
  };
}

describe("evaluateLaunchReport", () => {
  it("reports a complete, consistent launch as launched", () => {
    const report = evaluateLaunchReport(validInput());
    expect(report.status).toBe("launched");
    expect(report.failures).toEqual([]);
    expect(report.buildId).toBe(BUILD_ID);
    expect(report.reportCount).toBe(1);
    expect(report.probeCount).toBe(5);
    expect(report.retainedReleaseCount).toBe(3);
    expect(report.recurringCostUsd).toBe(0);
    expect(report.heldLeavesPriorDeploymentActive).toBe(true);
  });

  it("holds the launch when recurring provider cost is not zero", () => {
    const input = validInput();
    input.providerDecisions.recurringCostUsd = 12;
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(report.failures.some((f) => /cost/iu.test(f))).toBe(true);
  });

  it("holds the launch when a linked gate report is not accepted", () => {
    const input = validInput();
    input.reports[0]!.status = "blocked";
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(
      report.failures.some((f) => /local-single-host-gates/u.test(f)),
    ).toBe(true);
  });

  it("holds the launch when a probe is not ok", () => {
    const input = validInput();
    input.probes[2]!.status = "failed";
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(
      report.failures.some((f) => /candidate-market-smoke/u.test(f)),
    ).toBe(true);
  });

  it("holds the launch when a required probe is missing", () => {
    const input = validInput();
    input.probes = input.probes.filter((p) => p.name !== "secret-leakage");
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(report.failures.some((f) => /secret-leakage/u.test(f))).toBe(true);
  });

  it("holds the launch when resident fallback is not verified", () => {
    const input = validInput();
    input.rollbackEvidence.residentFallbackVerified = false;
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(report.failures.some((f) => /resident fallback/iu.test(f))).toBe(
      true,
    );
  });

  it("holds the launch when the identity build id disagrees with the launch build id", () => {
    const input = validInput();
    input.identities.buildId = "0000000000000000000000000000000000000000";
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
    expect(report.failures.some((f) => /build id/iu.test(f))).toBe(true);
  });

  it("holds the launch when the active machine class is not local", () => {
    const input = validInput();
    input.identities.machineClass = "hosted";
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
  });

  it("holds the launch when the current release is not among the retained releases", () => {
    const input = validInput();
    input.manifests.currentReleaseId = "release-9";
    const report = evaluateLaunchReport(input);
    expect(report.status).toBe("held");
  });
});

describe("parseLaunchReportInput", () => {
  it("round-trips a valid input", () => {
    const input = validInput();
    const parsed = parseLaunchReportInput(JSON.parse(JSON.stringify(input)));
    expect(parsed).toEqual(input);
  });

  it("rejects an unknown schema version", () => {
    const input = JSON.parse(JSON.stringify(validInput()));
    input.schemaVersion = "local-launch-report-input-v2";
    expect(() => parseLaunchReportInput(input)).toThrow(
      LaunchReportInputError,
    );
  });

  it("rejects a missing section", () => {
    const input = JSON.parse(JSON.stringify(validInput()));
    delete input.rollbackEvidence;
    expect(() => parseLaunchReportInput(input)).toThrow(
      LaunchReportInputError,
    );
  });

  it("rejects an empty probe set", () => {
    const input = JSON.parse(JSON.stringify(validInput()));
    input.probes = [];
    expect(() => parseLaunchReportInput(input)).toThrow(
      LaunchReportInputError,
    );
  });
});

describe("committed local-launch report artifact", () => {
  const artifactPath = join(
    "reports",
    "deployment",
    "launch-report.3688257.json",
  );

  it("re-derives a launched verdict from the durable artifact's linked evidence", () => {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      input: unknown;
      report: { status: string; failures: string[] };
    };
    const parsed = parseLaunchReportInput(artifact.input);
    const reevaluated = evaluateLaunchReport(parsed);
    expect(reevaluated.status).toBe("launched");
    expect(reevaluated.failures).toEqual([]);
    // The stored verdict must match the re-derived one, so the artifact cannot
    // drift from the evidence it links.
    expect(artifact.report.status).toBe("launched");
    expect(artifact.report.failures).toEqual([]);
    expect(parsed.identities.machineClass).toBe("local");
    expect(parsed.providerDecisions.recurringCostUsd).toBe(0);
  });
});
