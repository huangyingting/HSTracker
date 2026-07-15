import { isProductCatalogError } from "../../../../../../catalog/product-catalog-errors";
import type { ProductSearchProduct } from "../../../../../../catalog/product-catalog";
import {
  invalidTradeTrendQuery,
  isTradeTrendAnalysisError,
} from "../../../../../../domain/trade-trend/errors";
import { executeTradeTrendV1 } from "../../../../../../domain/trade-analytics/trade-trend-v1-adapter";
import {
  TRADE_TRENDS_CSV_SCHEMA_VERSION,
  TradeTrendCsvRepresentationError,
  serializeTradeTrendCsv,
} from "../../../../../../export/trade-trend-csv";
import type { TradeTrendCsvIdentity } from "../../../../../../export/trade-trend-csv-contract";
import { createAnonymousSourceHttpAdapter } from "../../../../../../http/anonymous-source-adapter";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import {
  jsonErrorResponse,
  jsonErrorResponseFor,
} from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import type { ApplicationRuntime } from "../../../../../../runtime/application-runtime";
import { isAnalysisCapacityExceededError } from "../../../../../../runtime/analysis-capacity-error";
import { isAnalysisBudgetExceededError } from "../../../../../../runtime/analysis-budget-error";
import { isAnalysisRateLimitedError } from "../../../../../../runtime/analysis-rate-limit-error";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { RUNTIME_RESOURCE_POLICY } from "../../../../../../runtime-resource-policy";
import { runtimeProbeCachePartition } from "../../../../../../runtime/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_SEARCH_PARAMETERS = [
  "importer",
  "product",
  "productSearchBuildId",
  "freshnessStatusId",
  "schema",
] as const;

type TradeTrendExportRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

class TradeTrendExportRouteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 410 | 503,
    readonly code: string,
    readonly publicMessage: string,
    message: string,
  ) {
    super(message);
    this.name = "TradeTrendExportRouteError";
  }
}

export async function GET(
  request: Request,
  context: TradeTrendExportRouteContext,
): Promise<Response> {
  return tradeTrendCsvRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: TradeTrendExportRouteContext,
): Promise<Response> {
  return tradeTrendCsvRoute.head(request, context);
}

const tradeTrendCsvRoute =
  createMeasuredRuntimeRoute<TradeTrendExportRouteContext>({
    routeFamily: "trade-trend-csv",
    deadlineMs: ROUTE_DEADLINE_MS.tradeTrendCsv,
    async respond({
      request,
      context,
      runtime,
      signal,
      measurement,
    }) {
      const url = new URL(request.url);
      const parsedIdentity = validateSearchParameters(
        url.searchParams,
      );
      const { analysisBuildId } = await context.params;
      validateIdentifier(analysisBuildId, "analysis build");
      const identity: TradeTrendCsvIdentity = {
        analysisBuildId,
        ...parsedIdentity,
      };

      // Resolves this exact analysisBuildId's own manifest when it is
      // current or a retained predecessor, falling back to current's
      // manifest only for an analysisBuildId the manifest layer does not
      // recognize; the execution result's own analysisBuildId is what
      // actually decides compatibility below (see issue #44).
      const manifest =
        runtime.resolveAnalysisManifest(identity.analysisBuildId) ??
        runtime.currentAnalysis();
      if (
        identity.productSearchBuildId !==
        manifest.productSearchBuildId
      ) {
        throw new TradeTrendExportRouteError(
          410,
          "PRODUCT_SEARCH_BUILD_RETIRED",
          "The requested product-search build is no longer served.",
          `Product-search build ${identity.productSearchBuildId} is not served.`,
        );
      }
      const freshness = runtime.resolveFreshnessStatus(
        identity.freshnessStatusId,
      );
      if (freshness === null) {
        throw new TradeTrendExportRouteError(
          404,
          "FRESHNESS_STATUS_NOT_FOUND",
          "The requested freshness status is not available.",
          `Freshness status ${identity.freshnessStatusId} is not served.`,
        );
      }

      const result = await executeTradeTrendV1(
        runtime.tradeAnalytics,
        {
          analysisBuildId: identity.analysisBuildId,
          importerCode: identity.importerCode,
          productCode: identity.productCode,
        },
        {
          signal,
          observe: measurement.observeOperation,
          cachePartitionKey: runtimeProbeCachePartition(request),
          ...anonymousSourceAdapter.executionOptions(request),
        },
      );
      if (result.analysisBuildId !== manifest.analysisBuildId) {
        throw new TradeTrendExportRouteError(
          409,
          "INCOMPATIBLE_PRODUCT_SEARCH_BUILD",
          "The product-search build is not compatible with the analysis build.",
          `Product-search build ${identity.productSearchBuildId} is not bound to analysis build ${analysisBuildId}.`,
        );
      }
      if (
        freshness.servedBaciRelease !==
        result.provenance.baciRelease
      ) {
        throw new TradeTrendExportRouteError(
          409,
          "INCOMPATIBLE_FRESHNESS_STATUS",
          "The freshness status is not compatible with the analysis release.",
          `Freshness status ${identity.freshnessStatusId} does not describe ${result.provenance.baciRelease}.`,
        );
      }

      const product = await findExactProduct(
        runtime,
        identity.productSearchBuildId,
        identity.productCode,
        signal,
      );
      const exported = measurement.measureSerialization(
        () =>
          serializeTradeTrendCsv({
            result,
            product,
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

      if (
        matchesIfNoneMatch(request.headers.get("if-none-match"), etag)
      ) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(exported.bytes, {
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
      if (error instanceof TradeTrendExportRouteError) {
        return jsonErrorResponse(
          error.status,
          error.code,
          error.publicMessage,
        );
      }
      if (isTradeTrendAnalysisError(error)) {
        return jsonErrorResponse(error.status, error.code, error.publicMessage);
      }
      if (isProductCatalogError(error)) {
        return jsonErrorResponse(
          error.status,
          error.code,
          error.publicMessage,
        );
      }
      if (error instanceof TradeTrendCsvRepresentationError) {
        return jsonErrorResponse(
          503,
          error.code,
          "The complete Trade Trend export is temporarily unavailable.",
        );
      }

      const correlationId = measurement.correlationId;
      writeStructuredErrorLog(
        "trade-trend-csv-export-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Trade Trend export could not be completed.",
        correlationId,
      );
    },
  });

const anonymousSourceAdapter = createAnonymousSourceHttpAdapter({
  trustedProxy: RUNTIME_RESOURCE_POLICY.trustedProxy,
});

function validateSearchParameters(
  searchParameters: URLSearchParams,
): Omit<TradeTrendCsvIdentity, "analysisBuildId"> {
  const keys = [...searchParameters.keys()];
  if (
    keys.length !== REQUIRED_SEARCH_PARAMETERS.length ||
    REQUIRED_SEARCH_PARAMETERS.some(
      (key) => searchParameters.getAll(key).length !== 1,
    ) ||
    keys.some(
      (key) =>
        !REQUIRED_SEARCH_PARAMETERS.includes(
          key as (typeof REQUIRED_SEARCH_PARAMETERS)[number],
        ),
    )
  ) {
    throw invalidTradeTrendQuery(
      "The export route accepts exactly one value for each export identity.",
    );
  }

  const schema = searchParameters.get("schema")!;
  if (schema !== TRADE_TRENDS_CSV_SCHEMA_VERSION) {
    throw new TradeTrendExportRouteError(
      400,
      "UNSUPPORTED_EXPORT_SCHEMA",
      "The requested export schema is not supported.",
      `Export schema ${schema} is not supported.`,
    );
  }
  const importer = searchParameters.get("importer")!;
  const product = searchParameters.get("product")!;
  const productSearchBuildId = searchParameters.get("productSearchBuildId")!;
  const freshnessStatusId = searchParameters.get("freshnessStatusId")!;
  if (!/^\d{1,3}$/u.test(importer)) {
    throw invalidTradeTrendQuery("The importer must be a BACI economy code.");
  }
  if (!/^\d{6}$/u.test(product)) {
    throw invalidTradeTrendQuery("The product must be a six-digit HS12 code.");
  }
  validateIdentifier(productSearchBuildId, "product-search build");
  validateIdentifier(freshnessStatusId, "freshness status");

  return {
    importerCode: importer,
    productCode: product,
    productSearchBuildId,
    freshnessStatusId,
    schemaVersion: schema,
  };
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u.test(value)) {
    throw invalidTradeTrendQuery(`The ${name} identity is malformed.`);
  }
}

async function findExactProduct(
  runtime: ApplicationRuntime,
  productSearchBuildId: string,
  productCode: string,
  signal: AbortSignal,
): Promise<ProductSearchProduct> {
  const search = await runtime.searchProducts(
    {
      productSearchBuildId,
      query: productCode,
      locale: "en",
      limit: 1,
    },
    { signal },
  );
  const product = search.matches.find(
    (match) => match.product.code === productCode,
  )?.product;
  if (product === undefined) {
    throw new TradeTrendExportRouteError(
      503,
      "EXPORT_DEPENDENCY_INCOMPATIBLE",
      "The compatible product catalog is temporarily unavailable.",
      `Product ${productCode} is absent from its compatible product catalog.`,
    );
  }
  return product;
}
