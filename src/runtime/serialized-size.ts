export const CACHE_ENTRY_OVERHEAD_BYTES = 1_024;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializedBytes(value: unknown): number {
  const serialized: string | undefined = JSON.stringify(value);
  return serialized === undefined ? 0 : utf8ByteLength(serialized);
}

export function serializedWeight(value: unknown): number {
  return serializedBytes(value) + CACHE_ENTRY_OVERHEAD_BYTES;
}
