import { createHash } from "node:crypto";

import {
  invalidAnalysisQuery,
  isCandidateMarketAnalysisError,
} from "../../../../../../domain/candidate-market/errors";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import { withoutResponseBody } from "../../../../../../http/response";
import { isAnalysisCapacityExceededError } from "../../../../../../runtime/analysis-capacity-error";
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

type CandidateMarketRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: CandidateMarketRouteContext,
  headOnly: boolean,
): Promise<Response> {
  const applicationRuntime = getApplicationRuntime();
  return measureRuntimeRequest(
    applicationRuntime,
    "candidate-market",
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
  context: CandidateMarketRouteContext,
  headOnly: boolean,
  applicationRuntime: ApplicationRuntime,
  measurement: RuntimeRequestMeasurement,
): Promise<Response> {
  const deadline = createRequestDeadline(
    request.signal,
    ROUTE_DEADLINE_MS.candidateMarket,
  );
  try {
    const url = new URL(request.url);
    validateSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    const result = await applicationRuntime.analyze(
      {
        analysisBuildId,
        exporterCode: url.searchParams.get("exporter") ?? "",
        productCode: url.searchParams.get("product") ?? "",
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
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }
    if (isAnalysisCapacityExceededError(error)) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
        undefined,
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    }
    if (isCandidateMarketAnalysisError(error)) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = measurement.correlationId;
    console.error("Candidate Market analysis request failed", {
      correlationId,
      error,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Candidate Market analysis could not be completed.",
      correlationId,
    );
  } finally {
    deadline.dispose();
  }
}

function validateSearchParameters(searchParameters: URLSearchParams) {
  const keys = [...searchParameters.keys()];
  if (
    keys.length !== 2 ||
    searchParameters.getAll("exporter").length !== 1 ||
    searchParameters.getAll("product").length !== 1 ||
    keys.some((key) => key !== "exporter" && key !== "product")
  ) {
    throw invalidAnalysisQuery(
      "The route accepts exactly one exporter and one product parameter.",
    );
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId?: string,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        ...(correlationId === undefined ? {} : { correlationId }),
      },
    }),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ...additionalHeaders,
      },
    },
  );
}
