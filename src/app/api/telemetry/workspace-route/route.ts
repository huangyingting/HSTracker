import { jsonErrorResponse } from "../../../../http/json-error-response";
import { runtimeMetricRegistry } from "../../../../operations/runtime-prometheus-metrics";
import { isWorkspaceRouteFamily } from "../../../../domain/workspace-route-family";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return invalidTelemetryResponse();
    }
    throw error;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("routeFamily" in payload) ||
    !isWorkspaceRouteFamily(payload.routeFamily)
  ) {
    return invalidTelemetryResponse();
  }

  runtimeMetricRegistry().observeWorkspaceRouteView(payload.routeFamily);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalidTelemetryResponse(): Response {
  return jsonErrorResponse(
    400,
    "INVALID_WORKSPACE_ROUTE_TELEMETRY",
    "The request must contain one supported anonymous route family.",
  );
}
