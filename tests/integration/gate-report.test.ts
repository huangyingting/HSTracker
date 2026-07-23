import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  buildGate,
  buildPromotionInput,
  reviewRequiredChecks,
  type GateCheckResult,
} from "../../src/promotion/gate-report";
import { loadPromotionEvaluation } from "../../src/promotion/promotion-acceptance";
import { PROMOTION_GATE_REQUIRED_CHECKS } from "../../src/promotion/promotion-evidence";
import type {
  PromotionGateId,
  PromotionIdentity,
} from "../../src/promotion/promotion-report";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

const IDENTITY: PromotionIdentity = {
  fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
  buildId: "issue-30-candidate",
  baciRelease: "V202601",
  analysisBuildId: "acceptance-fixtures-v1",
  productSearchBuildId: "acceptance-product-search-v3",
  artifactSha256:
    "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
  deploymentPairingId: "deployment-issue-30-candidate",
  sourceStatusSnapshotId: "source-status-issue-30-candidate",
  machineId: "local",
  machineClass: "local",
  region: "loc",
};

const TOOL_VERSIONS = {
  node: "24.17.0",
  npm: "11.13.0",
  next: "16.2.10",
  duckdb: "1.5.4-r.1",
  playwright: "1.61.1",
};

async function assembleAndEvaluate(
  overrides: Partial<Record<PromotionGateId, GateCheckResult[]>> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "gate-report-"));
  workspaces.push(root);
  await mkdir(join(root, "reports"), { recursive: true });

  const gates = (
    Object.keys(PROMOTION_GATE_REQUIRED_CHECKS) as PromotionGateId[]
  ).map((gate) => {
    const checks =
      overrides[gate] ??
      PROMOTION_GATE_REQUIRED_CHECKS[gate].map((name) => ({
        name,
        status: "accepted" as const,
      }));
    return buildGate({
      gate,
      identity: IDENTITY,
      measurementClass: "candidate",
      checks,
      reportPath: `reports/promotion/candidate/gates/${gate}.json`,
      windowStartedAt: "2026-07-12T01:00:00Z",
      windowEndedAt: "2026-07-12T01:30:00Z",
      measuredAt: "2026-07-12T01:30:00Z",
      sampleCount: 100,
    });
  });

  await Promise.all(
    gates.map(async (built) => {
      const absolute = join(root, built.reportPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, built.reportJson);
    }),
  );

  const input = buildPromotionInput({
    identity: IDENTITY,
    toolVersions: TOOL_VERSIONS,
    evaluatedAt: "2026-07-12T01:45:00Z",
    gates,
  });
  const inputPath = join(root, "promotion-input.json");
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);

  return loadPromotionEvaluation(inputPath, root);
}

describe("promotion gate-report builder", () => {
  it("assembles eleven accepted gate reports into an accepted promotion", async () => {
    const { report } = await assembleAndEvaluate();
    expect(report.status).toBe("accepted");
    expect(report.gateCount).toBe(11);
  });

  it("blocks the promotion when a single gate check is review-required", async () => {
    const { report } = await assembleAndEvaluate({
      "recurring-cost": [{ name: "monthly-cost", status: "review-required" }],
    });
    expect(report.status).toBe("blocked");
  });

  it("rejects a gate whose required checks are incomplete", () => {
    expect(() =>
      buildGate({
        gate: "recurring-cost",
        identity: IDENTITY,
        measurementClass: "candidate",
        checks: [],
        reportPath: "reports/promotion/candidate/gates/recurring-cost.json",
        windowStartedAt: "2026-07-12T01:00:00Z",
        windowEndedAt: "2026-07-12T01:30:00Z",
        measuredAt: "2026-07-12T01:30:00Z",
        sampleCount: 100,
      }),
    ).toThrow(/monthly-cost/u);
  });

  it("blocks the promotion when a gate is left at its not-yet-measured default", async () => {
    const { report } = await assembleAndEvaluate({
      "lifecycle-and-recovery": reviewRequiredChecks("lifecycle-and-recovery"),
    });
    expect(report.status).toBe("blocked");
  });
});
