import { createHash } from "node:crypto";

import {
  invalidProductSearchQuery,
  isProductCatalogError,
} from "../../../../../../catalog/product-catalog-errors";
import type { ProductSearchLocale } from "../../../../../../catalog/product-catalog";
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

type ProductCatalogRouteContext = {
  params: Promise<{
    productSearchBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: ProductCatalogRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: ProductCatalogRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: ProductCatalogRouteContext,
  headOnly: boolean,
): Promise<Response> {
  const applicationRuntime = getApplicationRuntime();
  return measureRuntimeRequest(
    applicationRuntime,
    "product-search",
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
  context: ProductCatalogRouteContext,
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
    const searchQuery = parseSearchParameters(url.searchParams);
    const { productSearchBuildId } = await context.params;
    const result = await applicationRuntime.searchProducts(
      {
        productSearchBuildId,
        ...searchQuery,
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
    if (isProductCatalogError(error)) {
      return jsonErrorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = measurement.correlationId;
    console.error("Product Catalog request failed", {
      correlationId,
      error,
    });
    return jsonErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Product search could not be completed.",
      correlationId,
    );
  } finally {
    deadline.dispose();
  }
}

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
