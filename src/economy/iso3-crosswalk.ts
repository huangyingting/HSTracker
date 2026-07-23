const ISO3_PATTERN = /^[A-Z]{3}$/u;
const SOURCE_SPECIAL_CODE_PATTERN = /^(?=[A-Z0-9]{3}$)(?=.*[0-9])/u;

export function readNullableIso3Crosswalk(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string or null.`);
  }
  if (ISO3_PATTERN.test(value)) {
    return value;
  }
  if (SOURCE_SPECIAL_CODE_PATTERN.test(value)) {
    return null;
  }
  throw new TypeError(`${label} is not an ISO3 crosswalk or source special code.`);
}
