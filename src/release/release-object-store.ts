import { createHash } from "node:crypto";

export type ReleaseObjectIdentity = {
  bytes: number;
  sha256: string;
};

export type ReleaseObject = {
  body: AsyncIterable<Uint8Array>;
  version: string;
};

export interface ReleaseObjectReader {
  getObject(key: string): Promise<ReleaseObject | null>;
}

export interface ReleaseObjectStore extends ReleaseObjectReader {
  putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void>;

  compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string>;
}

export function releaseObjectIdentity(
  bytes: Uint8Array,
): ReleaseObjectIdentity {
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function streamReleaseObjectIdentity(
  body: AsyncIterable<Uint8Array>,
): Promise<ReleaseObjectIdentity> {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest("hex") };
}

export async function* singleChunk(
  bytes: Uint8Array,
): AsyncIterable<Uint8Array> {
  yield bytes;
}
