import { createHash } from "node:crypto";

import {
  invalidTradeExplorerQuery,
  isTradeExplorerAnalysisError,
} from "../../../../../../domain/trade-explorer/errors";
import { executeTradeExplorerV1 } from "../../../../../../domain/trade-analytics/trade-explorer-v1-adapter";
import {
  decodeTradeExplorerQuery,
  type TradeExplorerQueryFields,
} from "../../../../../../domain/trade-analytics/trade-explorer-v1-query-codec";
import { parseTradeExplorerRequestBody } from "../../../../../../domain/trade-analytics/trade-explorer-v1-request-body";
import { createAnonymousSourceHttpAdapter } from "../../../../../../http/anonymous-source-adapter";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import {
  AnalysisBudgetExceededError,
  isAnalysisBudgetExceededError,
} from "../../../../../../runtime/analysis-budget-error";
import { isAnalysisCapacityExceededError } from "../../../../../../runtime/analysis-capacity-error";
import { isAnalysisRateLimitedError } from "../../../../../../runtime/analysis-rate-limit-error";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { RUNTIME_RESOURCE_POLICY } from "../../../../../../runtime-resource-policy";
import { runtimeProbeCachePartition } from "../../../../../../runtime/runtime-metrics";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TradeExplorerRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

// POST carries the structured bounded query as a JSON body (the preferred
// shape for up to four filter dimensions, each up to 25 codes -- see
// issue #46). GET/HEAD instead decode the identical semantic query from
// explicit URL parameters (see trade-explorer-v1-query-codec.ts), which
// HEAD needs since a request carries no body for that method, and which
// keeps this analysis route's own caching/conditional-GET behavior
// consistent with every other analysis route.
export async function GET(
  request: Request,
  context: TradeExplorerRouteContext,
): Promise<Response> {
  return tradeExplorerRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: TradeExplorerRouteContext,
): Promise<Response> {
  return tradeExplorerRoute.head(request, context);
}

export async function POST(
  request: Request,
  context: TradeExplorerRouteContext,
): Promise<Response> {
  return tradeExplorerRoute.post(request, context);
}

const tradeExplorerRoute = createMeasuredRuntimeRoute<TradeExplorerRouteContext>({
  routeFamily: "trade-explorer",
  deadlineMs: ROUTE_DEADLINE_MS.tradeExplorer,
  async respond({ request, context, runtime, signal, measurement }) {
    const query = await queryFor(request, signal);
    const { analysisBuildId } = await context.params;
    const result = await executeTradeExplorerV1(
      runtime.tradeAnalytics,
      { analysisBuildId, ...query },
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
    const isBodyCarryingRequest = request.method === "POST";
    const headers = {
      "Cache-Control": isBodyCarryingRequest
        ? "no-store"
        : IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };
    if (
      !isBodyCarryingRequest &&
      matchesIfNoneMatch(request.headers.get("if-none-match"), etag)
    ) {
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
    if (isTradeExplorerAnalysisError(error)) {
      return jsonErrorResponse(error.status, error.code, error.publicMessage);
    }
    const correlationId = measurement.correlationId;
    writeStructuredErrorLog("trade-explorer-analysis-request-failed", error, {
      correlationId,
    });
    return jsonErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Trade Explorer analysis could not be completed.",
      correlationId,
    );
  },
});

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

async function queryFor(
  request: Request,
  signal: AbortSignal,
): Promise<TradeExplorerQueryFields> {
  if (request.method === "POST") {
    const json = await readBoundedJsonBody(request, signal);
    return parseTradeExplorerRequestBody(json);
  }
  const url = new URL(request.url);
  const decoded = decodeTradeExplorerQuery(url.searchParams);
  if (decoded === null) {
    throw invalidTradeExplorerQuery(
      "The route accepts only its own named semantic query parameters.",
    );
  }
  return decoded;
}

async function readBoundedJsonBody(
  request: Request,
  signal: AbortSignal,
): Promise<unknown> {
  const maximumBytes = RUNTIME_RESOURCE_POLICY.tradeExplorerRequestBodyMaxBytes;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw invalidTradeExplorerQuery(
        "The request Content-Length must be a non-negative integer.",
      );
    }
    if (bytes > maximumBytes) {
      throw new AnalysisBudgetExceededError(
        "INPUT_CARDINALITY",
        "Trade Explorer",
      );
    }
  }

  if (request.body === null) {
    throw invalidTradeExplorerQuery("The request body must be valid JSON.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  const cancelOnAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });

  try {
    if (signal.aborted) {
      void reader.cancel(signal.reason).catch(() => undefined);
      throw signal.reason;
    }
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw signal.reason;
      }
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        throw new AnalysisBudgetExceededError(
          "INPUT_CARDINALITY",
          "Trade Explorer",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    if (error instanceof AnalysisBudgetExceededError) {
      throw error;
    }
    throw invalidTradeExplorerQuery("The request body must be valid JSON.");
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidTradeExplorerQuery("The request body must be valid JSON.");
  }
}
