import { getApplicationRuntime } from "../../runtime/application-runtime";
import { measureRuntimeRequestSync } from "../../runtime/runtime-metrics";
import { withoutResponseBody } from "../../http/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const buildId = process.env.APP_BUILD_ID?.trim() || "development";
  const applicationRuntime = getApplicationRuntime();

  return measureRuntimeRequestSync(
    applicationRuntime,
    "health",
    (measurement) => {
      const body = measurement.measureSerialization(
        () => JSON.stringify(applicationRuntime.health(buildId)),
        (serialized) =>
          new TextEncoder().encode(serialized).byteLength,
      );
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
