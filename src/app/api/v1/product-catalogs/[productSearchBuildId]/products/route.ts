import { createHash } from "node:crypto";

import {
  invalidProductSearchQuery,
  isProductCatalogError,
} from "../../../../../../catalog/product-catalog-errors";
import type { ProductSearchLocale } from "../../../../../../catalog/product-catalog";
import { IMMUTABLE_VERSIONED_RESPONSE_CACHE_CONTROL } from "../../../../../../http/cache-policy";
import { matchesIfNoneMatch } from "../../../../../../http/conditional-request";
import { jsonErrorResponse } from "../../../../../../http/json-error-response";
import { createMeasuredRuntimeRoute } from "../../../../../../http/measured-runtime-route";
import { writeStructuredErrorLog } from "../../../../../../operations/structured-log";
import { ROUTE_DEADLINE_MS } from "../../../../../../runtime/request-deadline";
import { utf8ByteLength } from "../../../../../../runtime/serialized-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductCatalogRouteContext = {
  params: Promise<{
    productSearchBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: ProductCatalogRouteContext,
): Promise<Response> {
  return productCatalogRoute.get(request, context);
}

export async function HEAD(
  request: Request,
  context: ProductCatalogRouteContext,
): Promise<Response> {
  return productCatalogRoute.head(request, context);
}

const productCatalogRoute =
  createMeasuredRuntimeRoute<ProductCatalogRouteContext>({
    routeFamily: "product-search",
    deadlineMs: ROUTE_DEADLINE_MS.search,
    async respond({
      request,
      context,
      runtime,
      signal,
      measurement,
    }) {
      const url = new URL(request.url);
      const searchQuery = parseSearchParameters(url.searchParams);
      const { productSearchBuildId } = await context.params;
      const result = await runtime.searchProducts(
        {
          productSearchBuildId,
          ...searchQuery,
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
      if (isProductCatalogError(error)) {
        return jsonErrorResponse(
          error.status,
          error.code,
          error.publicMessage,
        );
      }

      const correlationId = measurement.correlationId;
      writeStructuredErrorLog(
        "product-catalog-request-failed",
        error,
        { correlationId },
      );
      return jsonErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Product search could not be completed.",
        correlationId,
      );
    },
  });

function parseSearchParameters(searchParameters: URLSearchParams): {
  query: string;
  locale: ProductSearchLocale;
  limit: number;
} {
  const keys = [...searchParameters.keys()];
  const query = searchParameters.get("q");
  const locale = searchParameters.get("locale");
  const limit = searchParameters.get("limit");
  if (
    keys.length !== 3 ||
    searchParameters.getAll("q").length !== 1 ||
    searchParameters.getAll("locale").length !== 1 ||
    searchParameters.getAll("limit").length !== 1 ||
    keys.some(
      (key) => key !== "q" && key !== "locale" && key !== "limit",
    ) ||
    query === null ||
    (locale !== "en" && locale !== "zh-Hans") ||
    limit === null ||
    !/^(?:[1-9]|1\d|20)$/u.test(limit)
  ) {
    throw invalidProductSearchQuery(
      "The route accepts exactly one q, supported locale, and integer limit from 1 through 20.",
    );
  }

  return { query, locale, limit: Number(limit) };
}
