import { createHash, randomUUID } from "node:crypto";

import {
  ProductCatalogError,
  invalidProductSearchQuery,
} from "../../../../../../catalog/product-catalog-errors";
import { createFixtureProductCatalog } from "../../../../../../catalog/fixture-product-catalog";
import type { ProductSearchLocale } from "../../../../../../catalog/product-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const catalog = createFixtureProductCatalog();
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
  try {
    const url = new URL(request.url);
    const searchQuery = parseSearchParameters(url.searchParams);
    const { productSearchBuildId } = await context.params;
    const result = await catalog.search({
      productSearchBuildId,
      ...searchQuery,
    });
    const body = JSON.stringify(result);
    const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(headOnly ? null : body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = randomUUID();
    console.error("Product Catalog request failed", {
      correlationId,
      error,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Product search could not be completed.",
      correlationId,
    );
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

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId?: string,
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
      },
    },
  );
}
