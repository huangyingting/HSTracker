export function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

export function count(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

export function sha256String(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return candidate;
}

export function hs12(value: unknown, label: string): "HS12" {
  if (value !== "HS12") {
    throw new Error(`${label} must be HS12.`);
  }
  return value;
}

export function prefixedId(
  value: unknown,
  label: string,
  prefix: string,
): string {
  const candidate = string(value, label);
  if (!new RegExp(`^${prefix}-[a-f0-9]{16}$`, "u").test(candidate)) {
    throw new Error(`${label} is malformed.`);
  }
  return candidate;
}

export function utcTimestamp(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(candidate) ||
    Number.isNaN(Date.parse(candidate))
  ) {
    throw new Error(`${label} must be a UTC timestamp without fractions.`);
  }
  return candidate;
}
