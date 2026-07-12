import { describe, expect, it } from "vitest";

import { evaluateDeploymentGates } from "../../src/deployment/deployment-gates";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

describe("production deployment gates", () => {
  it("accepts the measured V202601 deployment baseline", () => {
    expect(
      evaluateDeploymentGates({
        imageCompressedBytes: 180 * MIB,
        artifactBytes: 1_002_975_232,
        catalogResidentBytes: 5_153_712,
        volumeCapacityBytes: 50 * GIB,
        volumeFreeBytesAtPeak: 42 * GIB,
        volumeFreeBytesAfterActivation: 47 * GIB,
        recurringMonthlyCostUsd: 21.07,
      }),
    ).toEqual({
      schemaVersion: "production-deployment-gates-v1",
      status: "accepted",
      gates: {
        image: {
          measuredBytes: 188_743_680,
          limitBytes: 524_288_000,
          status: "accepted",
        },
        artifact: {
          measuredBytes: 1_002_975_232,
          targetBytes: 8_589_934_592,
          limitBytes: 10_737_418_240,
          status: "accepted",
        },
        catalog: {
          measuredResidentBytes: 5_153_712,
          limitBytes: 33_554_432,
          status: "accepted",
        },
        volume: {
          capacityBytes: 53_687_091_200,
          minimumCapacityBytes: 53_687_091_200,
          requiredCapacityBytes: 9_738_523_990,
          freeBytesAtPeak: 45_097_156_608,
          freeFractionAtPeak: 0.84,
          freeBytesAfterActivation: 50_465_865_728,
          freeFractionAfterActivation: 0.94,
          warningFreeFraction: 0.3,
          minimumFreeFraction: 0.25,
          status: "accepted",
        },
        cost: {
          forecastUsd: 21.07,
          targetUsd: 40,
          reviewThresholdUsd: 50,
          architectureDecision: null,
          status: "accepted",
        },
      },
    });

  });

  it("blocks every hard resource and cost threshold", () => {
    const result = evaluateDeploymentGates({
      imageCompressedBytes: 500 * MIB + 1,
      artifactBytes: 10 * GIB + 1,
      catalogResidentBytes: 32 * MIB + 1,
      volumeCapacityBytes: 49 * GIB,
      volumeFreeBytesAtPeak: 12 * GIB,
      volumeFreeBytesAfterActivation: 12 * GIB,
      recurringMonthlyCostUsd: 50.01,
    });

    expect(result.status).toBe("blocked");
    expect(result.gates.image.status).toBe("blocked");
    expect(result.gates.artifact.status).toBe("blocked");
    expect(result.gates.catalog.status).toBe("blocked");
    expect(result.gates.volume.status).toBe("blocked");
    expect(result.gates.cost.status).toBe("blocked");
  });

  it("requires review at warning thresholds without reporting acceptance", () => {
    const result = evaluateDeploymentGates({
      imageCompressedBytes: 200 * MIB,
      artifactBytes: 9 * GIB,
      catalogResidentBytes: 20 * MIB,
      volumeCapacityBytes: 50 * GIB,
      volumeFreeBytesAtPeak: 14 * GIB,
      volumeFreeBytesAfterActivation: 15 * GIB,
      recurringMonthlyCostUsd: 45,
    });

    expect(result.status).toBe("review-required");
    expect(result.gates.artifact.status).toBe("review-required");
    expect(result.gates.volume.status).toBe("review-required");
    expect(result.gates.cost.status).toBe("review-required");
  });
});
