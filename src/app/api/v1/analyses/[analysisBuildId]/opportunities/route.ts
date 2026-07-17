import { createHash } from "node:crypto";

import { executeOpportunityDiscoveryV1 } from "../../../../../../domain/trade-analytics/opportunity-discovery-v1-adapter";
import {
  invalidOpportunityQuery,
  isOpportunityDiscoveryAnalysisError,
} from "../../../../../../domain/opportunity-discovery/errors";
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

type OpportunitiesRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: OpportunitiesRouteContext,
): Promise<Response> {
  return opportunitiesRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: OpportunitiesRouteContext,
): Promise<Response> {
  return opportunitiesRoute.head(request, context);
}

const opportunitiesRoute = createMeasuredRuntimeRoute<OpportunitiesRouteContext>(
  {
    routeFamily: "opportunity-feed",
    deadlineMs: ROUTE_DEADLINE_MS.opportunityFeed,
    async respond({ request, context, runtime, signal, measurement }) {
      const url = new URL(request.url);
      validateSearchParameters(url.searchParams);
      const { analysisBuildId } = await context.params;
      const page = await executeOpportunityDiscoveryV1(
        runtime.tradeAnalytics,
        {
          analysisBuildId,
          exportEconomyCode: url.searchParams.get("exporter") ?? "",
          page: readPage(url.searchParams),
          productFilter: readProductFilter(url.searchParams),
        },
        {
          signal,
          observe: measurement.observeOperation,
          cachePartitionKey: runtimeProbeCachePartition(request),
          ...anonymousSourceAdapter.executionOptions(request),
        },
      );
      const body = measurement.measureSerialization(
        () => JSON.stringify(page),
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
        "opportunity-discovery-analysis-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Opportunity Discovery analysis could not be completed.",
        correlationId,
      );
    },
  },
);

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

const ALLOWED_PARAMETERS = new Set(["exporter", "limit", "cursor", "products"]);

function validateSearchParameters(searchParameters: URLSearchParams): void {
  const keys = [...searchParameters.keys()];
  if (searchParameters.getAll("exporter").length !== 1) {
    throw invalidOpportunityQuery(
      "The route requires exactly one exporter parameter.",
    );
  }
  for (const key of keys) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw invalidOpportunityQuery(`Unsupported query parameter: ${key}.`);
    }
    if (key !== "exporter" && searchParameters.getAll(key).length !== 1) {
      throw invalidOpportunityQuery(
        `The ${key} parameter may appear at most once.`,
      );
    }
  }
}

// Reads paging inputs verbatim; format validation (limit range, cursor
// non-emptiness) is enforced by the recipe request validator so the route
// never re-implements the contract. An absent `limit` uses the recipe default.
function readPage(
  searchParameters: URLSearchParams,
): { limit?: number; cursor?: string | null } | undefined {
  const limitParameter = searchParameters.get("limit");
  const cursorParameter = searchParameters.get("cursor");
  if (limitParameter === null && cursorParameter === null) {
    return undefined;
  }
  const page: { limit?: number; cursor?: string | null } = {};
  if (limitParameter !== null) {
    page.limit = Number(limitParameter);
  }
  if (cursorParameter !== null) {
    page.cursor = cursorParameter;
  }
  return page;
}

// A present `products` parameter is a comma-separated HS12 projection; its
// codes are validated by the recipe request validator.
function readProductFilter(
  searchParameters: URLSearchParams,
): { hsRevision: "HS12"; codes: readonly string[] } | undefined {
  const productsParameter = searchParameters.get("products");
  if (productsParameter === null) {
    return undefined;
  }
  return {
    hsRevision: "HS12",
    codes: productsParameter.split(","),
  };
}
