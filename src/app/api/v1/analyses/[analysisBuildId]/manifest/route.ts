import { createHash } from "node:crypto";

import { currentManifestCacheControl } from "../../../../../../domain/release/current-analysis";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../http/json-error-response";
import { withoutResponseBody } from "../../../../../../http/response";
import { getApplicationRuntime } from "../../../../../../runtime/application-runtime";
import {
  RequestDeadlineExceededError,
  ROUTE_DEADLINE_MS,
  createSynchronousRequestDeadline,
} from "../../../../../../runtime/request-deadline";
import {
  classifyRuntimeRequest,
  measureRuntimeRequestSync,
} from "../../../../../../runtime/runtime-metrics";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ analysisBuildId: string }> },
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ analysisBuildId: string }> },
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: { params: Promise<{ analysisBuildId: string }> },
  headOnly: boolean,
): Promise<Response> {
  const { analysisBuildId } = await context.params;
  const applicationRuntime = getApplicationRuntime();
  const deadline = createSynchronousRequestDeadline(
    ROUTE_DEADLINE_MS.currentAnalysis,
  );
  const response = measureRuntimeRequestSync(
    applicationRuntime,
    "current-analysis",
    classifyRuntimeRequest(request, headOnly ? "HEAD" : "GET"),
    (measurement) => {
      const current = applicationRuntime.currentAnalysisSnapshot();
      const manifest =
        analysisBuildId === current.manifest.analysisBuildId
          ? current.manifest
          : applicationRuntime.resolveAnalysisManifest(analysisBuildId);
      if (manifest === null) {
        return jsonErrorResponse(
          410,
          "ANALYSIS_BUILD_RETIRED",
          `Analysis build ${analysisBuildId} is no longer retained.`,
        );
      }

      const body = measurement.measureSerialization(
        () => JSON.stringify(manifest),
        utf8ByteLength,
      );
      const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
      const headers = {
        // A retained build is immutable, but its manifest advertises the
        // active retention window, which changes only on controlled
        // deployment. Revalidate it on the same cadence as current.
        "Cache-Control": currentManifestCacheControl(
          current.manifest.freshness,
          current.asOf,
        ),
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
      };
      if (deadline.hasElapsed()) {
        return jsonErrorResponseFor(new RequestDeadlineExceededError());
      }
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(body, { status: 200, headers });
    },
  );
  return headOnly ? withoutResponseBody(response) : response;
}
