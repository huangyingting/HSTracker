import {
  invalidTradeExplorerQuery,
  isTradeExplorerAnalysisError,
} from "../../../../../../domain/trade-explorer/errors";
import { executeTradeExplorerV1 } from "../../../../../../domain/trade-analytics/trade-explorer-v1-adapter";
import { decodeTradeExplorerQuery, type TradeExplorerQueryFields } from "../../../../../../domain/trade-analytics/trade-explorer-v1-query-codec";
import {
  TRADE_EXPLORERS_CSV_SCHEMA_VERSION,
  TradeExplorerCsvRepresentationError,
  serializeTradeExplorerCsv,
} from "../../../../../../export/trade-explorer-csv";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTRA_SEARCH_PARAMETERS = ["freshnessStatusId", "schema"] as const;

type TradeExplorerExportRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

class TradeExplorerExportRouteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 410 | 503,
    readonly code: string,
    readonly publicMessage: string,
    message: string,
  ) {
    super(message);
    this.name = "TradeExplorerExportRouteError";
  }
}

export async function GET(
  request: Request,
  context: TradeExplorerExportRouteContext,
): Promise<Response> {
  return tradeExplorerCsvRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: TradeExplorerExportRouteContext,
): Promise<Response> {
  return tradeExplorerCsvRoute.head(request, context);
}

const tradeExplorerCsvRoute =
  createMeasuredRuntimeRoute<TradeExplorerExportRouteContext>({
    routeFamily: "trade-explorer-csv",
    deadlineMs: ROUTE_DEADLINE_MS.tradeExplorerCsv,
    async respond({ request, context, runtime, signal, measurement }) {
      const url = new URL(request.url);
      const { query, freshnessStatusId } = parseSearchParameters(
        url.searchParams,
      );
      const { analysisBuildId } = await context.params;

      // Resolves this exact analysisBuildId's own manifest when it is
      // current or a retained predecessor, falling back to current's
      // manifest only for an analysisBuildId the manifest layer does not
      // recognize; the execution result's own analysisBuildId is what
      // actually decides compatibility below (see issue #44).
      const manifest =
        runtime.resolveAnalysisManifest(analysisBuildId) ??
        runtime.currentAnalysis();
      const freshness = runtime.resolveFreshnessStatus(freshnessStatusId);
      if (freshness === null) {
        throw new TradeExplorerExportRouteError(
          404,
          "FRESHNESS_STATUS_NOT_FOUND",
          "The requested freshness status is not available.",
          `Freshness status ${freshnessStatusId} is not served.`,
        );
      }

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
      if (result.analysisBuildId !== manifest.analysisBuildId) {
        throw new TradeExplorerExportRouteError(
          409,
          "INCOMPATIBLE_ANALYSIS_BUILD",
          "The analysis build is not compatible with the current or retained manifest.",
          `Analysis build ${analysisBuildId} does not match the resolved manifest.`,
        );
      }
      if (freshness.servedBaciRelease !== result.provenance.baciRelease) {
        throw new TradeExplorerExportRouteError(
          409,
          "INCOMPATIBLE_FRESHNESS_STATUS",
          "The freshness status is not compatible with the analysis release.",
          `Freshness status ${freshnessStatusId} does not describe ${result.provenance.baciRelease}.`,
        );
      }

      const exported = measurement.measureSerialization(
        () =>
          serializeTradeExplorerCsv({
            result,
            manifest: { ...manifest, freshness },
          }),
        (serialized) => serialized.bytes.byteLength,
      );
      const etag = `W/"sha256-${exported.sha256}"`;
      const headers = {
        "Cache-Control": IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Content-Type": "text/csv; charset=utf-8; header=present",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        Vary: "Accept-Encoding",
      };
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(exported.bytes, { status: 200, headers });
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
      if (error instanceof TradeExplorerExportRouteError) {
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }
      if (isTradeExplorerAnalysisError(error)) {
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }
      if (error instanceof TradeExplorerCsvRepresentationError) {
        return jsonErrorResponseFor(
          new AnalysisBudgetExceededError("EXPORT", "Trade Explorer"),
        );
      }
      const correlationId = measurement.correlationId;
      writeStructuredErrorLog("trade-explorer-csv-export-request-failed", error, {
        correlationId,
      });
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Trade Explorer export could not be completed.",
        correlationId,
      );
    },
  });

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

function parseSearchParameters(searchParameters: URLSearchParams): {
  query: TradeExplorerQueryFields;
  freshnessStatusId: string;
} {
  const schema = searchParameters.get("schema");
  if (schema !== TRADE_EXPLORERS_CSV_SCHEMA_VERSION) {
    throw new TradeExplorerExportRouteError(
      400,
      "UNSUPPORTED_EXPORT_SCHEMA",
      "The requested export schema is not supported.",
      `Export schema ${String(schema)} is not supported.`,
    );
  }
  const freshnessStatusId = searchParameters.get("freshnessStatusId");
  if (
    freshnessStatusId === null ||
    !/^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u.test(freshnessStatusId) ||
    searchParameters.getAll("freshnessStatusId").length !== 1 ||
    searchParameters.getAll("schema").length !== 1
  ) {
    throw invalidTradeExplorerQuery(
      "The export route requires exactly one freshnessStatusId and schema parameter.",
    );
  }

  const codecParameters = new URLSearchParams();
  for (const [key, value] of searchParameters) {
    if (!(EXTRA_SEARCH_PARAMETERS as readonly string[]).includes(key)) {
      codecParameters.append(key, value);
    }
  }
  const query = decodeTradeExplorerQuery(codecParameters);
  if (query === null) {
    throw invalidTradeExplorerQuery(
      "The export route accepts only its own named semantic query parameters plus freshnessStatusId and schema.",
    );
  }
  return { query, freshnessStatusId };
}
