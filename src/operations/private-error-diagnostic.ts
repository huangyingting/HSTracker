export type PrivateErrorDiagnostic = {
  name: string;
  message: string;
};

export function privateErrorDiagnostic(
  error: unknown,
): PrivateErrorDiagnostic {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}
