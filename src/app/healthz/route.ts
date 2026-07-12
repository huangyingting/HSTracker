import { getApplicationRuntime } from "../../runtime/application-runtime";
import { jsonErrorResponseFor } from "../../http/json-error-response";
import { measureRuntimeRequestSync } from "../../runtime/runtime-metrics";
import { withoutResponseBody } from "../../http/response";
import {
  RequestDeadlineExceededError,
  ROUTE_DEADLINE_MS,
  createSynchronousRequestDeadline,
} from "../../runtime/request-deadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const deadline = createSynchronousRequestDeadline(
    ROUTE_DEADLINE_MS.health,
  );
  const buildId = process.env.APP_BUILD_ID?.trim() || "development";
  const applicationRuntime = getApplicationRuntime();

  return measureRuntimeRequestSync(
    applicationRuntime,
    "health",
    (measurement) => {
      const health = applicationRuntime.health(buildId);
      if (deadline.hasElapsed()) {
        return jsonErrorResponseFor(
          new RequestDeadlineExceededError(),
        );
      }
      const body = measurement.measureSerialization(
        () => JSON.stringify(health),
        (serialized) =>
          new TextEncoder().encode(serialized).byteLength,
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
        },
      });
    },
  );
}

export function HEAD(): Response {
  return withoutResponseBody(GET());
}
