import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  evaluatePromotionReport,
  parsePromotionReportInput,
  PromotionReportInputError,
  type PromotionEvidence,
  type PromotionGateId,
  type PromotionReportInput,
} from "../../src/promotion/promotion-report";

const REQUIRED_GATES: readonly PromotionGateId[] = [
  "source-and-domain",
  "origin-benchmarks",
  "browser-lab",
  "target-load",
  "coalescing-and-capacity",
  "http-cache-and-deadlines",
  "lifecycle-and-recovery",
  "deployment-resources",
  "external-smoke-and-observability",
  "recurring-cost",
  "market-analysis-launch",
];

describe("production promotion report", () => {
  it("parses an independently loaded promotion input document", () => {
    const parsed = parsePromotionReportInput(
      JSON.parse(JSON.stringify(acceptedInput())),
    );

    expect(evaluatePromotionReport(parsed).status).toBe("accepted");
  });

  it("rejects a malformed loaded evidence document", () => {
    const malformed = JSON.parse(
      JSON.stringify(acceptedInput()).replace(
        '"sampleCount":100',
        '"sampleCount":"100"',
      ),
    );

    expect(() => parsePromotionReportInput(malformed)).toThrowError(
      new PromotionReportInputError(
        "source-and-domain sample count must be a positive safe integer.",
      ),
    );
  });

  it("accepts one exact candidate identity only after every gate passes", () => {
    const result = evaluatePromotionReport(acceptedInput());

    expect(result).toMatchObject({
      schemaVersion: "production-promotion-report-v1",
      evaluatedAt: "2026-07-12T16:00:00Z",
      status: "accepted",
      gateCount: 11,
      priorFailureCount: 0,
      unresolvedFailureCount: 0,
      identity: {
        fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
        buildId: "build-30",
        baciRelease: "V202601",
        artifactSha256: "b".repeat(64),
        machineId: "machine-01J00000000000000000000000",
        machineClass: "shared-cpu-2x",
        region: "sin",
      },
    });
    expect(result.gates.map((gate) => gate.gate)).toEqual(
      REQUIRED_GATES,
    );
  });

  it("blocks an unresolved failed attempt without erasing later success", () => {
    const input = acceptedInput();
    input.evidence[2].attempts = [
      {
        attemptedAt: "2026-07-12T15:00:00Z",
        status: "blocked",
        logSha256: "c".repeat(64),
      },
      {
        attemptedAt: "2026-07-12T15:30:00Z",
        status: "accepted",
        logSha256: "d".repeat(64),
      },
    ];

    const result = evaluatePromotionReport(input);

    expect(result.status).toBe("blocked");
    expect(result.priorFailureCount).toBe(1);
    expect(result.unresolvedFailureCount).toBe(1);
    expect(result.gates[2]).toMatchObject({
      gate: "browser-lab",
      status: "accepted",
      promotionStatus: "blocked",
      attempts: [
        { status: "blocked" },
        { status: "accepted" },
      ],
    });
  });

  it("accepts a fixed rerun while retaining its failure and resolution", () => {
    const input = acceptedInput();
    input.evidence[2].attempts = [
      {
        attemptedAt: "2026-07-12T15:00:00Z",
        status: "blocked",
        logSha256: "c".repeat(64),
      },
      {
        attemptedAt: "2026-07-12T15:30:00Z",
        status: "accepted",
        logSha256: "d".repeat(64),
      },
    ];
    input.evidence[2].resolution = {
      resolvedAt: "2026-07-12T15:25:00Z",
      cause: "Removed the blocking long task and rebuilt the candidate.",
      buildId: "build-30",
    };

    const result = evaluatePromotionReport(input);

    expect(result.status).toBe("accepted");
    expect(result.priorFailureCount).toBe(1);
    expect(result.unresolvedFailureCount).toBe(0);
    expect(result.gates[2].resolution).toEqual(
      input.evidence[2].resolution,
    );
  });

  it("fails closed when required evidence is missing", () => {
    const input = acceptedInput();
    input.evidence = input.evidence.filter(
      (evidence) => evidence.gate !== "target-load",
    );

    expect(() => evaluatePromotionReport(input)).toThrowError(
      new PromotionReportInputError(
        "Missing promotion evidence for target-load.",
      ),
    );
  });

  it("fails closed when evidence belongs to another build", () => {
    const input = acceptedInput();
    input.evidence[0].identity = {
      ...input.evidence[0].identity,
      buildId: "different-build",
    };

    expect(() => evaluatePromotionReport(input)).toThrowError(
      new PromotionReportInputError(
        "source-and-domain evidence buildId does not match the promotion identity.",
      ),
    );
  });
});

function acceptedInput(): PromotionReportInput {
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
    schemaVersion: "production-promotion-input-v1",
    evaluatedAt: "2026-07-12T16:00:00Z",
    identity,
    toolVersions: {
      node: "24.17.0",
      npm: "11.13.0",
      next: "16.2.10",
      duckdb: "1.5.4-r.1",
      playwright: "1.61.1",
    },
    evidence: REQUIRED_GATES.map(
      (gate, index): PromotionEvidence => ({
        gate,
        schemaVersion: `${gate}-report-v1`,
        status: "accepted",
        identity: { ...identity },
        reportSha256: index.toString(16).padStart(64, "0"),
        measuredAt: "2026-07-12T15:30:00Z",
        windowStartedAt: "2026-07-12T15:00:00Z",
        windowEndedAt: "2026-07-12T15:30:00Z",
        sampleCount: 100,
        retainedLogs: [
          `reports/promotion/build-30/${gate}.json`,
        ],
        attempts: [
          {
            attemptedAt: "2026-07-12T15:30:00Z",
            status: "accepted",
            logSha256: index.toString(16).padStart(64, "0"),
          },
        ],
      }),
    ),
  };
}
