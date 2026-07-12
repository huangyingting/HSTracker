import { S3Client } from "@aws-sdk/client-s3";

import type {
  ReleaseObjectReader,
  ReleaseObjectStore,
} from "./release-object-store";
import {
  S3ReleaseObjectReader,
  S3ReleaseObjectStore,
} from "./s3-release-object-store";

type Environment = Readonly<Record<string, string | undefined>>;
type CredentialScope = "READ" | "WRITE";

export class ReleaseObjectStorageConfigurationError extends Error {
  readonly code = "ENVIRONMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ReleaseObjectStorageConfigurationError";
  }
}

export function createRuntimeReleaseObjectReader(
  environment: Environment = process.env,
): ReleaseObjectReader {
  const { client, bucket } = createS3Connection(environment, "READ");
  return new S3ReleaseObjectReader(client, { bucket });
}

export function createPromotionReleaseObjectStore(
  environment: Environment = process.env,
): ReleaseObjectStore {
  const { client, bucket } = createS3Connection(environment, "WRITE");
  return new S3ReleaseObjectStore(client, { bucket });
}

function createS3Connection(
  environment: Environment,
  credentialScope: CredentialScope,
): { client: S3Client; bucket: string } {
  const bucket = required(
    environment.HS_TRACKER_RELEASE_S3_BUCKET,
    "HS_TRACKER_RELEASE_S3_BUCKET",
  );
  const region = required(
    environment.HS_TRACKER_RELEASE_S3_REGION,
    "HS_TRACKER_RELEASE_S3_REGION",
  );
  const endpoint = optional(
    environment.HS_TRACKER_RELEASE_S3_ENDPOINT,
    "HS_TRACKER_RELEASE_S3_ENDPOINT",
  );
  const forcePathStyle = optionalBoolean(
    environment.HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE,
    "HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE",
  );
  const credentials = scopedCredentials(environment, credentialScope);
  return {
    bucket,
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials,
    }),
  };
}

function scopedCredentials(
  environment: Environment,
  scope: CredentialScope,
):
  | {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | undefined {
  const accessKeyName =
    `HS_TRACKER_RELEASE_${scope}_ACCESS_KEY_ID` as const;
  const secretKeyName =
    `HS_TRACKER_RELEASE_${scope}_SECRET_ACCESS_KEY` as const;
  const sessionTokenName =
    `HS_TRACKER_RELEASE_${scope}_SESSION_TOKEN` as const;
  const accessKeyId = environment[accessKeyName];
  const secretAccessKey = environment[secretKeyName];
  const sessionToken = optional(environment[sessionTokenName], sessionTokenName);
  if (accessKeyId === undefined && secretAccessKey === undefined) {
    return undefined;
  }
  return {
    accessKeyId: required(accessKeyId, accessKeyName),
    secretAccessKey: required(secretAccessKey, secretKeyName),
    sessionToken,
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new ReleaseObjectStorageConfigurationError(
      `${name} is required.`,
    );
  }
  return value;
}

function optional(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === "") {
    throw new ReleaseObjectStorageConfigurationError(
      `${name} must be nonempty when set.`,
    );
  }
  return value;
}

function optionalBoolean(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new ReleaseObjectStorageConfigurationError(
    `${name} must be true or false.`,
  );
}
