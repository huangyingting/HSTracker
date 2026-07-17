import { createHash } from "node:crypto";

import { executeOpportunityDetailV1 } from "../../../../../../../../domain/trade-analytics/opportunity-detail-v1-adapter";
import {
  invalidOpportunityQuery,
  isOpportunityDiscoveryAnalysisError,
} from "../../../../../../../../domain/opportunity-discovery/errors";
import { createAnonymousSourceHttpAdapter } from "../../../../../../../../http/anonymous-source-adapter";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../../../operations/structured-log";
import { isAnalysisCapacityExceededError } from "../../../../../../../../runtime/analysis-capacity-error";
import { isAnalysisBudgetExceededError } from "../../../../../../../../runtime/analysis-budget-error";
import { isAnalysisRateLimitedError } from "../../../../../../../../runtime/analysis-rate-limit-error";
import { ROUTE_DEADLINE_MS } from "../../../../../../../../runtime/request-deadline";
import { RUNTIME_RESOURCE_POLICY } from "../../../../../../../../runtime-resource-policy";
import { runtimeProbeCachePartition } from "../../../../../../../../runtime/runtime-metrics";
import { utf8ByteLength } from "../../../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpportunityDetailRouteContext = {
  params: Promise<{
    analysisBuildId: string;
    productCode: string;
    importerCode: string;
  }>;
};

export async function GET(
  request: Request,
  context: OpportunityDetailRouteContext,
): Promise<Response> {
  return opportunityDetailRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: OpportunityDetailRouteContext,
): Promise<Response> {
  return opportunityDetailRoute.head(request, context);
}

const opportunityDetailRoute =
  createMeasuredRuntimeRoute<OpportunityDetailRouteContext>({
    routeFamily: "opportunity-detail",
    deadlineMs: ROUTE_DEADLINE_MS.opportunityDetail,
    async respond({ request, context, runtime, signal, measurement }) {
      const url = new URL(request.url);
      validateSearchParameters(url.searchParams);
      const { analysisBuildId, productCode, importerCode } =
        await context.params;
      const detail = await executeOpportunityDetailV1(
        runtime.tradeAnalytics,
        {
          analysisBuildId,
          exportEconomyCode: url.searchParams.get("exporter") ?? "",
          productCode,
          marketCode: importerCode,
        },
        {
          signal,
          observe: measurement.observeOperation,
          cachePartitionKey: runtimeProbeCachePartition(request),
          ...anonymousSourceAdapter.executionOptions(request),
        },
      );
      const body = measurement.measureSerialization(
        () => JSON.stringify(detail),
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

      return new Response(body, { status: 200, headers });
    },
    errorResponse(error, measurement) {
      if (isAnalysisCapacityExceededError(error)) {
        return jsonErrorResponseFor(error, undefined, {
          "Retry-After": String(error.retryAfterSeconds),
        });
      }
      if (isAnalysisRateLimitedError(error)) {
        return jsonErrorResponseFor(error, undefined, {
          "Retry-After": String(error.retryAfterSeconds),
        });
      }
      if (isAnalysisBudgetExceededError(error)) {
        return jsonErrorResponseFor(error);
      }
      if (isOpportunityDiscoveryAnalysisError(error)) {
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }

      const correlationId = measurement.correlationId;
      writeStructuredErrorLog(
        "opportunity-detail-analysis-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Opportunity Detail analysis could not be completed.",
        correlationId,
      );
    },
  });

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

const ALLOWED_PARAMETERS = new Set(["exporter"]);

function validateSearchParameters(searchParameters: URLSearchParams): void {
  if (searchParameters.getAll("exporter").length !== 1) {
    throw invalidOpportunityQuery(
      "The route requires exactly one exporter parameter.",
    );
  }
  for (const key of searchParameters.keys()) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw invalidOpportunityQuery(`Unsupported query parameter: ${key}.`);
    }
  }
}
