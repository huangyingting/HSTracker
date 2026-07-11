export type EconomyDirectoryErrorCode =
  | "INVALID_ECONOMY_QUERY"
  | "ANALYSIS_BUILD_RETIRED"
  | "ANALYSIS_UNAVAILABLE";

export class EconomyDirectoryError extends Error {
  constructor(
    readonly code: EconomyDirectoryErrorCode,
    readonly status: 400 | 410 | 503,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "EconomyDirectoryError";
  }
}

export function invalidEconomyQuery(message: string) {
  return new EconomyDirectoryError(
    "INVALID_ECONOMY_QUERY",
    400,
    message,
    "The economy search query is invalid.",
  );
}

export function retiredEconomyDirectory(id: string) {
  return new EconomyDirectoryError(
    "ANALYSIS_BUILD_RETIRED",
    410,
    `Analysis build ${id} is no longer served.`,
    "The requested analysis build is no longer served.",
  );
}

export function unavailableEconomyDirectory(id: string) {
  return new EconomyDirectoryError(
    "ANALYSIS_UNAVAILABLE",
    503,
    `Economy directory for analysis build ${id} is unavailable.`,
    "Economy search is temporarily unavailable.",
  );
}
