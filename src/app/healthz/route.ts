import { getApplicationRuntime } from "../../runtime/application-runtime";
import { jsonErrorResponseFor } from "../../http/json-error-response";
import {
  classifyRuntimeRequest,
  measureRuntimeRequestSync,
} from "../../runtime/runtime-metrics";
import { withoutResponseBody } from "../../http/response";
import {
  RequestDeadlineExceededError,
  ROUTE_DEADLINE_MS,
  createSynchronousRequestDeadline,
} from "../../runtime/request-deadline";
import { utf8ByteLength } from "../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request?: Request): Response {
  return respond(request, "GET");
}

export function HEAD(request?: Request): Response {
  return withoutResponseBody(respond(request, "HEAD"));
}

function respond(
  request: Request | undefined,
  method: "GET" | "HEAD",
): Response {
  const deadline = createSynchronousRequestDeadline(
    ROUTE_DEADLINE_MS.health,
  );
  const buildId = process.env.APP_BUILD_ID?.trim() || "development";
  const applicationRuntime = getApplicationRuntime();

  return measureRuntimeRequestSync(
    applicationRuntime,
    "health",
    classifyRuntimeRequest(request, method),
    (measurement) => {
      const health = applicationRuntime.health(buildId);
      const body = measurement.measureSerialization(
        () => JSON.stringify(health),
        utf8ByteLength,
      );
      if (deadline.hasElapsed()) {
        return jsonErrorResponseFor(
          new RequestDeadlineExceededError(),
        );
      }
      return new Response(body, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "X-HS-Tracker-Build-Id": buildId,
          "X-HS-Tracker-Machine-Class":
            process.env.HS_TRACKER_MACHINE_CLASS?.trim() || "local",
          "X-HS-Tracker-Machine-Id":
            process.env.FLY_MACHINE_ID?.trim() ||
            process.env.HS_TRACKER_MACHINE_ID?.trim() ||
            "local",
          "X-HS-Tracker-Region":
            process.env.FLY_REGION?.trim() ||
            process.env.HS_TRACKER_REGION?.trim() ||
            "loc",
        },
      });
    },
  );
}
