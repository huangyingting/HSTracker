import { gzipSync } from "node:zlib";

export function withoutResponseBody(response: Response): Response {
  if (response.body === null) {
    return response;
  }
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Responses below this size gzip to roughly their own length (or larger once
// the gzip envelope is added), so compressing them wastes CPU for no transfer
// win. The candidate/opportunity evidence payloads that motivate compression
// are hundreds of kilobytes and clear this threshold comfortably.
const MINIMUM_GZIP_BYTES = 1024;

function requestAcceptsGzip(request: Request): boolean {
  const header = request.headers.get("accept-encoding");
  if (header === null) {
    return false;
  }
  return header
    .split(",")
    .some((token) => token.trim().split(";")[0].toLowerCase() === "gzip");
}

/**
 * Gzip a response body on the wire when the caller advertised `gzip` support.
 *
 * The local single-host deployment (ADR-0004) serves the app directly with no
 * TLS/compression proxy in front, and Next.js does not compress dynamic route
 * handler responses. Every evidence route already declares
 * `Vary: Accept-Encoding` and the promotion budgets assume compressed transfer
 * sizes, so the encoding is applied here at the app layer. Callers that do not
 * negotiate gzip (including direct route-handler tests) receive the response
 * unchanged.
 */
export async function gzipResponseWhenRequested(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!requestAcceptsGzip(request)) {
    return response;
  }
  if (
    response.body === null ||
    response.headers.has("content-encoding") ||
    response.status === 204 ||
    response.status === 304
  ) {
    return response;
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length < MINIMUM_GZIP_BYTES) {
    return new Response(raw, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const compressed = gzipSync(raw);
  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.set("Content-Length", String(compressed.length));
  const vary = headers.get("Vary");
  if (vary === null) {
    headers.set("Vary", "Accept-Encoding");
  } else if (!/(^|,)\s*accept-encoding\s*($|,)/iu.test(vary)) {
    headers.set("Vary", `${vary}, Accept-Encoding`);
  }
  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
