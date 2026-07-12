import { createHash } from "node:crypto";

import {
  invalidEconomyQuery,
  isEconomyDirectoryError,
} from "../../../../../../economy/economy-directory-errors";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import { jsonErrorResponse } from "../../../../../../http/json-error-response";
import { withoutResponseBody } from "../../../../../../http/response";
import {
  getApplicationRuntime,
  type ApplicationRuntime,
} from "../../../../../../runtime/application-runtime";
import {
  createRequestDeadline,
  isRequestDeadlineExceededError,
  ROUTE_DEADLINE_MS,
} from "../../../../../../runtime/request-deadline";
import {
  measureRuntimeRequest,
  type RuntimeRequestMeasurement,
} from "../../../../../../runtime/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";

type EconomyRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: EconomyRouteContext,
  headOnly: boolean,
): Promise<Response> {
  const applicationRuntime = getApplicationRuntime();
  return measureRuntimeRequest(
    applicationRuntime,
    "economy-search",
    async (measurement) => {
      const response = await respondMeasured(
        request,
        context,
        headOnly,
        applicationRuntime,
        measurement,
      );
      return headOnly ? withoutResponseBody(response) : response;
    },
  );
}

async function respondMeasured(
  request: Request,
  context: EconomyRouteContext,
  headOnly: boolean,
  applicationRuntime: ApplicationRuntime,
  measurement: RuntimeRequestMeasurement,
): Promise<Response> {
  const deadline = createRequestDeadline(
    request.signal,
    ROUTE_DEADLINE_MS.search,
  );
  try {
    const url = new URL(request.url);
    const query = parseSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    const result = await applicationRuntime.searchEconomies(
      {
        analysisBuildId,
        query,
        limit: 50,
      },
      {
        signal: deadline.signal,
        observe: measurement.observeOperation,
      },
    );
    const body = measurement.measureSerialization(
      () => JSON.stringify(result),
      (serialized) => new TextEncoder().encode(serialized).byteLength,
    );
    const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(headOnly ? null : body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (isRequestDeadlineExceededError(error)) {
      return jsonErrorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }
    if (isEconomyDirectoryError(error)) {
      return jsonErrorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = measurement.correlationId;
    console.error("Economy Directory request failed", {
      correlationId,
      error,
    });
    return jsonErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Economy search could not be completed.",
      correlationId,
    );
  } finally {
    deadline.dispose();
  }
}

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
