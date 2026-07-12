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
