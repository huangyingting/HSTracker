export type MeasurementClass = "candidate" | "local-smoke";

export function validateMeasurementOrigin(
  value: unknown,
  measurementClass: MeasurementClass,
  label: string,
  createError: (message: string) => Error,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw createError(`${label} must be a nonempty string.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw createError(`${label} must be an absolute URL.`);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw createError(`${label} must not embed credentials.`);
  }
  if (
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw createError(
      `${label} must not encode a cross-origin path, query, or fragment.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopbackAlias =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname === "::1" ||
    hostname === "[::1]";
  const isAdr0004Loopback =
    parsed.protocol === "http:" && hostname === "127.0.0.1";
  const isHostedHttps =
    parsed.protocol === "https:" && !isLoopbackAlias;
  if (
    measurementClass === "candidate" &&
    !isHostedHttps &&
    !isAdr0004Loopback
  ) {
    throw createError(
      `${label} for candidate evidence must use HTTPS or ADR-0004 loopback HTTP.`,
    );
  }
  if (measurementClass === "local-smoke" && !isAdr0004Loopback) {
    throw createError(
      `${label} for local-smoke evidence must use ADR-0004 loopback HTTP.`,
    );
  }

  return `${parsed.protocol}//${parsed.host}`;
}
