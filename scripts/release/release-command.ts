export class ReleaseCommandArgumentError extends Error {
  readonly code = "CLI_ARGUMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ReleaseCommandArgumentError";
  }
}

export function requiredOption(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new ReleaseCommandArgumentError(`--${name} is required.`);
  }
  return value;
}

export function writeReleaseCommandError(
  operation: string,
  error: unknown,
): void {
  const code =
    error instanceof ReleaseCommandArgumentError
      ? error.code
      : stringProperty(error, "code") ?? "RELEASE_COMMAND_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : `${operation} failed with an unknown error.`;
  process.stderr.write(
    `${JSON.stringify({ error: { code, message } })}\n`,
  );
  process.exitCode = 1;
}

function stringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}
