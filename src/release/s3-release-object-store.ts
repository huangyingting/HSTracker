import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  streamReleaseObjectIdentity,
  type ReleaseObject,
  type ReleaseObjectIdentity,
  type ReleaseObjectReadOptions,
  type ReleaseObjectReader,
  type ReleaseObjectStore,
} from "./release-object-store";

export type S3ReleaseObjectLocation = {
  bucket: string;
};

export class S3ReleaseObjectReader implements ReleaseObjectReader {
  constructor(
    protected readonly client: S3Client,
    protected readonly location: S3ReleaseObjectLocation,
  ) {}

  async getObject(
    key: string,
    options: ReleaseObjectReadOptions = {},
  ): Promise<ReleaseObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.location.bucket,
          Key: key,
        }),
        { abortSignal: options.signal },
      );
      if (!(response.Body instanceof Readable)) {
        throw new Error(`S3 release object ${key} has no readable body.`);
      }
      if (response.ETag === undefined) {
        throw new Error(`S3 release object ${key} has no version.`);
      }
      return {
        body: response.Body,
        version: response.ETag,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
}

export class S3ReleaseObjectStore
  extends S3ReleaseObjectReader
  implements ReleaseObjectStore
{
  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    const existingMatches = await this.immutableObjectMatches(key, identity);
    if (existingMatches === true) {
      return;
    }
    if (existingMatches === false) {
      throw new Error(`Immutable release object ${key} already differs.`);
    }
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.location.bucket,
          Key: key,
          Body: Readable.from(body),
          ContentLength: identity.bytes,
          ChecksumSHA256: Buffer.from(identity.sha256, "hex").toString("base64"),
          IfNoneMatch: "*",
          Metadata: {
            bytes: String(identity.bytes),
            sha256: identity.sha256,
          },
        }),
      );
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        throw error;
      }
      if (await this.immutableObjectMatches(key, identity)) {
        return;
      }
      throw new Error(`Immutable release object ${key} already differs.`, {
        cause: error,
      });
    }
  }

  private async immutableObjectMatches(
    key: string,
    identity: ReleaseObjectIdentity,
  ): Promise<boolean | null> {
    try {
      const existing = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.location.bucket,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
      );
      if (existing.ContentLength !== identity.bytes) {
        return false;
      }
      const expectedChecksum = Buffer.from(
        identity.sha256,
        "hex",
      ).toString("base64");
      if (existing.ChecksumSHA256 !== undefined) {
        return existing.ChecksumSHA256 === expectedChecksum;
      }
      if (existing.Metadata?.sha256 === identity.sha256) {
        return true;
      }
      const stored = await this.getObject(key);
      return stored === null
        ? null
        : streamMatchesIdentity(stored.body, identity);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string> {
    try {
      const response = await this.client.send(
        new PutObjectCommand({
          Bucket: this.location.bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ChecksumSHA256: createSha256Checksum(body),
          ContentType: "application/json",
          IfMatch: expectedVersion ?? undefined,
          IfNoneMatch: expectedVersion === null ? "*" : undefined,
        }),
      );
      if (response.ETag === undefined) {
        throw new Error(`S3 release pointer ${key} has no version.`);
      }
      return response.ETag;
    } catch (error) {
      if (isConditionalWriteConflict(error)) {
        throw new Error(`Release pointer ${key} changed concurrently.`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    serviceErrorStatus(error) === 404 ||
    serviceErrorName(error) === "NoSuchKey" ||
    serviceErrorName(error) === "NotFound"
  );
}

function isPreconditionFailure(error: unknown): boolean {
  return (
    serviceErrorStatus(error) === 412 ||
    serviceErrorName(error) === "PreconditionFailed"
  );
}

function isConditionalWriteConflict(error: unknown): boolean {
  return (
    isPreconditionFailure(error) ||
    serviceErrorStatus(error) === 409 ||
    serviceErrorName(error) === "ConditionalRequestConflict"
  );
}

function createSha256Checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

async function streamMatchesIdentity(
  body: AsyncIterable<Uint8Array>,
  expected: ReleaseObjectIdentity,
): Promise<boolean> {
  const actual = await streamReleaseObjectIdentity(body);
  return (
    actual.bytes === expected.bytes &&
    actual.sha256 === expected.sha256
  );
}

function serviceErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const metadata = Reflect.get(error, "$metadata");
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const status = Reflect.get(metadata, "httpStatusCode");
  return typeof status === "number" ? status : undefined;
}

function serviceErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const name = Reflect.get(error, "name");
  return typeof name === "string" ? name : undefined;
}
