export type ValidationErrorFactory = (message: string) => Error;

export function record(
  value: unknown,
  label: string,
  error: ValidationErrorFactory,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function positiveSafeInteger(
  value: unknown,
  label: string,
  error: ValidationErrorFactory,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function nonnegativeSafeInteger(
  value: unknown,
  label: string,
  error: ValidationErrorFactory,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}
