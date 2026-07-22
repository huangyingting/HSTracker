export const WORKSPACE_ROUTE_FAMILIES = [
  "primary-scope",
  "primary-opportunities",
  "primary-market-analysis",
  "advanced-trade-trend",
  "advanced-supplier-competition",
  "advanced-trade-explorer",
] as const;

export type WorkspaceRouteFamily = (typeof WORKSPACE_ROUTE_FAMILIES)[number];

export function isWorkspaceRouteFamily(
  value: unknown,
): value is WorkspaceRouteFamily {
  return (
    typeof value === "string" &&
    WORKSPACE_ROUTE_FAMILIES.some((routeFamily) => routeFamily === value)
  );
}
