import { createHash } from "node:crypto";

import {
  invalidAnalysisQuery,
  isCandidateMarketAnalysisError,
} from "../../../../../../domain/candidate-market/errors";
import { executeCandidateMarketV1 } from "../../../../../../domain/trade-analytics/candidate-market-v1-adapter";
import { createAnonymousSourceHttpAdapter } from "../../../../../../http/anonymous-source-adapter";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import { isAnalysisCapacityExceededError } from "../../../../../../runtime/analysis-capacity-error";
import { isAnalysisBudgetExceededError } from "../../../../../../runtime/analysis-budget-error";
import { isAnalysisRateLimitedError } from "../../../../../../runtime/analysis-rate-limit-error";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { RUNTIME_RESOURCE_POLICY } from "../../../../../../runtime-resource-policy";
import { runtimeProbeCachePartition } from "../../../../../../runtime/runtime-metrics";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CandidateMarketRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return candidateMarketRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return candidateMarketRoute.head(request, context);
}

const candidateMarketRoute =
  createMeasuredRuntimeRoute<CandidateMarketRouteContext>({
    routeFamily: "candidate-market",
    deadlineMs: ROUTE_DEADLINE_MS.candidateMarket,
    async respond({
      request,
      context,
      runtime,
      signal,
      measurement,
    }) {
      const url = new URL(request.url);
      validateSearchParameters(url.searchParams);
      const { analysisBuildId } = await context.params;
      const result = await executeCandidateMarketV1(
        runtime.tradeAnalytics,
        {
          analysisBuildId,
          exporterCode: url.searchParams.get("exporter") ?? "",
          productCode: url.searchParams.get("product") ?? "",
        },
        {
          signal,
          observe: measurement.observeOperation,
          cachePartitionKey: runtimeProbeCachePartition(request),
          ...anonymousSourceAdapter.executionOptions(request),
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
    errorResponse(error, measurement) {
      if (isAnalysisCapacityExceededError(error)) {
        return jsonErrorResponseFor(
          error,
          undefined,
          { "Retry-After": String(error.retryAfterSeconds) },
        );
      }
      if (isAnalysisRateLimitedError(error)) {
        return jsonErrorResponseFor(
          error,
          undefined,
          { "Retry-After": String(error.retryAfterSeconds) },
        );
      }
      if (isAnalysisBudgetExceededError(error)) {
        return jsonErrorResponseFor(error);
      }
      if (isCandidateMarketAnalysisError(error)) {
        return jsonErrorResponse(
          error.status,
          error.code,
          error.publicMessage,
        );
      }

      const correlationId = measurement.correlationId;
      writeStructuredErrorLog(
        "candidate-market-analysis-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Candidate Market analysis could not be completed.",
        correlationId,
      );
    },
  });

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

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
