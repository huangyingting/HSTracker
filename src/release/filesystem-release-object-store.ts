import { createReadStream } from "node:fs";
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  ReleasePointerConflictError,
  streamReleaseObjectIdentity,
  type ReleaseObject,
  type ReleaseObjectIdentity,
  type ReleaseObjectReadOptions,
  type ReleaseObjectReader,
  type ReleaseObjectStore,
} from "./release-object-store";

export type FilesystemReleaseObjectLocation = {
  directory: string;
};

export class FilesystemReleaseObjectStoreError extends Error {
  readonly code = "ENVIRONMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "FilesystemReleaseObjectStoreError";
  }
}

/**
 * Reads release objects from a local directory that acts as the private
 * release bucket for the local single-host deployment profile (ADR-0004). The
 * runtime is given this reader, which exposes no write methods, so the serving
 * process cannot mutate the release store.
 */
export class FilesystemReleaseObjectReader implements ReleaseObjectReader {
  protected readonly directory: string;

  constructor(location: FilesystemReleaseObjectLocation) {
    if (!isAbsolute(location.directory)) {
      throw new FilesystemReleaseObjectStoreError(
        "Filesystem release object store directory must be absolute.",
      );
    }
    this.directory = resolve(location.directory);
  }

  async getObject(
    key: string,
    options: ReleaseObjectReadOptions = {},
  ): Promise<ReleaseObject | null> {
    const path = this.resolveKey(key);
    const version = await objectVersion(path);
    if (version === null) {
      return null;
    }
    return {
      body: createReadStream(path, { signal: options.signal }),
      version,
    };
  }

  protected resolveKey(key: string): string {
    const path = resolve(this.directory, key);
    const relativePath = relative(this.directory, path);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new FilesystemReleaseObjectStoreError(
        `Release object key ${key} escapes the store directory.`,
      );
    }
    return path;
  }
}

/**
 * Adds immutable-object and compare-and-swap writes for local promotion and
 * rollback. Writes are atomic (temp file plus rename on the same filesystem),
 * and the single-host deployment runs at most one promotion process at a time.
 */
export class FilesystemReleaseObjectStore
  extends FilesystemReleaseObjectReader
  implements ReleaseObjectStore
{
  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    const path = this.resolveKey(key);
    const existing = await existingIdentity(path);
    if (existing !== null) {
      if (existing.bytes === identity.bytes && existing.sha256 === identity.sha256) {
        return;
      }
      throw new FilesystemReleaseObjectStoreError(
        `Immutable release object ${key} already differs.`,
      );
    }
    const temporaryPath = await this.stream(path, body);
    try {
      const written = await existingIdentity(temporaryPath);
      if (
        written === null ||
        written.bytes !== identity.bytes ||
        written.sha256 !== identity.sha256
      ) {
        throw new FilesystemReleaseObjectStoreError(
          "Release object bytes do not match their identity.",
        );
      }
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string> {
    const path = this.resolveKey(key);
    const currentVersion = await objectVersion(path);
    if (currentVersion !== expectedVersion) {
      throw new ReleasePointerConflictError(key);
    }
    const temporaryPath = this.temporaryPath(path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, body);
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    const version = await objectVersion(path);
    if (version === null) {
      throw new FilesystemReleaseObjectStoreError(
        `Release pointer ${key} disappeared after write.`,
      );
    }
    return version;
  }

  private async stream(
    path: string,
    body: AsyncIterable<Uint8Array>,
  ): Promise<string> {
    const temporaryPath = this.temporaryPath(path);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(body, createWriteStream(temporaryPath));
    return temporaryPath;
  }

  private temporaryPath(path: string): string {
    return join(
      dirname(path),
      `.tmp-${randomBytes(12).toString("hex")}`,
    );
  }
}

async function objectVersion(path: string): Promise<string | null> {
  try {
    const stats = await stat(path, { bigint: true });
    return `${stats.size}-${stats.mtimeNs}`;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function existingIdentity(
  path: string,
): Promise<ReleaseObjectIdentity | null> {
  try {
    await stat(path);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
  return streamReleaseObjectIdentity(createReadStream(path));
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}
