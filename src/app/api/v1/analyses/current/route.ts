import { createHash } from "node:crypto";

import {
  currentManifestCacheControl,
} from "../../../../../domain/release/current-analysis";
import { matchesIfNoneMatch } from "../../../../../http/conditional-request";
import { jsonErrorResponseFor } from "../../../../../http/json-error-response";
import { withoutResponseBody } from "../../../../../http/response";
import { getApplicationRuntime } from "../../../../../runtime/application-runtime";
import {
  RequestDeadlineExceededError,
  ROUTE_DEADLINE_MS,
  createSynchronousRequestDeadline,
} from "../../../../../runtime/request-deadline";
import { measureRuntimeRequestSync } from "../../../../../runtime/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return respond(request, false);
}

export async function HEAD(request: Request): Promise<Response> {
  return respond(request, true);
}

function respond(request: Request, headOnly: boolean): Response {
  const applicationRuntime = getApplicationRuntime();
  const deadline = createSynchronousRequestDeadline(
    ROUTE_DEADLINE_MS.currentAnalysis,
  );
  const response = measureRuntimeRequestSync(
    applicationRuntime,
    "current-analysis",
    (measurement) => {
      const { manifest, asOf } =
        applicationRuntime.currentAnalysisSnapshot();
      const body = measurement.measureSerialization(
        () => JSON.stringify(manifest),
        (serialized) =>
          new TextEncoder().encode(serialized).byteLength,
      );
      const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
      const headers = {
        "Cache-Control": currentManifestCacheControl(
          manifest.freshness,
          asOf,
        ),
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        Vary: "Accept-Encoding",
      };
      if (deadline.hasElapsed()) {
        return jsonErrorResponseFor(
          new RequestDeadlineExceededError(),
        );
      }

      if (
        matchesIfNoneMatch(request.headers.get("if-none-match"), etag)
      ) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(body, {
        status: 200,
        headers,
      });
    },
  );
  return headOnly ? withoutResponseBody(response) : response;
}
