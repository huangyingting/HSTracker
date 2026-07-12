import { createHash } from "node:crypto";

import type {
  ReleaseObject,
  ReleaseObjectIdentity,
  ReleaseObjectStore,
} from "./release-object-store";

type StoredObject = {
  bytes: Buffer;
  version: string;
};

export class InMemoryReleaseObjectStore implements ReleaseObjectStore {
  private readonly objects = new Map<string, StoredObject>();
  private version = 0;

  async getObject(key: string): Promise<ReleaseObject | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    const bytes = Buffer.from(stored.bytes);
    return {
      body: oneChunk(bytes),
      version: stored.version,
    };
  }

  async putImmutable(
    key: string,
    body: AsyncIterable<Uint8Array>,
    identity: ReleaseObjectIdentity,
  ): Promise<void> {
    const bytes = await collect(body);
    verifyIdentity(bytes, identity);
    const existing = this.objects.get(key);
    if (existing !== undefined) {
      if (!existing.bytes.equals(bytes)) {
        throw new Error(`Immutable release object ${key} already differs.`);
      }
      return;
    }
    this.objects.set(key, {
      bytes,
      version: this.nextVersion(),
    });
  }

  async compareAndSwap(
    key: string,
    expectedVersion: string | null,
    body: Uint8Array,
  ): Promise<string> {
    const existing = this.objects.get(key);
    if ((existing?.version ?? null) !== expectedVersion) {
      throw new Error(`Release pointer ${key} changed concurrently.`);
    }
    const version = this.nextVersion();
    this.objects.set(key, {
      bytes: Buffer.from(body),
      version,
    });
    return version;
  }

  private nextVersion(): string {
    this.version += 1;
    return `memory-version-${this.version}`;
  }
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function* oneChunk(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}

function verifyIdentity(
  bytes: Buffer,
  identity: ReleaseObjectIdentity,
): void {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new Error("Release object bytes do not match their identity.");
  }
}
