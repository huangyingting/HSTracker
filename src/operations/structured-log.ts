import { currentUtcSecond } from "./utc-clock";
import { privateErrorDiagnostic } from "./private-error-diagnostic";

export type StructuredLogLevel = "info" | "warn" | "error";

export function writeStructuredLog(
  level: StructuredLogLevel,
  event: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  const line = JSON.stringify({
    ...details,
    timestamp: currentUtcSecond(),
    level,
    event,
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function writeStructuredErrorLog(
  event: string,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): void {
  writeStructuredLog("error", event, {
    ...details,
    error: privateErrorDiagnostic(error),
  });
}
