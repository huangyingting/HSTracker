import { createHash } from "node:crypto";

import { invalidAnalysisQuery, isCandidateMarketAnalysisError } from "../../../../../../domain/candidate-market/errors";
import { createMarketAnalysis } from "../../../../../../domain/market-analysis/market-analysis";
import { isMarketAnalysisAnalysisError } from "../../../../../../domain/market-analysis/errors";
import { isSupplierCompetitionAnalysisError } from "../../../../../../domain/supplier-competition/errors";
import { isTradeTrendAnalysisError } from "../../../../../../domain/trade-trend/errors";
import { createAnonymousSourceHttpAdapter } from "../../../../../../http/anonymous-source-adapter";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import { isAnalysisBudgetExceededError } from "../../../../../../runtime/analysis-budget-error";
import { isAnalysisCapacityExceededError } from "../../../../../../runtime/analysis-capacity-error";
import { isAnalysisRateLimitedError } from "../../../../../../runtime/analysis-rate-limit-error";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { RUNTIME_RESOURCE_POLICY } from "../../../../../../runtime-resource-policy";
import { runtimeProbeCachePartition } from "../../../../../../runtime/runtime-metrics";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketAnalysisRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: MarketAnalysisRouteContext,
): Promise<Response> {
  return marketAnalysisRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: MarketAnalysisRouteContext,
): Promise<Response> {
  return marketAnalysisRoute.head(request, context);
}

const marketAnalysisRoute =
  createMeasuredRuntimeRoute<MarketAnalysisRouteContext>({
    routeFamily: "market-analysis",
    deadlineMs: ROUTE_DEADLINE_MS.marketAnalysis,
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
      const marketAnalysis = createMarketAnalysis(runtime.tradeAnalytics);
      const result = await marketAnalysis.load(
        {
          analysisBuildId,
          exportEconomyCode: url.searchParams.get("exporter") ?? "",
          productCode: url.searchParams.get("product") ?? "",
          marketCode: url.searchParams.get("market") ?? "",
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
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(body, { status: 200, headers });
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
      if (isMarketAnalysisAnalysisError(error)) {
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }
      if (
        isCandidateMarketAnalysisError(error) ||
        isTradeTrendAnalysisError(error) ||
        isSupplierCompetitionAnalysisError(error)
      ) {
        // The Module always throws this shared code for the annual
        // provenance invariant (spec §5.5), whichever constituent recipe's
        // own error family happens to carry it, as well as for a genuine
        // constituent incompatible-package/temporary-unavailability
        // outcome. Log only the correlation-safe name/message every other
        // route already logs on 500 (`privateErrorDiagnostic`); those
        // strings never contain a Dataset Package, artifact, or Analysis
        // Identity -- only the already-public analysisBuildId from the URL.
        if (error.code === "ANALYSIS_UNAVAILABLE") {
          writeStructuredErrorLog(
            "market-analysis-annual-evidence-unavailable",
            error,
            { correlationId: measurement.correlationId },
          );
        }
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }

      const correlationId = measurement.correlationId;
      writeStructuredErrorLog(
        "market-analysis-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Market Analysis could not be completed.",
        correlationId,
      );
    },
  });

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

function validateSearchParameters(searchParameters: URLSearchParams): void {
  const keys = [...searchParameters.keys()];
  if (
    keys.length !== 3 ||
    searchParameters.getAll("exporter").length !== 1 ||
    searchParameters.getAll("product").length !== 1 ||
    searchParameters.getAll("market").length !== 1 ||
    keys.some(
      (key) => key !== "exporter" && key !== "product" && key !== "market",
    )
  ) {
    throw invalidAnalysisQuery(
      "The route accepts exactly one exporter, one product, and one market parameter.",
    );
  }
}
