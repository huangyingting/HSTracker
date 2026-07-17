import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRecentTradeMomentumPackage,
  canonicalRecentTradeMomentumAnalyticalRows,
  evaluateRecentTradeMomentumActivationGate,
  evaluateRecentTradeMomentumArtifactGates,
  RECENT_TRADE_MOMENTUM_ARTIFACT_HARD_LIMIT_BYTES,
  RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES,
} from "../../scripts/release/recent-trade-momentum-package";
import {
  EXPECTED_RECENT_TRADE_MOMENTUM_ANALYTICAL_ROWS_JSON,
  recentTradeMomentumFixtureVintageA,
  recentTradeMomentumFixtureVintageAReordered,
  recentTradeMomentumFixtureVintageB,
} from "../../fixtures/recent-trade-momentum/v1/synthetic-oracle";

const temporaryDirectories: string[] = [];
let workspaceCounter = 0;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Recent Trade Momentum immutable package builder", () => {
  it("builds the pinned synthetic oracle package with deterministic analytical rows and gates", async () => {
    const workspace = await temporaryWorkspace();
    const reportPath = join(workspace, "reports", "vintage-a-report.json");

    const outcome = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageA,
      workspacePath: workspace,
      reportPath,
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "synthetic-build-sha",
      shadowVintagesPassed: 3,
    });
    const analyticalRows = await canonicalRecentTradeMomentumAnalyticalRows(
      outcome.artifactPath,
    );

    expect(outcome.status).toBe("accepted");
    expect(outcome.datasetPackage.identity).toMatch(/^dataset-package-v1-[a-f0-9]{64}$/u);
    expect(outcome.manifest.quality).toEqual({ status: "accepted", reason: null });
    expect(outcome.manifest.coverage).toEqual({
      expectedHistoryMonths: 24,
      shadowVintagesPassed: 3,
      publicCapabilityActivated: false,
    });
    expect(outcome.gates).toMatchObject({
      artifactSizeReviewRequired: false,
      artifactPromotionBlocked: false,
      retentionFitsDeclaredVolume: true,
      sourceRowUniqueness: true,
      aggregateRowUniqueness: true,
      valueReconciled: true,
      readOnlySmokePassed: true,
    });
    expect(outcome.reconciliation).toEqual({
      sourceIdentifiedValueEur: "5949999",
      aggregateIdentifiedValueEur: "5949999",
      excludedSpecialValueEur: "9999",
      worldTotalExcludedValueEur: "5949999",
    });
    expect(analyticalRows).toBe(EXPECTED_RECENT_TRADE_MOMENTUM_ANALYTICAL_ROWS_JSON);
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({
      schemaVersion: "recent-trade-momentum-build-report-v1",
      status: "accepted",
      sourceVintageId: "recent-trade-momentum-fixtures-v1-a",
      rowCounts: outcome.manifest.rowCounts,
    });

    const instance = await DuckDBInstance.create(outcome.artifactPath, {
      access_mode: "READ_ONLY",
    });
    try {
      const connection = await instance.connect();
      try {
        const smoke = await connection.runAndReadAll(`
          SELECT
            COUNT(*)::UBIGINT AS momentum_rows,
            COUNT_IF(coverage_state = 'SUPPORTED')::UBIGINT AS supported_rows,
            SUM(CAST(recent_value_eur AS BIGINT))::UBIGINT AS recent_value
          FROM momentum
        `);
        expect(smoke.getRowObjectsJson()[0]).toEqual({
          momentum_rows: "6",
          supported_rows: "2",
          recent_value: "1499999",
        });
      } finally {
        connection.closeSync();
      }
    } finally {
      instance.closeSync();
    }
  });

  it("sorts source-grain rows so source-code reorder produces byte-identical analytical output", async () => {
    const firstWorkspace = await temporaryWorkspace();
    const secondWorkspace = await temporaryWorkspace();

    const first = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageA,
      workspacePath: firstWorkspace,
      reportPath: join(firstWorkspace, "report.json"),
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "synthetic-build-sha",
      shadowVintagesPassed: 3,
    });
    const reordered = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageAReordered,
      workspacePath: secondWorkspace,
      reportPath: join(secondWorkspace, "report.json"),
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "synthetic-build-sha",
      shadowVintagesPassed: 3,
    });

    await expect(
      canonicalRecentTradeMomentumAnalyticalRows(reordered.artifactPath),
    ).resolves.toBe(await canonicalRecentTradeMomentumAnalyticalRows(first.artifactPath));
  });

  it("publishes a new package identity and revision report for changed vintages", async () => {
    const firstWorkspace = await temporaryWorkspace();
    const secondWorkspace = await temporaryWorkspace();
    const first = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageA,
      workspacePath: firstWorkspace,
      reportPath: join(firstWorkspace, "report.json"),
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "synthetic-build-sha",
      shadowVintagesPassed: 3,
    });

    const second = await buildRecentTradeMomentumPackage({
      sourceVintage: recentTradeMomentumFixtureVintageB,
      previousPackage: first,
      workspacePath: secondWorkspace,
      reportPath: join(secondWorkspace, "report.json"),
      builtAt: "2026-07-17T00:00:00.000Z",
      buildGitSha: "synthetic-build-sha",
      shadowVintagesPassed: 3,
    });

    expect(second.datasetPackage.identity).not.toBe(first.datasetPackage.identity);
    expect(second.manifest.supersedesPackageIdentity).toBe(first.datasetPackage.identity);
    expect(second.revisionReport).toMatchObject({
      schemaVersion: "recent-trade-momentum-revision-report-v1",
      previousSourceVintageId: "recent-trade-momentum-fixtures-v1-a",
      sourceVintageId: "recent-trade-momentum-fixtures-v1-b",
      sourceGrain: {
        inserted: 1,
        deleted: 1,
        valueChanged: 1,
        stateChanged: 1,
      },
      momentum: {
        valueChanged: 2,
        stateChanged: 2,
        alertEventKinds: [
          "REVISION_UPDATE",
          "REVISION_RETRACTION",
          "REVISION_REINSTATEMENT",
        ],
      },
    });
    expect(second.revisionReport.affectedProducts).toEqual(["010121"]);
    expect(second.revisionReport.affectedReporters).toEqual(["BE", "DE"]);
  });

  it("blocks oversized artifacts while allowing target-size review signals", () => {
    expect(
      evaluateRecentTradeMomentumArtifactGates(
        RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES,
      ),
    ).toEqual({
      artifactBytes: RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES,
      artifactSizeReviewRequired: false,
      artifactPromotionBlocked: false,
    });
    expect(
      evaluateRecentTradeMomentumArtifactGates(
        RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES + 1,
      ),
    ).toEqual({
      artifactBytes: RECENT_TRADE_MOMENTUM_ARTIFACT_TARGET_BYTES + 1,
      artifactSizeReviewRequired: true,
      artifactPromotionBlocked: false,
    });
    expect(
      evaluateRecentTradeMomentumArtifactGates(
        RECENT_TRADE_MOMENTUM_ARTIFACT_HARD_LIMIT_BYTES + 1,
      ),
    ).toEqual({
      artifactBytes: RECENT_TRADE_MOMENTUM_ARTIFACT_HARD_LIMIT_BYTES + 1,
      artifactSizeReviewRequired: true,
      artifactPromotionBlocked: true,
    });
  });

  it("requires three accepted shadow vintages before public capability activation", () => {
    expect(evaluateRecentTradeMomentumActivationGate(2)).toEqual({
      publicCapabilityActivated: false,
      shadowVintagesPassed: 2,
      activationAllowed: false,
      reason: "THREE_SHADOW_VINTAGES_REQUIRED",
    });
    expect(evaluateRecentTradeMomentumActivationGate(3)).toEqual({
      publicCapabilityActivated: false,
      shadowVintagesPassed: 3,
      activationAllowed: true,
      reason: null,
    });
  });
});

async function temporaryWorkspace(): Promise<string> {
  workspaceCounter += 1;
  const path = join(
    "data",
    "work",
    `recent-trade-momentum-test-${process.pid}-${workspaceCounter}`,
  );
  await rm(path, { force: true, recursive: true });
  await mkdir(path, { recursive: true });
  temporaryDirectories.push(path);
  return path;
}
