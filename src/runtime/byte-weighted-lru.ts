import {
  CACHE_ENTRY_OVERHEAD_BYTES,
  serializedWeight,
} from "./serialized-size";

type WeightedCacheEntry<Value> = {
  readonly value: Value;
  readonly weight: number;
};

export class ByteWeightedLru<Value> {
  private readonly entries = new Map<
    string,
    WeightedCacheEntry<Value>
  >();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  lookup(
    key: string,
  ): { readonly value: Value; readonly resultBytes: number } | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return {
      value: entry.value,
      resultBytes: entry.weight - CACHE_ENTRY_OVERHEAD_BYTES,
    };
  }

  set(
    key: string,
    value: Value,
    weight = serializedWeight(value),
  ): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.entries.delete(key);
      this.bytes -= existing.weight;
    }

    if (weight > this.maxBytes) {
      return;
    }

    while (
      this.bytes + weight > this.maxBytes &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      this.bytes -= oldest.weight;
    }

    this.entries.set(key, { value, weight });
    this.bytes += weight;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  resources(): { entries: number; bytes: number; maxBytes: number } {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
    };
  }
}
