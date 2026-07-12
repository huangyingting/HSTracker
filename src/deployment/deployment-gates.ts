const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const IMAGE_LIMIT_BYTES = 500 * MIB;
const ARTIFACT_TARGET_BYTES = 8 * GIB;
const ARTIFACT_LIMIT_BYTES = 10 * GIB;
const CATALOG_RESIDENT_LIMIT_BYTES = 32 * MIB;
const SPILL_LIMIT_BYTES = 4 * GIB;
const MINIMUM_VOLUME_BYTES = 50 * GIB;
const VOLUME_WARNING_FREE_FRACTION = 0.3;
const VOLUME_MINIMUM_FREE_FRACTION = 0.25;
const COST_TARGET_USD = 40;
const COST_REVIEW_THRESHOLD_USD = 50;

export type DeploymentGateStatus =
  | "accepted"
  | "review-required"
  | "blocked";

export type DeploymentGateInput = {
  imageCompressedBytes: number;
  artifactBytes: number;
  catalogResidentBytes: number;
  volumeCapacityBytes: number;
  volumeFreeBytesAtPeak: number;
  volumeFreeBytesAfterActivation: number;
  recurringMonthlyCostUsd: number;
  costArchitectureDecision?: string;
};

export class DeploymentGateInputError extends Error {
  readonly code = "DEPLOYMENT_GATE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DeploymentGateInputError";
  }
}

export function evaluateDeploymentGates(input: DeploymentGateInput) {
  const imageCompressedBytes = positiveBytes(
    input.imageCompressedBytes,
    "image compressed bytes",
  );
  const artifactBytes = positiveBytes(input.artifactBytes, "artifact bytes");
  const catalogResidentBytes = positiveBytes(
    input.catalogResidentBytes,
    "catalog resident bytes",
  );
  const volumeCapacityBytes = positiveBytes(
    input.volumeCapacityBytes,
    "volume capacity bytes",
  );
  const volumeFreeBytesAtPeak = availableBytes(
    input.volumeFreeBytesAtPeak,
    volumeCapacityBytes,
    "volume free bytes at peak",
  );
  const volumeFreeBytesAfterActivation = availableBytes(
    input.volumeFreeBytesAfterActivation,
    volumeCapacityBytes,
    "volume free bytes after activation",
  );
  const recurringMonthlyCostUsd = nonnegativeNumber(
    input.recurringMonthlyCostUsd,
    "recurring monthly cost",
  );
  const architectureDecision = optionalDecision(
    input.costArchitectureDecision,
  );

  const imageStatus: DeploymentGateStatus =
    imageCompressedBytes <= IMAGE_LIMIT_BYTES ? "accepted" : "blocked";
  const artifactStatus: DeploymentGateStatus =
    artifactBytes > ARTIFACT_LIMIT_BYTES
      ? "blocked"
      : artifactBytes > ARTIFACT_TARGET_BYTES
        ? "review-required"
        : "accepted";
  const catalogStatus: DeploymentGateStatus =
    catalogResidentBytes <= CATALOG_RESIDENT_LIMIT_BYTES
      ? "accepted"
      : "blocked";
  const requiredCapacityBytes = Math.ceil(
    (3 * artifactBytes + SPILL_LIMIT_BYTES) /
      (1 - VOLUME_MINIMUM_FREE_FRACTION),
  );
  const freeFractionAtPeak =
    volumeFreeBytesAtPeak / volumeCapacityBytes;
  const freeFractionAfterActivation =
    volumeFreeBytesAfterActivation / volumeCapacityBytes;
  const volumeStatus = volumeGateStatus({
    volumeCapacityBytes,
    requiredCapacityBytes,
    freeFractionAtPeak,
    freeFractionAfterActivation,
  });
  const costStatus = costGateStatus(
    recurringMonthlyCostUsd,
    architectureDecision,
  );

  return {
    schemaVersion: "production-deployment-gates-v1" as const,
    status: combinedStatus([
      imageStatus,
      artifactStatus,
      catalogStatus,
      volumeStatus,
      costStatus,
    ]),
    gates: {
      image: {
        measuredBytes: imageCompressedBytes,
        limitBytes: IMAGE_LIMIT_BYTES,
        status: imageStatus,
      },
      artifact: {
        measuredBytes: artifactBytes,
        targetBytes: ARTIFACT_TARGET_BYTES,
        limitBytes: ARTIFACT_LIMIT_BYTES,
        status: artifactStatus,
      },
      catalog: {
        measuredResidentBytes: catalogResidentBytes,
        limitBytes: CATALOG_RESIDENT_LIMIT_BYTES,
        status: catalogStatus,
      },
      volume: {
        capacityBytes: volumeCapacityBytes,
        minimumCapacityBytes: MINIMUM_VOLUME_BYTES,
        requiredCapacityBytes,
        freeBytesAtPeak: volumeFreeBytesAtPeak,
        freeFractionAtPeak,
        freeBytesAfterActivation: volumeFreeBytesAfterActivation,
        freeFractionAfterActivation,
        warningFreeFraction: VOLUME_WARNING_FREE_FRACTION,
        minimumFreeFraction: VOLUME_MINIMUM_FREE_FRACTION,
        status: volumeStatus,
      },
      cost: {
        forecastUsd: recurringMonthlyCostUsd,
        targetUsd: COST_TARGET_USD,
        reviewThresholdUsd: COST_REVIEW_THRESHOLD_USD,
        architectureDecision,
        status: costStatus,
      },
    },
  };
}

function volumeGateStatus(input: {
  volumeCapacityBytes: number;
  requiredCapacityBytes: number;
  freeFractionAtPeak: number;
  freeFractionAfterActivation: number;
}): DeploymentGateStatus {
  if (
    input.volumeCapacityBytes < MINIMUM_VOLUME_BYTES ||
    input.volumeCapacityBytes < input.requiredCapacityBytes ||
    input.freeFractionAtPeak < VOLUME_MINIMUM_FREE_FRACTION ||
    input.freeFractionAfterActivation < VOLUME_MINIMUM_FREE_FRACTION
  ) {
    return "blocked";
  }
  if (
    input.freeFractionAtPeak < VOLUME_WARNING_FREE_FRACTION ||
    input.freeFractionAfterActivation < VOLUME_WARNING_FREE_FRACTION
  ) {
    return "review-required";
  }
  return "accepted";
}

function costGateStatus(
  forecastUsd: number,
  architectureDecision: string | null,
): DeploymentGateStatus {
  if (
    forecastUsd > COST_REVIEW_THRESHOLD_USD &&
    architectureDecision === null
  ) {
    return "blocked";
  }
  return forecastUsd > COST_TARGET_USD
    ? "review-required"
    : "accepted";
}

function combinedStatus(
  statuses: readonly DeploymentGateStatus[],
): DeploymentGateStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  return statuses.includes("review-required")
    ? "review-required"
    : "accepted";
}

function bytes(value: number, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new DeploymentGateInputError(
      `${label} must be a nonnegative safe integer.`,
    );
  }
  return value;
}

function positiveBytes(value: number, label: string): number {
  const parsed = bytes(value, label);
  if (parsed === 0) {
    throw new DeploymentGateInputError(`${label} must be positive.`);
  }
  return parsed;
}

function availableBytes(
  value: number,
  capacity: number,
  label: string,
): number {
  const parsed = bytes(value, label);
  if (parsed > capacity) {
    throw new DeploymentGateInputError(
      `${label} cannot exceed volume capacity bytes.`,
    );
  }
  return parsed;
}

function nonnegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DeploymentGateInputError(
      `${label} must be a finite nonnegative number.`,
    );
  }
  return value;
}

function optionalDecision(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (value.trim().length === 0) {
    throw new DeploymentGateInputError(
      "Cost architecture decision must be nonempty when set.",
    );
  }
  return value;
}
