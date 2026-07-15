import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { VerifiedReleaseRuntime } from "../runtime/verified-release-runtime";
import {
  ACTIVE_DEPLOYMENT_POINTER_KEY,
  parseDeploymentPairingManifest,
  readReleaseMetadata,
  releaseJsonBytes,
  type ActiveDeploymentPointer,
  type DeploymentPairingManifest,
  type ReleaseObjectReference,
} from "./release-manifest";
import {
  releaseObjectIdentity,
  singleChunk,
  type ReleaseObject,
  type ReleaseObjectReader,
} from "./release-object-store";

export async function validateDeploymentActivation(input: {
  objectStore: ReleaseObjectReader;
  deploymentReference: ReleaseObjectReference;
  activatedAt: string;
}): Promise<DeploymentPairingManifest> {
  const deploymentBytes = await readVerifiedObject(
    input.objectStore,
    input.deploymentReference,
  );
  const deployment = parseDeploymentPairingManifest(
    JSON.parse(deploymentBytes.toString("utf8")),
  );
  const pointer: ActiveDeploymentPointer = {
    schemaVersion: "active-deployment-pointer-v1",
    current: input.deploymentReference,
    history: [],
    sourceStatusFallback: deployment.sourceStatusFallback,
    activatedAt: input.activatedAt,
  };
  const volumePath = resolve(
    `.release-activation-validation-${process.pid}-${randomUUID()}`,
  );
  let runtime: VerifiedReleaseRuntime | undefined;
  try {
    runtime = await VerifiedReleaseRuntime.load({
      objectStore: new ExactDeploymentReader(
        input.objectStore,
        releaseJsonBytes(pointer),
      ),
      volumePath,
      now: () => input.activatedAt,
    });
    if (
      runtime.health("release-activation-validation")
        .deployment.deploymentPairingId !==
      deployment.deploymentPairingId
    ) {
      throw new TypeError(
        "Validated deployment does not match the requested deployment.",
      );
    }
    return deployment;
  } finally {
    runtime?.close();
    await rm(volumePath, { force: true, recursive: true });
  }
}

class ExactDeploymentReader implements ReleaseObjectReader {
  constructor(
    private readonly delegate: ReleaseObjectReader,
    private readonly pointerBytes: Buffer,
  ) {}

  getObject(key: string): Promise<ReleaseObject | null> {
    if (key === ACTIVE_DEPLOYMENT_POINTER_KEY) {
      return Promise.resolve({
        body: singleChunk(this.pointerBytes),
        version: "activation-validation",
      });
    }
    return this.delegate.getObject(key);
  }
}

async function readVerifiedObject(
  objectStore: ReleaseObjectReader,
  reference: ReleaseObjectReference,
): Promise<Buffer> {
  const stored = await objectStore.getObject(reference.key);
  if (stored === null) {
    throw new TypeError(
      `Deployment object ${reference.key} is unavailable.`,
    );
  }
  const bytes = await readReleaseMetadata(stored.body);
  const actual = releaseObjectIdentity(bytes);
  if (
    actual.bytes !== reference.bytes ||
    actual.sha256 !== reference.sha256
  ) {
    throw new TypeError(
      `Deployment object ${reference.key} is corrupt.`,
    );
  }
  return bytes;
}
