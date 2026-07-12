import { createHash } from "node:crypto";

import {
  invalidEconomyQuery,
  isEconomyDirectoryError,
} from "../../../../../../economy/economy-directory-errors";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import { jsonErrorResponse } from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EconomyRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return economyRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return economyRoute.head(request, context);
}

const economyRoute = createMeasuredRuntimeRoute<EconomyRouteContext>({
  routeFamily: "economy-search",
  deadlineMs: ROUTE_DEADLINE_MS.search,
  async respond({ request, context, runtime, signal, measurement }) {
    const url = new URL(request.url);
    const query = parseSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    const result = await runtime.searchEconomies(
      {
        analysisBuildId,
        query,
        limit: 50,
      },
      {
        signal,
        observe: measurement.observeOperation,
      },
    );
    const body = measurement.measureSerialization(
      () => JSON.stringify(result),
      utf8ByteLength,
    );
    const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(body, {
      status: 200,
      headers,
    });
  },
  errorResponse(error, measurement) {
    if (isEconomyDirectoryError(error)) {
      return jsonErrorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = measurement.correlationId;
    writeStructuredErrorLog(
      "economy-directory-request-failed",
      error,
      {
      correlationId,
      },
    );
    return jsonErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Economy search could not be completed.",
      correlationId,
    );
  },
});

function parseSearchParameters(searchParameters: URLSearchParams): string {
  const keys = [...searchParameters.keys()];
  const query = searchParameters.get("q");
  if (
    keys.length !== 1 ||
    searchParameters.getAll("q").length !== 1 ||
    keys.some((key) => key !== "q") ||
    query === null
  ) {
    throw invalidEconomyQuery(
      "The route accepts exactly one q parameter.",
    );
  }
  return query;
}
