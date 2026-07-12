const ERROR_BRAND_NAMESPACE = "hs-tracker.error";

export function brandCrossBundleError(error: Error, brand: string): void {
  Object.defineProperty(
    error,
    Symbol.for(`${ERROR_BRAND_NAMESPACE}.${brand}`),
    { value: true },
  );
}

export function hasCrossBundleErrorBrand<T extends Error>(
  value: unknown,
  brand: string,
): value is T {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(
      value,
      Symbol.for(`${ERROR_BRAND_NAMESPACE}.${brand}`),
    ) === true
  );
}
