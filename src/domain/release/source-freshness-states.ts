export const SOURCE_FRESHNESS_STATES = [
  "LATEST_KNOWN",
  "UPDATE_IN_PROGRESS",
  "REFRESH_DELAYED",
  "CHECK_OVERDUE",
] as const;

export type SourceFreshnessState = (typeof SOURCE_FRESHNESS_STATES)[number];
