import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PromotionEvidenceFileError,
  verifyRetainedPromotionEvidence,
} from "../../src/promotion/promotion-evidence";
import type { PromotionEvidence } from "../../src/promotion/promotion-report";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("retained promotion evidence", () => {
  it("independently hashes the report and every retained attempt", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input);
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence(
        [input],
        workspace,
      ),
    ).resolves.toEqual([
      {
        gate: "origin-benchmarks",
        reportSha256,
        report: {
          schemaVersion: "origin-benchmarks-report-v1",
          measurementClass: "candidate",
          status: "accepted",
        },
        retainedLogs: [
          {
            path: "reports/promotion/origin.json",
            bytes: reportBytes.byteLength,
            sha256: reportSha256,
          },
        ],
      },
    ]);
  });

  it("rejects a declared digest that does not match retained bytes", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("f".repeat(64));
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      retainedReportBytes(input),
    );

    await expect(
      verifyRetainedPromotionEvidence(
        [input],
        workspace,
      ),
    ).rejects.toEqual(
      new PromotionEvidenceFileError(
        "origin-benchmarks report SHA-256 is not present in its retained logs.",
      ),
    );
  });

  it("rejects a generic schema relabeled as gate evidence", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    input.schemaVersion = "generic-candidate-report-v1";
    const reportBytes = retainedReportBytes(input);
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toThrow(
      "origin-benchmarks evidence must declare schemaVersion origin-benchmarks-report-v1",
    );
  });

  it("rejects a report missing a required gate-specific check", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input, {
      checks: [
        { name: "representative-fixtures", status: "accepted" },
      ],
    });
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toThrow(
      "origin-benchmarks retained report is missing required check origin-thresholds",
    );
  });

  it("rejects accepted evidence containing a blocked check", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input, {
      checks: [
        { name: "representative-fixtures", status: "accepted" },
        { name: "origin-thresholds", status: "blocked" },
      ],
    });
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toThrow(
      "origin-benchmarks retained report checks do not support its declared status",
    );
  });

  it("rejects an accepted declaration for a retained blocked report", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input, {
      status: "blocked",
    });
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toEqual(
      new PromotionEvidenceFileError(
        "origin-benchmarks retained report status does not match its declared evidence.",
      ),
    );
  });

  it("rejects relabeled local-smoke evidence", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input, {
      measurementClass: "local-smoke",
    });
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toEqual(
      new PromotionEvidenceFileError(
        "origin-benchmarks accepted evidence requires a candidate retained report.",
      ),
    );
  });

  it("rejects a retained report measured for another build", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("0".repeat(64));
    const reportBytes = retainedReportBytes(input, {
      identity: { ...input.identity, buildId: "other-build" },
    });
    const reportSha256 = sha256(reportBytes);
    input.reportSha256 = reportSha256;
    input.attempts[0].logSha256 = reportSha256;
    await writeFile(
      join(workspace, "reports/promotion/origin.json"),
      reportBytes,
    );

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toEqual(
      new PromotionEvidenceFileError(
        "origin-benchmarks retained report buildId does not match its declared evidence.",
      ),
    );
  });

  it("fails closed for remote logs that cannot be independently retained", async () => {
    const workspace = await promotionWorkspace();
    const input = evidence("f".repeat(64));
    input.retainedLogs = ["https://example.com/origin.json"];

    await expect(
      verifyRetainedPromotionEvidence([input], workspace),
    ).rejects.toEqual(
      new PromotionEvidenceFileError(
        "origin-benchmarks retained log must be a local reports-relative path.",
      ),
    );
  });
});

async function promotionWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "hs-promotion-"));
  workspaces.push(workspace);
  await mkdir(join(workspace, "reports/promotion"), {
    recursive: true,
  });
  return workspace;
}

function evidence(reportSha256: string): PromotionEvidence {
  const identity = {
    fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
    buildId: "build-30",
    baciRelease: "V202601",
    analysisBuildId: "analysis-build-v1-620a5047a1a306ca",
    productSearchBuildId: "product-search-v1-aa1f4027019c194b",
    artifactSha256: "b".repeat(64),
    deploymentPairingId: "deployment-pairing-v1-4a9935ac2499d871",
    sourceStatusSnapshotId: "source-status-v1-1234567890abcdef",
    machineId: "machine-01J00000000000000000000000",
    machineClass: "shared-cpu-2x",
    region: "sin",
  };
  return {
    gate: "origin-benchmarks",
    schemaVersion: "origin-benchmarks-report-v1",
    status: "accepted",
    identity,
    reportSha256,
    measuredAt: "2026-07-12T15:30:00Z",
    windowStartedAt: "2026-07-12T15:00:00Z",
    windowEndedAt: "2026-07-12T15:30:00Z",
    sampleCount: 100,
    retainedLogs: ["reports/promotion/origin.json"],
    attempts: [
      {
        attemptedAt: "2026-07-12T15:30:00Z",
        status: "accepted",
        logSha256: reportSha256,
      },
    ],
  };
}

function retainedReportBytes(
  input: PromotionEvidence,
  overrides: {
    measurementClass?: "candidate" | "local-smoke";
    status?: PromotionEvidence["status"];
    identity?: PromotionEvidence["identity"];
    checks?: Array<{
      name: string;
      status: PromotionEvidence["status"];
    }>;
  } = {},
): Buffer {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: input.schemaVersion,
      gate: input.gate,
      measurementClass: overrides.measurementClass ?? "candidate",
      status: overrides.status ?? input.status,
      identity: overrides.identity ?? input.identity,
      checks: overrides.checks ?? [
        { name: "representative-fixtures", status: input.status },
        { name: "origin-thresholds", status: input.status },
      ],
    })}\n`,
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
