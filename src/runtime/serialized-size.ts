const CACHE_ENTRY_OVERHEAD_BYTES = 1_024;

export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function serializedWeight(value: unknown): number {
  return serializedBytes(value) + CACHE_ENTRY_OVERHEAD_BYTES;
}
