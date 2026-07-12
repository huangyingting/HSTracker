import { createHash } from "node:crypto";

import {
  currentManifestCacheControl,
} from "../../../../../domain/release/current-analysis";
import { getApplicationRuntime } from "../../../../../runtime/application-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return respond(request, false);
}

export async function HEAD(request: Request): Promise<Response> {
  return respond(request, true);
}

function respond(request: Request, headOnly: boolean): Response {
  const { manifest, asOf } =
    getApplicationRuntime().currentAnalysisSnapshot();
  const body = JSON.stringify(manifest);
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

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(headOnly ? null : body, { status: 200, headers });
}
