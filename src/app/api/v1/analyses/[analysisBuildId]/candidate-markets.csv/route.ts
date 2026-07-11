import { randomUUID } from "node:crypto";

import { createFixtureProductCatalog } from "../../../../../../catalog/fixture-product-catalog";
import { ProductCatalogError } from "../../../../../../catalog/product-catalog-errors";
import type { ProductSearchProduct } from "../../../../../../catalog/product-catalog";
import {
  CandidateMarketAnalysisError,
  invalidAnalysisQuery,
} from "../../../../../../domain/candidate-market/errors";
import { createFixtureCandidateMarketAnalysis } from "../../../../../../evidence/fixture-trade-evidence-source";
import {
  CANDIDATE_MARKETS_CSV_SCHEMA_VERSION,
  CandidateMarketCsvRepresentationError,
  serializeCandidateMarketCsv,
} from "../../../../../../export/candidate-market-csv";
import {
  resolveFixtureCurrentAnalysisManifest,
  resolveFixtureExportFreshnessStatus,
} from "../../../../../../release/fixture-current-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysis = createFixtureCandidateMarketAnalysis();
const productCatalog = createFixtureProductCatalog();
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";
const REQUIRED_SEARCH_PARAMETERS = [
  "exporter",
  "product",
  "productSearchBuildId",
  "freshnessStatusId",
  "schema",
] as const;

type CandidateMarketExportRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

class CandidateMarketExportRouteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    readonly publicMessage: string,
    message: string,
  ) {
    super(message);
    this.name = "CandidateMarketExportRouteError";
  }
}

export async function GET(
  request: Request,
  context: CandidateMarketExportRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: CandidateMarketExportRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: CandidateMarketExportRouteContext,
  headOnly: boolean,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = validateSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    validateIdentifier(analysisBuildId, "analysis build");

    const manifest = resolveFixtureCurrentAnalysisManifest();
    if (query.productSearchBuildId !== manifest.productSearchBuildId) {
      throw new CandidateMarketExportRouteError(
        404,
        "PRODUCT_SEARCH_BUILD_NOT_FOUND",
        "The requested product-search build is not available.",
        `Product-search build ${query.productSearchBuildId} is not served.`,
      );
    }
    const freshness = resolveFixtureExportFreshnessStatus(
      query.freshnessStatusId,
    );
    if (freshness === null) {
      throw new CandidateMarketExportRouteError(
        404,
        "FRESHNESS_STATUS_NOT_FOUND",
        "The requested freshness status is not available.",
        `Freshness status ${query.freshnessStatusId} is not served.`,
      );
    }

    const result = await analysis.analyze({
      analysisBuildId,
      exporterCode: query.exporter,
      productCode: query.product,
    });
    if (result.analysisBuildId !== manifest.analysisBuildId) {
      throw new CandidateMarketExportRouteError(
        409,
        "INCOMPATIBLE_PRODUCT_SEARCH_BUILD",
        "The product-search build is not compatible with the analysis build.",
        `Product-search build ${query.productSearchBuildId} is not bound to analysis build ${analysisBuildId}.`,
      );
    }
    if (
      freshness.servedBaciRelease !== result.provenance.baciRelease
    ) {
      throw new CandidateMarketExportRouteError(
        409,
        "INCOMPATIBLE_FRESHNESS_STATUS",
        "The freshness status is not compatible with the analysis release.",
        `Freshness status ${query.freshnessStatusId} does not describe ${result.provenance.baciRelease}.`,
      );
    }

    const product = await findExactProduct(
      query.productSearchBuildId,
      query.product,
    );
    const exported = serializeCandidateMarketCsv({
      result,
      product,
      manifest: { ...manifest, freshness },
    });
    const etag = `W/"sha256-${exported.sha256}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      "Content-Disposition": `attachment; filename="${exported.filename}"`,
      "Content-Type": "text/csv; charset=utf-8; header=present",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      Vary: "Accept-Encoding",
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(headOnly ? null : exported.bytes, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof CandidateMarketExportRouteError) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }
    if (error instanceof CandidateMarketAnalysisError) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }
    if (error instanceof ProductCatalogError) {
      const status = error.status === 410 ? 404 : error.status;
      const code =
        error.status === 410
          ? "PRODUCT_SEARCH_BUILD_NOT_FOUND"
          : error.code;
      return errorResponse(status, code, error.publicMessage);
    }
    if (error instanceof CandidateMarketCsvRepresentationError) {
      return errorResponse(
        503,
        error.code,
        "The complete Candidate Market export is temporarily unavailable.",
      );
    }

    const correlationId = randomUUID();
    console.error("Candidate Market CSV export request failed", {
      correlationId,
      error,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Candidate Market export could not be completed.",
      correlationId,
    );
  }
}

function validateSearchParameters(searchParameters: URLSearchParams): {
  exporter: string;
  product: string;
  productSearchBuildId: string;
  freshnessStatusId: string;
} {
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
    throw invalidAnalysisQuery(
      "The export route requires exactly one value for each export identity.",
    );
  }

  const schema = searchParameters.get("schema")!;
  if (schema !== CANDIDATE_MARKETS_CSV_SCHEMA_VERSION) {
    throw new CandidateMarketExportRouteError(
      400,
      "UNSUPPORTED_EXPORT_SCHEMA",
      "The requested export schema is not supported.",
      `Export schema ${schema} is not supported.`,
    );
  }
  const exporter = searchParameters.get("exporter")!;
  const product = searchParameters.get("product")!;
  const productSearchBuildId = searchParameters.get("productSearchBuildId")!;
  const freshnessStatusId = searchParameters.get("freshnessStatusId")!;
  if (!/^\d{1,3}$/u.test(exporter)) {
    throw invalidAnalysisQuery("The exporter must be a BACI economy code.");
  }
  if (!/^\d{6}$/u.test(product)) {
    throw invalidAnalysisQuery("The product must be a six-digit HS12 code.");
  }
  validateIdentifier(productSearchBuildId, "product-search build");
  validateIdentifier(freshnessStatusId, "freshness status");

  return {
    exporter,
    product,
    productSearchBuildId,
    freshnessStatusId,
  };
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u.test(value)) {
    throw invalidAnalysisQuery(`The ${name} identity is malformed.`);
  }
}

async function findExactProduct(
  productSearchBuildId: string,
  productCode: string,
): Promise<ProductSearchProduct> {
  const search = await productCatalog.search({
    productSearchBuildId,
    query: productCode,
    locale: "en",
    limit: 1,
  });
  const product = search.matches.find(
    (match) => match.product.code === productCode,
  )?.product;
  if (product === undefined) {
    throw new TypeError(
      `Product ${productCode} is absent from its compatible product catalog.`,
    );
  }
  return product;
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
